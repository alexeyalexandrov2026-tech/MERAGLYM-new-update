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
    "api_key", "token", "card", "number", "cvc", "cvv",
}
_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {
    "asctime", "message", "taskName",
}


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if k.lower() in REDACT_KEYS else redact(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


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
                payload[key] = redact(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


class ConsoleFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-8s %(name)s :: %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        extras = {
            k: redact(v)
            for k, v in record.__dict__.items()
            if k not in _RESERVED and not k.startswith("_")
        }
        rid = request_id_var.get()
        if rid != "-":
            extras["request_id"] = rid
        return f"{base} {extras}" if extras else base


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
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
