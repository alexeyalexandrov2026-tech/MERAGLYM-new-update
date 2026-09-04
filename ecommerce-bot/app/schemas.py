"""Request/response schemas. All external input is validated here."""

from __future__ import annotations

import datetime as dt
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import (
    FulfillmentStatus,
    InventoryState,
    OrderStatus,
    OutboxStatus,
    RefundStatus,
)

SAFE_TEXT = re.compile(r"^[\w\s.,'\-/#()&+]{1,200}$", re.UNICODE)
COUNTRY_CODE = re.compile(r"^[A-Z]{2}$")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Catalog
# --------------------------------------------------------------------------- #
class ProductOut(ORMModel):
    id: str
    sku: str
    slug: str
    name: str
    description: str
    image_url: str | None
    unit_price_minor: int
    currency: str
    stock_available: int
    is_active: bool
    requires_shipping: bool


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int
    limit: int
    offset: int


class ProductCreate(BaseModel):
    sku: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._\-]+$")]
    slug: Annotated[str, Field(min_length=1, max_length=160, pattern=r"^[a-z0-9\-]+$")]
    name: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=5000)] = ""
    image_url: Annotated[str, Field(max_length=500)] | None = None
    unit_price_minor: Annotated[int, Field(ge=0, le=100_000_000)]
    currency: Annotated[str, Field(min_length=3, max_length=3)]
    stock_on_hand: Annotated[int, Field(ge=0, le=1_000_000)] = 0
    is_active: bool = True
    requires_shipping: bool = True
    weight_grams: Annotated[int, Field(ge=0, le=1_000_000)] = 0

    @field_validator("currency")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()

    @field_validator("image_url")
    @classmethod
    def _https_only(cls, v: str | None) -> str | None:
        if v and not v.startswith(("https://", "/")):
            raise ValueError("image_url must be https or a site-relative path")
        return v


class ProductUpdate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    description: Annotated[str, Field(max_length=5000)] | None = None
    unit_price_minor: Annotated[int, Field(ge=0, le=100_000_000)] | None = None
    is_active: bool | None = None


class StockAdjustment(BaseModel):
    """Positive to receive stock, negative to write it off."""

    delta: Annotated[int, Field(ge=-1_000_000, le=1_000_000)]
    reason: Annotated[str, Field(min_length=1, max_length=200)]

    @field_validator("delta")
    @classmethod
    def _non_zero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("delta must not be zero")
        return v


# --------------------------------------------------------------------------- #
# Checkout
# --------------------------------------------------------------------------- #
class ShippingAddress(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line1: Annotated[str, Field(min_length=1, max_length=200)]
    line2: Annotated[str, Field(max_length=200)] | None = None
    city: Annotated[str, Field(min_length=1, max_length=100)]
    postal_code: Annotated[str, Field(min_length=1, max_length=32)]
    state: Annotated[str, Field(max_length=100)] | None = None
    country: Annotated[str, Field(min_length=2, max_length=2)]

    @field_validator("country")
    @classmethod
    def _country(cls, v: str) -> str:
        v = v.upper()
        if not COUNTRY_CODE.match(v):
            raise ValueError("country must be a 2-letter ISO-3166-1 alpha-2 code")
        return v

    @field_validator("line1", "line2", "city", "state")
    @classmethod
    def _safe(cls, v: str | None) -> str | None:
        if v is not None and not SAFE_TEXT.match(v):
            raise ValueError("field contains unsupported characters")
        return v


class CheckoutLineItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sku: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._\-]+$")]
    quantity: Annotated[int, Field(ge=1, le=25)]


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    customer_name: Annotated[str, Field(max_length=200)] | None = None
    items: Annotated[list[CheckoutLineItem], Field(min_length=1, max_length=20)]
    shipping_address: ShippingAddress | None = None

    @field_validator("items")
    @classmethod
    def _no_duplicate_skus(cls, v: list[CheckoutLineItem]) -> list[CheckoutLineItem]:
        skus = [item.sku for item in v]
        if len(set(skus)) != len(skus):
            raise ValueError("duplicate sku in items; combine them into one line")
        return v

    @field_validator("customer_name")
    @classmethod
    def _safe_name(cls, v: str | None) -> str | None:
        if v is not None and not SAFE_TEXT.match(v):
            raise ValueError("customer_name contains unsupported characters")
        return v


class CheckoutResponse(BaseModel):
    order_id: str
    reference: str
    status: OrderStatus
    checkout_url: str
    total_minor: int
    currency: str
    expires_at: dt.datetime | None
    order_status_url: str


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #
class OrderItemOut(ORMModel):
    sku: str
    name: str
    unit_price_minor: int
    quantity: int
    line_total_minor: int


class RefundOut(ORMModel):
    id: str
    provider_refund_id: str | None
    amount_minor: int
    currency: str
    reason: str | None
    status: RefundStatus
    created_at: dt.datetime


class OrderOut(ORMModel):
    id: str
    reference: str
    status: OrderStatus
    fulfillment_status: FulfillmentStatus
    inventory_state: InventoryState
    customer_email: EmailStr
    customer_name: str | None
    currency: str
    subtotal_minor: int
    shipping_minor: int
    total_minor: int
    amount_refunded_minor: int
    shipping_address: dict | None
    paid_at: dt.datetime | None
    failure_reason: str | None
    created_at: dt.datetime
    items: list[OrderItemOut]
    refunds: list[RefundOut] = []


class OrderPage(BaseModel):
    items: list[OrderOut]
    total: int
    limit: int
    offset: int


class FulfillmentUpdate(BaseModel):
    status: Literal["in_progress", "shipped", "delivered", "cancelled"]
    tracking_number: Annotated[str, Field(max_length=100)] | None = None
    carrier: Annotated[str, Field(max_length=100)] | None = None


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: Annotated[str, Field(min_length=1, max_length=36)]
    #: Omit for a full refund of the remaining refundable amount.
    amount_minor: Annotated[int, Field(ge=1, le=100_000_000)] | None = None
    reason: Annotated[str, Field(max_length=200)] | None = None
    restock: bool = True


# --------------------------------------------------------------------------- #
# Ops
# --------------------------------------------------------------------------- #
class OutboxMessageOut(ORMModel):
    id: str
    order_id: str | None
    kind: str
    channel: str
    recipient: str
    status: OutboxStatus
    attempts: int
    last_error: str | None
    next_attempt_at: dt.datetime
    sent_at: dt.datetime | None


class HealthOut(BaseModel):
    status: Literal["ok", "degraded", "error"]
    checks: dict[str, str] = {}
    version: str = "1.0.0"


class ErrorOut(BaseModel):
    error: dict
