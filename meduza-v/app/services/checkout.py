"""Checkout: build an order, reserve stock, and hand the buyer to the
provider-hosted payment page.

Two properties this module exists to guarantee:

1. **Prices come from the database, never from the request.** The client sends
   SKUs and quantities only; every amount is recomputed server-side and the
   same figures are what the provider is asked to charge.
2. **Locks are never held across a network call.** Stock is reserved and
   committed in one short transaction; the provider call happens outside it;
   a second short transaction records the result (or unwinds the reservation).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
import secrets
from collections.abc import Iterable, Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..errors import ConflictError, PaymentProviderError, ValidationError
from ..models import (
    InventoryState,
    Order,
    OrderItem,
    OrderStatus,
    utcnow,
)
from ..payments import CheckoutSessionSpec, LineItemSpec, PaymentGateway
from ..schemas import CheckoutRequest
from . import catalog, inventory, orders

log = logging.getLogger(__name__)


def derive_idempotency_key(request: CheckoutRequest, supplied: str | None) -> str:
    """Use the client's Idempotency-Key, else a digest of the request body.

    The digest fallback stops a double-clicked buy button from creating two
    orders and two stock reservations for the same basket.

    Neither form of key is a secret: the client picks the supplied one, and the
    fallback is derived from data a stranger can guess. Replay is therefore
    authorised by `fingerprint`, never by the key alone — see
    `find_replayed_order`.
    """
    if supplied:
        return supplied[:255]
    return "auto-" + fingerprint(request)


def _fingerprint(
    email: str,
    customer_name: str | None,
    lines: Iterable[tuple[str, int]],
    address: Mapping[str, Any] | None,
) -> str:
    parts = [
        email.lower().strip(),
        (customer_name or "").strip(),
        *(f"{sku}x{quantity}" for sku, quantity in sorted(lines)),
    ]
    if address is None:
        parts.append("-")
    else:
        parts.extend(
            str(address.get(field) or "").strip()
            for field in ("line1", "line2", "city", "postal_code", "state", "country")
        )
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def fingerprint(request: CheckoutRequest) -> str:
    """Digest of everything this caller supplied about the order."""
    return _fingerprint(
        request.email,
        request.customer_name,
        ((i.sku, i.quantity) for i in request.items),
        request.shipping_address.model_dump() if request.shipping_address else None,
    )


def order_fingerprint(order: Order) -> str:
    """The same digest, recomputed from an order already in the database."""
    return _fingerprint(
        order.customer_email,
        order.customer_name,
        ((i.sku, i.quantity) for i in order.items),
        order.shipping_address,
    )


async def find_replayed_order(
    session: AsyncSession, key: str, request: CheckoutRequest
) -> Order | None:
    """Return a still-payable order previously created by *this same request*.

    The key alone must never be enough. A client picks its own
    `Idempotency-Key`, and the fallback key is a digest of an email address and
    a basket — both guessable. Returning an order on a key match alone handed
    any caller who guessed them somebody else's order together with its
    `access_token`, which is the credential for reading that order's name and
    shipping address; registering the key first also let an attacker redirect a
    stranger's checkout to their own address.

    So a replay is only honoured when the incoming request is byte-for-byte the
    request that created the order. A caller who satisfies that already knows
    everything the order can disclose.
    """
    order = await session.scalar(select(Order).where(Order.idempotency_key == key))
    if order is None:
        return None
    if order.status is not OrderStatus.pending_payment or not order.checkout_url:
        return None
    if order.reservation_expires_at and order.reservation_expires_at <= utcnow():
        return None
    if not secrets.compare_digest(order_fingerprint(order), fingerprint(request)):
        # Only a client-supplied key can land here: the fallback key *is* the
        # fingerprint, so two different requests never derive the same one.
        log.warning("checkout_idempotency_key_collision", extra={"order_id": order.id})
        raise ConflictError(
            "This Idempotency-Key is already in use for a different checkout."
        )
    return order


async def build_order(
    session: AsyncSession,
    request: CheckoutRequest,
    settings: Settings,
    *,
    idempotency_key: str,
) -> Order:
    """Create a pending order with stock reserved. Commits nothing itself."""
    if len(request.items) > settings.max_line_items_per_order:
        raise ValidationError("Too many line items in this order.")

    products = await catalog.get_by_skus(session, [i.sku for i in request.items])
    missing = [i.sku for i in request.items if i.sku not in products]
    if missing:
        raise ValidationError(
            "Unknown or unavailable product.", details={"skus": missing}
        )

    currencies = {products[i.sku].currency for i in request.items}
    if len(currencies) > 1:
        raise ValidationError("All items in an order must share one currency.")
    currency = currencies.pop()

    order = Order(
        reference=orders.new_reference(),
        status=OrderStatus.pending_payment,
        inventory_state=InventoryState.reserved,
        customer_email=request.email.lower(),
        customer_name=request.customer_name,
        shipping_address=(
            request.shipping_address.model_dump() if request.shipping_address else None
        ),
        currency=currency,
        payment_provider=settings.payment_provider,
        idempotency_key=idempotency_key,
        reservation_expires_at=utcnow()
        + dt.timedelta(minutes=settings.checkout_session_ttl_minutes),
    )

    subtotal = 0
    needs_shipping = False
    for line in request.items:
        product = products[line.sku]
        if not product.is_active:
            raise ValidationError(
                f"{line.sku} is not available.", details={"sku": line.sku}
            )
        if line.quantity > settings.max_quantity_per_line:
            raise ValidationError(
                f"At most {settings.max_quantity_per_line} of {line.sku} per order."
            )
        line_total = product.unit_price_minor * line.quantity
        subtotal += line_total
        needs_shipping = needs_shipping or product.requires_shipping
        order.items.append(
            OrderItem(
                product_id=product.id,
                sku=product.sku,
                name=product.name,
                unit_price_minor=product.unit_price_minor,
                quantity=line.quantity,
                line_total_minor=line_total,
            )
        )

    if needs_shipping and request.shipping_address is None:
        raise ValidationError("This order contains shippable items; an address is required.")

    order.subtotal_minor = subtotal
    order.shipping_minor = settings.shipping_flat_minor if needs_shipping else 0
    order.total_minor = order.subtotal_minor + order.shipping_minor
    if order.total_minor <= 0:
        raise ValidationError("Order total must be greater than zero.")

    session.add(order)
    await inventory.reserve(session, order)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("This checkout was already submitted.") from exc
    return order


def build_session_spec(
    order: Order, settings: Settings, *, idempotency_key: str
) -> CheckoutSessionSpec:
    line_items = tuple(
        LineItemSpec(
            name=item.name,
            description=f"SKU {item.sku}",
            unit_amount_minor=item.unit_price_minor,
            quantity=item.quantity,
            currency=order.currency,
        )
        for item in order.items
    )
    if order.shipping_minor:
        line_items += (
            LineItemSpec(
                name="Shipping",
                description="Standard delivery",
                unit_amount_minor=order.shipping_minor,
                quantity=1,
                currency=order.currency,
            ),
        )
    return CheckoutSessionSpec(
        order_id=order.id,
        order_reference=order.reference,
        customer_email=order.customer_email,
        currency=order.currency,
        line_items=line_items,
        success_url=(
            f"{settings.public_base_url}{settings.storefront_success_path}"
            f"?order={order.id}&token={order.access_token}"
        ),
        cancel_url=(
            f"{settings.public_base_url}{settings.storefront_cancel_path}"
            f"?order={order.id}"
        ),
        expires_at=order.reservation_expires_at
        or utcnow() + dt.timedelta(minutes=settings.checkout_session_ttl_minutes),
        metadata={"order_id": order.id, "order_reference": order.reference},
        idempotency_key=f"checkout:{idempotency_key}",
    )


async def attach_session(
    session: AsyncSession,
    order_id: str,
    *,
    session_id: str,
    url: str,
    payment_intent_id: str | None,
    expires_at: dt.datetime | None,
) -> Order:
    order = await orders.get_by_id(session, order_id, for_update=True)
    order.provider_session_id = session_id
    order.checkout_url = url
    order.provider_payment_intent_id = payment_intent_id
    if expires_at:
        order.reservation_expires_at = expires_at
    return order


async def abandon_after_provider_failure(
    session: AsyncSession, order_id: str, reason: str
) -> None:
    """Unwind a reservation when the provider call failed."""
    order = await orders.get_by_id(session, order_id, for_update=True)
    await inventory.release(session, order)
    orders.transition(order, OrderStatus.cancelled, strict=False)
    order.failure_reason = reason[:500]
    log.warning(
        "checkout_abandoned", extra={"order_id": order.id, "reason": reason[:200]}
    )


async def create_checkout(
    session_factory,
    gateway: PaymentGateway,
    settings: Settings,
    request: CheckoutRequest,
    *,
    idempotency_key: str,
) -> Order:
    """Full checkout flow across three short units of work."""
    from ..db import session_scope

    # 1. Reserve stock and persist the pending order.
    async with session_scope() as db:
        replay = await find_replayed_order(db, idempotency_key, request)
        if replay is not None:
            log.info("checkout_idempotent_replay", extra={"order_id": replay.id})
            return replay
        order = await build_order(db, request, settings, idempotency_key=idempotency_key)
        order_id = order.id
        spec = build_session_spec(order, settings, idempotency_key=idempotency_key)

    # 2. Call the provider with no database locks held.
    try:
        result = await gateway.create_checkout_session(spec)
    except PaymentProviderError as exc:
        async with session_scope() as db:
            await abandon_after_provider_failure(db, order_id, str(exc))
        raise

    # 3. Record the provider's references.
    async with session_scope() as db:
        order = await attach_session(
            db,
            order_id,
            session_id=result.session_id,
            url=result.url,
            payment_intent_id=result.payment_intent_id,
            expires_at=result.expires_at,
        )
        log.info(
            "checkout_created",
            extra={
                "order_id": order.id,
                "reference": order.reference,
                "total_minor": order.total_minor,
                "currency": order.currency,
                "provider_session_id": result.session_id,
            },
        )
        await db.refresh(order, ["items"])
        return order
