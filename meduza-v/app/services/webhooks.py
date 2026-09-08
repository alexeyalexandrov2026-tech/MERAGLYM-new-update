"""Verified webhook ingestion with exactly-once side effects.

Duplicate suppression has two independent layers, because providers redeliver
events freely and a single layer is not enough:

1. ``webhook_events`` has a unique index on ``(provider, provider_event_id)``.
   The insert is the dedupe primitive — if it raises, the event is a duplicate
   and we acknowledge without re-running any side effect.
2. Every side effect is *itself* idempotent: order transitions are guarded by
   the state machine, stock movements by ``inventory_state``, and receipts by
   the outbox ``dedupe_key``. So even a duplicate that slips past layer 1
   (concurrent delivery, restored backup) cannot double-charge, double-ship,
   or double-send.

The endpoint always answers 200 once the signature verifies and the event is
recorded, so the provider stops retrying; failures during processing are
retried by our own worker from the ``webhook_events`` ledger.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..db import supports_row_locking
from ..models import (
    Order,
    OrderStatus,
    PaymentEventStatus,
    Refund,
    RefundStatus,
    WebhookEvent,
    utcnow,
)
from ..payments import PaymentEvent
from . import inventory, orders, outbox

log = logging.getLogger(__name__)

#: Event types we act on. Anything else is recorded as ``ignored`` — useful for
#: auditing what the provider actually sends, without growing the code path.
HANDLED_EVENT_TYPES = {
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "charge.refunded",
    "charge.refund.updated",
    "refund.updated",
}


@dataclass(slots=True)
class WebhookOutcome:
    status: str          # "processed" | "duplicate" | "ignored" | "failed"
    event_id: str
    order_id: str | None = None


async def record_event(
    session: AsyncSession, event: PaymentEvent, provider: str, raw_body: bytes
) -> WebhookEvent | None:
    """Insert the ledger row. ``None`` means this event was already seen."""
    record = WebhookEvent(
        provider=provider,
        provider_event_id=event.id,
        event_type=event.type,
        payload_digest=hashlib.sha256(raw_body).hexdigest(),
        payload=event.raw,
        status=PaymentEventStatus.received,
    )
    session.add(record)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return None
    return record


async def process_event(
    session: AsyncSession,
    event: PaymentEvent,
    settings: Settings,
) -> str | None:
    """Apply an event's side effects. Returns the affected order id, if any."""
    handler = {
        "checkout.session.completed": _handle_session_completed,
        "checkout.session.async_payment_succeeded": _handle_session_completed,
        "checkout.session.async_payment_failed": _handle_session_payment_failed,
        "checkout.session.expired": _handle_session_expired,
        "payment_intent.payment_failed": _handle_payment_intent_failed,
        "payment_intent.canceled": _handle_payment_intent_canceled,
        "charge.refunded": _handle_charge_refunded,
        "charge.refund.updated": _handle_refund_updated,
        "refund.updated": _handle_refund_updated,
    }.get(event.type)
    if handler is None:
        return None
    return await handler(session, event, settings)


# --------------------------------------------------------------------------- #
# Handlers
# --------------------------------------------------------------------------- #
async def _resolve_order(session: AsyncSession, event: PaymentEvent) -> Order | None:
    """Find the order this event belongs to, trying every reference we store."""
    obj = event.data
    order_id = (obj.get("metadata") or {}).get("order_id") or obj.get(
        "client_reference_id"
    )
    if order_id:
        stmt = select(Order).where(Order.id == order_id)
        if supports_row_locking(session):
            stmt = stmt.with_for_update()
        order = await session.scalar(stmt)
        if order is not None:
            return order
    session_id = obj.get("id") if obj.get("object") == "checkout.session" else None
    if session_id:
        order = await orders.get_by_session_id(session, session_id, for_update=True)
        if order is not None:
            return order
    intent = obj.get("payment_intent")
    if isinstance(intent, dict):
        intent = intent.get("id")
    if intent:
        return await orders.get_by_payment_intent(session, intent, for_update=True)
    return None


