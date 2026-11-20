"""Device groups and directive names keep first-seen order (#492)."""

# Project
from hyperglass.models.config.devices import Devices

# Eight groups, so a hash-ordered set matches first-seen order only by chance (1 in 8!).
GROUPS = ("Zulu", "Alpha", "Mike", "Bravo", "Yankee", "Charlie", "X-ray", "Delta")


def device(name, group, platform="juniper"):
    return {
        "name": name,
        "address": "192.0.2.1",
        "group": group,
        "credential": {"username": "lg", "password": "lg"},
        "platform": platform,
        "attrs": {"source4": "192.0.2.1", "source6": "2001:db8::1"},
    }


def test_frontend_groups_follow_device_order():
    # The first group is repeated at the end: a repeat must not move it.
    items = [device(f"router {i}", group) for i, group in enumerate((*GROUPS, GROUPS[0]))]
    exported = Devices(*items).frontend()

    assert [group["group"] for group in exported] == list(GROUPS)
    assert [location["name"] for location in exported[0]["locations"]] == ["router 0", "router 8"]


def test_directive_names_follow_device_order():
    devices = Devices(device("one", "A", "juniper"), device("two", "B", "arista_eos"))
    names = devices.directive_names()

    expected = list(
        dict.fromkeys(directive.name for d in devices for directive in d.directives)
    )
    assert names == expected
    assert len(names) == len(set(names))
