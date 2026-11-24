"""Primary state container."""

# Standard Library
import pickle
import typing as t
import asyncio

# Project
from hyperglass.exceptions.private import StateError

# Local
from .manager import StateManager
from .recovery import mark_stale, rebuild_state
from .recovery import ensure_ready as check_ready

if t.TYPE_CHECKING:
    # Project
    from hyperglass.models.ui import UIParameters
    from hyperglass.plugins._base import HyperglassPlugin
    from hyperglass.models.directive import Directive, Directives
    from hyperglass.models.config.params import Params
    from hyperglass.models.config.devices import Devices

    # Local
    from .manager import RedisManager


PluginT = t.TypeVar("PluginT", bound="HyperglassPlugin")

# Not user-configurable: shown when configuration cannot be read from Redis, so it
# cannot come from `params.messages`.
STATE_UNAVAILABLE = "Hyperglass state is unavailable"


class HyperglassState(StateManager):
    """Primary hyperglass state container."""

    def add_plugin(self, _type: str, plugin: "HyperglassPlugin") -> None:
        """Add a plugin to its list by type."""
        current = self.plugins(_type)
        self.redis.set(("plugins", _type), list({*current, plugin}))

    def remove_plugin(self, _type: str, plugin: "HyperglassPlugin") -> None:
        """Remove a plugin from its list by type."""
        current = self.plugins(_type)
        plugins = {p for p in current if p != plugin}
        self.redis.set(("plugins", _type), list(plugins))

    def reset_plugins(self, _type: str) -> None:
        """Remove all plugins of `_type`."""
        self.redis.set(("plugins", _type), [])

    def add_directive(self, *directives: t.Union["Directive", t.Dict[str, t.Any]]) -> None:
        """Add a directive."""
        current = self.directives
        current.add(*directives, unique_by="id")
        self.redis.set("directives", current)

    def clear(self) -> None:
        """Delete all hyperglass cache keys.

        Scoped to the state namespace rather than flushing the database, so hyperglass
        does not delete keys belonging to anything else sharing the Redis database.
        Note that two hyperglass instances sharing a database still share this
        namespace and will clear each other on start; give each its own
        `HYPERGLASS_REDIS_DB`.
        """
        mark_stale()
        batch = []
        for key in self.redis.instance.scan_iter(match=f"{self.redis.namespace}.*", count=500):
            batch.append(key)
            if len(batch) == 500:
                self.redis.instance.delete(*batch)
                batch = []
        if batch:
            self.redis.instance.delete(*batch)
        # Again after the deletes: a check that ran while they were in progress could
        # have found state complete and trusted it again.
        mark_stale()

    def _required(self, key: str) -> t.Any:
        """Recover missing state for synchronous callers without blocking an event loop."""
        try:
            return self.redis.get(key, raise_if_none=True)
        except StateError:
            # State is missing, so the next request must check it again rather than
            # trust the last check.
            mark_stale()
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                pass
            else:
                # The request hook recovers asynchronously before handlers run. If
                # Redis disappears during a request, fail this read and recover on
                # the next request rather than blocking every request on this worker.
                raise
            if not rebuild_state(self.redis):
                raise
            return self.redis.get(key, raise_if_none=True)

    async def ensure_ready(self) -> None:
        """Recover configuration and plugins outside the request event loop.

        Cheap while state is present: see `recovery.ensure_ready`.
        """
        if not await check_ready(self.redis):
            raise StateError(STATE_UNAVAILABLE)

    @property
    def cache(self) -> "RedisManager":
        """Get the redis manager instance."""
        return self.redis

    @property
    def params(self) -> "Params":
        """Get hyperglass configuration parameters (`hyperglass.yaml`)."""
        return self._required("params")

    @property
    def devices(self) -> "Devices":
        """Get hyperglass devices (`devices.yaml`)."""
        return self._required("devices")

    @property
    def ui_params(self) -> "UIParameters":
        """UI parameters, built from params."""
        return self._required("ui_params")

    @property
    def directives(self) -> "Directives":
        """All directives."""
        return self._required("directives")

    @property
    def generation(self) -> t.Optional[str]:
        """Identifier for the current population of state.

        Written every time configuration is loaded into Redis, so a consumer can tell a
        rebuilt store from the one it started with. `None` means state has been lost.
        """
        return self.redis.get("generation", raise_if_none=False)

    def plugins(self, _type: str, *, required: bool = False) -> t.List[PluginT]:
        """Get plugins by type.

        With `required`, a registry missing from Redis, or not yet marked ready, raises
        `StateError` rather than reading as empty or partial. Built-in plugins are
        always registered, so a missing registry means state was lost or is being
        rebuilt, and a query run without its plugins would skip input
        validation and cache unparsed output for the whole cache timeout. The request
        gets a 503 and the next one rebuilds state.
        """
        if not required:
            return self.redis.get(("plugins", _type), raise_if_none=False, value_if_none=[])
        # One round trip for both. `plugins.ready` is deleted when configuration or the
        # registry starts loading and set once every plugin is registered, so a registry
        # being rebuilt by another worker, empty or partial, is not ready either.
        names = (self.redis.key(("plugins", _type)), self.redis.key(("plugins", "ready")))
        registry, ready = self.redis.instance.mget(names)
        if registry is None or ready is None:
            mark_stale()
            raise StateError(
                "Plugin registry '{key}' is missing or not ready in Redis store", key=_type
            )
        return pickle.loads(registry)  # noqa: S301 - written by hyperglass itself
