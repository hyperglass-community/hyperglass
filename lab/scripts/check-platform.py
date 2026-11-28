#!/usr/bin/env python3
"""Wait for appliance SSH and verify the fixture data link after deployment.

SSH runs inside the Hyperglass lab container, so the probe uses the paramiko and
Netmiko versions that Hyperglass pins instead of the host Python's.
"""

# Standard Library
import os
import json
import time
import base64
import argparse
import subprocess
from pathlib import Path

PLATFORMS = {
    "sonic": (1, "linux", "admin", "admin", "hostname"),
    "exos": (2, "extreme_exos", "admin", "admin", "show switch"),
    "voss": (3, "extreme_vsp", "admin", "Lab-Router9", "show sys-info"),
    "xrd": (4, "cisco_xr", "clab", "clab@123", "show version"),
    "nexus": (6, "cisco_nxos", "admin", "Lab-Router9", "show version"),
    "timos": (7, "nokia_sros", "admin", "Lab-Router9", "show version"),
    "routeros6": (8, "mikrotik_routeros", "admin", "Lab-Router9", "/system resource print"),
    "os9": (9, "dell_force10", "admin", "Lab-Router9", "show version"),
}
# Container that runs the SSH probe. It shares the management network with the appliances.
PROBE_CONTAINER = os.environ.get("HYPERGLASS_PROBE_CONTAINER", "clab-hyperglass-hyperglass")
# Runs in the container. Reads the job as JSON on stdin; a non-zero exit is a failed probe.
SSH_PROBE = """
import json, sys
from netmiko import ConnectHandler
job = json.load(sys.stdin)
with ConnectHandler(**job["connect"]) as conn:
    output = conn.send_command(job["command"], read_timeout=30)
    if not output.strip():
        sys.exit("Empty SSH command result")
    if job["fixture"]:
        # Execute the fixture in one shell, preserving its error handling.
        output = conn.send_command(
            "echo " + job["fixture"] + " | base64 -d | sh; echo LAB_STATUS:$?",
            read_timeout=90,
            cmd_verify=False,
        )
        if "LAB_STATUS:0" not in output:
            sys.exit(output)
"""
# Seconds to wait for SSH and the data links. OS9 boots slower than the others.
DEFAULT_TIMEOUT = 600
TIMEOUTS = {"os9": 1500}


def ready_timeout(node, requested=None):
    """Return the wait for a platform: --timeout, then PLATFORM_READY_TIMEOUT, then the default."""
    if requested is not None:
        return requested
    configured = os.environ.get("PLATFORM_READY_TIMEOUT")
    if configured:
        return int(configured)
    return TIMEOUTS.get(node, DEFAULT_TIMEOUT)


def require_probe_container():
    """Stop with a clear message when the Hyperglass container is not running."""
    result = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", PROBE_CONTAINER],
        text=True,
        capture_output=True,
    )
    if result.stdout.strip() != "true":
        raise SystemExit(
            f"The readiness probe runs in the Hyperglass container {PROBE_CONTAINER}, "
            "which is not running. Start the main lab first (for example ./lab-up.sh frr), "
            "or set HYPERGLASS_PROBE_CONTAINER."
        )


def ssh_probe(connect, command, fixture=""):
    """Run one SSH check from the Hyperglass container."""
    result = subprocess.run(
        ["docker", "exec", "-i", PROBE_CONTAINER, "python3", "-c", SSH_PROBE],
        input=json.dumps({"connect": connect, "command": command, "fixture": fixture}),
        text=True,
        capture_output=True,
    )
    if result.returncode:
        lines = (result.stderr or result.stdout).strip().splitlines()
        raise RuntimeError(lines[-1] if lines else f"SSH probe exited {result.returncode}")


def check(node, timeout):
    """Wait for an optional platform to become ready."""
    number, driver, username, password, command = PLATFORMS[node]
    container = "clab-hyperglass-platforms-" + node
    deadline = time.monotonic() + timeout
    last_error = "waiting for startup"
    configured = False
    while time.monotonic() < deadline:
        state = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]["State"]
        if not state["Running"]:
            raise RuntimeError(f"{node} exited during boot")
        if state.get("Health", {}).get("Status", "healthy") != "healthy":
            time.sleep(5)
            continue
        try:
            payload = ""
            if node == "sonic" and not configured:
                fixture = Path(__file__).resolve().parents[1] / "configs/sonic/fixture.sh"
                payload = base64.b64encode(fixture.read_bytes()).decode()
            ssh_probe(
                {
                    "device_type": driver,
                    "host": f"192.168.250.{20 + number}",
                    "username": username,
                    "password": password,
                    "conn_timeout": 5,
                    "banner_timeout": 10,
                    "auth_timeout": 10,
                },
                command,
                payload,
            )
            configured = configured or bool(payload)
            for family, target in (
                ("IPv4", f"10.251.{number}.1"),
                ("IPv6", f"fd00:251:{number}::1"),
            ):
                result = subprocess.run(
                    [
                        "docker",
                        "exec",
                        "clab-hyperglass-platforms-probe",
                        "ping",
                        "-c",
                        "3",
                        "-W",
                        "2",
                        target,
                    ],
                    text=True,
                    capture_output=True,
                )
                if result.returncode:
                    raise RuntimeError(f"{family} data link failed: {result.stdout}{result.stderr}")
            print(f"{node}: SSH and both data links ready", flush=True)
            return
        except Exception as exc:
            last_error = str(exc)
            time.sleep(5)
    raise TimeoutError(f"{node} did not become ready within {timeout}s: {last_error}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("node", choices=PLATFORMS)
    parser.add_argument(
        "--timeout",
        type=int,
        help="seconds to wait (default: PLATFORM_READY_TIMEOUT, else os9 1500, others 600)",
    )
    args = parser.parse_args()
    require_probe_container()
    check(args.node, ready_timeout(args.node, args.timeout))
