"""Database models.

Design notes:

* Money is stored as integer minor units (``amount_*_minor``) plus an ISO-4217
  currency code. No floats anywhere in the money path.
* No card data is stored, ever. The only payment identifiers persisted are the
  provider's opaque references (checkout session id, payment intent id,
  charge id, refund id).
* ``Order`` carries an explicit state machine plus a separate
  ``inventory_state`` so that stock reservation/commit/release is idempotent and
  can be replayed safely when a webhook is redelivered.
* Receipts are delivered through a transactional outbox (``OutboxMessage``) so
  that "order is paid" and "a receipt will be sent" commit atomically.
"""

from __future__ import annotations

import datetime as dt
import enum
import secrets
import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, TypeDecorator

# JSONB on PostgreSQL, plain JSON elsewhere (tests on SQLite).
JSONType = JSON().with_variant(postgresql.JSONB(), "postgresql")


class UTCDateTime(TypeDecorator):
    """A timestamp that is always timezone-aware UTC on the way in and out.

    PostgreSQL ``timestamptz`` already round-trips an aware value, but SQLite
    does not — it hands back a naive datetime, and comparing that to an aware
    ``utcnow()`` raises. Normalising here means every comparison in the
    application works identically on both backends.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt.UTC)
        return value.astimezone(dt.UTC)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=dt.UTC)
        return value.astimezone(dt.UTC)


def utcnow() -> dt.datetime:
    return dt.datetime.now(tz=dt.UTC)


def new_uuid() -> str:
    return str(uuid.uuid4())


def new_public_token() -> str:
    """Unguessable token used to view an order without an account."""
    return secrets.token_urlsafe(32)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[dt.datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        UTCDateTime,
        server_default=func.now(),
        onupdate=utcnow,
        nullable=False,
    )


# --------------------------------------------------------------------------- #
# Enumerations
# --------------------------------------------------------------------------- #
class OrderStatus(str, enum.Enum):
    pending_payment = "pending_payment"
    paid = "paid"
    fulfilled = "fulfilled"
    payment_failed = "payment_failed"
    expired = "expired"
    cancelled = "cancelled"
    partially_refunded = "partially_refunded"
    refunded = "refunded"


#: Allowed order transitions. Anything not listed here is rejected outright,
#: which is what makes replayed webhooks safe.
ORDER_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.pending_payment: {
        OrderStatus.paid,
        OrderStatus.payment_failed,
        OrderStatus.expired,
        OrderStatus.cancelled,
    },
    OrderStatus.paid: {
        OrderStatus.fulfilled,
        OrderStatus.partially_refunded,
        OrderStatus.refunded,
    },
    OrderStatus.fulfilled: {
        OrderStatus.partially_refunded,
        OrderStatus.refunded,
    },
    OrderStatus.partially_refunded: {
        OrderStatus.partially_refunded,
        OrderStatus.refunded,
    },
    OrderStatus.payment_failed: {OrderStatus.pending_payment, OrderStatus.cancelled},
    OrderStatus.expired: set(),
    OrderStatus.cancelled: set(),
    OrderStatus.refunded: set(),
}

TERMINAL_ORDER_STATUSES = {
    OrderStatus.expired,
    OrderStatus.cancelled,
    OrderStatus.refunded,
}


class InventoryState(str, enum.Enum):
    """Where this order's stock currently sits."""

    reserved = "reserved"    # held, not yet sold
    committed = "committed"  # sold, removed from on-hand
    released = "released"    # returned to available (never sold)
    restocked = "restocked"  # returned to available after a refund


class FulfillmentStatus(str, enum.Enum):
    unfulfilled = "unfulfilled"
    in_progress = "in_progress"
    shipped = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"


class PaymentEventStatus(str, enum.Enum):
    received = "received"
    processed = "processed"
    failed = "failed"
    ignored = "ignored"


class OutboxStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"       # retryable, will be picked up again
    dead_letter = "dead_letter"  # exhausted retries; needs an operator


class RefundStatus(str, enum.Enum):
    pending = "pending"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


# --------------------------------------------------------------------------- #
# Catalog
# --------------------------------------------------------------------------- #
class Product(TimestampMixin, Base):
    """A lawful, general-merchandise catalog item.

    ``requires_shipping`` and ``weight_grams`` exist so fulfilment can compute
    logistics. There is deliberately no age-restriction or licence-gating field:
    this catalog is scoped to unrestricted lawful goods only.
    """

    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    stock_on_hand: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stock_reserved: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    requires_shipping: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    weight_grams: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        CheckConstraint("unit_price_minor >= 0", name="ck_products_price_non_negative"),
        CheckConstraint("stock_on_hand >= 0", name="ck_products_stock_non_negative"),
        CheckConstraint("stock_reserved >= 0", name="ck_products_reserved_non_negative"),
        CheckConstraint(
            "stock_reserved <= stock_on_hand", name="ck_products_reserved_lte_on_hand"
        ),
        Index("ix_products_active", "is_active"),
    )

    @property
    def stock_available(self) -> int:
        return self.stock_on_hand - self.stock_reserved


