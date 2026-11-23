"""Validation model for share snapshots."""

# Standard Library
import typing as t

# Third Party
from pydantic import Field, PositiveInt

# Local
from ..main import HyperglassModel
from .quota import Window, RateQuota

# Seconds a share is kept: at least a minute, at most 30 days.
ShareTimeout = t.Annotated[int, Field(ge=60, le=2592000)]


class ShareQuota(RateQuota):
    """Shares one client, and all clients together, can create in each window."""

    client_limit: PositiveInt = 10
    global_limit: PositiveInt = 100
    window: Window = 3600


class ShareReadQuota(RateQuota):
    """Shares one client, and all clients together, can read in each window."""

    client_limit: PositiveInt = 60
    global_limit: PositiveInt = 1200
    window: Window = 60


class Share(HyperglassModel):
    """Snapshots of cached query results that can be read by their id (#559)."""

    enable: bool = False
    # Seconds from creation until a share is deleted. Reading it doesn't extend it.
    timeout: ShareTimeout = 604800
    # Live shares from all clients together. A full store refuses new shares; it never
    # deletes existing ones to make room.
    max_entries: PositiveInt = 1000
    # Bytes of one stored snapshot.
    max_size: PositiveInt = 262144
    quota: ShareQuota = Field(default_factory=ShareQuota)
    read_quota: ShareReadQuota = Field(default_factory=ShareReadQuota)
