"""Server-side My IP endpoint (#49)."""

# Third Party
import pytest
from litestar.testing import create_test_client
from hyperglass.util.tests.test_client_address import ProxyRequest, TRUSTED
from hyperglass.state import use_state
from hyperglass.models.config.params import Params


@pytest.fixture
def client():
    # Project
    from hyperglass.api.routes import myip

    with create_test_client([myip], request_class=ProxyRequest) as test_client:
        yield test_client


@pytest.mark.parametrize(
    "headers,family,expected",
    (
        ({"x-real-ip": "192.0.2.10"}, 4, "192.0.2.10"),
        ({"x-real-ip": "192.0.2.10"}, 6, None),
        ({"x-forwarded-for": "2001:db8::10, 10.0.0.1"}, 6, "2001:db8::10"),
        ({"x-forwarded-for": "::ffff:192.0.2.20"}, 4, "192.0.2.20"),
        ({"x-real-ip": "not-an-ip"}, 4, "10.0.0.2"),
    ),
)
def test_myip(client, headers, family, expected):
    use_state().redis.set(
        "params",
        Params(
            web={
                "client_ip": {
                    **TRUSTED,
                    "header": "x-real-ip" if "x-real-ip" in headers else None,
                }
            }
        ),
    )
    assert client.get("/api/myip", params={"family": family}, headers=headers).json() == {
        "ip": expected
    }


def test_my_ip_option():
    # Project
    from hyperglass.models.config.web import Web

    # Server detection is the default, so no third party is contacted (#90).
    assert Web().my_ip == "server"
    assert Web(my_ip="external").my_ip == "external"
    assert Web(my_ip="off").my_ip == "off"
