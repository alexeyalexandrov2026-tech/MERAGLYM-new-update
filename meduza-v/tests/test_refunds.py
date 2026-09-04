"""Refunds: admin-initiated, provider-initiated, partial, and idempotent."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.db import session_scope
from app.models import (
    InventoryState,
    Order,
    OrderStatus,
    OutboxMessage,
    Product,
    Refund,
    RefundStatus,
)
from tests.conftest import checkout_payload, completed_session, stripe_event

pytestmark = pytest.mark.anyio


async def _paid_order(client, gateway) -> dict:
    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()
    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        session_id, intent_id = order.provider_session_id, order.provider_payment_intent_id
    body, signature = gateway.sign(
        stripe_event(
            "checkout.session.completed", completed_session(created, session_id, intent_id)
        )
    )
    response = await client.post(
        "/webhooks/stripe", content=body, headers={"Stripe-Signature": signature}
    )
    assert response.status_code == 200
    return created


async def test_full_refund_restocks_and_sends_a_receipt(
    client, gateway, products, admin_headers
):
    created = await _paid_order(client, gateway)
    response = await client.post(
        "/admin/refunds",
        json={"order_id": created["order_id"], "reason": "requested_by_customer"},
        headers=admin_headers,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "succeeded"
    assert body["amount_minor"] == created["total_minor"]

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.refunded
        assert order.amount_refunded_minor == created["total_minor"]
        assert order.inventory_state is InventoryState.restocked

        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_on_hand == 10, "refunded goods return to stock"

        receipt = await db.scalar(
            select(OutboxMessage).where(OutboxMessage.kind == "receipt.refunded")
        )
        assert receipt is not None
        assert "refund" in receipt.subject.lower()


async def test_partial_refund_leaves_the_order_partially_refunded(
    client, gateway, products, admin_headers
):
    created = await _paid_order(client, gateway)
    response = await client.post(
        "/admin/refunds",
        json={"order_id": created["order_id"], "amount_minor": 500},
        headers=admin_headers,
    )
    assert response.status_code == 201

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.partially_refunded
        assert order.amount_refunded_minor == 500
        assert order.inventory_state is InventoryState.committed, "no restock on partial"


async def test_refund_cannot_exceed_the_remaining_balance(
    client, gateway, products, admin_headers
):
    created = await _paid_order(client, gateway)
    await client.post(
        "/admin/refunds",
        json={"order_id": created["order_id"], "amount_minor": 500},
        headers=admin_headers,
    )
    response = await client.post(
        "/admin/refunds",
        json={"order_id": created["order_id"], "amount_minor": created["total_minor"]},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_repeated_refund_request_is_idempotent(
    client, gateway, products, admin_headers
):
    created = await _paid_order(client, gateway)
    payload = {"order_id": created["order_id"], "amount_minor": 500, "reason": "duplicate"}
    first = await client.post("/admin/refunds", json=payload, headers=admin_headers)
    second = await client.post("/admin/refunds", json=payload, headers=admin_headers)

    assert first.json()["id"] == second.json()["id"]
    async with session_scope() as db:
        assert await db.scalar(select(func.count()).select_from(Refund)) == 1
        order = await db.get(Order, created["order_id"])
        assert order.amount_refunded_minor == 500, "the money moved once"


async def test_unpaid_order_cannot_be_refunded(client, products, admin_headers):
    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()
    response = await client.post(
        "/admin/refunds", json={"order_id": created["order_id"]}, headers=admin_headers
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "invalid_state"


async def test_provider_initiated_refund_webhook_is_applied(client, gateway, products):
    """A refund issued from the provider dashboard must reconcile here too."""
    created = await _paid_order(client, gateway)
    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        intent_id = order.provider_payment_intent_id

    charge = {
        "id": "ch_test_123",
        "object": "charge",
        "payment_intent": intent_id,
        "metadata": {"order_id": created["order_id"]},
        "amount": created["total_minor"],
        "amount_refunded": created["total_minor"],
        "refunds": {"object": "list", "data": [{"id": "re_test_dash", "status": "succeeded"}]},
    }
    body, signature = gateway.sign(stripe_event("charge.refunded", charge))
    response = await client.post(
        "/webhooks/stripe", content=body, headers={"Stripe-Signature": signature}
    )
    assert response.status_code == 200

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.refunded
        assert order.amount_refunded_minor == created["total_minor"]
        refund = await db.scalar(select(Refund).where(Refund.provider_refund_id == "re_test_dash"))
        assert refund is not None and refund.status is RefundStatus.succeeded


async def test_replayed_refund_webhook_does_not_double_count(client, gateway, products):
    """amount_refunded is cumulative, so replay must be a no-op."""
    created = await _paid_order(client, gateway)
    async with session_scope() as db:
        intent_id = (await db.get(Order, created["order_id"])).provider_payment_intent_id

    charge = {
        "id": "ch_test_123",
        "object": "charge",
        "payment_intent": intent_id,
        "metadata": {"order_id": created["order_id"]},
        "amount": created["total_minor"],
        "amount_refunded": 500,
        "refunds": {"object": "list", "data": [{"id": "re_partial", "status": "succeeded"}]},
    }
    for event_id in ("evt_r1", "evt_r2"):
        body, signature = gateway.sign(stripe_event("charge.refunded", charge, event_id))
        await client.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": signature})

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.amount_refunded_minor == 500, "cumulative, not additive"
        assert await db.scalar(select(func.count()).select_from(Refund)) == 1


async def test_failed_refund_webhook_reverses_the_bookkeeping(
    client, gateway, products, admin_headers
):
    created = await _paid_order(client, gateway)
    refund = (
        await client.post(
            "/admin/refunds",
            json={"order_id": created["order_id"], "amount_minor": 500},
            headers=admin_headers,
        )
    ).json()

    body, signature = gateway.sign(
        stripe_event(
            "refund.updated",
            {"id": refund["provider_refund_id"], "object": "refund", "status": "failed"},
        )
    )
    response = await client.post(
        "/webhooks/stripe", content=body, headers={"Stripe-Signature": signature}
    )
    assert response.status_code == 200

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.amount_refunded_minor == 0, "a failed refund releases the balance"
        row = await db.get(Refund, refund["id"])
        assert row.status is RefundStatus.failed
