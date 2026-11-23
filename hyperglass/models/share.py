"""Share snapshots, as stored in Redis and returned by `GET /api/share/{id}` (#559).

A stored snapshot is read back through these models before it is returned. Every model
forbids unknown fields and takes values only of their own type, so a snapshot changed in
Redis by hand, or written by another version, is refused instead of being returned.
"""

# Standard Library
import typing as t

# Third Party
from pydantic import Field, BaseModel, ConfigDict, AwareDatetime, field_validator, model_validator

# Project
from hyperglass.util import snake_to_camel

__all__ = ("SNAPSHOT_VERSION", "Snapshot", "ShareRequest", "ShareResult")

# Version of the snapshot format this version writes and reads. Raise it when the
# format changes, so a snapshot written in another format is not served as this one.
SNAPSHOT_VERSION = 1

TEXT = "text/plain"


class _Model(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        alias_generator=snake_to_camel,
        populate_by_name=True,
        frozen=True,
    )


class ShareQuery(_Model):
    """The query whose result is shared."""

    # Device ID.
    location: str
    # Directive ID and name: the name finds the equivalent directive of another vendor.
    query_type: str
    query_type_name: str
    # The target as validated, before input plugins transform it.
    target: t.Union[str, t.List[str]]
    variables: t.Dict[str, str]


class ShareLabels(_Model):
    """Display names of the query's location and query type."""

    location: str
    query_type: str


class ShareResult(_Model):
    """One device's result."""

    query: ShareQuery
    labels: ShareLabels
    output: t.Union[str, t.Dict[str, t.Any]]
    format: t.Literal["text/plain", "application/json"]
    # Time the device ran the query, as the query response reports it.
    timestamp: str
    # Seconds the device took.
    runtime: int = Field(ge=0)

    @model_validator(mode="after")
    def check_format(self) -> "ShareResult":
        """Structured output is an object; text output is a string."""
        if isinstance(self.output, str) != (self.format == TEXT):
            raise ValueError("output does not match format")
        return self


class Snapshot(_Model):
    """A share: copies of cached query results, one for now."""

    version: t.Literal[1]
    # Stored as ISO 8601 text, which strict mode alone would refuse.
    created_at: AwareDatetime = Field(strict=False)
    expires_at: AwareDatetime = Field(strict=False)
    results: t.List[ShareResult] = Field(min_length=1)


class ShareRequest(BaseModel):
    """Body of `POST /api/share`: the `id` of a query response."""

    model_config = ConfigDict(extra="forbid", alias_generator=snake_to_camel)

    query_id: str = Field(pattern=r"^hyperglass\.query\.[0-9a-f]{64}$")
    # Seconds to keep the share, one of `share.timeout_choices`; `share.timeout` if
    # absent or null.
    expires_in: t.Optional[int] = Field(None, gt=0)

    @field_validator("expires_in", mode="before")
    @classmethod
    def whole_seconds(cls, value: t.Any) -> t.Any:
        """Take a JSON integer only: not a string, a float or a boolean."""
        if value is not None and type(value) is not int:
            raise ValueError("expiresIn must be an integer")
        return value
