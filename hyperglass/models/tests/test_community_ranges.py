"""Built-in BGP community targets are range-checked before a command is built (#441)."""

# Third Party
import pytest

# Project
from hyperglass.models.directive import community_error
from hyperglass.defaults.directives import init_builtin_directives
from hyperglass.exceptions.private import InputValidationError

U16, U32 = 65535, 4294967295

VALID = (
    # 32-bit community number
    "0",
    f"{U32}",
    # standard ASN16:VALUE16
    "0:0",
    f"{U16}:{U16}",
    "65000:1",
    # large ASN32:VALUE32:VALUE32
    "0:0:0",
    f"{U32}:{U32}:{U32}",
    "4200000000:1:2",
    # extended, 2-octet ASN : 4-octet value
    f"target:{U16}:{U32}",
    "origin:0:0",
    # extended, 4-octet ASN : 2-octet value
    f"target:{U16 + 1}:{U16}",
    f"origin:{U32}:0",
    # extended, asdot 4-octet ASN : 2-octet value
    f"target:{U16}.{U16}:{U16}",
    "target:1.0:1",
    # extended, IPv4 : 2-octet value
    f"target:192.0.2.1:{U16}",
    "origin:255.255.255.255:0",
    "target:0.0.0.0:1",
)

INVALID = (
    # 32-bit community number
    f"{U32 + 1}",
    # standard
    f"{U16 + 1}:1",
    f"1:{U16 + 1}",
    "70000:1",
    "65000:4294967295",  # 2-octet ASN : 4-octet value needs `target:`/`origin:`
    # large
    f"{U32 + 1}:1:1",
    f"1:{U32 + 1}:1",
    f"1:1:{U32 + 1}",
    # too many parts
    "1:2:3:4",
    "1:2:3:4:5",
    # dotted forms need `target:`/`origin:`
    "192.0.2.1",
    "192.0.2.1:100",
    "1.2:3",
    "1:2.3",
    "1.2:3:4",
    # extended: 2-octet ASN value overflow
    f"target:{U16}:{U32 + 1}",
    # extended: 4-octet ASN takes a 2-octet value
    f"target:{U16 + 1}:{U16 + 1}",
    f"origin:{U32}:{U16 + 1}",
    f"target:{U32 + 1}:1",
    # extended: asdot
    f"target:{U16 + 1}.1:1",
    f"target:1.{U16 + 1}:1",
    f"target:1.1:{U16 + 1}",
    # extended: IPv4
    f"target:192.0.2.1:{U16 + 1}",
    "target:256.0.0.1:1",
    "target:1.2.3:1",
    "target:1.2.3.4.5:1",
    # extended: shape
    "target:65000",
    "target:65000:1:2",
    "origin:1:2:3:4",
)


@pytest.mark.parametrize("value", VALID)
def test_valid_communities(value):
    assert community_error(value) is None


@pytest.mark.parametrize("value", INVALID)
def test_invalid_communities(value):
    assert community_error(value)


COMMUNITY_DIRECTIVES = [d for d in init_builtin_directives() if d.query_kind == "bgp_community"]


@pytest.mark.parametrize("directive", COMMUNITY_DIRECTIVES, ids=lambda d: d.id)
@pytest.mark.parametrize("value", ("70000:1", "1:2:3:4:5", f"target:{U16 + 1}:{U16 + 1}"))
def test_builtin_community_directives_reject_out_of_range(directive, value):
    directive = directive.model_copy(deep=True)
    with pytest.raises(InputValidationError) as error:
        directive.validate_target(value)
    assert error.value.kwargs["error"] == community_error(value)


@pytest.mark.parametrize("directive", COMMUNITY_DIRECTIVES, ids=lambda d: d.id)
def test_builtin_community_directives_accept_standard(directive):
    assert directive.model_copy(deep=True).validate_target("65000:1") is True


@pytest.mark.parametrize("value", VALID)
def test_valid_communities_reach_the_command(value):
    directive = next(d for d in COMMUNITY_DIRECTIVES if d.id == "__hyperglass_frr_bgp_community__")
    assert directive.model_copy(deep=True).validate_target(value) is True
