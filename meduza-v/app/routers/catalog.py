"""Public catalog endpoints. Read-only, rate limited, no authentication."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..schemas import ProductOut, ProductPage
from ..security import public_rate_limit
from ..services import catalog

router = APIRouter(prefix="/api/catalog", tags=["catalog"])

_limit = Depends(public_rate_limit("catalog", "rate_limit_public_per_minute"))


@router.get("/products", response_model=ProductPage, dependencies=[_limit])
async def list_products(
    session: Annotated[AsyncSession, Depends(get_session)],
    search: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> ProductPage:
    products, total = await catalog.list_products(
        session, search=search, limit=limit, offset=offset
    )
    return ProductPage(
        items=[
            ProductOut.model_validate(
                {**p.__dict__, "stock_available": p.stock_available}
            )
            for p in products
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/products/{slug}", response_model=ProductOut, dependencies=[_limit])
async def get_product(
    slug: Annotated[str, Path(max_length=160, pattern=r"^[a-z0-9\-]+$")],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ProductOut:
    product = await catalog.get_by_slug(session, slug)
    return ProductOut.model_validate(
        {**product.__dict__, "stock_available": product.stock_available}
    )