# --------------------------------------------------------------------------- #
# Orders
# --------------------------------------------------------------------------- #
class Order(TimestampMixin, Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    #: Human-facing reference, e.g. ORD-7QK2M4XA.
    reference: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    #: Bearer token allowing the buyer to view this order without an account.
    access_token: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, default=new_public_token
    )

    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, name="order_status", native_enum=False, length=32),
        default=OrderStatus.pending_payment,
        nullable=False,
    )
    inventory_state: Mapped[InventoryState] = mapped_column(
        Enum(InventoryState, name="inventory_state", native_enum=False, length=16),
        default=InventoryState.reserved,
        nullable=False,
    )
    fulfillment_status: Mapped[FulfillmentStatus] = mapped_column(
        Enum(FulfillmentStatus, name="fulfillment_status", native_enum=False, length=16),
        default=FulfillmentStatus.unfulfilled,
        nullable=False,
    )

    customer_email: Mapped[str] = mapped_column(String(320), nullable=False)
    customer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shipping_address: Mapped[dict | None] = mapped_column(JSONType, nullable=True)

    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    subtotal_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    shipping_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    amount_refunded_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0
    )

    # Payment provider references. Never any card data.
    payment_provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_session_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    provider_payment_intent_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_charge_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    checkout_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    #: Client-supplied Idempotency-Key for checkout creation.
    idempotency_key: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )

    reservation_expires_at: Mapped[dt.datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    paid_at: Mapped[dt.datetime | None] = mapped_column(UTCDateTime, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )
    refunds: Mapped[list[Refund]] = relationship(
        back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        CheckConstraint("total_minor >= 0", name="ck_orders_total_non_negative"),
        CheckConstraint(
            "amount_refunded_minor >= 0 AND amount_refunded_minor <= total_minor",
            name="ck_orders_refund_within_total",
        ),
        Index("ix_orders_status", "status"),
        Index("ix_orders_email", "customer_email"),
        Index("ix_orders_reservation_expiry", "status", "reservation_expires_at"),
    )

    @property
    def is_refundable_amount_minor(self) -> int:
        return max(self.total_minor - self.amount_refunded_minor, 0)


class OrderItem(TimestampMixin, Base):
    __tablename__ = "order_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    # Denormalised so a later catalog edit cannot rewrite historical orders.
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    line_total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_items_quantity_positive"),
        Index("ix_order_items_order", "order_id"),
    )


class Refund(TimestampMixin, Base):
    __tablename__ = "refunds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    provider_refund_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[RefundStatus] = mapped_column(
        Enum(RefundStatus, name="refund_status", native_enum=False, length=16),
        default=RefundStatus.pending,
        nullable=False,
    )
    requested_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )

    order: Mapped[Order] = relationship(back_populates="refunds")

    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_refunds_amount_positive"),
        Index("ix_refunds_order", "order_id"),
    )


# --------------------------------------------------------------------------- #
# Webhook idempotency ledger
# --------------------------------------------------------------------------- #
class WebhookEvent(Base):
    """One row per provider event id. The unique index is the dedupe primitive."""

    __tablename__ = "webhook_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    payload_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The verified event body, retained so a failed handler can be replayed
    #: without asking the provider to redeliver. Subject to the same
    #: retention policy as orders (see README, "Data retention").
    payload: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    status: Mapped[PaymentEventStatus] = mapped_column(
        Enum(PaymentEventStatus, name="payment_event_status", native_enum=False, length=16),
        default=PaymentEventStatus.received,
        nullable=False,
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    order_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[dt.datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), nullable=False
    )
    processed_at: Mapped[dt.datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )

    __table_args__ = (
        UniqueConstraint("provider", "provider_event_id", name="uq_webhook_provider_event"),
        Index("ix_webhook_events_status", "status", "received_at"),
    )


# --------------------------------------------------------------------------- #
# Transactional outbox (receipts and other notifications)
# --------------------------------------------------------------------------- #
class OutboxMessage(Base):
    __tablename__ = "outbox_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("orders.id", ondelete="CASCADE"), nullable=True
    )
    #: e.g. "receipt.paid", "receipt.refunded", "order.payment_failed"
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default="email")
    recipient: Mapped[str] = mapped_column(String(320), nullable=False)
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    body_html: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: Guarantees one message per (order, kind) even across webhook replays.
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    status: Mapped[OutboxStatus] = mapped_column(
        Enum(OutboxStatus, name="outbox_status", native_enum=False, length=16),
        default=OutboxStatus.pending,
        nullable=False,
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    next_attempt_at: Mapped[dt.datetime] = mapped_column(
        UTCDateTime, default=utcnow, nullable=False
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    locked_until: Mapped[dt.datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), nullable=False
    )
    sent_at: Mapped[dt.datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )

    __table_args__ = (
        Index("ix_outbox_dispatch", "status", "next_attempt_at"),
    )


# --------------------------------------------------------------------------- #
# Admin audit trail
# --------------------------------------------------------------------------- #
class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    actor: Mapped[str] = mapped_column(String(120), nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    subject_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    subject_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        UTCDateTime, server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_admin_audit_created", "created_at"),)
