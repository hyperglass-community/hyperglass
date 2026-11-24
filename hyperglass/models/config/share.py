"""Validation model for share snapshots."""

# Standard Library
import typing as t

# Third Party
from pydantic import Field, PositiveInt, ValidationInfo, field_validator, model_validator

# Local
from ..main import HyperglassModel
from .quota import Window, RateQuota

# Seconds a share is kept: at least a minute, at most a year.
ShareTimeout = t.Annotated[int, Field(ge=60, le=31536000)]

DAY = 86400


class ShareQuota(RateQuota):
    """Shares one client, and all clients together, can create in each window."""

    client_limit: PositiveInt = 10
    global_limit: PositiveInt = 100
    window: Window = 3600


class ShareReadQuota(RateQuota):
    """Share reads and delete requests from one client, and from all clients, in each window."""

    client_limit: PositiveInt = 60
    global_limit: PositiveInt = 1200
    window: Window = 60


class Share(HyperglassModel):
    """Snapshots of cached query results that can be read by their id (#559)."""

    enable: bool = False
    # Whether a browser keeps the links it creates, with their delete tokens, in its local
    # storage (#562), so they can be copied or deleted later. With `False`, they are kept in
    # the page's memory only, and a browser's stored links are deleted when it loads the
    # page: for kiosks and shared terminals. Sent to the UI.
    remember_links: bool = True
    # Seconds a share is kept when the request doesn't choose. One of `timeout_choices`.
    # Reading a share doesn't extend it.
    timeout: ShareTimeout = 30 * DAY
    # The longest a visitor can choose; longer `timeout_choices` are dropped.
    max_timeout: ShareTimeout = 90 * DAY
    # The times a visitor can choose from, in seconds. Sorted, without duplicates and
    # without those above `max_timeout`, once validated.
    timeout_choices: t.List[ShareTimeout] = [7 * DAY, 30 * DAY, 90 * DAY]
    # Live shares from all clients together. A full store refuses new shares; it never
    # deletes existing ones to make room.
    max_entries: PositiveInt = 1000
    # Bytes of one stored snapshot.
    max_size: PositiveInt = 262144
    quota: ShareQuota = Field(default_factory=ShareQuota)
    read_quota: ShareReadQuota = Field(default_factory=ShareReadQuota)

    @field_validator("timeout_choices", mode="after")
    @classmethod
    def cap_choices(cls, choices: t.List[int], info: ValidationInfo) -> t.List[int]:
        """Sort the choices and drop duplicates and those above `max_timeout`."""
        max_timeout = info.data.get("max_timeout")
        if max_timeout is None:
            # `max_timeout` failed its own validation, which is reported instead.
            return choices
        capped = sorted({choice for choice in choices if choice <= max_timeout})
        if not capped:
            raise ValueError("share.timeout_choices has no time within share.max_timeout")
        return capped

    @model_validator(mode="after")
    def check_timeout(self) -> "Share":
        """`timeout` must be one of the choices that remain."""
        if self.timeout not in self.timeout_choices:
            raise ValueError(
                "share.timeout must be one of share.timeout_choices, within share.max_timeout"
            )
        return self
