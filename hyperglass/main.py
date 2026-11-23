"""Start hyperglass."""

# Standard Library
import os
import sys
import atexit
import shutil
import typing as t
import asyncio
import logging
import tempfile
from pathlib import Path

# Third Party
import uvicorn
from redis.exceptions import TimeoutError as RedisTimeoutError
from redis.exceptions import ConnectionError as RedisConnectionError

# Local
from .log import LibInterceptHandler, init_logger, configure_syslog, enable_file_logging
from .util import get_node_version, remove_ipv6_networks_from_no_proxy
from .settings import Settings
from .constants import MIN_NODE_VERSION, MIN_PYTHON_VERSION, __version__

# Same as `hyperglass.api.metrics.REDIS_UNAVAILABLE`, which can't be imported here:
# importing `hyperglass.api` reads state from Redis.
REDIS_UNREACHABLE = (RedisConnectionError, RedisTimeoutError)

# Ensure the Python version meets the minimum requirements.
pretty_version = ".".join(tuple(str(v) for v in MIN_PYTHON_VERSION))
if sys.version_info < MIN_PYTHON_VERSION:
    raise RuntimeError(f"Python {pretty_version}+ is required.")


def check_node_version(node_version: t.Optional[t.Tuple[int, int, int]]) -> None:
    """Raise an error if NodeJS is missing or older than the minimum version."""
    pretty_node_version = ".".join(str(v) for v in MIN_NODE_VERSION)
    if node_version is None:
        raise RuntimeError(f"NodeJS {pretty_node_version}+ is required (NodeJS is not installed)")
    # Compare major and minor, because pnpm needs a minimum minor version (#175).
    if tuple(node_version[: len(MIN_NODE_VERSION)]) < MIN_NODE_VERSION:
        installed = ".".join(str(v) for v in node_version)
        raise RuntimeError(
            f"NodeJS {pretty_node_version}+ is required (version {installed} installed)"
        )


# Ensure the NodeJS version meets the minimum requirements when the UI is enabled.
if not Settings.disable_ui:
    check_node_version(get_node_version())


# Local
from .state import use_state

LOG_LEVEL = logging.INFO if Settings.debug is False else logging.DEBUG
logging.basicConfig(handlers=[LibInterceptHandler()], level=0, force=True)
log = init_logger(LOG_LEVEL)

# httpx cannot parse IPv6 networks in NO_PROXY, and every HTTP client would fail (#91).
# Remove them before any client exists; uvicorn workers inherit the cleaned environment.
if no_proxy_removed := remove_ipv6_networks_from_no_proxy(os.environ):
    log.bind(removed=no_proxy_removed).warning("Ignoring IPv6 networks in NO_PROXY")


async def build_ui() -> bool:
    """Perform a UI build prior to starting the application."""
    # Local
    from .frontend import build_frontend

    state = use_state()
    await build_frontend(
        dev_mode=Settings.dev_mode,
        dev_url=Settings.dev_url,
        prod_url=Settings.prod_url,
        params=state.ui_params,
        app_path=Settings.app_path,
    )
    return True


def unregister_all_plugins() -> None:
    """Unregister all plugins."""
    # Local
    from .plugins import InputPluginManager, OutputPluginManager

    for manager in (InputPluginManager, OutputPluginManager):
        manager().reset()


def prepare_metrics_dir() -> Path:
    """Prepare prometheus_client's multiprocess directory.

    Each uvicorn worker is a separate process with its own metric values, so
    workers write them to a shared directory that the metrics endpoint
    aggregates. prometheus_client selects this mode when it is first imported,
    so this must run before any worker imports it (i.e. before the app is
    imported), and the directory must be emptied between runs.

    The default is a new directory under the system temporary directory, which
    the container's non-root user can write to, unlike the application path's
    parent directories.
    """
    configured = os.environ.get("PROMETHEUS_MULTIPROC_DIR")

    if not configured:
        path = Path(tempfile.mkdtemp(prefix="hyperglass-metrics-"))
        atexit.register(shutil.rmtree, path, ignore_errors=True)
        os.environ["PROMETHEUS_MULTIPROC_DIR"] = str(path)
        return path

    path = Path(configured)
    path.mkdir(parents=True, exist_ok=True)
    # Values left by a previous run would otherwise be added to this run's.
    for stale in path.glob("*.db"):
        stale.unlink()
    return path


def start(*, log_level: t.Union[str, int], workers: int) -> None:
    """Start hyperglass via ASGI server."""
    # Local
    from .plugins import register_all_plugins

    register_all_plugins()

    if use_state("params").metrics.enable:
        metrics_dir = prepare_metrics_dir()
        log.bind(directory=str(metrics_dir)).debug("Prepared metrics directory")

    if not Settings.disable_ui:
        asyncio.run(build_ui())

    uvicorn.run(
        app="hyperglass.api:app",
        host=str(Settings.host),
        port=Settings.port,
        workers=workers,
        # Preserve the socket peer; application proxy trust uses web.client_ip.
        proxy_headers=False,
        log_level=log_level,
        log_config={
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "()": "uvicorn.logging.DefaultFormatter",
                    "format": "%(message)s",
                },
                "access": {
                    "()": "uvicorn.logging.AccessFormatter",
                    "format": "%(message)s",
                },
            },
            "handlers": {
                "default": {"formatter": "default", "class": "hyperglass.log.LibInterceptHandler"},
                "access": {"formatter": "access", "class": "hyperglass.log.LibInterceptHandler"},
            },
            "loggers": {
                "uvicorn.error": {"level": "ERROR", "handlers": ["default"], "propagate": False},
                "uvicorn.access": {"level": "INFO", "handlers": ["access"], "propagate": False},
            },
        },
    )


def run(workers: int = None):
    """Run hyperglass."""
    # Local
    from .configuration import init_user_config

    try:
        log.debug(repr(Settings))

        state = use_state()
        state.clear()

        init_user_config()

        enable_file_logging(
            directory=state.params.logging.directory,
            max_size=state.params.logging.max_size,
            log_format=state.params.logging.format,
            level=LOG_LEVEL,
        )

        configure_syslog(state.params.logging.syslog)
        _workers = workers if workers is not None else Settings.worker_count

        log.bind(
            version=__version__,
            state_generation=state.generation,
            listening=f"http://{Settings.bind()}",
            app_path=f"{Settings.app_path.absolute()!s}",
            container=Settings.container,
            original_app_path=f"{Settings.original_app_path.absolute()!s}",
            workers=_workers,
        ).info(
            "Starting hyperglass",
        )

        start(log_level=LOG_LEVEL, workers=_workers)
        log.bind(version=__version__).critical("Stopping hyperglass")
    except Exception as error:
        log.critical(error)
        # Handle app exceptions. Clearing state and unregistering plugins both write
        # to Redis, so skip them when Redis is unreachable rather than wait on it
        # again; the next start clears state anyway.
        if isinstance(error, REDIS_UNREACHABLE):
            raise error
        if not Settings.dev_mode:
            state = use_state()
            state.clear()
            log.debug("Cleared hyperglass state")
        unregister_all_plugins()
        raise error
    except (SystemExit, BaseException):
        unregister_all_plugins()
        sys.exit(4)


if __name__ == "__main__":
    run()
