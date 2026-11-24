"""hyperglass API."""

# Standard Library
import typing as t
import logging
from pathlib import Path

# Third Party
from litestar import Router, Litestar, Response
from litestar.openapi import OpenAPIConfig
from litestar.exceptions import HTTPException, ValidationException
from litestar.openapi.spec import Server
from litestar.static_files import create_static_files_router

# Project
from hyperglass.state import use_state
from hyperglass.constants import __version__
from hyperglass.exceptions import HyperglassError

# Local
from .share import share_read, share_create, share_delete
from .events import check_redis
from .routes import (
    dns,
    info,
    myip,
    query,
    device,
    health,
    devices,
    queries,
    aspath_enrich,
    query_enrichment,
)
from .metrics import create_metrics
from .middleware import COMPRESSION_CONFIG, recover_state, create_cors_config
from .error_handlers import app_handler, http_handler, default_handler, validation_handler

__all__ = ("app", "create_app")

STATE = use_state()


DOCS = STATE.params.docs

OPEN_API = OpenAPIConfig(
    title=DOCS.title.format(site_title=STATE.params.site_title),
    version=__version__,
    description=DOCS.description,
    path=DOCS.path,
    root_schema_site="elements",
    servers=[Server(url=DOCS.server_url or "/")],
)

# Per-endpoint documentation from `docs.query`, `docs.devices`, `docs.queries` and `docs.info`.
for _handler, _endpoint in (
    (query, "query"),
    (devices, "devices"),
    (queries, "queries"),
    (info, "info"),
):
    for _attr, _value in DOCS.endpoint_docs(_endpoint).items():
        setattr(_handler, _attr, _value)

HANDLERS = [
    device,
    devices,
    queries,
    info,
    health,
    query,
    query_enrichment,
    myip,
]

if STATE.params.web.dns_provider.name == "server":
    HANDLERS.append(dns)
if STATE.params.web.aspath_enrichment:
    HANDLERS.append(aspath_enrich)


def same_origin_referrer(response: Response) -> Response:
    """Tell browsers to send the page's address only to this site.

    A share link carries its id in the page address (`/?share=<id>`), which a browser
    would otherwise send, in the `Referer` header, to other sites the page loads from or
    links to.
    """
    response.headers["Referrer-Policy"] = "same-origin"
    return response


def ui_routers(static_path: Path) -> t.List[Router]:
    """Routers serving the built UI and its images from `static_path`."""
    return [
        create_static_files_router(
            path="/images",
            directories=[static_path / "images"],
            name="images",
            include_in_schema=False,
        ),
        create_static_files_router(
            path="/",
            directories=[static_path / "ui"],
            name="ui",
            html_mode=True,
            include_in_schema=False,
            after_request=same_origin_referrer,
        ),
    ]


def create_app() -> Litestar:
    """Create the Litestar application from the current hyperglass state.

    `app` is built once, when this module is first imported. Tests use this to
    build an application from other parameters, such as with metrics enabled.
    """
    state = use_state()
    params = state.params

    route_handlers = [*HANDLERS]
    middleware = []

    if params.share.enable:
        route_handlers.extend((share_create, share_read, share_delete))

    if params.metrics.enable:
        prometheus_config, metrics_controller = create_metrics(
            params.metrics, exclude=("/api/health",)
        )
        route_handlers.append(metrics_controller)
        middleware.append(prometheus_config.middleware)

    if not state.settings.disable_ui:
        route_handlers.extend(ui_routers(state.settings.static_path))

    return Litestar(
        route_handlers=route_handlers,
        middleware=middleware,
        exception_handlers={
            HTTPException: http_handler,
            HyperglassError: app_handler,
            ValidationException: validation_handler,
            Exception: default_handler,
        },
        on_startup=[check_redis],
        before_request=recover_state,
        debug=state.settings.debug,
        cors_config=create_cors_config(state=state),
        compression_config=COMPRESSION_CONFIG,
        openapi_config=OPEN_API if params.docs.enable else None,
    )


app = create_app()
