"""Validation models for request quotas."""

# Third Party
from pydantic import PositiveInt

# Local
from ..main import HyperglassModel


class RateQuota(HyperglassModel):
    """Requests allowed in each window, to one client and to all clients together.

    Clients are counted per IPv4 address and per IPv6 /64, so one host cannot multiply
    its quota by rotating through the addresses of its prefix.
    """

    client_limit: PositiveInt
    global_limit: PositiveInt
    # Length of the fixed counting window, in seconds.
    window: PositiveInt


class QueryLimit(RateQuota):
    """Optional rate limit on `POST /api/query`."""

    enable: bool = False
    client_limit: PositiveInt = 30
    global_limit: PositiveInt = 300
    window: PositiveInt = 60
