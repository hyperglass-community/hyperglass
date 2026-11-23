"""A directive's `retain` flag keeps its results out of query history (#558)."""

# Third Party
import pytest
from pydantic import ValidationError

# Project
from hyperglass.models.ui import UIDevices
from hyperglass.models.directive import Directives
from hyperglass.defaults.directives import init_builtin_directives


def _raw(**keys):
    """One directive as `directives.yaml` holds it, keyed by its ID."""
    return {
        "private_route": {
            "name": "Private Route",
            "rules": [
                {"condition": "0.0.0.0/0", "command": "show route {target}"},
                {"condition": "::/0", "command": "show route {target}"},
            ],
            "field": {"description": "IP address or prefix"},
            **keys,
        }
    }


def test_retain_defaults_to_true():
    (directive,) = Directives.new(_raw())

    assert directive.retain is True
    assert directive.frontend()["retain"] is True


def test_retain_false_is_read_from_the_directives_file():
    (directive,) = Directives.new(_raw(retain=False))

    assert directive.retain is False
    assert directive.frontend()["retain"] is False


def test_retain_must_be_a_boolean():
    with pytest.raises(ValidationError, match="retain"):
        Directives.new(_raw(retain="sometimes"))


def test_every_builtin_directive_is_retained():
    builtins = init_builtin_directives()

    assert len(builtins) > 0
    assert all(directive.retain is True for directive in builtins)


@pytest.mark.parametrize("retain", (True, False))
def test_retain_reaches_the_ui_parameters(retain):
    """The flag survives the `UIDirective` model that `hyperglass.json` is built from."""
    (directive,) = Directives.new(_raw(retain=retain))
    group = UIDevices(
        group="Europe",
        locations=[{"id": "router", "name": "Router", "directives": [directive.frontend()]}],
    )

    exported = group.export_dict(by_alias=True)

    assert exported["locations"][0]["directives"][0]["retain"] is retain


def test_a_ui_directive_without_retain_is_rejected():
    """A directive can't reach `hyperglass.json` without the flag: it never defaults to retain."""
    (directive,) = Directives.new(_raw())
    exported = directive.frontend()
    del exported["retain"]

    with pytest.raises(ValidationError, match="retain"):
        UIDevices(
            group="Europe",
            locations=[{"id": "router", "name": "Router", "directives": [exported]}],
        )
