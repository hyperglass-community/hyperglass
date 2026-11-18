"""Request validation errors return 400 with the failed fields."""

# Third Party
import pytest
from litestar.testing import TestClient
from litestar.exceptions import ValidationException

# Project
from hyperglass.settings import Settings

# hyperglass.api reads state when it is imported, so import it inside the tests,
# after the autouse fixture in conftest.py has seeded the isolated store.


def get_validation_exception_detail(exc):
    """Import and call the handler helper once the store is seeded."""
    # Project
    from hyperglass.api.error_handlers import get_validation_exception_detail as detail

    return detail(exc)


@pytest.fixture
def client(monkeypatch):
    """Provide a test client for the API without building the UI."""
    monkeypatch.setattr(Settings, "disable_ui", True)
    # Project
    from hyperglass.api import app

    with TestClient(app=app) as client:
        yield client


@pytest.mark.parametrize(
    "body",
    (
        pytest.param({"queryTarget": "192.0.2.0/24"}, id="missing-fields"),
        pytest.param({"queryLocation": 1, "queryType": [], "queryTarget": {}}, id="wrong-types"),
    ),
)
def test_validation_error_returns_400(client, body):
    response = client.post("/api/query", json=body)

    assert response.status_code == 400
    data = response.json()
    assert data["level"] == "error"
    assert data["status_code"] == 400


def test_validation_error_names_failed_fields(client):
    response = client.post("/api/query", json={"queryTarget": "192.0.2.0/24"})

    data = response.json()
    assert data["keywords"] == ["queryLocation", "queryType"]
    assert data["output"] == "queryLocation: Field required\nqueryType: Field required"


def test_validation_detail_accepts_dict_extra():
    exc = ValidationException(extra={"queryLocation": "Field required"})

    response = get_validation_exception_detail(exc)

    assert response.status_code == 400
    assert response.content["keywords"] == ["queryLocation"]
    assert response.content["output"] == "queryLocation: 'Field required'"


def test_validation_detail_keeps_unrecognised_list_items():
    exc = ValidationException(extra=["something went wrong"])

    response = get_validation_exception_detail(exc)

    assert response.content["output"] == "something went wrong"
    assert response.content["keywords"] == []
