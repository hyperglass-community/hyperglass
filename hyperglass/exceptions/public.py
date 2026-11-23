"""User-facing/Public exceptions."""

# Standard Library
from typing import TYPE_CHECKING, Any, Dict, Optional

# Local
from ._common import PublicHyperglassError

if TYPE_CHECKING:
    # Project
    from hyperglass.models.api.query import Query
    from hyperglass.models.config.devices import Device


def _strip_device_settings(error: str) -> str:
    """Remove the netmiko "Device settings:" line, which contains the device IP and port."""
    if "Device settings:" not in error:
        return error
    lines = error.split("\n")
    return "\n".join(
        line for line in lines if not line.strip().startswith("Device settings:")
    ).strip()


class ScrapeError(
    PublicHyperglassError,
    template="connection_error",
    level="danger",
):
    """Raised when an SSH driver error occurs."""

    def __init__(self, *, error: BaseException, device: "Device"):
        """Initialize parent error with sanitized error message."""
        error_str = _strip_device_settings(str(error))

        # If the error is empty after sanitization, provide a generic message
        if not error_str or error_str.isspace():
            error_str = "Connection error occurred"

        super().__init__(
            error=error_str, device=device.name, device_name=device.name, proxy=device.proxy
        )


class AuthError(PublicHyperglassError, template="authentication_error", level="danger"):
    """Raised when authentication to a device fails."""

    def __init__(self, *, error: BaseException, device: "Device"):
        """Initialize parent error with sanitized error message."""
        error_str = _strip_device_settings(str(error))

        # If the error is empty after sanitization, provide a generic message
        if not error_str or error_str.isspace():
            error_str = "Authentication failed"

        super().__init__(
            error=error_str, device=device.name, device_name=device.name, proxy=device.proxy
        )


class RestError(PublicHyperglassError, template="connection_error", level="danger"):
    """Raised upon a rest API client error."""

    def __init__(self, *, error: BaseException, device: "Device"):
        """Initialize parent error with sanitized error message."""
        error_str = _strip_device_settings(str(error))

        # If the error is empty after sanitization, provide a generic message
        if not error_str or error_str.isspace():
            error_str = "REST API connection error"

        super().__init__(error=error_str, device=device.name, device_name=device.name)


class DeviceTimeout(PublicHyperglassError, template="request_timeout", level="danger"):
    """Raised when the connection to a device times out."""

    def __init__(self, *, error: BaseException, device: "Device"):
        """Initialize parent error with sanitized error message."""
        error_str = _strip_device_settings(str(error))

        # If the error is empty after sanitization, provide a generic message
        if not error_str or error_str.isspace():
            error_str = "Connection timed out"

        super().__init__(
            error=error_str, device=device.name, device_name=device.name, proxy=device.proxy
        )


class NotFound(PublicHyperglassError, template="not_found"):
    """Raised when an object is not found."""

    def __init__(self, type: str, name: str, **kwargs: Dict[str, str]) -> None:
        """Initialize parent error."""
        super().__init__(type=type, name=name, **kwargs)


class QueryLocationNotFound(NotFound):
    """Raised when a query location is not found."""

    def __init__(self, location: Any, **kwargs: Dict[str, Any]) -> None:
        """Initialize a NotFound error for a query location."""
        # Project
        from hyperglass.state import use_state

        (text := use_state("params").web.text)

        super().__init__(type=text.query_location, name=str(location), **kwargs)


class QueryTypeNotFound(NotFound):
    """Raised when a query type is not found."""

    def __init__(self, query_type: Any, **kwargs: Dict[str, Any]) -> None:
        """Initialize a NotFound error for a query type."""
        # Project
        from hyperglass.state import use_state

        (text := use_state("params").web.text)
        super().__init__(type=text.query_type, name=str(query_type), **kwargs)


class InputInvalid(PublicHyperglassError, template="invalid_input"):
    """Raised when input validation fails."""

    def __init__(
        self, *, error: Optional[Any] = None, target: str, **kwargs: Dict[str, Any]
    ) -> None:
        """Initialize parent error."""

        kwargs = {"target": target, "error": str(error), **kwargs}

        super().__init__(**kwargs)


class InputNotAllowed(PublicHyperglassError, template="target_not_allowed"):
    """Raised when input validation fails due to a configured check."""

    def __init__(
        self, *, error: Optional[str] = None, query: "Query", **kwargs: Dict[str, Any]
    ) -> None:
        """Initialize parent error."""

        kwargs = {
            "query_type": query.query_type,
            "target": query.query_target,
            "error": str(error),
            **kwargs,
        }

        super().__init__(**kwargs)


class ResponseEmpty(PublicHyperglassError, template="no_output"):
    """Raised when hyperglass can connect to the device but the response is empty."""

    def __init__(
        self, *, error: Optional[str] = None, query: "Query", **kwargs: Dict[str, Any]
    ) -> None:
        """Initialize parent error."""

        kwargs = {
            "query_type": query.query_type,
            "target": query.query_target,
            "error": str(error),
            **kwargs,
        }

        super().__init__(**kwargs)


class DeviceCommandError(PublicHyperglassError, template="device_command_error"):
    """Raised when a device rejects a query command."""


class RateLimited(PublicHyperglassError, template="rate_limited", level="warning"):
    """Raised when a client, or all clients together, are over a request quota."""

    def __init__(self, *, retry_after: int) -> None:
        """Initialize parent error with the seconds to wait before retrying."""
        self._retry_after = retry_after
        super().__init__()

    @property
    def status_code(self) -> int:
        """Return HTTP 429, Too Many Requests."""
        return 429

    @property
    def headers(self) -> Dict[str, str]:
        """Tell the client when the quota is renewed."""
        return {"Retry-After": str(self._retry_after)}
