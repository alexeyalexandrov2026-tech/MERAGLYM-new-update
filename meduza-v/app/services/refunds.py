"""Operator-initiated refunds.

The provider is the source of truth for money movement. This module records
intent, calls the provider once (with an idempotency key so a retried admin
request cannot refund twice), then records the result. The authoritative
bookkeeping still happens when the provider's ``charge.refunded`` webhook
arrives, which keeps a refund issued from the provider's own dashboard
consistent with one issued here.
"""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy import select

from ..config import Settings
from ..errors import ConflictError, InvalidStateError, ValidationError
from ..models import OrderStatus, Refund, RefundStatus
from ..payments import PaymentGateway
from . import inventory, orders, outbox

log = logging.getLogger(__name__)

REFUNDABLE_STATUSES = {
    OrderStatus.paid,
    OrderStatus.fulfilled,
    OrderStatus.partially_refunded,
}


def refund_idempotency_key(order_id: str, amount_minor: int, reason: str | None) -> str:
    digest = hashlib.sha256(
        f"{order_id}|{amount_minor}|{reason or ''}".encode()
    ).hexdigest()
    return f"refund:{digest}"


async def create_refund(
    session_factory,
    gateway: PaymentGateway,
    settings: Settings,
    *,
    order_id: str,
    amount_minor: int | None,
    reason: str | None,
    restock: bool,
    actor: str,
) -> Refund:
    from ..db import session_scope

    # 1. Validate and record intent.
    async with session_scope() as db:
        order = await orders.get_by_id(db, order_id, for_update=True)
        if order.status not in REFUNDABLE_STATUSES:
            raise InvalidStateError(
                "Only a paid order can be refunded.",
                details={"status": order.status.value},
            )
        if not order.provider_payment_intent_id:
            raise InvalidStateError("This order has no provider payment to refund.")

        refundable = order.is_refundable_amount_minor
        if refundable <= 0:
            raise InvalidStateError("This order is already fully refunded.")
        amount = amount_minor if amount_minor is not None else refundable
        if amount > refundable:
            raise ValidationError(
                "Refund exceeds the remaining refundable amount.",
                details={"refundable_minor": refundable},
            )

        key = refund_idempotency_key(order_id, amount, reason)
        existing = await db.scalar(select(Refund).where(Refund.idempotency_key == key))
        if existing is not None and existing.status is not RefundStatus.failed:
            log.info("refund_idempotent_replay", extra={"refund_id": existing.id})
            return existing

        refund = Refund(
            order_id=order.id,
            amount_minor=amount,
            currency=order.currency,
            reason=reason,
            status=RefundStatus.pending,
            requested_by=actor,
            idempotency_key=key,
        )
        db.add(refund)
        await db.flush()
        refund_id = refund.id
        payment_intent_id = order.provider_payment_intent_id
        full_refund = amount >= refundable

    # 2. Ask the provider, holding no locks.
    try:
        result = await gateway.create_refund(
            payment_intent_id=payment_intent_id,
            amount_minor=amount,
            reason=reason,
            idempotency_key=key,
        )
    except Exception:
        async with session_scope() as db:
            failed = await db.get(Refund, refund_id)
            if failed is not None:
                failed.status = RefundStatus.failed
        log.exception("refund_provider_call_failed", extra={"order_id": order_id})
        raise

    # 3. Record the outcome.
    async with session_scope() as db:
        refund = await db.get(Refund, refund_id)
        if refund is None:  # pragma: no cover - defensive
            raise ConflictError("Refund record vanished mid-flight.")
        refund.provider_refund_id = result.refund_id
        refund.status = {
            "succeeded": RefundStatus.succeeded,
            "pending": RefundStatus.pending,
            "failed": RefundStatus.failed,
            "canceled": RefundStatus.cancelled,
        }.get(result.status, RefundStatus.pending)

        if refund.status is RefundStatus.succeeded:
            order = await orders.get_by_id(db, order_id, for_update=True)
            order.amount_refunded_minor = min(
                order.amount_refunded_minor + result.amount_minor, order.total_minor
            )
            fully = order.amount_refunded_minor >= order.total_minor
            orders.transition(
                order,
                OrderStatus.refunded if fully else OrderStatus.partially_refunded,
                strict=False,
            )
            if fully and restock:
                await inventory.restock(db, order)
            await outbox.enqueue_refund_receipt(
                db,
                order,
                settings,
                refund_id=result.refund_id,
                refund_amount_minor=result.amount_minor,
            )
        log.info(
            "refund_created",
            extra={
                "order_id": order_id,
                "refund_id": refund.id,
                "provider_refund_id": result.refund_id,
                "amount_minor": result.amount_minor,
                "status": refund.status.value,
                "actor": actor,
                "full_refund": full_refund,
            },
        )
        await db.refresh(refund)
        return refund