async def _handle_session_completed(
    session: AsyncSession, event: PaymentEvent, settings: Settings
) -> str | None:
    obj = event.data
    order = await _resolve_order(session, event)
    if order is None:
        log.error("webhook_order_not_found", extra={"event_type": event.type})
        return None

    # Stripe: a completed session is only *paid* when payment_status says so.
    # Delayed methods complete the session first and pay later, which arrives
    # as checkout.session.async_payment_succeeded.
    payment_status = obj.get("payment_status")
    if payment_status not in {"paid", "no_payment_required"}:
        log.info(
            "webhook_session_completed_unpaid",
            extra={"order_id": order.id, "payment_status": payment_status},
        )
        return order.id

    amount_total = obj.get("amount_total")
    if amount_total is not None and int(amount_total) != order.total_minor:
        # Never mark an order paid for an amount we did not ask for.
        log.error(
            "webhook_amount_mismatch",
            extra={
                "order_id": order.id,
                "expected_minor": order.total_minor,
                "received_minor": int(amount_total),
            },
        )
        order.failure_reason = "amount mismatch on payment confirmation"
        return order.id

    intent = obj.get("payment_intent")
    if isinstance(intent, dict):
        intent = intent.get("id")
    if intent:
        order.provider_payment_intent_id = intent

    changed = orders.transition(order, OrderStatus.paid, strict=False)
    if not changed:
        log.info("webhook_order_already_paid", extra={"order_id": order.id})
        return order.id

    order.paid_at = utcnow()
    order.failure_reason = None
    await inventory.commit(session, order)
    await outbox.enqueue_paid_receipt(session, order, settings)
    log.info(
        "order_paid",
        extra={
            "order_id": order.id,
            "reference": order.reference,
            "total_minor": order.total_minor,
        },
    )
    return order.id


async def _fail_order(
    session: AsyncSession,
    order: Order,
    settings: Settings,
    *,
    target: OrderStatus,
    reason: str,
) -> str:
    if orders.transition(order, target, strict=False):
        order.failure_reason = reason[:500]
        await inventory.release(session, order)
        await outbox.enqueue_payment_failed(session, order, settings, reason=reason)
        log.info(
            "order_payment_failed",
            extra={"order_id": order.id, "status": target.value, "reason": reason[:200]},
        )
    return order.id


async def _handle_session_payment_failed(
    session: AsyncSession, event: PaymentEvent, settings: Settings
) -> str | None:
    order = await _resolve_order(session, event)
    if order is None:
        return None
    return await _fail_order(
        session,
        order,
        settings,
        target=OrderStatus.payment_failed,
        reason="the payment was not completed",
    )


async def _handle_session_expired(
    session: AsyncSession, event: PaymentEvent, settings: Settings
) -> str | None:
    order = await _resolve_order(session, event)
    if order is None:
        return None
    if orders.transition(order, OrderStatus.expired, strict=False):
        order.failure_reason = "the checkout session expired"
        await inventory.release(session, order)
        log.info("order_expired", extra={"order_id": order.id})
    return order.id


async def _handle_payment_intent_failed(
    session: AsyncSession, event: PaymentEvent, settings: Settings
) -> str | None:
    order = await _resolve_order(session, event)
    if order is None:
        return None
    error = event.data.get("last_payment_error") or {}
    reason = error.get("message") or "the payment was declined"
    return await _fail_order(
        session, order, settings, target=OrderStatus.payment_failed, reason=reason
    )


async def _handle_payment_intent_canceled(
    session: AsyncSession, event: PaymentEvent, settings: Settings
) -> str | None:
    """The payment was abandoned or cancelled before it ever succeeded.

    Stripe spells the event ``payment_intent.canceled`` (one 'l'). The order is
    cancelled rather than marked failed: nothing went wrong, the buyer simply
    did not go through with it, so the buyer gets no failure notice. Stock is
    released either way.
    """
    order = await _resolve_order(session, event)
    if order is None:
        return None
    reason = (event.data.get("cancellation_reason") or "the payment was cancelled")
    if orders.transition(order, OrderStatus.cancelled, strict=False):
        order.failure_reason = str(reason)[:500]
        await inventory.release(session, order)
        log.info(
            "order_cancelled",
            extra={"order_id": order.id, "reason": str(reason)[:200]},
        )
    return order.id


