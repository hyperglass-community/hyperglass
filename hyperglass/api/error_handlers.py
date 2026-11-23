"""API Error Handlers."""

# Standard Library
import typing as t

# Third Party
from litestar import Request, Response
from litestar.exceptions import ValidationException

# Project
from hyperglass.log import log
from hyperglass.state import HyperglassState, use_state
from hyperglass.exceptions import PublicHyperglassError
from hyperglass.state.store import STATE_UNAVAILABLE
from hyperglass.exceptions.private import StateError

# Local
from .metrics import REDIS_UNAVAILABLE, record_query_error

__all__ = (
    "default_handler",
    "http_handler",
    "app_handler",
    "validation_handler",
    "unavailable_handler",
)


def get_validation_exception_detail(exc: ValidationException) -> Response:
    data: dict[str, t.Any] = {
        "level": "error",
        "status_code": exc.status_code,
        "keywords": [],
        "output": repr(exc),
    }
    if isinstance(exc.extra, dict):
        data["output"] = "\n".join(f"{k}: {v!r}" for k, v in exc.extra.items())
        data["keywords"] = list(exc.extra)

    if isinstance(exc.extra, list):
        # Litestar reports each failed field as {"message": ..., "key": ...}.
        outputs = []
        kw = []
        for v in exc.extra:
            if isinstance(v, dict) and "key" in v:
                outputs = [*outputs, f"{v['key']}: {v.get('message', '')}"]
                kw = [*kw, v["key"]]
            else:
                outputs = [*outputs, str(v)]
        data["output"] = "\n".join(outputs)
        data["keywords"] = kw

    return Response(data, status_code=exc.status_code)


def default_handler(request: Request, exc: BaseException) -> Response:
    """Handle uncaught errors."""
    if isinstance(exc, REDIS_UNAVAILABLE):
        return unavailable_handler(request, exc)
    state = use_state()
    log.bind(method=request.method, path=request.url.path, detail=str(exc)).critical("Error")
    record_query_error(request, exc)
    return Response(
        {"output": general_message(state), "level": "danger", "keywords": []},
        status_code=500,
    )


def http_handler(request: Request, exc: BaseException) -> Response:
    """Handle web server errors.

    Headers set on the exception, such as `Retry-After` on a 429 or `Allow` on a 405,
    are sent with the response.
    """
    log.bind(method=request.method, path=request.url.path, detail=exc.detail).critical("HTTP Error")
    record_query_error(request, exc)
    return Response(
        {"output": exc.detail, "level": "danger", "keywords": []},
        status_code=exc.status_code,
        headers=exc.headers,
    )


def app_handler(request: Request, exc: BaseException) -> Response:
    """Handle application errors.

    Only public errors, whose messages come from `params.messages`, are returned as
    raised. Any other error's message is internal, so it is logged and the client gets
    the same answer as for an unexpected error. State missing from Redis mid-request is
    the temporary condition `recover_state` reports, so it gets the same 503.
    """
    if isinstance(exc, StateError):
        return unavailable_handler(request, exc)
    if not isinstance(exc, PublicHyperglassError):
        return default_handler(request, exc)
    log.bind(method=request.method, path=request.url.path, detail=exc.message).critical(
        "hyperglass Error"
    )
    record_query_error(request, exc)
    return Response(
        {"output": exc.message, "level": exc.level, "keywords": exc.keywords},
        status_code=exc.status_code,
        headers=exc.headers,
    )


def validation_handler(request: Request, exc: ValidationException) -> Response:
    """Handle request validation errors raised by Litestar.

    These are client errors, such as a malformed query body, so they are logged as
    warnings rather than as critical server errors.
    """
    log.bind(method=request.method, path=request.url.path, detail=exc).warning("Validation Error")
    record_query_error(request, exc)
    return get_validation_exception_detail(exc)


def general_message(state: HyperglassState) -> str:
    """Get the configured message for unexpected errors, without depending on Redis.

    Params are read from Redis, so when they cannot be read the response uses the
    fixed message `recover_state` answers with, rather than failing in turn.
    """
    try:
        return state.params.messages.general
    except Exception:  # noqa: BLE001 - an error response must not fail
        return STATE_UNAVAILABLE


def unavailable_handler(request: Request, exc: BaseException) -> Response:
    """Answer 503 when Redis is unreachable or state is missing, before or during a request.

    Configuration is read from Redis, so the message cannot come from `params.messages`.
    """
    log.bind(method=request.method, path=request.url.path, detail=str(exc)).critical(
        "Redis Unavailable"
    )
    record_query_error(request, exc)
    return Response(
        {"output": STATE_UNAVAILABLE, "level": "danger", "keywords": []},
        status_code=503,
    )
