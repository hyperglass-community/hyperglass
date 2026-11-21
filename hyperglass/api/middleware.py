"""hyperglass API middleware."""

# Standard Library
import typing as t

# Third Party
from litestar import Request
from litestar.exceptions import ServiceUnavailableException
from litestar.config.cors import CORSConfig
from litestar.config.compression import CompressionConfig

# Project
from hyperglass.state import use_state
from hyperglass.exceptions.private import StateError

if t.TYPE_CHECKING:
    # Project
    from hyperglass.state import HyperglassState

__all__ = ("create_cors_config", "recover_state", "skip_state_recovery", "COMPRESSION_CONFIG")

COMPRESSION_CONFIG = CompressionConfig(backend="brotli", brotli_gzip_fallback=True)

REQUEST_LOG_MESSAGE = "REQ"
RESPONSE_LOG_MESSAGE = "RES"
REQUEST_LOG_FIELDS = ("method", "path", "path_params", "query")
RESPONSE_LOG_FIELDS = ("status_code",)


async def recover_state(request: Request) -> None:
    """Recover lost state before the request is handled, or answer 503.

    A request that finds state missing while it is being rebuilt elsewhere, or while a
    failed rebuild is cooling down, is rejected at once instead of waiting, so missing
    state cannot exhaust the worker's thread pool. 503 tells clients and load balancers
    the condition is temporary.
    """
    try:
        await use_state().ensure_ready()
    except StateError as error:
        # The message cannot come from `params.messages`: params are what is missing.
        raise ServiceUnavailableException(detail=str(error)) from error


async def skip_state_recovery(_: Request) -> None:
    """Replace `recover_state` on a handler that must answer while Redis is down.

    Litestar uses the closest layer's `before_request` hook, so setting this on a
    handler disables the app-wide hook for it.
    """
    return None


def create_cors_config(state: "HyperglassState") -> CORSConfig:
    """Create CORS configuration from parameters."""
    origins = state.params.cors_origins.copy()
    if state.settings.dev_mode:
        origins = [*origins, state.settings.dev_url, "http://localhost:3000"]

    return CORSConfig(
        allow_origins=origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
