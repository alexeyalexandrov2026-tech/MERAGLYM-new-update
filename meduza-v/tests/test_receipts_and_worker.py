"""Receipt delivery, retry, dead-lettering, and the background worker."""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select

from app.db import session_scope
from app.errors import ReceiptDeliveryError
from app.models import (
    InventoryState,
    Order,
    OrderStatus,
    OutboxMessage,
    OutboxStatus,
    Product,
    utcnow,
)
from app.services import outbox
from app.worker import Worker
from tests.conftest import checkout_payload, completed_session, stripe_event

pytestmark = pytest.mark.anyio


async def _paid_order(client, gateway) -> dict:
    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()
    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        ids = (order.provider_session_id, order.provider_payment_intent_id)
    body, signature = gateway.sign(
        stripe_event("checkout.session.completed", completed_session(created, *ids))
    )
    await client.post("/webhooks/stripe", content=body, headers={"Stripe-Signature": signature})
    return created


def _worker(settings, channel, gateway) -> Worker:
    return Worker(settings, channel, gateway)


async def test_worker_delivers_the_receipt(client, gateway, channel, settings, products):
    created = await _paid_order(client, gateway)
    delivered = await _worker(settings, channel, gateway).drain_outbox()

    assert delivered == 1
    assert len(channel.sent) == 1
    message = channel.sent[0]
    assert message.to == "buyer@example.com"
    assert created["reference"] in message.subject
    assert created["reference"] in message.body_text
    assert message.body_html and "<table" in message.body_html
    # The receipt states the totals the buyer was actually charged.
    assert "33.00 USD" in message.body_text  # 2 x 16.50
    assert "38.00 USD" in message.body_text  # + 5.00 shipping

    async with session_scope() as db:
        row = await db.scalar(select(OutboxMessage))
        assert row.status is OutboxStatus.sent
        assert row.sent_at is not None
        assert row.attempts == 1


async def test_transient_delivery_failure_is_retried_with_backoff(
    client, gateway, channel, settings, products
):
    await _paid_order(client, gateway)
    channel.fail_times = 1

    assert await _worker(settings, channel, gateway).drain_outbox() == 0
    async with session_scope() as db:
        row = await db.scalar(select(OutboxMessage))
        assert row.status is OutboxStatus.failed
        assert row.attempts == 1
        assert "transient" in row.last_error
        assert row.next_attempt_at > utcnow(), "backoff must defer the next attempt"
        # Bring it forward so the test does not have to wait.
        row.next_attempt_at = utcnow() - dt.timedelta(seconds=1)

    assert await _worker(settings, channel, gateway).drain_outbox() == 1
    async with session_scope() as db:
        row = await db.scalar(select(OutboxMessage))
        assert row.status is OutboxStatus.sent
        assert row.attempts == 2


async def test_permanent_delivery_failure_dead_letters_immediately(
    client, gateway, channel, settings, products
):
    await _paid_order(client, gateway)
    channel.fail_permanently = True

    assert await _worker(settings, channel, gateway).drain_outbox() == 0
    async with session_scope() as db:
        row = await db.scalar(select(OutboxMessage))
        assert row.status is OutboxStatus.dead_letter
        assert row.attempts == 1, "no retry budget is spent on a permanent failure"


async def test_retry_budget_is_exhausted_then_dead_lettered(
    client, gateway, channel, settings, products
):
    await _paid_order(client, gateway)
    channel.fail_times = 99

    for _ in range(settings.outbox_max_attempts):
        async with session_scope() as db:
            row = await db.scalar(select(OutboxMessage))
            row.next_attempt_at = utcnow() - dt.timedelta(seconds=1)
        await _worker(settings, channel, gateway).drain_outbox()

    async with session_scope() as db:
        row = await db.scalar(select(OutboxMessage))
        assert row.status is OutboxStatus.dead_letter
        assert row.attempts == settings.outbox_max_attempts
    assert channel.sent == []


