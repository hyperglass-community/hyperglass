"""Validation model for Prometheus metrics config."""

# Third Party
from pydantic import Field

# Local
from ..main import HyperglassModel
from ..fields import AnyUri


class Metrics(HyperglassModel):
    """Validation model for params.metrics."""

    enable: bool = Field(
        False,
        title="Enable",
        description=(
            "Expose Prometheus metrics. The metrics path is unauthenticated, so restrict "
            "access to it at your reverse proxy or firewall."
        ),
    )
    path: AnyUri = Field(
        "/metrics",
        title="Path",
        description="HTTP path at which Prometheus metrics are exposed.",
    )
