"""A rule after IP rules can't accept targets the IP rule options refuse (#495)."""

# Third Party
import pytest

# Project
from hyperglass.models.directive import Directive
from hyperglass.exceptions.private import InputValidationError

# Targets refused by default, with the option that admits them and an IP rule
# condition that contains them.
REFUSED = (
    ("127.0.0.1", "Loopback", "allow_loopback", "0.0.0.0/0"),
    ("127.0.0.0/8", "Loopback", "allow_loopback", "0.0.0.0/0"),
    ("::1", "Loopback", "allow_loopback", "::/0"),
    ("0.0.0.0", "Unspecified", "allow_unspecified", "0.0.0.0/0"),  # noqa: S104
    ("::", "Unspecified", "allow_unspecified", "::/0"),
    ("240.0.0.1", "Reserved", "allow_reserved", "0.0.0.0/0"),
    ("100::1", "Reserved", "allow_reserved", "::/0"),
    ("169.254.1.1", "Link-local", "allow_link_local", "0.0.0.0/0"),
    ("169.254.0.0/16", "Link-local", "allow_link_local", "0.0.0.0/0"),
    ("fe80::1", "Link-local", "allow_link_local", "::/0"),
    ("fe80::/64", "Link-local", "allow_link_local", "::/0"),
    ("fe80::1%eth0", "Zoned", "allow_link_local", "::/0"),
    ("fe80::1%3", "Zoned", "allow_link_local", "::/0"),
)
# Zones that no option admits.
ALWAYS_ZONED = ("2001:db8::1%eth0", "fe80::%eth0/64", "::1%lo", "::ffff:169.254.0.1%eth0")
ORDINARY = ("192.0.2.1", "198.51.100.0/24", "2001:db8::1", "2001:db8::/48")


def directive(*rules, multiple=False) -> Directive:
    return Directive(id="test", name="Test", field=None, multiple=multiple, rules=list(rules))


def ip_rule(condition, **options):
    return {"condition": condition, "command": "ping {target}", **options}


PATTERN = {"condition": "*", "command": "ping {target}"}
NO_VALIDATION = {"condition": None, "command": "ping {target}"}


@pytest.mark.parametrize("target", ("fe80::1%eth0", "fe80::1", "::1", "169.254.1.1"))
def test_issue_example_refuses_targets(target):
    """The directive from #495: an IPv6 documentation rule, then `*`."""
    instance = directive(ip_rule("2001:db8::/32"), PATTERN)
    with pytest.raises(InputValidationError):
        instance.validate_target(target)


@pytest.mark.parametrize("last", (PATTERN, NO_VALIDATION), ids=("pattern", "no-validation"))
@pytest.mark.parametrize("target, kind, option, condition", REFUSED)
def test_rule_after_ip_rules_refuses_class(last, target, kind, option, condition):
    instance = directive(ip_rule("2001:db8::/32"), ip_rule("192.0.2.0/24"), last)
    with pytest.raises(InputValidationError) as error:
        instance.validate_target(target)
    assert error.value.kwargs["kind"] == kind


@pytest.mark.parametrize("target, kind, option, condition", REFUSED)
def test_option_on_ip_rule_without_target_does_not_apply(target, kind, option, condition):
    """An option admits a target only through an IP rule that contains it."""
    other = "2001:db8::/32" if ":" in condition else "192.0.2.0/24"
    instance = directive(ip_rule(other, **{option: True}), PATTERN)
    with pytest.raises(InputValidationError) as error:
        instance.validate_target(target)
    assert error.value.kwargs["kind"] == kind


@pytest.mark.parametrize("target, kind, option, condition", REFUSED)
def test_ip_rule_with_option_still_accepts(target, kind, option, condition):
    instance = directive(ip_rule(condition, **{option: True}), PATTERN)
    assert instance.validate_target(target) is True


@pytest.mark.parametrize("target", ALWAYS_ZONED)
def test_zones_refused_with_every_option(target):
    options = {
        "allow_loopback": True,
        "allow_reserved": True,
        "allow_unspecified": True,
        "allow_link_local": True,
    }
    instance = directive(ip_rule("192.0.2.0/24", **options), PATTERN)
    with pytest.raises(InputValidationError) as error:
        instance.validate_target(target)
    assert error.value.kwargs["kind"] == "Zoned"


def test_zone_with_line_break_is_refused():
    instance = directive(ip_rule("192.0.2.0/24"), PATTERN)
    with pytest.raises(InputValidationError):
        instance.validate_target("fe80::1%eth0\nreboot")


@pytest.mark.parametrize("target", ORDINARY)
def test_ordinary_targets_still_accepted(target):
    instance = directive(ip_rule("2001:db8::/32"), PATTERN)
    assert instance.validate_target(target) is True


def test_target_list_is_checked():
    """An IP rule reads a one-item list, and the pattern rule then gets the list."""
    instance = directive(ip_rule("2001:db8::/32"), PATTERN, multiple=True)
    assert instance.validate_target(["192.0.2.1"]) is True
    with pytest.raises(InputValidationError) as error:
        instance.validate_target(["::1"])
    assert error.value.kwargs["kind"] == "Loopback"


@pytest.mark.parametrize("target, kind, option, condition", REFUSED)
def test_rule_before_ip_rules_refuses_class(target, kind, option, condition):
    """An IP rule's option admits a target only when that IP rule accepts it."""
    instance = directive(PATTERN, ip_rule(condition, **{option: True}))
    with pytest.raises(InputValidationError) as error:
        instance.validate_target(target)
    assert error.value.kwargs["kind"] == kind


@pytest.mark.parametrize(
    "target, kind", (("127.0.0.1/8", "Loopback"), ("fe80::1/64", "Link-local"))
)
def test_prefix_with_host_bits_is_checked(target, kind):
    """IP rules refuse host bits; a pattern rule placed first can still accept them."""
    instance = directive(PATTERN, ip_rule("2001:db8::/32"), ip_rule("192.0.2.0/24"))
    with pytest.raises(InputValidationError) as error:
        instance.validate_target(target)
    assert error.value.kwargs["kind"] == kind


def test_refusing_rule_is_not_marked_passed():
    instance = directive(ip_rule("2001:db8::/32"), PATTERN)
    with pytest.raises(InputValidationError):
        instance.validate_target("::1")
    assert [rule._passed for rule in instance.rules] == [None, False]


def test_deny_rule_after_ip_rules_still_denies():
    deny = {"condition": "^10\\.", "action": "deny", "command": "ping {target}"}
    instance = directive(ip_rule("2001:db8::/32"), deny, PATTERN)
    with pytest.raises(InputValidationError) as error:
        instance.validate_target("10.0.0.1")
    assert "kind" not in error.value.kwargs


@pytest.mark.parametrize("target", ("127.0.0.1", "::1", "fe80::1%eth0"))
def test_directive_without_ip_rules_is_unchanged(target):
    """Without IP rules, a directive has no address class policy to apply."""
    assert directive(PATTERN).validate_target(target) is True