async def _handle_charge_refunded(
    session: AsyncSession, event: PaymentEvent, settings: Settings
) -> str | None:
    """A charge was refunded, in whole or in part.

    Stripe reports the cumulative ``amount_refunded`` on the charge, so we set
    the order's refunded total from it rather than adding to it — that is what
    makes replaying the event harmless.
    """
    obj = event.data
    order = await _resolve_order(session, event)
    if order is None:
        return None

    charge_id = obj.get("id")
    if charge_id and obj.get("object") == "charge":
        order.provider_charge_id = charge_id

    amount_refunded = int(obj.get("amount_refunded") or 0)
    if amount_refunded <= order.amount_refunded_minor:
        log.info("webhook_refund_no_change", extra={"order_id": order.id})
        return order.id

    delta = amount_refunded - order.amount_refunded_minor
    order.amount_refunded_minor = min(amount_refunded, order.total_minor)

    fully_refunded = order.amount_refunded_minor >= order.total_minor
    orders.transition(
        order,
        OrderStatus.refunded if fully_refunded else OrderStatus.partially_refunded,
        strict=False,
    )
    if fully_refunded:
        await inventory.restock(session, order)

    # Record any refund objects we have not seen before.
    refund_id = _newest_refund_id(obj)
    await _upsert_refund(session, order, refund_id, delta)
    await outbox.enqueue_refund_receipt(
        session,
        order,
        settings,
        refund_id=refund_id or f"{order.id}:{order.amount_refunded_minor}",
        refund_amount_minor=delta,
    )
    log.info(
        "order_refunded",
        extra={
            "order_id": order.id,
            "amount_refunded_minor": order.amount_refunded_minor,
            "fully_refunded": fully_refunded,
        },
    )
    return order.id


async def _handle_refund_updated(
    session: AsyncSession, event: PaymentEvent, settings: Settings
) -> str | None:
    """Track a refund that later succeeded or failed (e.g. bank rejection)."""
    obj = event.data
    refund_id = obj.get("id")
    if not refund_id:
        return None
    refund = await session.scalar(
        select(Refund).where(Refund.provider_refund_id == refund_id)
    )
    if refund is None:
        return None
    status = obj.get("status")
    mapping = {
        "succeeded": RefundStatus.succeeded,
        "failed": RefundStatus.failed,
        "canceled": RefundStatus.cancelled,
        "pending": RefundStatus.pending,
    }
    if status in mapping:
        refund.status = mapping[status]
    if refund.status is RefundStatus.failed:
        order = await orders.get_by_id(session, refund.order_id, for_update=True)
        # The money came back to us; undo its effect on the order total.
        order.amount_refunded_minor = max(
            order.amount_refunded_minor - refund.amount_minor, 0
        )
        log.warning(
            "refund_failed",
            extra={"order_id": order.id, "refund_id": refund.provider_refund_id},
        )
        return order.id
    return refund.order_id


def event_from_record(record: WebhookEvent) -> PaymentEvent | None:
    """Rebuild a PaymentEvent from a stored ledger row, for replay."""
    raw = record.payload
    if not raw:
        return None
    return PaymentEvent(
        id=raw.get("id", record.provider_event_id),
        type=raw.get("type", record.event_type),
        created=record.received_at,
        data=dict((raw.get("data") or {}).get("object") or {}),
        raw=raw,
    )


def _newest_refund_id(charge: dict) -> str | None:
    refunds = (charge.get("refunds") or {}).get("data") or []
    if not refunds:
        return None
    return refunds[0].get("id")


async def _upsert_refund(
    session: AsyncSession, order: Order, refund_id: str | None, amount_minor: int
) -> None:
    if not refund_id or amount_minor <= 0:
        return
    existing = await session.scalar(
        select(Refund).where(Refund.provider_refund_id == refund_id)
    )
    if existing is not None:
        existing.status = RefundStatus.succeeded
        return
    session.add(
        Refund(
            order_id=order.id,
            provider_refund_id=refund_id,
            amount_minor=amount_minor,
            currency=order.currency,
            status=RefundStatus.succeeded,
            reason="provider-reported refund",
        )
    )
