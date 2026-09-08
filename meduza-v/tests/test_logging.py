"""Structured logging must be safe and must not leak secrets."""

from __future__ import annotations

import json
import logging

import pytest

from app.logging_config import (
    ConsoleFormatter,
    JsonFormatter,
    configure_logging,
    redact,
    redact_field,
    request_id_var,
)


@pytest.fixture(autouse=True)
def _safe_extra_installed():
    configure_logging("INFO", "json")


def _emit(caplog, **extra) -> logging.LogRecord:
    logger = logging.getLogger("test.logging")
    with caplog.at_level(logging.INFO, logger="test.logging"):
        logger.info("event", extra=extra)
    return caplog.records[-1]


@pytest.mark.parametrize(
    "key",
    ["created", "message", "module", "name", "filename", "process", "args", "levelname"],
)
def test_reserved_extra_keys_do_not_crash_the_caller(caplog, key):
    """A diagnostic must never be able to take the process down.

    `logger.info(..., extra={"created": 1})` raises KeyError inside the stdlib.
    Colliding keys are renamed instead.
    """
    record = _emit(caplog, **{key: "value"})
    assert getattr(record, f"{key}_") == "value"


def test_non_colliding_extras_are_untouched(caplog):
    record = _emit(caplog, order_id="ord_1", total_minor=1650)
    assert record.order_id == "ord_1"
    assert record.total_minor == 1650


def test_json_formatter_emits_parseable_lines_with_context():
    token = request_id_var.set("req-abc")
    try:
        record = logging.LogRecord(
            "app.test", logging.INFO, "f.py", 1, "order_paid", (), None
        )
        record.order_id = "ord_1"
        payload = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)

    assert payload["message"] == "order_paid"
    assert payload["level"] == "INFO"
    assert payload["logger"] == "app.test"
    assert payload["request_id"] == "req-abc"
    assert payload["order_id"] == "ord_1"
    assert payload["ts"].endswith("+00:00")


@pytest.mark.parametrize(
    "key",
    ["authorization", "Authorization", "stripe-signature", "password", "api_key",
     "token", "secret", "card", "number", "cvc", "cvv"],
)
def test_secret_shaped_keys_are_redacted(key):
    assert redact({key: "s3cret"})[key] == "[redacted]"


def test_redaction_reaches_nested_structures():
    cleaned = redact(
        {"order": {"id": "ord_1", "card": {"number": "4242424242424242"}},
         "headers": [{"authorization": "Bearer x"}]}
    )
    assert cleaned["order"]["card"] == "[redacted]"
    assert cleaned["headers"][0]["authorization"] == "[redacted]"
    assert cleaned["order"]["id"] == "ord_1", "non-secret values survive"


@pytest.mark.parametrize(
    "field",
    ["authorization", "admin_api_key", "stripe_signature", "access_token",
     "smtp_password", "webhook_secret", "card_cvc"],
)
def test_formatters_redact_secrets_passed_as_top_level_fields(field):
    """A secret named as a log field, not nested in a dict, must still vanish."""
    for formatter in (JsonFormatter(), ConsoleFormatter()):
        record = logging.LogRecord("app.t", logging.INFO, "f.py", 1, "m", (), None)
        setattr(record, field, "supersecret-value")
        rendered = formatter.format(record)
        assert "supersecret-value" not in rendered, f"{field} leaked via {formatter}"


def test_redact_field_keeps_ordinary_fields():
    assert redact_field("order_id", "ord_1") == "ord_1"
    assert redact_field("total_minor", 1650) == 1650


def test_exceptions_are_rendered_into_the_log_line():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = logging.LogRecord(
            "app.t", logging.ERROR, "f.py", 1, "failed", (), sys.exc_info()
        )
    payload = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in payload["exception"]
