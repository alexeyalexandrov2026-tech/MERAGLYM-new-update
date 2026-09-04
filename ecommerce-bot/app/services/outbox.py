"""Transactional outbox for receipts and customer notifications.

Enqueueing happens inside the same transaction that marks an order paid or
refunded, so "the order is paid" and "a receipt is owed" can never disagree.
A separate worker process drains the queue with exponential backoff and
dead-letters messages that exhaust their retry budget.
"""

from __future__ import annotations

import datetime as dt
import logging
import random
from collections.abc import Sequence

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..db import supports_row_locking
from ..errors import ReceiptDeliveryError
from ..models import Order, OutboxMessage, OutboxStatus, utcnow
from ..notifications import Message, NotificationChannel
from ..notifications.templates import (
    render_paid_receipt,
    render_payment_failed,
    render_refund_receipt,
)

log = logging.getLogger(__name__)

#: Backoff schedule in seconds, indexed by attempt number.
BACKOFF_SECONDS = (30, 60, 300, 900, 3600, 7200, 21600, 43200)
MAX_BACKOFF_SECONDS = 43200


def backoff_for(attempt: int) -> dt.timedelta:
    base = BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)]
    # Full jitter, so a provider outage does not produce a retry thundering herd.
    return dt.timedelta(seconds=base / 2 + random.random() * base / 2)


def _status_url(settings: Settings, order: Order) -> str:
    return (
        f"{settings.public_base_url}/api/orders/{order.id}"
        f"?token={order.access_token}"
    )


async def enqueue(
    session: AsyncSession,
    *,
    order: Order | None,
    kind: str,
    recipient: str,
    subject: str,
    body_text: str,
    body_html: str | None,
    dedupe_key: str,
    max_attempts: int,
    channel: str = "email",
) -> OutboxMessage | None:
    """Insert a message unless ``dedupe_key`` already exists.

    Returns ``None`` when the message was already queued — that is the normal
    outcome for a redelivered webhook, not an error.
    """
    existing = await session.scalar(
        select(OutboxMessage).where(OutboxMessage.dedupe_key == dedupe_key)
    )
    if existing is not None:
        return None
    message = OutboxMessage(
        order_id=order.id if order else None,
        kind=kind,
        channel=channel,
        recipient=recipient,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        dedupe_key=dedupe_key,
        max_attempts=max_attempts,
        next_attempt_at=utcnow(),
    )
    session.add(message)
    try:
        await session.flush()
    except IntegrityError:
        # Lost a race with a concurrent webhook delivery; the other one wins.
        await session.rollback()
        return None
    return message


async def enqueue_paid_receipt(
    session: AsyncSession, order: Order, settings: Settings
) -> OutboxMessage | None:
    subject, text, html = render_paid_receipt(
        order,
        store_name=settings.email_from_name,
        status_url=_status_url(settings, order),
    )
    return await enqueue(
        session,
        order=order,
        kind="receipt.paid",
        recipient=order.customer_email,
        subject=subject,
        body_text=text,
        body_html=html,
        dedupe_key=f"receipt.paid:{order.id}",
        max_attempts=settings.outbox_max_attempts,
    )


async def enqueue_refund_receipt(
    session: AsyncSession,
    order: Order,
    settings: Settings,
    *,
    refund_id: str,
    refund_amount_minor: int,
) -> OutboxMessage | None:
    subject, text, html = render_refund_receipt(
        order,
        refund_amount_minor=refund_amount_minor,
        store_name=settings.email_from_name,
        status_url=_status_url(settings, order),
    )
    return await enqueue(
        session,
        order=order,
        kind="receipt.refunded",
        recipient=order.customer_email,
        subject=subject,
        body_text=text,
        body_html=html,
        # Keyed on the refund, so partial refunds each get their own receipt.
        dedupe_key=f"receipt.refunded:{refund_id}",
        max_attempts=settings.outbox_max_attempts,
    )


