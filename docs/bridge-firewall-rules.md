# RVR Bridge Firewall Rules — Loop Prevention

## Overview

RVR creates an L2 bridge between two routers over a Starlink satellite link. The bridge uses a TAP device (`rvr`) joined to the local LAN bridge (`br-lan`). Without careful firewall rules, traffic loops form — packets that enter the tunnel come back out on the bridge, re-enter the tunnel, and so on.

Three layers of filtering prevent these loops:

```
                     Starlink
                        |
                    Tailscale
                        |
                   KCPtun (UDP 41641)
                        |
                   tap2tcp (TCP)
                        |
                    TAP "rvr"
                        |
                  "rvr_bridge"          <-- nftables bridge filter here
                        |
    [wlan0]---[br-lan]--+--[eth1]      <-- STP enabled, iptables on br-lan
                        
    Layer 1: iptables   — blocks KCPtun port 41641 on bridge/TAP
    Layer 2: nftables   — L2 whitelist on rvr_bridge (only safe traffic crosses)
    Layer 3: STP        — prevents bridge topology loops
```

## Layer 1: iptables — KCPtun Port Isolation

KCPtun uses UDP port 41641 for its tunnel. If these packets leak onto the bridge, they would be forwarded to the remote side, re-enter the tunnel, and loop infinitely.

### Rules (added by tap2tcp-up, removed by tap2tcp-down)

```sh
# Prevent KCPtun control packets from leaving through the bridge.
# These must flow through the Tailscale tunnel, not the raw bridge.
iptables -I OUTPUT -o br-lan -p udp --dport 41641 -j DROP
iptables -I OUTPUT -o br-lan -p udp --sport 41641 -j DROP

# Prevent KCPtun packets from being forwarded between the TAP
# interface and the external network. Without this, packets could
# exit via the TAP, get bridged to a physical port, hit the
# remote router's bridge, and loop back through the tunnel.
iptables -I FORWARD -i rvr -p udp --dport 41641 -j DROP
iptables -I FORWARD -o rvr -p udp --dport 41641 -j DROP
iptables -I FORWARD -i rvr -p udp --sport 41641 -j DROP
iptables -I FORWARD -o rvr -p udp --sport 41641 -j DROP
```

### Why port 41641 specifically?

41641 is Tailscale's WireGuard listen port. KCPtun sends its UDP packets to the peer's Tailscale IP on port 4000, but the underlying WireGuard transport uses 41641. If these packets cross the bridge, the remote Tailscale daemon processes them again, creating a loop.

## Layer 2: nftables Bridge Filter — L2 Whitelist

This is a **bridge-level** (OSI Layer 2) filter — not a netfilter/L3 filter. It operates on Ethernet frames as they cross between bridge ports, before any IP routing decisions.

### Rules (loaded by tap2tcp-up via `nft -f -`)

```nft
table bridge rvr_filter {
    chain forward {
        type filter hook forward priority 0; policy accept;

        # Pass 1: If traffic doesn't involve rvr_bridge at all,
        # accept immediately. Normal LAN traffic (wlan0 <-> eth1)
        # is completely unaffected by these rules.
        iifname != "rvr_bridge" oifname != "rvr_bridge" accept

        # Pass 2: Allow safe protocols through rvr_bridge.
        # These are all local-scoped and cannot cause external loops.
        ether type arp accept                          # ARP (essential for bridge operation)
        ether type ip ip daddr 10.0.0.0/8 accept       # RFC1918 private
        ether type ip ip daddr 172.16.0.0/12 accept     # RFC1918 private
        ether type ip ip daddr 192.168.0.0/16 accept    # RFC1918 private
        ether type ip ip daddr 169.254.0.0/16 accept    # Link-local (DHCP discovery)
        ether type ip ip daddr 224.0.0.0/4 accept       # Multicast (mDNS, SSDP, etc.)
        ether type ip ip daddr 255.255.255.255 accept   # Broadcast (DHCP)
        ether type ip6 ip6 daddr fe80::/10 accept       # IPv6 link-local
        ether type ip6 ip6 daddr ff00::/8 accept        # IPv6 multicast

        # Pass 3: Drop everything else crossing rvr_bridge.
        # This prevents public/routable IP traffic from bridging
        # through the TAP — such traffic could escape the tunnel
        # and cause loops or unintended routing.
        iifname "rvr_bridge" counter drop
        oifname "rvr_bridge" counter drop
    }
}
```

