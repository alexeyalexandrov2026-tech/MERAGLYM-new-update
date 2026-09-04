"""Webhook verification, successful payment, failure, duplicates, expiry."""

from __future__ import annotations

import json
import time

import pytest
from sqlalchemy import func, select

from app.db import session_scope
from app.models import (
    InventoryState,
    Order,
    OrderStatus,
    OutboxMessage,
    PaymentEventStatus,
    Product,
    WebhookEvent,
)
from tests.conftest import checkout_payload, completed_session, stripe_event

pytestmark = pytest.mark.anyio


async def _create_order(client) -> dict:
    response = await client.post("/api/checkout/sessions", json=checkout_payload())
    assert response.status_code == 201, response.text
    return response.json()


async def _order_row(order_id: str) -> Order:
    async with session_scope() as db:
        return await db.get(Order, order_id)


async def _post_event(client, gateway, event: dict):
    body, signature = gateway.sign(event)
    return await client.post(
        "/webhooks/stripe",
        content=body,
        headers={"Stripe-Signature": signature, "Content-Type": "application/json"},
    )


# --------------------------------------------------------------------------- #
# Signature verification
# --------------------------------------------------------------------------- #
async def test_unsigned_webhook_is_rejected(client, products, gateway):
    response = await client.post("/webhooks/stripe", json={"id": "evt_x", "type": "ping"})
    assert response.status_code == 400


async def test_forged_signature_is_rejected(client, products, gateway):
    event = stripe_event("checkout.session.completed", {})
    body = json.dumps(event).encode()
    response = await client.post(
        "/webhooks/stripe",
        content=body,
        headers={"Stripe-Signature": f"t={int(time.time())},v1=deadbeef"},
    )
    assert response.status_code == 400
    async with session_scope() as db:
        assert await db.scalar(select(func.count()).select_from(WebhookEvent)) == 0


async def test_tampered_body_is_rejected(client, products, gateway):
    """A valid signature over a different payload must not verify."""
    event = stripe_event("checkout.session.completed", {"id": "cs_x"})
    body, signature = gateway.sign(event)
    tampered = body.replace(b"cs_x", b"cs_y")
    response = await client.post(
        "/webhooks/stripe", content=tampered, headers={"Stripe-Signature": signature}
    )
    assert response.status_code == 400


async def test_stale_timestamp_is_rejected(client, products, gateway):
    """Replay protection: the provider's tolerance window is enforced."""
    event = stripe_event("checkout.session.completed", {"id": "cs_x"})
    body, signature = gateway.sign(event, timestamp=int(time.time()) - 86_400)
    response = await client.post(
        "/webhooks/stripe", content=body, headers={"Stripe-Signature": signature}
    )
    assert response.status_code == 400


# --------------------------------------------------------------------------- #
# Successful payment
# --------------------------------------------------------------------------- #
async def test_successful_payment_commits_stock_and_queues_a_receipt(
    client, products, gateway
):
    created = await _create_order(client)
    order = await _order_row(created["order_id"])
    event = stripe_event(
        "checkout.session.completed",
        completed_session(created, order.provider_session_id, order.provider_payment_intent_id),
    )

    response = await _post_event(client, gateway, event)
    assert response.status_code == 200
    assert response.json()["status"] == "processed"

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.paid
        assert order.paid_at is not None
        assert order.inventory_state is InventoryState.committed

        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_on_hand == 8, "sold units leave on-hand stock"
        assert product.stock_reserved == 0, "the reservation is consumed"

        receipts = (
            await db.execute(select(OutboxMessage).where(OutboxMessage.kind == "receipt.paid"))
        ).scalars().all()
        assert len(receipts) == 1
        assert receipts[0].recipient == "buyer@example.com"
        assert created["reference"] in receipts[0].body_text


async def test_amount_mismatch_does_not_mark_the_order_paid(client, products, gateway):
    """Never trust the amount in the event over the amount we asked for."""
    created = await _create_order(client)
    order = await _order_row(created["order_id"])
    session_obj = completed_session(
        created, order.provider_session_id, order.provider_payment_intent_id
    )
    session_obj["amount_total"] = 1  # underpaid

    await _post_event(client, gateway, stripe_event("checkout.session.completed", session_obj))

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.pending_payment
        assert "amount mismatch" in (order.failure_reason or "")


async def test_completed_but_unpaid_session_does_not_confirm(client, products, gateway):
    """Delayed payment methods complete the session before the money arrives."""
    created = await _create_order(client)
    order = await _order_row(created["order_id"])
    session_obj = completed_session(
        created, order.provider_session_id, order.provider_payment_intent_id
    )
    session_obj["payment_status"] = "unpaid"

    await _post_event(client, gateway, stripe_event("checkout.session.completed", session_obj))
    assert (await _order_row(created["order_id"])).status is OrderStatus.pending_payment

    # ...and the later async success does confirm it.
    session_obj["payment_status"] = "paid"
    await _post_event(
        client, gateway, stripe_event("checkout.session.async_payment_succeeded", session_obj)
    )
    assert (await _order_row(created["order_id"])).status is OrderStatus.paid