async def enqueue_payment_failed(
    session: AsyncSession, order: Order, settings: Settings, *, reason: str | None
) -> OutboxMessage | None:
    subject, text, html = render_payment_failed(
        order,
        store_name=settings.email_from_name,
        storefront_url=settings.public_base_url,
        reason=reason,
    )
    return await enqueue(
        session,
        order=order,
        kind="order.payment_failed",
        recipient=order.customer_email,
        subject=subject,
        body_text=text,
        body_html=html,
        dedupe_key=f"order.payment_failed:{order.id}",
        max_attempts=3,
    )


# --------------------------------------------------------------------------- #
# Draining
# --------------------------------------------------------------------------- #
async def claim_batch(
    session: AsyncSession, *, worker_id: str, limit: int, lock_seconds: int
) -> Sequence[OutboxMessage]:
    """Atomically claim due messages for this worker.

    On PostgreSQL this uses ``FOR UPDATE SKIP LOCKED`` so several worker
    replicas can drain the same queue without contending or double-sending.
    """
    now = utcnow()
    stmt = (
        select(OutboxMessage)
        .where(
            OutboxMessage.status.in_([OutboxStatus.pending, OutboxStatus.failed]),
            OutboxMessage.next_attempt_at <= now,
        )
        .order_by(OutboxMessage.next_attempt_at)
        .limit(limit)
    )
    if supports_row_locking(session):
        stmt = stmt.with_for_update(skip_locked=True)
    messages = list((await session.execute(stmt)).scalars().all())
    if not messages:
        return []
    locked_until = now + dt.timedelta(seconds=lock_seconds)
    await session.execute(
        update(OutboxMessage)
        .where(OutboxMessage.id.in_([m.id for m in messages]))
        .values(locked_by=worker_id, locked_until=locked_until)
    )
    return messages


async def deliver(
    session: AsyncSession,
    message: OutboxMessage,
    channel: NotificationChannel,
) -> bool:
    """Attempt one delivery. Returns True on success.

    Never raises: a failure is recorded on the row so the worker keeps going.
    """
    message.attempts += 1
    try:
        await channel.send(
            Message(
                to=message.recipient,
                subject=message.subject,
                body_text=message.body_text,
                body_html=message.body_html,
            )
        )
    except ReceiptDeliveryError as exc:
        _record_failure(message, str(exc), permanent=exc.permanent)
        log.warning(
            "receipt_delivery_failed",
            extra={
                "outbox_id": message.id,
                "order_id": message.order_id,
                "kind": message.kind,
                "attempts": message.attempts,
                "permanent": exc.permanent,
                "status": message.status.value,
            },
        )
        return False
    except Exception as exc:
        _record_failure(message, f"unexpected: {exc!r}", permanent=False)
        log.exception("receipt_delivery_crashed", extra={"outbox_id": message.id})
        return False

    message.status = OutboxStatus.sent
    message.sent_at = utcnow()
    message.last_error = None
    message.locked_by = None
    message.locked_until = None
    log.info(
        "receipt_delivered",
        extra={
            "outbox_id": message.id,
            "order_id": message.order_id,
            "kind": message.kind,
            "attempts": message.attempts,
        },
    )
    return True


def _record_failure(message: OutboxMessage, error: str, *, permanent: bool) -> None:
    message.last_error = error[:2000]
    message.locked_by = None
    message.locked_until = None
    if permanent or message.attempts >= message.max_attempts:
        message.status = OutboxStatus.dead_letter
        message.next_attempt_at = utcnow()
    else:
        message.status = OutboxStatus.failed
        message.next_attempt_at = utcnow() + backoff_for(message.attempts)


async def reclaim_expired_locks(session: AsyncSession) -> int:
    """Return messages whose worker died mid-delivery to the queue."""
    result = await session.execute(
        update(OutboxMessage)
        .where(
            OutboxMessage.locked_until.is_not(None),
            OutboxMessage.locked_until < utcnow(),
            OutboxMessage.status.in_([OutboxStatus.pending, OutboxStatus.failed]),
        )
        .values(locked_by=None, locked_until=None)
    )
    return result.rowcount or 0
