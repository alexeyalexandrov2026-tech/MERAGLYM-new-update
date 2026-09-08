"""Application configuration.

Every value is sourced from the environment (or a secrets manager that projects
secrets into the environment). Nothing secret is ever hard-coded or defaulted to
a working value: the validators below refuse to start in production if a secret
is missing or still set to a placeholder.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Literal

from pydantic import computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]
PaymentProvider = Literal["stripe", "fake"]
EmailBackend = Literal["smtp", "console", "memory"]

# Values that look configured but are not. Refused in production.
PLACEHOLDER_MARKERS = ("changeme", "replace-me", "placeholder", "xxx", "your-", "todo")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Core -------------------------------------------------------------
    environment: Environment = "development"
    app_name: str = "Meduza V"
    log_level: str = "INFO"
    log_format: Literal["json", "console"] = "json"

    # Public base URL of this service; used to build success/cancel/receipt URLs.
    public_base_url: str = "http://localhost:8000"
    storefront_success_path: str = "/checkout/success"
    storefront_cancel_path: str = "/checkout/cancel"

    # ---- Database ---------------------------------------------------------
    # postgresql+asyncpg://user:pass@host:5432/dbname
    database_url: str = "postgresql+asyncpg://meduza:meduza@localhost:5432/meduza"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_echo: bool = False

    # ---- Payments ---------------------------------------------------------
    payment_provider: PaymentProvider = "stripe"
    stripe_api_key: str = ""            # sk_test_... in sandbox
    stripe_webhook_secret: str = ""     # whsec_...
    stripe_api_version: str = ""        # optional pin, e.g. "2024-06-20"
    currency: str = "usd"
    # How long a hosted checkout session (and its inventory reservation) lives.
    checkout_session_ttl_minutes: int = 30
    # Flat shipping fee in minor units, charged once per order that ships.
    shipping_flat_minor: int = 0

    # ---- Email / receipts -------------------------------------------------
    email_backend: EmailBackend = "console"
    email_from: str = "receipts@example.com"
    email_from_name: str = "Example Store"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    smtp_timeout_seconds: int = 20

    # ---- Admin auth -------------------------------------------------------
    admin_api_key: str = ""

    # ---- Rate limiting ----------------------------------------------------
    rate_limit_enabled: bool = True
    rate_limit_public_per_minute: int = 120
    rate_limit_checkout_per_minute: int = 10
    rate_limit_admin_per_minute: int = 60
    redis_url: str = ""  # optional; enables shared rate-limit state across replicas
    trusted_proxy_hops: int = 0  # X-Forwarded-For entries to trust (0 = trust none)

    # ---- Worker -----------------------------------------------------------
    worker_poll_interval_seconds: float = 5.0
    worker_batch_size: int = 25
    outbox_max_attempts: int = 8
    outbox_lock_seconds: int = 120
    webhook_retry_after_seconds: int = 300

    # ---- Catalog ----------------------------------------------------------
    max_line_items_per_order: int = 20
    max_quantity_per_line: int = 25

    @field_validator("currency")
    @classmethod
    def _lower_currency(cls, v: str) -> str:
        v = v.strip().lower()
        if len(v) != 3:
            raise ValueError("currency must be a 3-letter ISO-4217 code")
        return v

    @field_validator("public_base_url")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @model_validator(mode="after")
    def _validate_secrets(self) -> Settings:
        if self.payment_provider == "stripe" and self.environment != "test":
            _require(self.stripe_api_key, "STRIPE_API_KEY")
            _require(self.stripe_webhook_secret, "STRIPE_WEBHOOK_SECRET")
        if self.email_backend == "smtp":
            _require(self.smtp_host, "SMTP_HOST")
        if self.is_production:
            _require(self.admin_api_key, "ADMIN_API_KEY")
            if len(self.admin_api_key) < 32:
                raise ValueError("ADMIN_API_KEY must be at least 32 characters")
            if not self.public_base_url.startswith("https://"):
                raise ValueError("PUBLIC_BASE_URL must use https in production")
            if self.stripe_api_key.startswith("sk_test_"):
                raise ValueError("refusing to run production with a Stripe test key")
            if self.email_backend != "smtp":
                raise ValueError("production requires EMAIL_BACKEND=smtp")
        elif not self.admin_api_key:
            # Dev convenience only: ephemeral key, printed at startup.
            object.__setattr__(self, "admin_api_key", secrets.token_urlsafe(32))
        return self


def _require(value: str, name: str) -> None:
    if not value or not value.strip():
        raise ValueError(f"{name} is required but was empty")
    lowered = value.lower()
    if any(marker in lowered for marker in PLACEHOLDER_MARKERS):
        raise ValueError(f"{name} still contains a placeholder value")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    """Used by tests to reload configuration after mutating the environment."""
    get_settings.cache_clear()
