"""Order lookup and state transitions."""

from __future__ import annotations

import logging
import secrets
import string

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import supports_row_locking
from ..errors import InvalidStateError, NotFoundError
from ..models import (
    ORDER_TRANSITIONS,
    FulfillmentStatus,
    Order,
    OrderStatus,
)

log = logging.getLogger(__name__)

_REFERENCE_ALPHABET = string.ascii_uppercase + string.digits


def new_reference() -> str:
    """Human-quotable order reference, e.g. ORD-7QK2M4XA."""
    return "ORD-" + "".join(secrets.choice(_REFERENCE_ALPHABET) for _ in range(8))


def transition(order: Order, target: OrderStatus, *, strict: bool = True) -> bool:
    """Move an order to ``target`` if the state machine allows it.

    Returns True if the status changed. With ``strict=False`` a disallowed
    transition is logged and ignored rather than raised — which is what webhook
    handlers want, because providers redeliver events out of order.
    """
    if order.status is target:
        return False
    if target not in ORDER_TRANSITIONS[order.status]:
        if strict:
            raise InvalidStateError(
                f"Cannot move order from {order.status.value} to {target.value}.",
                details={"from": order.status.value, "to": target.value},
            )
        log.info(
            "order_transition_ignored",
            extra={
                "order_id": order.id,
                "from": order.status.value,
                "to": target.value,
            },
        )
        return False
    log.info(
        "order_transition",
        extra={"order_id": order.id, "from": order.status.value, "to": target.value},
    )
    order.status = target
    return True


async def get_by_id(
    session: AsyncSession, order_id: str, *, for_update: bool = False
) -> Order:
    stmt = select(Order).where(Order.id == order_id)
    if for_update and supports_row_locking(session):
        stmt = stmt.with_for_update()
    order = await session.scalar(stmt)
    if order is None:
        raise NotFoundError("Order not found.")
    return order


async def get_by_session_id(
    session: AsyncSession, provider_session_id: str, *, for_update: bool = False
) -> Order | None:
    stmt = select(Order).where(Order.provider_session_id == provider_session_id)
    if for_update and supports_row_locking(session):
        stmt = stmt.with_for_update()
    return await session.scalar(stmt)


async def get_by_payment_intent(
    session: AsyncSession, payment_intent_id: str, *, for_update: bool = False
) -> Order | None:
    stmt = select(Order).where(Order.provider_payment_intent_id == payment_intent_id)
    if for_update and supports_row_locking(session):
        stmt = stmt.with_for_update()
    return await session.scalar(stmt)


async def get_for_customer(session: AsyncSession, order_id: str, token: str) -> Order:
    """Token-scoped lookup for the buyer's own order.

    The comparison is constant time and happens after the row is fetched, so a
    wrong token and a missing order are indistinguishable to the caller.
    """
    order = await session.scalar(select(Order).where(Order.id == order_id))
    if order is None or not secrets.compare_digest(order.access_token, token):
        raise NotFoundError("Order not found.")
    return order


async def list_orders(
    session: AsyncSession,
    *,
    status: OrderStatus | None = None,
    email: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Order], int]:
    filters = []
    if status is not None:
        filters.append(Order.status == status)
    if email:
        filters.append(Order.customer_email == email.lower())

    total = await session.scalar(
        select(func.count()).select_from(Order).where(*filters)
    )
    rows = (
        await session.execute(
            select(Order)
            .where(*filters)
            .order_by(Order.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return list(rows), int(total or 0)


async def set_fulfillment(
    session: AsyncSession,
    order: Order,
    status: FulfillmentStatus,
) -> Order:
    if order.status not in {
        OrderStatus.paid,
        OrderStatus.fulfilled,
        OrderStatus.partially_refunded,
    }:
        raise InvalidStateError(
            "Only a paid order can be fulfilled.",
            details={"status": order.status.value},
        )
    order.fulfillment_status = status
    if status in {FulfillmentStatus.shipped, FulfillmentStatus.delivered}:
        transition(order, OrderStatus.fulfilled, strict=False)
    return order