### Why a whitelist instead of a blacklist?

A blacklist would need to enumerate every dangerous address range. The whitelist approach is safer — only explicitly-safe local traffic crosses the TAP. Any unknown or public-routable traffic is dropped by default.

### Why are RFC1918 addresses safe?

RFC1918 addresses (10.x, 172.16-31.x, 192.168.x) are not routable on the internet. They can only exist on local network segments. Allowing them through the bridge is exactly what we want — the whole point of RVR is to bridge two local networks together. Public IPs crossing the bridge could indicate a routing misconfiguration or a tunnel escape.

## Layer 3: STP — Spanning Tree Protocol

```sh
ip link set br-lan type bridge stp_state 1
ip link set rvr_bridge master br-lan
```

### Why STP?

When `rvr_bridge` is added to `br-lan`, there are now multiple paths for traffic: physical ports (eth1, wlan0) and the TAP tunnel. Without STP, the bridge treats all paths as equal, and broadcast traffic loops indefinitely between them. STP detects redundant paths and blocks them, maintaining a single spanning tree topology.

### Critical: Runtime-only, NEVER via UCI

```sh
# CORRECT — runtime only, reverted on service stop
ip link set br-lan type bridge stp_state 1

# WRONG — persists to /etc/config/network, triggers netifd to
# tear down and rebuild br-lan, which kills WiFi and can brick
# the router on GL-BE3600
uci set network.@device[0].stp='1'
uci commit network    # <-- THIS BRICKS THE ROUTER
```

STP is reverted to 0 by `stop_local_services()` and `tap2tcp-down`.

## Cleanup Sequence (tap2tcp-down)

When tap2tcp stops, all rules are reversed:

```sh
# Remove L2 bridge filter
nft delete table bridge rvr_filter 2>/dev/null || true

# Remove rvr_bridge from br-lan (must happen before STP disable)
ip link set rvr_bridge nomaster 2>/dev/null || true

# Remove L3 iptables rules (reverse of tap2tcp-up)
iptables -D OUTPUT -o br-lan -p udp --dport 41641 -j DROP 2>/dev/null || true
iptables -D OUTPUT -o br-lan -p udp --sport 41641 -j DROP 2>/dev/null || true
iptables -D FORWARD -i rvr -p udp --dport 41641 -j DROP 2>/dev/null || true
iptables -D FORWARD -o rvr -p udp --dport 41641 -j DROP 2>/dev/null || true
iptables -D FORWARD -i rvr -p udp --sport 41641 -j DROP 2>/dev/null || true
iptables -D FORWARD -o rvr -p udp --sport 41641 -j DROP 2>/dev/null || true
```

`stop_local_services()` also runs the cleanup and additionally disables STP:
```sh
ip link set br-lan type bridge stp_state 0
```

## GL-BE3600 Specific Warnings

1. **Never `uci commit network`** — triggers netifd to rebuild br-lan, killing WiFi. Has bricked multiple routers.
2. **Never `/etc/init.d/firewall reload` during uninstall** — with kmod-tun loaded, the QCA PPE driver crashes (null pointer in `tun_register_offload_stats_callback`). Use `nft delete rule` by handle instead.
3. **STP convergence takes 30-45 seconds** — during this time, bridge ports are in LISTENING state and no traffic flows. This is normal and expected after `tap2tcp-up` runs.
