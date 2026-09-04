"""Catalog queries."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import NotFoundError
from ..models import Product


async def list_products(
    session: AsyncSession,
    *,
    search: str | None = None,
    include_inactive: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Product], int]:
    filters = []
    if not include_inactive:
        filters.append(Product.is_active.is_(True))
    if search:
        # Parameterised LIKE; the wildcards are ours, the term is bound.
        term = f"%{search.strip().lower()}%"
        filters.append(
            or_(
                func.lower(Product.name).like(term),
                func.lower(Product.description).like(term),
                func.lower(Product.sku).like(term),
            )
        )
    total = await session.scalar(select(func.count()).select_from(Product).where(*filters))
    rows = (
        await session.execute(
            select(Product)
            .where(*filters)
            .order_by(Product.name)
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return list(rows), int(total or 0)


async def get_by_slug(session: AsyncSession, slug: str) -> Product:
    product = await session.scalar(
        select(Product).where(Product.slug == slug, Product.is_active.is_(True))
    )
    if product is None:
        raise NotFoundError("Product not found.")
    return product


async def get_by_id(session: AsyncSession, product_id: str) -> Product:
    product = await session.scalar(select(Product).where(Product.id == product_id))
    if product is None:
        raise NotFoundError("Product not found.")
    return product


async def get_by_skus(session: AsyncSession, skus: list[str]) -> dict[str, Product]:
    rows = (
        await session.execute(select(Product).where(Product.sku.in_(skus)))
    ).scalars().all()
    return {product.sku: product for product in rows}
