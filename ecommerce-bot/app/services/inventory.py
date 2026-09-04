"""Inventory reservation with an explicit, idempotent state machine.

Lifecycle of an order's stock::

    checkout created  ->  reserved   (stock_reserved += qty)
    payment confirmed ->  committed  (stock_reserved -= qty, stock_on_hand -= qty)
    expired/failed    ->  released   (stock_reserved -= qty)
    full refund       ->  restocked  (stock_on_hand += qty)

Every transition checks the order's current ``inventory_state`` first, so a
redelivered webhook can call ``commit`` twice without double-decrementing.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import supports_row_locking
from ..errors import OutOfStockError
from ..models import InventoryState, Order, Product

log = logging.getLogger(__name__)


async def _lock_products(session: AsyncSession, product_ids: list[str]) -> dict[str, Product]:
    """Load products, taking row locks on backends that support them.

    Two details here are load-bearing, and getting either wrong silently
    reintroduces overselling:

    * ``order_by(id)`` gives every transaction the same lock order, which is
      what prevents deadlocks between concurrent multi-item checkouts.
    * ``populate_existing()`` forces the freshly locked row values over
      whatever is already in the session's identity map. Callers routinely
      read a product *before* locking it (to price the basket), and without
      this the ``FOR UPDATE`` query waits for the lock correctly and then
      hands back the pre-lock, stale attribute values — so every racing
      transaction computes availability from the same outdated number and
      they all think there is stock.
    """
    if not product_ids:
        return {}
    stmt = (
        select(Product)
        .where(Product.id.in_(product_ids))
        .order_by(Product.id)
        .execution_options(populate_existing=True)
    )
    if supports_row_locking(session):
        stmt = stmt.with_for_update()
    rows = (await session.execute(stmt)).scalars().all()
    return {product.id: product for product in rows}


async def reserve(session: AsyncSession, order: Order) -> None:
    """Hold stock for a pending order. Raises OutOfStockError if unavailable."""
    products = await _lock_products(session, sorted({i.product_id for i in order.items}))
    for item in order.items:
        product = products.get(item.product_id)
        if product is None or not product.is_active:
            raise OutOfStockError(
                f"{item.sku} is no longer available.", details={"sku": item.sku}
            )
        if product.stock_available < item.quantity:
            raise OutOfStockError(
                f"Only {product.stock_available} of {item.sku} left in stock.",
                details={"sku": item.sku, "available": product.stock_available},
            )
    for item in order.items:
        products[item.product_id].stock_reserved += item.quantity
    order.inventory_state = InventoryState.reserved


async def commit(session: AsyncSession, order: Order) -> bool:
    """Convert a reservation into a sale. Returns False if already committed."""
    if order.inventory_state is not InventoryState.reserved:
        log.info(
            "inventory_commit_skipped",
            extra={"order_id": order.id, "inventory_state": order.inventory_state.value},
        )
        return False
    products = await _lock_products(session, sorted({i.product_id for i in order.items}))
    for item in order.items:
        product = products.get(item.product_id)
        if product is None:
            continue
        # Clamp defensively: an operator write-off could have moved stock under us.
        product.stock_reserved = max(product.stock_reserved - item.quantity, 0)
        product.stock_on_hand = max(product.stock_on_hand - item.quantity, 0)
    order.inventory_state = InventoryState.committed
    return True


async def release(session: AsyncSession, order: Order) -> bool:
    """Return a never-sold reservation to available stock."""
    if order.inventory_state is not InventoryState.reserved:
        return False
    products = await _lock_products(session, sorted({i.product_id for i in order.items}))
    for item in order.items:
        product = products.get(item.product_id)
        if product is not None:
            product.stock_reserved = max(product.stock_reserved - item.quantity, 0)
    order.inventory_state = InventoryState.released
    return True


async def restock(session: AsyncSession, order: Order) -> bool:
    """Return refunded goods to available stock."""
    if order.inventory_state is not InventoryState.committed:
        return False
    products = await _lock_products(session, sorted({i.product_id for i in order.items}))
    for item in order.items:
        product = products.get(item.product_id)
        if product is not None:
            product.stock_on_hand += item.quantity
    order.inventory_state = InventoryState.restocked
    return True


async def adjust_stock(session: AsyncSession, product: Product, delta: int) -> Product:
    """Operator stock movement (goods received, shrinkage, correction)."""
    new_on_hand = product.stock_on_hand + delta
    if new_on_hand < 0:
        raise OutOfStockError("Adjustment would drive stock below zero.")
    if new_on_hand < product.stock_reserved:
        raise OutOfStockError(
            "Adjustment would drop stock below what is already reserved.",
            details={"reserved": product.stock_reserved},
        )
    product.stock_on_hand = new_on_hand
    return product
