"""Checkout and buyer-facing order status."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings, get_settings
from ..db import get_session, get_sessionmaker
from ..payments import PaymentGateway
from ..schemas import CheckoutRequest, CheckoutResponse, OrderOut
from ..security import public_rate_limit
from ..services import checkout as checkout_service
from ..services import orders as order_service

router = APIRouter(prefix="/api", tags=["checkout"])


def get_gateway_dep(request: Request) -> PaymentGateway:
    return request.app.state.gateway


@router.post(
    "/checkout/sessions",
    response_model=CheckoutResponse,
    status_code=201,
    dependencies=[Depends(public_rate_limit("checkout", "rate_limit_checkout_per_minute"))],
)
async def create_checkout_session(
    payload: CheckoutRequest,
    gateway: Annotated[PaymentGateway, Depends(get_gateway_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=255)] = None,
) -> CheckoutResponse:
    """Create an order and return the provider-hosted payment URL.

    The buyer's card details go straight to the payment provider from that
    page; they never touch this service.
    """
    key = checkout_service.derive_idempotency_key(payload, idempotency_key)
    order = await checkout_service.create_checkout(
        get_sessionmaker(), gateway, settings, payload, idempotency_key=key
    )
    return CheckoutResponse(
        order_id=order.id,
        reference=order.reference,
        status=order.status,
        checkout_url=order.checkout_url or "",
        total_minor=order.total_minor,
        currency=order.currency,
        expires_at=order.reservation_expires_at,
        order_status_url=(
            f"{settings.public_base_url}/api/orders/{order.id}?token={order.access_token}"
        ),
    )


@router.get(
    "/orders/{order_id}",
    response_model=OrderOut,
    dependencies=[Depends(public_rate_limit("order_status", "rate_limit_public_per_minute"))],
)
async def get_order_status(
    order_id: Annotated[str, Path(min_length=1, max_length=36)],
    token: Annotated[str, Query(min_length=8, max_length=64)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrderOut:
    """Buyer-facing order lookup, authorised by the token issued at checkout."""
    order = await order_service.get_for_customer(session, order_id, token)
    return OrderOut.model_validate(order)
