"""Test formatting of private error messages."""

# Third Party
import pytest
from pydantic import BaseModel, ValidationError

# Local
from ..private import ConfigError, ConfigInvalid


class _Model(BaseModel):
    name: str
    port: int


def test_config_invalid_lists_pydantic_errors():
    """ConfigInvalid formats exactly the errors of a real ValidationError (#449)."""
    with pytest.raises(ValidationError) as exc:
        _Model(name=None, port="not-a-port")

    errors = exc.value.errors()
    assert len(errors) == 2

    message = ConfigInvalid(errors=errors).message

    assert message.count("Field: ") == len(errors)
    assert f"Field: name\n  Error: {errors[0]['msg']}" in message
    assert f"Field: port\n  Error: {errors[1]['msg']}" in message


def test_private_error_level_keyword():
    """`level` sets the instance level instead of being formatted into the message (#547)."""
    err = ConfigError("Command '{c}' is missing '{k}'", level="danger", c="cmd", k="attr")

    assert err.level == "danger"
    assert err.status_code == 500
    assert err.message == "Command 'cmd' is missing 'attr'"
    assert sorted(err.keywords) == ["attr", "cmd"]


def test_private_error_default_level():
    """A private error keeps its class level when no level is passed."""
    assert ConfigError("boom").level == "warning"
    assert ConfigError("boom").status_code == 400
