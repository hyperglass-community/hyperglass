"""Link-local targets and IPv6 zones are refused unless a rule allows link-local (#439)."""

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
UNZONED_LINK_LOCAL = (
    ("fe80::1", "::/0"),
    ("febf:ffff::1", "::/0"),
    ("fe80::/64", "::/0"),
    ("fe80::/10", "::/0"),
    ("169.254.1.1", "0.0.0.0/0"),
    ("169.254.0.0/24", "0.0.0.0/0"),
    ("169.254.0.0/16", "0.0.0.0/0"),
)
NOT_LINK_LOCAL = (
    ("2001:db8::1", "::/0"),
    ("2001:db8::/32", "::/0"),
    ("fec0::1", "::/0"),  # just above fe80::/10
    ("::/0", "::/0"),  # contains link-local, but is not wholly link-local
    ("fe80::/9", "::/0"),
    ("192.0.2.1", "0.0.0.0/0"),
    ("169.255.0.1", "0.0.0.0/0"),
    ("169.254.0.0/15", "0.0.0.0/0"),
    ("0.0.0.0/0", "0.0.0.0/0"),
)


def rule(condition="::/0", **options):
    model = RuleWithIPv4 if "." in condition else RuleWithIPv6
    return model(condition=condition, command="ping {target}", **options)


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


@pytest.mark.parametrize("target, condition", UNZONED_LINK_LOCAL)
def test_link_local_targets_are_refused_by_default(target, condition):
    instance = rule(condition)
    with pytest.raises(InputValidationError) as error:
        instance.validate_target(target, multiple=False)
    assert error.value.kwargs["kind"] == "Link-local"
    assert instance._passed is False


@pytest.mark.parametrize("target, condition", UNZONED_LINK_LOCAL)
def test_other_options_do_not_admit_link_local(target, condition):
    options = {"allow_loopback": True, "allow_reserved": True, "allow_unspecified": True}
    with pytest.raises(InputValidationError) as error:
        rule(condition, **options).validate_target(target, multiple=False)
    assert error.value.kwargs["kind"] == "Link-local"


@pytest.mark.parametrize("target, condition", UNZONED_LINK_LOCAL)
def test_opt_in_accepts_link_local_targets(target, condition):
    instance = rule(condition, allow_link_local=True)
    assert instance.validate_target(target, multiple=False) is True
    assert instance._passed is True


@pytest.mark.parametrize("allow_link_local", (False, True))
@pytest.mark.parametrize("target, condition", NOT_LINK_LOCAL)
def test_other_targets_are_unchanged(target, condition, allow_link_local):
    instance = rule(condition, allow_link_local=allow_link_local)
    assert instance.validate_target(target, multiple=False) is True


def test_option_is_read_from_directive_config():
    directive = Directive(
        id="ping-link-local",
        name="Ping",
        field=None,
        rules=[
            {"condition": "169.254.0.0/16", "command": "ping {target}", "allow_link_local": True},
            {"condition": "0.0.0.0/0", "command": "ping {target}"},
            {"condition": "fe80::/10", "command": "ping {target}", "allow_link_local": True},
            {"condition": "::/0", "command": "ping {target}"},
        ],
    )
    assert isinstance(directive.rules[0], RuleWithIPv4)
    assert directive.rules[0].allow_link_local is True
    assert directive.rules[1].allow_link_local is False
    assert directive.validate_target("169.254.1.1") is True
    assert directive.validate_target("fe80::1") is True
    assert directive.validate_target("fe80::1%eth0") is True
    with pytest.raises(InputValidationError):
        directive.validate_target("2001:db8::1%eth0")


IP_BUILTINS = [
    d for d in init_builtin_directives() if any(isinstance(r, RuleWithIPv6) for r in d.rules)
]


@pytest.mark.parametrize("directive", IP_BUILTINS, ids=lambda directive: directive.id)
@pytest.mark.parametrize("target", ("fe80::1%eth0", "fe80::1", "169.254.1.1"))
def test_builtin_directives_refuse_link_local(directive, target):
    if "." in target and not any(isinstance(r, RuleWithIPv4) for r in directive.rules):
        pytest.skip("directive has no IPv4 rule")
    directive = directive.model_copy(deep=True)
    with pytest.raises(InputValidationError):
        directive.validate_target(target)
