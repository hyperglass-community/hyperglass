#!/bin/sh
# Run inside the disposable Cumulus VX guest with NVUE 5.4.
set -eu

# The built-in Cumulus commands run `sudo -n vtysh` and `sudo -n ip vrf exec`.
# Without this rule the device rejects every query command.
SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO=sudo
RULE=$(mktemp)
trap 'rm -f "$RULE"' EXIT
echo 'cumulus ALL=(root) NOPASSWD: /usr/bin/vtysh, /usr/sbin/ip, /usr/bin/ip' > "$RULE"
for VISUDO in visudo /usr/sbin/visudo; do
    if command -v "$VISUDO" >/dev/null 2>&1; then
        $SUDO "$VISUDO" -cf "$RULE"
        break
    fi
done
$SUDO install -o root -g root -m 0440 "$RULE" /etc/sudoers.d/hyperglass

nv set interface swp1 ip address 10.252.1.1/31
nv set interface swp1 ip address 2001:db8:252:1::1/127
nv set interface swp2 ip vrf LAB
nv set interface swp2 ip address 10.252.2.1/31
nv set interface swp2 ip address 2001:db8:252:2::1/127
nv set router bgp autonomous-system 65012
nv set router bgp router-id 10.252.0.12
nv set vrf default router bgp neighbor 10.252.1.0 remote-as 65000
nv set vrf default router bgp neighbor 2001:db8:252:1:: remote-as 65000
nv set vrf default router bgp address-family ipv4-unicast enable on
nv set vrf default router bgp address-family ipv6-unicast enable on
nv set vrf default router bgp neighbor 10.252.1.0 address-family ipv4-unicast enable on
nv set vrf default router bgp neighbor 2001:db8:252:1:: address-family ipv6-unicast enable on
nv set vrf LAB router bgp autonomous-system 65012
nv set vrf LAB router bgp router-id 10.252.0.12
nv set vrf LAB router bgp neighbor 10.252.2.0 remote-as 65000
nv set vrf LAB router bgp neighbor 2001:db8:252:2:: remote-as 65000
nv set vrf LAB router bgp address-family ipv4-unicast enable on
nv set vrf LAB router bgp address-family ipv6-unicast enable on
nv set vrf LAB router bgp neighbor 10.252.2.0 address-family ipv4-unicast enable on
nv set vrf LAB router bgp neighbor 2001:db8:252:2:: address-family ipv6-unicast enable on
nv config apply --assume-yes
