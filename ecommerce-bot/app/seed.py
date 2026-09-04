"""Seed the catalog with sample lawful merchandise.

PLACEHOLDER CONTENT: replace this catalog with your own products. Everything
here is ordinary unrestricted general merchandise (coffee, brewing equipment,
homeware) — no age-restricted, licensed, or otherwise regulated goods.

Run with:  python -m app.seed
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from .config import get_settings
from .db import dispose_engine, init_engine, session_scope
from .logging_config import configure_logging
from .models import Product

log = logging.getLogger(__name__)

SAMPLE_PRODUCTS = [
    {
        "sku": "COF-ETH-250",
        "slug": "ethiopia-yirgacheffe-250g",
        "name": "Ethiopia Yirgacheffe, 250g",
        "description": "Washed single-origin filter roast. Jasmine, bergamot, stone fruit.",
        "unit_price_minor": 1650,
        "stock_on_hand": 120,
        "weight_grams": 250,
    },
    {
        "sku": "COF-COL-1KG",
        "slug": "colombia-huila-1kg",
        "name": "Colombia Huila, 1kg",
        "description": "Balanced everyday espresso. Cocoa, red apple, caramel.",
        "unit_price_minor": 4200,
        "stock_on_hand": 60,
        "weight_grams": 1000,
    },
    {
        "sku": "EQP-GRD-01",
        "slug": "hand-grinder-conical",
        "name": "Conical Hand Grinder",
        "description": "Stainless conical burrs, 40 click-adjustable steps.",
        "unit_price_minor": 8900,
        "stock_on_hand": 25,
        "weight_grams": 640,
    },
    {
        "sku": "EQP-SCL-01",
        "slug": "brew-scale-0-1g",
        "name": "Brew Scale (0.1g)",
        "description": "Rechargeable 2kg scale with built-in timer and flow rate.",
        "unit_price_minor": 5400,
        "stock_on_hand": 40,
        "weight_grams": 480,
    },
    {
        "sku": "HOM-MUG-350",
        "slug": "stoneware-mug-350ml",
        "name": "Stoneware Mug, 350ml",
        "description": "Hand-glazed stoneware. Dishwasher and microwave safe.",
        "unit_price_minor": 1800,
        "stock_on_hand": 200,
        "weight_grams": 420,
    },
]


async def seed() -> int:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_format)
    init_engine(settings)
    created = 0
    try:
        async with session_scope() as session:
            for spec in SAMPLE_PRODUCTS:
                exists = await session.scalar(
                    select(Product).where(Product.sku == spec["sku"])
                )
                if exists is not None:
                    continue
                session.add(
                    Product(
                        **spec,
                        currency=settings.currency,
                        is_active=True,
                        requires_shipping=True,
                    )
                )
                created += 1
        log.info("catalog_seeded", extra={"created": created})
        return created
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(seed())
