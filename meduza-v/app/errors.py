"""Domain errors mapped to stable HTTP responses."""

from __future__ import annotations


class DomainError(Exception):
    """Base class for expected, client-visible failures."""

    status_code = 400
    code = "domain_error"

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(DomainError):
    status_code = 404
    code = "not_found"


class ValidationError(DomainError):
    status_code = 422
    code = "validation_error"


class OutOfStockError(DomainError):
    status_code = 409
    code = "out_of_stock"


class ConflictError(DomainError):
    status_code = 409
    code = "conflict"


class InvalidStateError(DomainError):
    status_code = 409
    code = "invalid_state"


class AuthError(DomainError):
    status_code = 401
    code = "unauthorized"


class RateLimitedError(DomainError):
    status_code = 429
    code = "rate_limited"

    def __init__(self, message: str, retry_after: int = 60) -> None:
        super().__init__(message, details={"retry_after": retry_after})
        self.retry_after = retry_after


class PaymentProviderError(DomainError):
    """The upstream payment provider rejected or failed the call."""

    status_code = 502
    code = "payment_provider_error"


class WebhookVerificationError(DomainError):
    status_code = 400
    code = "webhook_verification_failed"


class ReceiptDeliveryError(Exception):
    """Raised by notification channels; retried by the outbox worker."""

    def __init__(self, message: str, *, permanent: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.permanent = permanent