async def test_a_failed_receipt_never_unwinds_the_payment(
    client, gateway, channel, settings, products
):
    """Delivery is downstream of the money; it must not affect the order."""
    created = await _paid_order(client, gateway)
    channel.fail_permanently = True
    await _worker(settings, channel, gateway).drain_outbox()

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.paid
        assert order.inventory_state is InventoryState.committed


async def test_dead_lettered_receipt_can_be_requeued_by_an_operator(
    client, gateway, channel, settings, products, admin_headers
):
    await _paid_order(client, gateway)
    channel.fail_permanently = True
    await _worker(settings, channel, gateway).drain_outbox()

    listing = await client.get(
        "/admin/outbox", params={"status": "dead_letter"}, headers=admin_headers
    )
    assert listing.status_code == 200
    message_id = listing.json()[0]["id"]

    retry = await client.post(f"/admin/outbox/{message_id}/retry", headers=admin_headers)
    assert retry.status_code == 200
    assert retry.json()["status"] == "pending"

    channel.fail_permanently = False
    assert await _worker(settings, channel, gateway).drain_outbox() == 1
    assert len(channel.sent) == 1


async def test_worker_expires_stale_reservations(client, gateway, channel, settings, products):
    created = (await client.post("/api/checkout/sessions", json=checkout_payload())).json()
    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        order.reservation_expires_at = utcnow() - dt.timedelta(minutes=1)

    released = await _worker(settings, channel, gateway).expire_stale_reservations()
    assert released == 1

    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        assert order.status is OrderStatus.expired
        product = await db.scalar(select(Product).where(Product.sku == "COF-ETH-250"))
        assert product.stock_reserved == 0, "abandoned checkouts must not leak stock"
    assert order.provider_session_id in gateway.expired


async def test_worker_does_not_expire_an_order_that_was_just_paid(
    client, gateway, channel, settings, products
):
    created = await _paid_order(client, gateway)
    async with session_scope() as db:
        order = await db.get(Order, created["order_id"])
        order.reservation_expires_at = utcnow() - dt.timedelta(minutes=1)

    assert await _worker(settings, channel, gateway).expire_stale_reservations() == 0
    assert (await _order_status(created["order_id"])) is OrderStatus.paid


async def _order_status(order_id: str) -> OrderStatus:
    async with session_scope() as db:
        return (await db.get(Order, order_id)).status


async def test_worker_run_once_survives_a_failing_job(
    client, gateway, channel, settings, products, monkeypatch
):
    """One broken job must not stop the loop."""
    worker = _worker(settings, channel, gateway)

    async def boom() -> int:
        raise RuntimeError("database went away")

    monkeypatch.setattr(worker, "drain_outbox", boom)
    results = await worker.run_once()
    assert results["receipts_delivered"] == -1
    assert results["reservations_expired"] == 0


async def test_expired_worker_lock_is_reclaimed(client, gateway, channel, settings, products):
    """A worker that dies mid-delivery must not strand the message."""
    await _paid_order(client, gateway)
    async with session_scope() as db:
        row = await db.scalar(select(OutboxMessage))
        row.locked_by = "dead-worker:1"
        row.locked_until = utcnow() - dt.timedelta(minutes=5)

    async with session_scope() as db:
        assert await outbox.reclaim_expired_locks(db) == 1
        row = await db.scalar(select(OutboxMessage))
        assert row.locked_by is None


def test_backoff_grows_and_is_jittered():
    early = outbox.backoff_for(0).total_seconds()
    late = outbox.backoff_for(6).total_seconds()
    assert 15 <= early <= 30
    assert late > early
    assert outbox.backoff_for(99).total_seconds() <= outbox.MAX_BACKOFF_SECONDS


def test_receipt_delivery_error_marks_permanence():
    assert ReceiptDeliveryError("x", permanent=True).permanent is True
    assert ReceiptDeliveryError("x").permanent is False
