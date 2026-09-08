"""Money helpers.

All amounts are stored and transported as integer minor units (cents) to avoid
floating point drift, matching how Stripe represents amounts.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

# ISO-4217 codes that have no minor unit. Stripe treats these as whole numbers.
ZERO_DECIMAL_CURRENCIES = {
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
    "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
}


def minor_unit_exponent(currency: str) -> int:
    return 0 if currency.lower() in ZERO_DECIMAL_CURRENCIES else 2


def format_amount(amount_minor: int, currency: str) -> str:
    exponent = minor_unit_exponent(currency)
    if exponent == 0:
        return f"{amount_minor} {currency.upper()}"
    value = (Decimal(amount_minor) / (Decimal(10) ** exponent)).quantize(
        Decimal(1).scaleb(-exponent), rounding=ROUND_HALF_UP
    )
    return f"{value} {currency.upper()}"
