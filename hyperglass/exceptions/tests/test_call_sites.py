"""Every call of a hyperglass error matches the error's signature (#547)."""

# Standard Library
import ast
import string
import typing as t
import inspect
from pathlib import Path

# Project
from hyperglass import exceptions
from hyperglass.exceptions import public, private
from hyperglass.exceptions._common import HyperglassError

PACKAGE = Path(exceptions.__file__).parent.parent

ERRORS: t.Dict[str, t.Type[HyperglassError]] = {
    name: obj
    for module in (exceptions, private, public)
    for name, obj in inspect.getmembers(module, inspect.isclass)
    if issubclass(obj, HyperglassError)
}


def _skip(path: Path) -> bool:
    """Skip the UI, external plugins and tests, as the linters do."""
    parts = path.relative_to(PACKAGE).parts
    return parts[0] == "ui" or parts[:2] == ("plugins", "external") or "tests" in parts


def _error_name(call: ast.Call) -> t.Optional[str]:
    """Return the error class a call constructs, if any."""
    func = call.func
    name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
    return name if name in ERRORS else None


def _error_calls() -> t.Iterator[t.Tuple[str, ast.Call]]:
    """Yield every `SomeError(...)` call in the package with its location."""
    for path in sorted(PACKAGE.rglob("*.py")):
        if _skip(path):
            continue
        for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
            if isinstance(node, ast.Call) and _error_name(node):
                yield f"{path.relative_to(PACKAGE)}:{node.lineno}", node


def _literal_message(call: ast.Call) -> t.Optional[str]:
    """Return the message when it is a string literal."""
    message = next((k.value for k in call.keywords if k.arg == "message"), None)
    if message is None and call.args:
        message = call.args[0]
    if isinstance(message, ast.Constant) and isinstance(message.value, str):
        return message.value
    return None


def test_error_calls_match_signatures():
    """No error is called with an extra positional or an unknown keyword argument.

    Either raises `TypeError` in place of the intended error.
    """
    mismatched = []
    for location, call in _error_calls():
        if any(isinstance(a, ast.Starred) for a in call.args) or any(
            k.arg is None for k in call.keywords
        ):
            continue
        signature = inspect.signature(ERRORS[_error_name(call)])
        try:
            signature.bind(*[None] * len(call.args), **{k.arg: None for k in call.keywords})
        except TypeError as err:
            mismatched.append(f"{location}: {_error_name(call)}: {err}")
    assert not mismatched, "\n".join(mismatched)


def test_error_message_placeholders_have_arguments():
    """Every `{name}` in a literal message has a keyword argument, and none is positional.

    `_safe_format` blanks a placeholder without an argument, so the message loses it silently.
    """
    missing = []
    for location, call in _error_calls():
        message = _literal_message(call)
        if message is None:
            continue
        keywords = {k.arg for k in call.keywords}
        parsed = string.Formatter().parse(message)
        fields = [field for _, field, _, _ in parsed if field is not None]
        if "" in fields:
            missing.append(f"{location}: positional placeholder in {message!r}")
        for field in fields:
            name = field.split(".")[0].split("[")[0]
            if name and name not in keywords:
                missing.append(f"{location}: no argument for {{{field}}} in {message!r}")
    assert not missing, "\n".join(missing)
