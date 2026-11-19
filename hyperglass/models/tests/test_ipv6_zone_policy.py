"""IPv6 zones are refused unless a rule allows zoned link-local hosts (#439)."""

# Third Party
import pytest

# Project
from hyperglass.models.directive import Directive, RuleWithIPv4, RuleWithIPv6
from hyperglass.defaults.directives import init_builtin_directives
from hyperglass.exceptions.private import InputValidationError

LINK_LOCAL_HOSTS = ("fe80::1%mgmt0", "fe80::1%eth0/128", "fe80::1%3", "febf:ffff::1%br-lan")
NEVER_ZONED = (
    "fe80::%br-lan/64",  # link-local prefix
    "2001:db8::1%eth0",  # global address
    "2001:db8::%a/64",  # global prefix
    "fec0::1%eth0",  # deprecated site-local
    "ff02::1%eth0",  # link-local multicast
    "::1%lo",  # loopback
    "::ffff:169.254.0.1%eth0",  # IPv4-mapped link-local
)


def rule(**options):
    return RuleWithIPv6(condition="::/0", command="ping {target}", **options)


@pytest.mark.parametrize("target", (*LINK_LOCAL_HOSTS, *NEVER_ZONED))
def test_zones_are_refused_by_default(target):
    instance = rule()
    with pytest.raises(InputValidationError) as error:
        instance.validate_target(target, multiple=False)
    assert error.value.kwargs["kind"] == "Zoned"
    assert instance._passed is False


@pytest.mark.parametrize("target", LINK_LOCAL_HOSTS)
def test_opt_in_accepts_zoned_link_local_hosts(target):
    instance = rule(allow_link_local=True)
    assert instance.validate_target(target, multiple=False) is True
    assert instance._passed is True


@pytest.mark.parametrize("target", NEVER_ZONED)
def test_opt_in_never_accepts_zones_on_prefixes_or_other_addresses(target):
    options = {"allow_link_local": True, "allow_loopback": True, "allow_reserved": True}
    with pytest.raises(InputValidationError) as error:
        rule(**options).validate_target(target, multiple=False)
    assert error.value.kwargs["kind"] == "Zoned"


@pytest.mark.parametrize("target", ("fe80::1", "fe80::/64", "2001:db8::1", "2001:db8::/32"))
def test_targets_without_zones_are_unchanged(target):
    assert rule().validate_target(target, multiple=False) is True


def test_option_is_read_from_directive_config():
    directive = Directive(
        id="ping6",
        name="Ping",
        field=None,
        rules=[
            {"condition": "0.0.0.0/0", "command": "ping {target}"},
            {"condition": "fe80::/10", "command": "ping {target}", "allow_link_local": True},
            {"condition": "::/0", "command": "ping {target}"},
        ],
    )
    assert isinstance(directive.rules[0], RuleWithIPv4)
    assert directive.validate_target("fe80::1%eth0") is True
    with pytest.raises(InputValidationError):
        directive.validate_target("2001:db8::1%eth0")


@pytest.mark.parametrize(
    "directive",
    [d for d in init_builtin_directives() if any(isinstance(r, RuleWithIPv6) for r in d.rules)],
    ids=lambda directive: directive.id,
)
def test_builtin_directives_refuse_zones(directive):
    directive = directive.model_copy(deep=True)
    with pytest.raises(InputValidationError):
        directive.validate_target("fe80::1%eth0")
