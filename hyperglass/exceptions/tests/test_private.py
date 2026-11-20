"""Test formatting of private error messages."""

# Third Party
import pytest
from pydantic import BaseModel, ValidationError

# Local
from ..private import ConfigInvalid


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
