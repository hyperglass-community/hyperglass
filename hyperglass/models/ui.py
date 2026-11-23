"""UI Configuration models."""

# Standard Library
import typing as t

# Local
from .main import HyperglassModel
from .config.web import WebPublic
from .config.params import ParamsPublic
from .config.messages import Messages

Alignment = t.Union[t.Literal["left"], t.Literal["center"], t.Literal["right"], None]
StructuredDataField = t.Tuple[str, str, Alignment]


class UIDirective(HyperglassModel):
    """UI: Directive."""

    id: str
    name: str
    field_type: t.Union[str, None]
    groups: t.List[str]
    description: str
    info: t.Optional[str] = None
    options: t.Optional[t.List[t.Dict[str, t.Any]]] = None
    variables: t.List[t.Dict[str, t.Any]] = []
    retain: bool


class UILocation(HyperglassModel):
    """UI: Location (Device)."""

    id: str
    name: str
    group: t.Optional[str] = None
    avatar: t.Optional[str] = None
    description: t.Optional[str] = None
    directives: t.List[UIDirective] = []


class UIDevices(HyperglassModel):
    """UI: Devices."""

    group: t.Optional[str] = None
    locations: t.List[UILocation] = []


class UIContent(HyperglassModel):
    """UI: Content."""

    credit: str
    greeting: str


class UICacheRefresh(HyperglassModel):
    """UI: Cache refresh.

    Only `enable`: the UI learns the interval from `refresh_in` on each response.
    """

    enable: bool


class UICache(HyperglassModel):
    """UI: Cache.

    Only what the UI reads. The full `Cache` model would fill in server-only fields,
    such as `refresh.min_interval`, with their defaults rather than the configured values.
    """

    timeout: int
    show_text: bool
    refresh: UICacheRefresh


class UIShare(HyperglassModel):
    """UI: Share. The times a visitor can keep a share for, and the default."""

    timeout: int
    timeout_choices: t.List[int]


class UIParameters(ParamsPublic, HyperglassModel):
    """UI Configuration Parameters."""

    cache: UICache
    share: UIShare
    web: WebPublic
    messages: Messages
    version: str
    devices: t.List[UIDevices] = []
    parsed_data_fields: t.Tuple[StructuredDataField, ...]
    content: UIContent
    developer_mode: bool
