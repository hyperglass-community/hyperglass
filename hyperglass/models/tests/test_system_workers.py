"""Tests for HyperglassSettings.worker_count."""

# flake8: noqa
# Project
from hyperglass.util import cpu_count
from hyperglass.models.system import HyperglassSettings


def _settings(tmp_path, **kwargs):
    return HyperglassSettings(app_path=tmp_path, **kwargs)


def test_explicit_workers_honored(tmp_path):
    assert _settings(tmp_path, debug=False, workers=4).worker_count == 4


def test_workers_clamped_to_at_least_one(tmp_path):
    assert _settings(tmp_path, debug=False, workers=0).worker_count == 1


def test_debug_defaults_to_one(tmp_path):
    assert _settings(tmp_path, debug=True).worker_count == 1


def test_unset_non_debug_uses_cpu_default(tmp_path):
    assert _settings(tmp_path, debug=False).worker_count == min(cpu_count(2), 8)


def test_explicit_workers_overrides_debug(tmp_path):
    # An explicit worker count wins even in debug mode.
    assert _settings(tmp_path, debug=True, workers=3).worker_count == 3


def test_automatic_workers_stop_at_eight(tmp_path, monkeypatch):
    monkeypatch.setattr("hyperglass.models.system.cpu_count", lambda multiplier=0: 144)
    assert _settings(tmp_path, debug=False).worker_count == 8


def test_redis_pool_covers_the_default_thread_pool(tmp_path):
    # Each worker runs Redis commands from up to 32 threads.
    assert _settings(tmp_path, debug=False, workers=1).redis_connection_pool["max_connections"] == 32
    assert _settings(tmp_path, debug=False, workers=64).redis_connection_pool["max_connections"] == 64
