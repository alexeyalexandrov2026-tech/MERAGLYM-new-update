"""Administrative endpoints. Every route requires an admin key and is audited."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings, get_settings
from ..db import get_session, get_sessionmaker
from ..errors import ConflictError
from ..models import (
    FulfillmentStatus,
    OrderStatus,
    OutboxMessage,
    OutboxStatus,
    Product,
    utcnow,
)
from ..payments import PaymentGateway
from ..schemas import (
    FulfillmentUpdate,
    OrderOut,
    OrderPage,
    OutboxMessageOut,
    ProductCreate,
    ProductOut,
    ProductUpdate,
    RefundOut,
    RefundRequest,
    StockAdjustment,
)
from ..security import audit, require_admin
from ..services import catalog, inventory
from ..services import orders as order_service
from ..services import refunds as refund_service

router = APIRouter(
    prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)]
)
log = logging.getLogger(__name__)


def _product_out(product: Product) -> ProductOut:
    return ProductOut.model_validate(
        {**product.__dict__, "stock_available": product.stock_available}
    )


def get_gateway_dep(request: Request) -> PaymentGateway:
    return request.app.state.gateway


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #
@router.get("/orders", response_model=OrderPage)
async def list_orders(
    session: Annotated[AsyncSession, Depends(get_session)],
    status: OrderStatus | None = None,
    email: Annotated[str | None, Query(max_length=320)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
) -> OrderPage:
    rows, total = await order_service.list_orders(
        session, status=status, email=email, limit=limit, offset=offset
    )
    return OrderPage(
        items=[OrderOut.model_validate(o) for o in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: Annotated[str, Path(min_length=1, max_length=36)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrderOut:
    return OrderOut.model_validate(await order_service.get_by_id(session, order_id))


@router.post("/orders/{order_id}/fulfillment", response_model=OrderOut)
async def update_fulfillment(
    order_id: Annotated[str, Path(min_length=1, max_length=36)],
    payload: FulfillmentUpdate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    actor: Annotated[str, Depends(require_admin)],
) -> OrderOut:
    order = await order_service.get_by_id(session, order_id, for_update=True)
    await order_service.set_fulfillment(
        session, order, FulfillmentStatus(payload.status)
    )
    session.add(
        audit(
            actor=actor,
            action="order.fulfillment_update",
            request=request,
            settings=settings,
            subject_type="order",
            subject_id=order.id,
            detail={
                "status": payload.status,
                "carrier": payload.carrier,
                "tracking_number": payload.tracking_number,
            },
        )
    )
    return OrderOut.model_validate(order)


# --------------------------------------------------------------------------- #
# Refunds
# --------------------------------------------------------------------------- #
@router.post("/refunds", response_model=RefundOut, status_code=201)
async def create_refund(
    payload: RefundRequest,
    request: Request,
    gateway: Annotated[PaymentGateway, Depends(get_gateway_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
    actor: Annotated[str, Depends(require_admin)],
) -> RefundOut:
    refund = await refund_service.create_refund(
        get_sessionmaker(),
        gateway,
        settings,
        order_id=payload.order_id,
        amount_minor=payload.amount_minor,
        reason=payload.reason,
        restock=payload.restock,
        actor=actor,
    )
    from ..db import session_scope

    async with session_scope() as db:
        db.add(
            audit(
                actor=actor,
                action="refund.create",
                request=request,
                settings=settings,
                subject_type="order",
                subject_id=payload.order_id,
                detail={
                    "refund_id": refund.id,
                    "amount_minor": refund.amount_minor,
                    "reason": payload.reason,
                },
            )
        )
    return RefundOut.model_validate(refund)


# --------------------------------------------------------------------------- #
# Catalog management
# --------------------------------------------------------------------------- #
@router.post("/products", response_model=ProductOut, status_code=201)
async def create_product(
    payload: ProductCreate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    actor: Annotated[str, Depends(require_admin)],
) -> ProductOut:
    existing = await session.scalar(
        select(Product).where(
            (Product.sku == payload.sku) | (Product.slug == payload.slug)
        )
    )
    if existing is not None:
        raise ConflictError("A product with this SKU or slug already exists.")
    product = Product(**payload.model_dump())
    session.add(product)
    await session.flush()
    session.add(
        audit(
            actor=actor,
            action="product.create",
            request=request,
            settings=settings,
            subject_type="product",
            subject_id=product.id,
            detail={"sku": product.sku},
        )
    )
    return _product_out(product)


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: Annotated[str, Path(min_length=1, max_length=36)],
    payload: ProductUpdate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    actor: Annotated[str, Depends(require_admin)],
) -> ProductOut:
    product = await catalog.get_by_id(session, product_id)
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(product, field, value)
    session.add(
        audit(
            actor=actor,
            action="product.update",
            request=request,
            settings=settings,
            subject_type="product",
            subject_id=product.id,
            detail=changes,
        )
    )
    return _product_out(product)


@router.post("/products/{product_id}/stock", response_model=ProductOut)
async def adjust_stock(
    product_id: Annotated[str, Path(min_length=1, max_length=36)],
    payload: StockAdjustment,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    actor: Annotated[str, Depends(require_admin)],
) -> ProductOut:
    product = await catalog.get_by_id(session, product_id)
    await inventory.adjust_stock(session, product, payload.delta)
    session.add(
        audit(
            actor=actor,
            action="product.stock_adjust",
            request=request,
            settings=settings,
            subject_type="product",
            subject_id=product.id,
            detail={"delta": payload.delta, "reason": payload.reason},
        )
    )
    return _product_out(product)


# --------------------------------------------------------------------------- #
# Receipt queue
# --------------------------------------------------------------------------- #
@router.get("/outbox", response_model=list[OutboxMessageOut])
async def list_outbox(
    session: Annotated[AsyncSession, Depends(get_session)],
    status: OutboxStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[OutboxMessageOut]:
    stmt = select(OutboxMessage).order_by(OutboxMessage.created_at.desc()).limit(limit)
    if status is not None:
        stmt = stmt.where(OutboxMessage.status == status)
    rows = (await session.execute(stmt)).scalars().all()
    return [OutboxMessageOut.model_validate(row) for row in rows]


@router.post("/outbox/{message_id}/retry", response_model=OutboxMessageOut)
async def retry_outbox_message(
    message_id: Annotated[str, Path(min_length=1, max_length=36)],
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    actor: Annotated[str, Depends(require_admin)],
) -> OutboxMessageOut:
    """Requeue a dead-lettered receipt after the underlying problem is fixed."""
    message = await session.get(OutboxMessage, message_id)
    if message is None:
        from ..errors import NotFoundError

        raise NotFoundError("Outbox message not found.")
    message.status = OutboxStatus.pending
    message.attempts = 0
    message.next_attempt_at = utcnow()
    message.last_error = None
    message.locked_by = None
    message.locked_until = None
    session.add(
        audit(
            actor=actor,
            action="outbox.retry",
            request=request,
            settings=settings,
            subject_type="outbox_message",
            subject_id=message.id,
        )
    )
    return OutboxMessageOut.model_validate(message)
