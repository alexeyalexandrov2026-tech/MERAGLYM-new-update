"""Development channel: logs the receipt instead of sending it."""

from __future__ import annotations

import logging

from .base import Message

log = logging.getLogger(__name__)


class ConsoleChannel:
    name = "console"

    async def send(self, message: Message) -> None:
        log.info(
            "receipt_would_be_sent",
            extra={
                "to": message.to,
                "subject": message.subject,
                "body_preview": message.body_text[:400],
            },
        )


class MemoryChannel:
    """Test channel: records everything and can be told to fail."""

    name = "memory"

    def __init__(self) -> None:
        self.sent: list[Message] = []
        self.fail_times = 0
        self.fail_permanently = False

    async def send(self, message: Message) -> None:
        from ..errors import ReceiptDeliveryError

        if self.fail_permanently:
            raise ReceiptDeliveryError("recipient rejected", permanent=True)
        if self.fail_times > 0:
            self.fail_times -= 1
            raise ReceiptDeliveryError("transient smtp failure")
        self.sent.append(message)
