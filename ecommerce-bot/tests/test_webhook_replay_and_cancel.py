"""Cancellation events, the webhook ledger, and operator replay."""

from __future__ import annotations

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


async def _order(client) -> dict:
    response = await client.post("/api/checkout/sessions", json=checkout_payload())
    assert response.status_code == 201, response.text
    return response.json()


async def _ids(order_id: str) -> tuple[str, str]:
    async with session_scope() as db:
        order = await db.get(Order, order_id)
        return order.provider_session_id, order.provider_payment_intent_id


async def _post(client, gateway, event: dict):
    body, signature = gateway.sign(event)
    return await client.post(
        "/webhooks/stripe", content=body, headers={"Stripe-Signature": signature}
    )


# --------------------------------------------------------------------------- #
# Cancellation
# --------------------------------------------------------------------------- #
async def test_cancelled_payment_releases_stock_without_a_failure_notice(
    client, products, gateway
):
    """`payment_intent.canceled` is an abandonment, not a failure.

    The buyer gets no "your payment failed" email — nothing went wrong — but
    the stock they were holding must go back.
    """
    created = await _order(client)
    _, intent_id = await _ids(created["order_id"])

    response = await _post(
        client,
        gateway,
        stripe_event(
            "payment_intent.canceled",
            {
                "id": intent_id,
                "object": "payment_intent",
                "metadata": {"order_id": created["order_id"]},
                "cancellation_reason": "abandoned",
            },
        ),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "processed"

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.cancelled
        assert order.failure_reason == "abandoned"
        assert order.inventory_state is InventoryState.released

        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 0
        assert product.stock_on_hand == 10, "nothing was sold"

        notices = await db.scalar(
            select(func.count()).select_from(OutboxMessage).where(
                OutboxMessage.kind == "order.payment_failed"
            )
        )
        assert notices == 0, "a cancellation is not a payment failure"


async def test_cancellation_cannot_undo_a_paid_order(client, products, gateway):
    created = await _order(client)
    session_id, intent_id = await _ids(created["order_id"])
    await _post(
        client,
        gateway,
        stripe_event(
            "checkout.session.completed", completed_session(created, session_id, intent_id)
        ),
    )
    await _post(
        client,
        gateway,
        stripe_event(
            "payment_intent.canceled",
            {
                "id": intent_id,
                "object": "payment_intent",
                "metadata": {"order_id": created["order_id"]},
                "cancellation_reason": "abandoned",
            },
        ),
    )
    async with session_scope() as db:
        assert (await db.get(Order, created["order_id"])).status is OrderStatus.paid


# --------------------------------------------------------------------------- #
# Ledger
# --------------------------------------------------------------------------- #
async def test_admin_can_inspect_the_webhook_ledger(
    client, products, gateway, admin_headers
):
    created = await _order(client)
    session_id, intent_id = await _ids(created["order_id"])
    await _post(
        client,
        gateway,
        stripe_event(
            "checkout.session.completed", completed_session(created, session_id, intent_id)
        ),
    )

    listing = await client.get("/admin/webhooks", headers=admin_headers)
    assert listing.status_code == 200
    rows = listing.json()
    assert len(rows) == 1
    assert rows[0]["event_type"] == "checkout.session.completed"
    assert rows[0]["status"] == "processed"
    assert rows[0]["order_id"] == created["order_id"]

    filtered = await client.get(
        "/admin/webhooks", params={"status": "failed"}, headers=admin_headers
    )
    assert filtered.json() == []


async def test_webhook_ledger_requires_admin(client, products):
    assert (await client.get("/admin/webhooks")).status_code == 401
    assert (await client.post("/admin/webhooks/x/replay")).status_code == 401


# --------------------------------------------------------------------------- #
# Replay
# --------------------------------------------------------------------------- #
async def test_operator_can_replay_a_failed_event(
    client, products, gateway, admin_headers, monkeypatch
):
    """A handler that failed on a transient fault is recoverable by replay."""
    created = await _order(client)
    session_id, intent_id = await _ids(created["order_id"])
    event = stripe_event(
        "checkout.session.completed", completed_session(created, session_id, intent_id)
    )

    # Make the first delivery's side effects blow up after the event is banked.
    from app.services import webhooks as webhook_service

    original = webhook_service.process_event

    async def boom(*args, **kwargs):
        raise RuntimeError("database went away mid-handler")

    monkeypatch.setattr(webhook_service, "process_event", boom)
    first = await _post(client, gateway, event)
    # Still acknowledged: the event is durably recorded, ours to retry.
    assert first.status_code == 200
    assert first.json()["status"] == "accepted_pending_retry"

    async with session_scope() as db:
        row = await db.scalar(select(WebhookEvent))
        assert row.status is PaymentEventStatus.failed
        assert "database went away" in row.error
        event_row_id = row.id
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.pending_payment, "no side effect landed"

    monkeypatch.setattr(webhook_service, "process_event", original)
    replay = await client.post(
        f"/admin/webhooks/{event_row_id}/replay", headers=admin_headers
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["status"] == "processed"
    assert replay.json()["order_id"] == created["order_id"]

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.paid
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_on_hand == 8


async def test_replaying_an_applied_event_is_a_no_op(
    client, products, gateway, admin_headers
):
    """Replay must be safe to run on anything, including already-applied work."""
    created = await _order(client)
    session_id, intent_id = await _ids(created["order_id"])
    await _post(
        client,
        gateway,
        stripe_event(
            "checkout.session.completed", completed_session(created, session_id, intent_id)
        ),
    )
    async with session_scope() as db:
        event_row_id = (await db.scalar(select(WebhookEvent))).id

    for _ in range(3):
        response = await client.post(
            f"/admin/webhooks/{event_row_id}/replay", headers=admin_headers
        )
        assert response.status_code == 200
        assert response.json()["status"] == "processed"

    async with session_scope() as db:
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_on_hand == 8, "stock committed exactly once"
        assert product.stock_reserved == 0
        receipts = await db.scalar(
            select(func.count()).select_from(OutboxMessage).where(
                OutboxMessage.kind == "receipt.paid"
            )
        )
        assert receipts == 1, "one receipt, no matter how many replays"


async def test_replaying_an_unknown_event_is_404(client, products, admin_headers):
    response = await client.post(
        "/admin/webhooks/00000000-0000-0000-0000-000000000000/replay",
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_replay_is_audited(client, products, gateway, admin_headers):
    from app.models import AdminAuditLog

    created = await _order(client)
    session_id, intent_id = await _ids(created["order_id"])
    await _post(
        client,
        gateway,
        stripe_event(
            "checkout.session.completed", completed_session(created, session_id, intent_id)
        ),
    )
    async with session_scope() as db:
        event_row_id = (await db.scalar(select(WebhookEvent))).id

    await client.post(f"/admin/webhooks/{event_row_id}/replay", headers=admin_headers)

    async with session_scope() as db:
        entry = await db.scalar(
            select(AdminAuditLog).where(AdminAuditLog.action == "webhook.replay")
        )
        assert entry is not None
        assert entry.subject_id == event_row_id
        assert entry.detail["event_type"] == "checkout.session.completed"