# --------------------------------------------------------------------------- #
# Duplicates
# --------------------------------------------------------------------------- #
async def test_duplicate_webhook_is_a_no_op(client, products, gateway):
    created = await _create_order(client)
    order = await _order_row(created["order_id"])
    event = stripe_event(
        "checkout.session.completed",
        completed_session(created, order.provider_session_id, order.provider_payment_intent_id),
        event_id="evt_duplicate_test",
    )

    first = await _post_event(client, gateway, event)
    second = await _post_event(client, gateway, event)
    third = await _post_event(client, gateway, event)

    assert first.json()["status"] == "processed"
    assert second.json()["status"] == "duplicate"
    assert third.json()["status"] == "duplicate"
    assert all(r.status_code == 200 for r in (first, second, third))

    async with session_scope() as db:
        assert await db.scalar(select(func.count()).select_from(WebhookEvent)) == 1
        # The side effects ran exactly once.
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_on_hand == 8
        assert product.stock_reserved == 0
        receipts = await db.scalar(
            select(func.count()).select_from(OutboxMessage).where(
                OutboxMessage.kind == "receipt.paid"
            )
        )
        assert receipts == 1


async def test_distinct_events_for_the_same_order_are_still_idempotent(
    client, products, gateway
):
    """Second layer of defence: a *different* event id, same effect."""
    created = await _create_order(client)
    order = await _order_row(created["order_id"])
    payload = completed_session(
        created, order.provider_session_id, order.provider_payment_intent_id
    )

    await _post_event(client, gateway, stripe_event("checkout.session.completed", payload, "evt_a"))
    await _post_event(client, gateway, stripe_event("checkout.session.completed", payload, "evt_b"))

    async with session_scope() as db:
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_on_hand == 8, "stock must be committed only once"
        receipts = await db.scalar(
            select(func.count()).select_from(OutboxMessage).where(
                OutboxMessage.kind == "receipt.paid"
            )
        )
        assert receipts == 1, "only one receipt, even for two distinct events"


# --------------------------------------------------------------------------- #
# Failures and expiry
# --------------------------------------------------------------------------- #
async def test_failed_payment_releases_stock_and_notifies(client, products, gateway):
    created = await _create_order(client)
    order = await _order_row(created["order_id"])
    event = stripe_event(
        "payment_intent.payment_failed",
        {
            "id": order.provider_payment_intent_id,
            "object": "payment_intent",
            "metadata": {"order_id": created["order_id"]},
            "last_payment_error": {"message": "Your card was declined."},
        },
    )
    response = await _post_event(client, gateway, event)
    assert response.status_code == 200

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.payment_failed
        assert order.failure_reason == "Your card was declined."
        assert order.inventory_state is InventoryState.released

        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 0
        assert product.stock_on_hand == 10, "nothing was sold"

        notice = await db.scalar(
            select(OutboxMessage).where(OutboxMessage.kind == "order.payment_failed")
        )
        assert notice is not None and notice.recipient == "buyer@example.com"


async def test_expired_session_releases_stock(client, products, gateway):
    created = await _create_order(client)
    order = await _order_row(created["order_id"])
    event = stripe_event(
        "checkout.session.expired",
        {
            "id": order.provider_session_id,
            "object": "checkout.session",
            "metadata": {"order_id": created["order_id"]},
            "status": "expired",
        },
    )
    await _post_event(client, gateway, event)

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.expired
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 0


async def test_paid_order_cannot_be_moved_back_to_failed(client, products, gateway):
    """Out-of-order redelivery must not un-sell a paid order."""
    created = await _create_order(client)
    order = await _order_row(created["order_id"])
    paid = completed_session(
        created, order.provider_session_id, order.provider_payment_intent_id
    )
    await _post_event(client, gateway, stripe_event("checkout.session.completed", paid))

    await _post_event(
        client,
        gateway,
        stripe_event(
            "payment_intent.payment_failed",
            {
                "id": order.provider_payment_intent_id,
                "object": "payment_intent",
                "metadata": {"order_id": created["order_id"]},
                "last_payment_error": {"message": "late failure"},
            },
        ),
    )
    assert (await _order_row(created["order_id"])).status is OrderStatus.paid


async def test_unhandled_event_type_is_recorded_and_ignored(client, products, gateway):
    event = stripe_event("customer.subscription.created", {"id": "sub_123"})
    response = await _post_event(client, gateway, event)
    assert response.status_code == 200
    assert response.json()["status"] == "ignored"

    async with session_scope() as db:
        row = await db.scalar(select(WebhookEvent))
        assert row.status is PaymentEventStatus.ignored


async def test_oversized_body_is_rejected(client, products, gateway):
    huge = b"x" * (1_048_576 + 1)
    response = await client.post(
        "/webhooks/stripe", content=huge, headers={"Stripe-Signature": "t=1,v1=x"}
    )
    assert response.status_code == 413
