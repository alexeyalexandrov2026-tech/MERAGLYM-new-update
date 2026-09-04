"""Structured (JSON) logging with request correlation IDs."""

from __future__ import annotations

import contextvars
import datetime as dt
import json
import logging
import sys
from typing import Any

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# Never let these reach the logs, whatever a caller passes in.
REDACT_KEYS = {
    "authorization", "x-admin-api-key", "stripe-signature", "password", "secret",
    "api_key", "token", "card", "number", "cvc", "cvv", "pan",
}
#: Substring matches, so admin_api_key/access_token/card_number are caught too.
REDACT_SUBSTRINGS = (
    "password", "secret", "api_key", "apikey", "token", "authorization",
    "signature", "cvc", "cvv",
)
_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {
    "asctime", "message", "taskName",
}


def is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return lowered in REDACT_KEYS or any(marker in lowered for marker in REDACT_SUBSTRINGS)


def redact(value: Any) -> Any:
    """Redact secret-shaped entries anywhere inside a value."""
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if is_secret_key(str(k)) else redact(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


def redact_field(key: str, value: Any) -> Any:
    """Redact by field *name* as well as by content.

    ``redact()`` alone only inspects dictionary keys, so a secret passed as a
    top-level log field — ``extra={"authorization": "Bearer ..."}`` — would
    reach the log line untouched. Both formatters go through here instead.
    """
    return "[redacted]" if is_secret_key(key) else redact(value)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": dt.datetime.fromtimestamp(record.created, tz=dt.UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = redact_field(key, value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


class ConsoleFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-8s %(name)s :: %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        extras = {
            k: redact_field(k, v)
            for k, v in record.__dict__.items()
            if k not in _RESERVED and not k.startswith("_")
        }
        rid = request_id_var.get()
        if rid != "-":
            extras["request_id"] = rid
        return f"{base} {extras}" if extras else base


def _install_safe_extra_handling() -> None:
    """Stop a structured-logging call from being able to crash the process.

    ``logger.info(..., extra={"created": 3})`` raises ``KeyError`` inside
    ``Logger.makeRecord``, because ``created`` is a field the logging module
    owns. That turns a harmless diagnostic into an outage at an arbitrary call
    site, and it is invisible until that exact line runs in production.

    Rather than police every call site, colliding keys are renamed once here
    (``created`` -> ``created_``) so any ``extra`` dictionary is safe to pass.
    """
    if getattr(logging.Logger, "_shopbot_safe_extra", False):
        return

    original = logging.Logger.makeRecord

    def make_record(self, name, level, fn, lno, msg, args, exc_info,
                    func=None, extra=None, sinfo=None):
        if extra:
            collisions = _RESERVED.intersection(extra)
            if collisions:
                extra = {
                    (f"{k}_" if k in collisions else k): v for k, v in extra.items()
                }
        return original(
            self, name, level, fn, lno, msg, args, exc_info, func, extra, sinfo
        )

    logging.Logger.makeRecord = make_record
    logging.Logger._shopbot_safe_extra = True


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    _install_safe_extra_handling()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json" else ConsoleFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # Uvicorn duplicates access logs through its own handlers; route them here.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers[:] = []
        logger.propagate = True
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
