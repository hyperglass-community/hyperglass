"""hyperglass API."""

# Standard Library
import logging

# Third Party
from litestar import Litestar
from litestar.openapi import OpenAPIConfig
from litestar.openapi.spec import Server
from litestar.exceptions import HTTPException, ValidationException
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

UI_DIR = STATE.settings.static_path / "ui"
IMAGES_DIR = STATE.settings.static_path / "images"


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

if not STATE.settings.disable_ui:
    HANDLERS = [
        *HANDLERS,
        create_static_files_router(
            path="/images", directories=[IMAGES_DIR], name="images", include_in_schema=False
        ),
        create_static_files_router(
            path="/", directories=[UI_DIR], name="ui", html_mode=True, include_in_schema=False
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
