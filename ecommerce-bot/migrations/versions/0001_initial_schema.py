"""Initial schema: catalog, orders, refunds, webhook ledger, outbox, audit log.

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-04
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

# JSONB on PostgreSQL, portable JSON elsewhere — matches app.models.JSONType.
JSONType = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
# app.models.UTCDateTime is a TypeDecorator over this; DDL is identical.
UTCDateTime = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("slug", sa.String(length=160), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("image_url", sa.String(length=500), nullable=True),
        sa.Column("unit_price_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("stock_on_hand", sa.Integer(), nullable=False),
        sa.Column("stock_reserved", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("requires_shipping", sa.Boolean(), nullable=False),
        sa.Column("weight_grams", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("unit_price_minor >= 0", name="ck_products_price_non_negative"),
        sa.CheckConstraint("stock_on_hand >= 0", name="ck_products_stock_non_negative"),
        sa.CheckConstraint("stock_reserved >= 0", name="ck_products_reserved_non_negative"),
        sa.CheckConstraint("stock_reserved <= stock_on_hand", name="ck_products_reserved_lte_on_hand"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sku"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_products_active", "products", ["is_active"])

    op.create_table(
        "orders",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("reference", sa.String(length=32), nullable=False),
        sa.Column("access_token", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("inventory_state", sa.String(length=16), nullable=False),
        sa.Column("fulfillment_status", sa.String(length=16), nullable=False),
        sa.Column("customer_email", sa.String(length=320), nullable=False),
        sa.Column("customer_name", sa.String(length=200), nullable=True),
        sa.Column("shipping_address", JSONType, nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("subtotal_minor", sa.BigInteger(), nullable=False),
        sa.Column("shipping_minor", sa.BigInteger(), nullable=False),
        sa.Column("total_minor", sa.BigInteger(), nullable=False),
        sa.Column("amount_refunded_minor", sa.BigInteger(), nullable=False),
        sa.Column("payment_provider", sa.String(length=32), nullable=False),
        sa.Column("provider_session_id", sa.String(length=255), nullable=True),
        sa.Column("provider_payment_intent_id", sa.String(length=255), nullable=True),
        sa.Column("provider_charge_id", sa.String(length=255), nullable=True),
        sa.Column("checkout_url", sa.String(length=1000), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("reservation_expires_at", UTCDateTime, nullable=True),
        sa.Column("paid_at", UTCDateTime, nullable=True),
        sa.Column("failure_reason", sa.String(length=500), nullable=True),
        sa.Column("created_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("total_minor >= 0", name="ck_orders_total_non_negative"),
        sa.CheckConstraint(
            "amount_refunded_minor >= 0 AND amount_refunded_minor <= total_minor",
            name="ck_orders_refund_within_total",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reference"),
        sa.UniqueConstraint("access_token"),
        sa.UniqueConstraint("provider_session_id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_orders_status", "orders", ["status"])
    op.create_index("ix_orders_email", "orders", ["customer_email"])
    op.create_index(
        "ix_orders_reservation_expiry", "orders", ["status", "reservation_expires_at"]
    )

    op.create_table(
        "order_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("unit_price_minor", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("line_total_minor", sa.BigInteger(), nullable=False),
        sa.Column("created_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_order_items_quantity_positive"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_items_order", "order_items", ["order_id"])

    op.create_table(
        "refunds",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=False),
        sa.Column("provider_refund_id", sa.String(length=255), nullable=True),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("requested_by", sa.String(length=120), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("created_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount_minor > 0", name="ck_refunds_amount_positive"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_refund_id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_refunds_order", "refunds", ["order_id"])

    op.create_table(
        "webhook_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("provider_event_id", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("payload_digest", sa.String(length=64), nullable=False),
        sa.Column("payload", JSONType, nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("received_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.Column("processed_at", UTCDateTime, nullable=True),
        sa.PrimaryKeyConstraint("id"),
        # This unique constraint is the webhook idempotency primitive.
        sa.UniqueConstraint(
            "provider", "provider_event_id", name="uq_webhook_provider_event"
        ),
    )
    op.create_index(
        "ix_webhook_events_status", "webhook_events", ["status", "received_at"]
    )

    op.create_table(
        "outbox_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("order_id", sa.String(length=36), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False),
        sa.Column("recipient", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=300), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("body_html", sa.Text(), nullable=True),
        sa.Column("dedupe_key", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", UTCDateTime, nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("locked_by", sa.String(length=64), nullable=True),
        sa.Column("locked_until", UTCDateTime, nullable=True),
        sa.Column("created_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.Column("sent_at", UTCDateTime, nullable=True),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        # Guarantees one receipt per (order, kind) across webhook replays.
        sa.UniqueConstraint("dedupe_key"),
    )
    op.create_index(
        "ix_outbox_dispatch", "outbox_messages", ["status", "next_attempt_at"]
    )

    op.create_table(
        "admin_audit_log",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("actor", sa.String(length=120), nullable=False),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("subject_type", sa.String(length=64), nullable=True),
        sa.Column("subject_id", sa.String(length=64), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("source_ip", sa.String(length=64), nullable=True),
        sa.Column("detail", JSONType, nullable=True),
        sa.Column("created_at", UTCDateTime, server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_audit_created", "admin_audit_log", ["created_at"])


def downgrade() -> None:
    op.drop_table("admin_audit_log")
    op.drop_table("outbox_messages")
    op.drop_table("webhook_events")
    op.drop_table("refunds")
    op.drop_table("order_items")
    op.drop_table("orders")
    op.drop_table("products")
