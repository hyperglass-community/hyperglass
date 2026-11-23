"""Operator commands for share snapshots (#559)."""

# Third Party
from typer.testing import CliRunner

# Project
from hyperglass.cli import cli
from hyperglass.state import use_state
from hyperglass.util.tests.test_share import raw, index, client, device, shared  # noqa: F401

runner = CliRunner()


def invoke(*args: str):
    return runner.invoke(cli, ["share", *args], terminal_width=200)


def test_list(device):  # noqa: F811
    with client() as test_client:
        first = shared(test_client, "192.0.2.0/24")["id"]
        second = shared(test_client, "2001:db8::/32")["id"]

    result = invoke("list")

    assert result.exit_code == 0, result.output
    assert first in result.output
    assert second in result.output
    assert "2001:db8::/32" in result.output
    assert "BGP Route" in result.output


def test_list_empty(device):  # noqa: F811
    result = invoke("list")

    assert result.exit_code == 0, result.output
    assert "No shares" in result.output


def test_list_skips_an_invalid_snapshot(device):  # noqa: F811
    with client() as test_client:
        share_id = shared(test_client)["id"]
    raw().hset(f"hyperglass.share:{share_id}", "snapshot", "{not json")

    result = invoke("list")

    assert result.exit_code == 0, result.output
    assert share_id in result.output
    assert "invalid" in result.output


def test_delete(device):  # noqa: F811
    with client() as test_client:
        kept = shared(test_client, "192.0.2.0/24")["id"]
        deleted = shared(test_client, "198.51.100.0/24")["id"]

        result = invoke("delete", deleted)

        assert result.exit_code == 0, result.output
        assert test_client.get(f"/api/share/{deleted}").status_code == 404
        assert test_client.get(f"/api/share/{kept}").status_code == 200
    assert index() == [kept.encode()]


def test_delete_unknown(device):  # noqa: F811
    result = invoke("delete", "0" * 32)

    assert result.exit_code == 1
    assert "not found" in result.output


def test_clear(device):  # noqa: F811
    with client() as test_client:
        ids = [shared(test_client, target)["id"] for target in ("192.0.2.0/24", "2001:db8::/32")]
    raw().set("hyperglass.share:stray", "x")
    raw().set("unrelated", "kept")

    result = invoke("clear", "--yes")

    assert result.exit_code == 0, result.output
    assert "Deleted" in result.output
    assert raw().keys("hyperglass.share:*") == []
    assert raw().get("unrelated") == b"kept"
    # Configuration state is not touched.
    assert use_state().redis.get("params") is not None
    for share_id in ids:
        assert raw().exists(f"hyperglass.share:{share_id}") == 0


def test_clear_asks_first(device):  # noqa: F811
    with client() as test_client:
        share_id = shared(test_client)["id"]

    result = runner.invoke(cli, ["share", "clear"], input="n\n")

    assert result.exit_code != 0
    assert raw().exists(f"hyperglass.share:{share_id}") == 1
