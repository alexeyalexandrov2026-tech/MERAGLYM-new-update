"""Notification channel abstraction."""

from __future__ import annotations

import dataclasses
from typing import Protocol, runtime_checkable


@dataclasses.dataclass(frozen=True, slots=True)
class Message:
    to: str
    subject: str
    body_text: str
    body_html: str | None = None


@runtime_checkable
class NotificationChannel(Protocol):
    name: str

    async def send(self, message: Message) -> None:
        """Deliver the message.

        Raise :class:`app.errors.ReceiptDeliveryError` on failure. Set
        ``permanent=True`` when the failure will never succeed on retry
        (e.g. a rejected recipient address), so the outbox worker can
        dead-letter it immediately instead of burning the retry budget.
        """
        ...
