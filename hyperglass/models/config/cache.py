"""Validation model for cache config."""

# Third Party
from pydantic import PositiveInt, model_validator

# Local
from ..main import HyperglassModel


class CacheRefresh(HyperglassModel):
    """Forced refresh of cached results through `force` on `/api/query`."""

    enable: bool = False
    # A forced query re-runs a cached result only once it is this many seconds old.
    min_interval: PositiveInt = 30


class Cache(HyperglassModel):
    """Public cache parameters."""

    timeout: int = 120
    show_text: bool = True
    refresh: CacheRefresh = CacheRefresh()

    @model_validator(mode="after")
    def validate_refresh_interval(self) -> "Cache":
        """Keep the refresh interval below the cache timeout when refresh is enabled.

        An entry only lives past `timeout` while hits keep renewing it, so an interval
        of `timeout` or more would refuse nearly every forced refresh.
        """
        if self.refresh.enable and self.refresh.min_interval >= self.timeout:
            raise ValueError(
                "cache.refresh.min_interval ({}) must be less than cache.timeout ({})".format(
                    self.refresh.min_interval, self.timeout
                )
            )
        return self
