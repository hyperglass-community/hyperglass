#!/bin/sh
# Check that the lab host kernel has the Linux vrf module loaded.
# The VRF LAB locations need it. This script does not load or install anything.
#
#   sh scripts/check-vrf-module.sh            exit 1 when the module is missing
#   sh scripts/check-vrf-module.sh --warn     print the message and exit 0
set -eu
MODE=${1:-}
# /sys/module/vrf exists when the module is loaded or built into the kernel.
if [ -d /sys/module/vrf ]; then
    exit 0
fi
if modprobe -n vrf >/dev/null 2>&1; then
    HINT="Load it with: sudo modprobe vrf"
else
    HINT="This kernel has no vrf module. Install the kernel extra modules package for your distribution, then run: sudo modprobe vrf"
fi
echo "The Linux vrf kernel module is not loaded on this host. VRF LAB locations will fail. $HINT" >&2
[ "$MODE" = "--warn" ] && exit 0
exit 1
