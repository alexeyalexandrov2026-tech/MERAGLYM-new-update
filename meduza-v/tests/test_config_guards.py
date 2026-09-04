"""Configuration must refuse to start production in an unsafe state.

These are the checks that stop a deploy from quietly going live with a test
key, a placeholder secret, or plaintext HTTP.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings

# Spelled out in full rather than inherited from the environment: conftest
# exports test values (PAYMENT_PROVIDER=fake) that would otherwise silently
# disable the very checks these tests exist to prove.
PROD = {
    "environment": "production",
    "payment_provider": "stripe",
    "stripe_api_key": "sk_live_example",
    "stripe_webhook_secret": "whsec_example",
    "public_base_url": "https://shop.example.com",
    "email_backend": "smtp",
    "smtp_host": "smtp.example.com",
    "admin_api_key": "a" * 40,
}


def build(**overrides) -> Settings:
    return Settings(_env_file=None, **{**PROD, **overrides})


def test_a_complete_production_config_is_accepted():
    settings = build()
    assert settings.is_production
    assert settings.public_base_url == "https://shop.example.com"


@pytest.mark.parametrize(
    "overrides, why",
    [
        ({"admin_api_key": ""}, "no admin key"),
        ({"admin_api_key": "short"}, "admin key under 32 chars"),
        ({"stripe_api_key": "sk_test_example"}, "a test key in production"),
        ({"public_base_url": "http://shop.example.com"}, "plaintext http"),
        ({"stripe_webhook_secret": "<PLACEHOLDER:whsec_...>"}, "placeholder secret"),
        ({"stripe_api_key": "your-key-here"}, "placeholder api key"),
        ({"stripe_webhook_secret": ""}, "no webhook secret"),
        ({"email_backend": "console"}, "receipts only logged, never sent"),
        ({"smtp_host": ""}, "smtp selected with no host"),
    ],
)
def test_unsafe_production_config_is_refused(overrides, why):
    with pytest.raises(ValidationError):
        build(**overrides)


def test_development_generates_an_ephemeral_admin_key():
    settings = Settings(
        _env_file=None,
        environment="development",
        payment_provider="fake",
        admin_api_key="",
    )
    assert len(settings.admin_api_key) >= 32


def test_currency_must_be_a_three_letter_code():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="test", payment_provider="fake", currency="dollars")


def test_currency_is_normalised_to_lowercase():
    settings = Settings(
        _env_file=None, environment="test", payment_provider="fake", currency="USD"
    )
    assert settings.currency == "usd"


def test_zero_decimal_currencies_format_without_a_fraction():
    from app.money import format_amount

    assert format_amount(1650, "usd") == "16.50 USD"
    assert format_amount(1650, "jpy") == "1650 JPY"
    assert format_amount(0, "usd") == "0.00 USD"
