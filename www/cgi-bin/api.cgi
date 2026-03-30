#!/bin/sh
#
# L2Bridge Web UI - Command and Profile API
# Handles l2bridge commands and aircraft profile management
#

# Configuration
AIRCRAFT_FILE="/etc/l2bridge/aircraft.json"
CONFIG_DIR="/etc/l2bridge"
LOCK_FILE="/tmp/l2bridge-webui.lock"
L2BRIDGE="/usr/bin/l2bridge"

# Helper: output JSON response
json_response() {
    echo "Content-Type: application/json"
    echo ""
    echo "$1"
}

# Helper: output error
json_error() {
    json_response "{\"success\": false, \"error\": \"$1\"}"
    exit 0
}

# Helper: escape string for JSON
json_escape() {
    printf '%s' "$1" | awk '
    BEGIN { ORS="" }
    {
        gsub(/\\/, "\\\\")      # Escape backslashes first
        gsub(/"/, "\\\"")       # Escape double quotes
        gsub(/\t/, "\\t")       # Escape tabs
        gsub(/\r/, "")          # Remove carriage returns
        if (NR > 1) print "\\n" # Add escaped newline between lines
        print
    }
    '
}

# Helper: validate Tailscale IP format (100.x.x.x)
validate_ip() {
    echo "$1" | grep -qE '^100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
}

# Helper: validate profile ID (alphanumeric, dash, underscore)
validate_id() {
    echo "$1" | grep -qE '^[a-zA-Z0-9_-]+$'
}

# Helper: acquire lock for command execution
acquire_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local pid=$(cat "$LOCK_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            json_error "Another command is currently running"
        fi
    fi
    echo $$ > "$LOCK_FILE"
    trap "rm -f '$LOCK_FILE'" EXIT
}

# Helper: release lock
release_lock() {
    rm -f "$LOCK_FILE"
}

# Initialize aircraft config file if it doesn't exist
init_aircraft_file() {
    mkdir -p "$CONFIG_DIR"
    if [ ! -f "$AIRCRAFT_FILE" ]; then
        printf '{\n  "version": 1,\n  "active": "",\n  "profiles": {}\n}\n' > "$AIRCRAFT_FILE"
    fi
}

# Read POST data
read_post_data() {
    if [ "$REQUEST_METHOD" = "POST" ]; then
        read -r POST_DATA
        echo "$POST_DATA"
    fi
}

# Parse JSON field (simple extraction without jsonfilter dependency)
# Usage: parse_json "field" "json_string"
parse_json() {
    local field="$1"
    local json="$2"
    echo "$json" | sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

# Execute l2bridge command
run_l2bridge_command() {
    local cmd="$1"
    local aircraft_ip="$2"
    local aircraft_name="$3"
    local start_time=$(date +%s)

    acquire_lock

    local output
    local exit_code

    if [ -n "$aircraft_name" ]; then
        output=$("$L2BRIDGE" "$cmd" "$aircraft_ip" "$aircraft_name" 2>&1)
        exit_code=$?
    elif [ -n "$aircraft_ip" ]; then
        output=$("$L2BRIDGE" "$cmd" "$aircraft_ip" 2>&1)
        exit_code=$?
    else
        output=$("$L2BRIDGE" "$cmd" 2>&1)
        exit_code=$?
    fi

    release_lock

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    local escaped_output=$(json_escape "$output")
    local success="false"
    [ $exit_code -eq 0 ] && success="true"

    json_response "{\"success\": $success, \"command\": \"$cmd\", \"output\": \"$escaped_output\", \"exit_code\": $exit_code, \"duration_seconds\": $duration}"
}

# List all aircraft profiles
list_aircraft() {
    init_aircraft_file
    echo "Content-Type: application/json"
    echo ""
    cat "$AIRCRAFT_FILE"
}

# Add new aircraft profile
add_aircraft() {
    local id="$1"
    local name="$2"
    local ip="$3"
    local password="$4"

    # Validate inputs
    [ -z "$id" ] && json_error "Profile ID is required"
    [ -z "$name" ] && json_error "Profile name is required"
    [ -z "$ip" ] && json_error "Tailscale IP is required"
    validate_id "$id" || json_error "Invalid profile ID format"
    validate_ip "$ip" || json_error "Invalid Tailscale IP format (must be 100.x.x.x)"

    init_aircraft_file

    # Check if ID already exists
    if grep -q "\"$id\":" "$AIRCRAFT_FILE"; then
        json_error "Profile ID already exists"
    fi

    local created=$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')

    # Get current active
    local current_active=""
    current_active=$(sed -n 's/.*"active":[[:space:]]*"\([^"]*\)".*/\1/p' "$AIRCRAFT_FILE" | head -1)

    # Simple approach: rebuild the entire file
    # Extract existing profiles as id|name|ip|password|created|last_used lines
    local tmp_profiles=$(mktemp)
    awk '
    /"[a-zA-Z0-9_-]+":[[:space:]]*\{/ {
        id = $0
        sub(/^[^"]*"/, "", id)
        sub(/".*/, "", id)
        if (id != "profiles") {
            current_id = id
            p_pass[current_id] = ""
        }
    }
    current_id && /"name":/ {
        val = $0; sub(/.*"name":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_name[current_id] = val
    }
    current_id && /"tailscale_ip":/ {
        val = $0; sub(/.*"tailscale_ip":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_ip[current_id] = val
    }
    current_id && /"ssh_password":/ {
        val = $0; sub(/.*"ssh_password":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_pass[current_id] = val
    }
    current_id && /"created":/ {
        val = $0; sub(/.*"created":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_created[current_id] = val
    }
    current_id && /"last_used":/ {
        val = $0; sub(/.*"last_used":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_last[current_id] = val
        print current_id "|" p_name[current_id] "|" p_ip[current_id] "|" p_pass[current_id] "|" p_created[current_id] "|" p_last[current_id]
    }
    ' "$AIRCRAFT_FILE" > "$tmp_profiles"

    # Add new profile to list (password can be empty)
    echo "$id|$name|$ip|$password|$created|$created" >> "$tmp_profiles"

    # Rebuild JSON file
    printf '{\n  "version": 1,\n  "active": "%s",\n  "profiles": {\n' "$current_active" > "$AIRCRAFT_FILE"

    local first=1
    while IFS='|' read -r pid pname pip ppass pcreated plast; do
        [ -z "$pid" ] && continue
        [ $first -eq 0 ] && printf ',\n' >> "$AIRCRAFT_FILE"
        printf '    "%s": {\n' "$pid" >> "$AIRCRAFT_FILE"
        printf '      "name": "%s",\n' "$pname" >> "$AIRCRAFT_FILE"
        printf '      "tailscale_ip": "%s",\n' "$pip" >> "$AIRCRAFT_FILE"
        printf '      "ssh_password": "%s",\n' "$ppass" >> "$AIRCRAFT_FILE"
        printf '      "created": "%s",\n' "$pcreated" >> "$AIRCRAFT_FILE"
        printf '      "last_used": "%s"\n' "$plast" >> "$AIRCRAFT_FILE"
        printf '    }' >> "$AIRCRAFT_FILE"
        first=0
    done < "$tmp_profiles"

    printf '\n  }\n}\n' >> "$AIRCRAFT_FILE"
    rm -f "$tmp_profiles"

    json_response "{\"success\": true, \"message\": \"Aircraft profile added\", \"id\": \"$id\"}"
}

# Update aircraft profile
update_aircraft() {
    local id="$1"
    local name="$2"
    local ip="$3"
    local password="$4"

    [ -z "$id" ] && json_error "Profile ID is required"
    validate_id "$id" || json_error "Invalid profile ID format"

    init_aircraft_file

    # Check if profile exists
    if ! grep -q "\"$id\":" "$AIRCRAFT_FILE"; then
        json_error "Profile not found"
    fi

    [ -n "$ip" ] && { validate_ip "$ip" || json_error "Invalid Tailscale IP format"; }

    # Extract all profiles, modify the target, rebuild
    local current_active=""
    current_active=$(sed -n 's/.*"active":[[:space:]]*"\([^"]*\)".*/\1/p' "$AIRCRAFT_FILE" | head -1)

    local tmp_profiles=$(mktemp)
    awk '
    /"[a-zA-Z0-9_-]+":[[:space:]]*\{/ {
        pid = $0
        sub(/^[^"]*"/, "", pid)
        sub(/".*/, "", pid)
        if (pid != "profiles") {
            current_id = pid
            p_pass[current_id] = ""
        }
    }
    current_id && /"name":/ {
        val = $0; sub(/.*"name":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_name[current_id] = val
    }
    current_id && /"tailscale_ip":/ {
        val = $0; sub(/.*"tailscale_ip":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_ip[current_id] = val
    }
    current_id && /"ssh_password":/ {
        val = $0; sub(/.*"ssh_password":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_pass[current_id] = val
    }
    current_id && /"created":/ {
        val = $0; sub(/.*"created":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_created[current_id] = val
    }
    current_id && /"last_used":/ {
        val = $0; sub(/.*"last_used":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_last[current_id] = val
        print current_id "|" p_name[current_id] "|" p_ip[current_id] "|" p_pass[current_id] "|" p_created[current_id] "|" p_last[current_id]
    }
    ' "$AIRCRAFT_FILE" > "$tmp_profiles"

    # Apply updates to the target profile in the extracted data
    local tmp_updated=$(mktemp)
    while IFS='|' read -r pid pname pip ppass pcreated plast; do
        [ -z "$pid" ] && continue
        if [ "$pid" = "$id" ]; then
            [ -n "$name" ] && pname="$name"
            [ -n "$ip" ] && pip="$ip"
            if [ -n "$password" ]; then
                if [ "$password" = "__CLEAR__" ]; then
                    ppass=""
                else
                    ppass="$password"
                fi
            fi
        fi
        echo "$pid|$pname|$pip|$ppass|$pcreated|$plast"
    done < "$tmp_profiles" > "$tmp_updated"

    # Rebuild JSON file
    printf '{\n  "version": 1,\n  "active": "%s",\n  "profiles": {\n' "$current_active" > "$AIRCRAFT_FILE"

    local first=1
    while IFS='|' read -r pid pname pip ppass pcreated plast; do
        [ -z "$pid" ] && continue
        [ $first -eq 0 ] && printf ',\n' >> "$AIRCRAFT_FILE"
        printf '    "%s": {\n' "$pid" >> "$AIRCRAFT_FILE"
        printf '      "name": "%s",\n' "$pname" >> "$AIRCRAFT_FILE"
        printf '      "tailscale_ip": "%s",\n' "$pip" >> "$AIRCRAFT_FILE"
        printf '      "ssh_password": "%s",\n' "$ppass" >> "$AIRCRAFT_FILE"
        printf '      "created": "%s",\n' "$pcreated" >> "$AIRCRAFT_FILE"
        printf '      "last_used": "%s"\n' "$plast" >> "$AIRCRAFT_FILE"
        printf '    }' >> "$AIRCRAFT_FILE"
        first=0
    done < "$tmp_updated"

    printf '\n  }\n}\n' >> "$AIRCRAFT_FILE"
    rm -f "$tmp_profiles" "$tmp_updated"

    json_response "{\"success\": true, \"message\": \"Aircraft profile updated\"}"
}

# Delete aircraft profile
delete_aircraft() {
    local id="$1"

    [ -z "$id" ] && json_error "Profile ID is required"
    validate_id "$id" || json_error "Invalid profile ID format"

    init_aircraft_file

    # Check if profile exists
    if ! grep -q "\"$id\":" "$AIRCRAFT_FILE"; then
        json_error "Profile not found"
    fi

    # Get current active, clear if it's the one being deleted
    local current_active=""
    current_active=$(sed -n 's/.*"active":[[:space:]]*"\([^"]*\)".*/\1/p' "$AIRCRAFT_FILE" | head -1)
    [ "$current_active" = "$id" ] && current_active=""

    # Extract all profiles except the one being deleted
    local tmp_profiles=$(mktemp)
    awk -v delete_id="$id" '
    /"[a-zA-Z0-9_-]+":[[:space:]]*\{/ {
        id = $0
        sub(/^[^"]*"/, "", id)
        sub(/".*/, "", id)
        if (id != "profiles") {
            current_id = id
            p_pass[current_id] = ""
        }
    }
    current_id && /"name":/ {
        val = $0; sub(/.*"name":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_name[current_id] = val
    }
    current_id && /"tailscale_ip":/ {
        val = $0; sub(/.*"tailscale_ip":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_ip[current_id] = val
    }
    current_id && /"ssh_password":/ {
        val = $0; sub(/.*"ssh_password":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_pass[current_id] = val
    }
    current_id && /"created":/ {
        val = $0; sub(/.*"created":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_created[current_id] = val
    }
    current_id && /"last_used":/ {
        val = $0; sub(/.*"last_used":[[:space:]]*"/, "", val); sub(/".*/, "", val)
        p_last[current_id] = val
        if (current_id != delete_id) {
            print current_id "|" p_name[current_id] "|" p_ip[current_id] "|" p_pass[current_id] "|" p_created[current_id] "|" p_last[current_id]
        }
    }
    ' "$AIRCRAFT_FILE" > "$tmp_profiles"

    # Rebuild JSON file
    printf '{\n  "version": 1,\n  "active": "%s",\n  "profiles": {\n' "$current_active" > "$AIRCRAFT_FILE"

    local first=1
    while IFS='|' read -r pid pname pip ppass pcreated plast; do
        [ -z "$pid" ] && continue
        [ $first -eq 0 ] && printf ',\n' >> "$AIRCRAFT_FILE"
        printf '    "%s": {\n' "$pid" >> "$AIRCRAFT_FILE"
        printf '      "name": "%s",\n' "$pname" >> "$AIRCRAFT_FILE"
        printf '      "tailscale_ip": "%s",\n' "$pip" >> "$AIRCRAFT_FILE"
        printf '      "ssh_password": "%s",\n' "$ppass" >> "$AIRCRAFT_FILE"
        printf '      "created": "%s",\n' "$pcreated" >> "$AIRCRAFT_FILE"
        printf '      "last_used": "%s"\n' "$plast" >> "$AIRCRAFT_FILE"
        printf '    }' >> "$AIRCRAFT_FILE"
        first=0
    done < "$tmp_profiles"

    printf '\n  }\n}\n' >> "$AIRCRAFT_FILE"
    rm -f "$tmp_profiles"

    json_response "{\"success\": true, \"message\": \"Aircraft profile deleted\"}"
}

# Set active aircraft
set_active_aircraft() {
    local id="$1"

    [ -z "$id" ] && json_error "Profile ID is required"
    validate_id "$id" || json_error "Invalid profile ID format"

    init_aircraft_file

    # Verify profile exists
    if ! grep -q "\"$id\"" "$AIRCRAFT_FILE"; then
        json_error "Profile not found"
    fi

    # Update active field
    sed -i "s/\"active\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"active\": \"$id\"/" "$AIRCRAFT_FILE"

    # Get the IP for this profile and update legacy config
    local ip=""
    if command -v jsonfilter >/dev/null 2>&1; then
        ip=$(jsonfilter -i "$AIRCRAFT_FILE" -e "@.profiles[\"$id\"].tailscale_ip" 2>/dev/null)
    else
        # Fallback parsing
        ip=$(awk -v id="$id" '
            /"'"$id"'"/ { found=1 }
            found && /"tailscale_ip"/ { gsub(/.*"tailscale_ip"[[:space:]]*:[[:space:]]*"/, ""); gsub(/".*/, ""); print; exit }
        ' "$AIRCRAFT_FILE")
    fi

    # Update legacy state file for compatibility with l2bridge script
    if [ -n "$ip" ]; then
        echo "AIRCRAFT_IP=\"$ip\"" > /etc/l2bridge.conf
    fi

    # Update last_used timestamp
    local now=$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')

    json_response "{\"success\": true, \"message\": \"Active aircraft set to $id\", \"tailscale_ip\": \"$ip\"}"
}

# ── Binding Management ──────────────────────────────────────────────

# Detect the WireGuard interface used by the VPN
detect_wg_interface() {
    # Try common interface names
    for iface in tailscale0 wg0 wg1; do
        if ip link show "$iface" >/dev/null 2>&1; then
            echo "$iface"
            return
        fi
    done
    # Fallback: find any interface with a 100.x.x.x address (VPN subnet)
    ip -4 addr show | awk '/100\.[0-9]+\.[0-9]+\.[0-9]+/ { gsub(/.*dev /, ""); gsub(/ .*/, ""); print; exit }'
}

# Enumerate WireGuard peers with stats
# Output: one line per peer: ip|last_handshake|rx_bytes|tx_bytes
enumerate_wg_peers() {
    local wg_iface
    wg_iface=$(detect_wg_interface)
    [ -z "$wg_iface" ] && return

    # Try wg show (kernel WireGuard)
    if command -v wg >/dev/null 2>&1 && wg show "$wg_iface" dump 2>/dev/null | grep -q .; then
        wg show "$wg_iface" dump 2>/dev/null | tail -n +2 | while IFS='	' read -r _pubkey _psk _endpoint allowed_ips handshake rx tx _keepalive; do
            # allowed_ips may have multiple CIDRs, extract the 100.x.x.x one
            for cidr in $(echo "$allowed_ips" | tr ',' ' '); do
                ip=$(echo "$cidr" | cut -d/ -f1)
                case "$ip" in
                    100.*) echo "$ip|$handshake|$rx|$tx"; break ;;
                esac
            done
        done
        return
    fi

    # Fallback: parse ip neigh for VPN interface (may be empty on userspace WG)
    if [ -n "$wg_iface" ]; then
        local neigh_out
        neigh_out=$(ip neigh show dev "$wg_iface" 2>/dev/null | awk '/100\./ { print $1"|0|0|0" }')
        if [ -n "$neigh_out" ]; then
            echo "$neigh_out"
            return
        fi
    fi

    # Fallback: VPN client local API
    # Both Tailscale and Headscale clients run the same tailscaled daemon
    # which exposes a local Unix socket API. Probe known socket paths.
    local vpn_socket=""
    for sock in /var/run/tailscale/tailscaled.sock /run/tailscale/tailscaled.sock /var/run/tailscaled.sock; do
        [ -S "$sock" ] && { vpn_socket="$sock"; break; }
    done
    if [ -n "$vpn_socket" ] && command -v curl >/dev/null 2>&1; then
        # Query the VPN daemon's local API for peer list.
        # Both Tailscale and Headscale clients run tailscaled which serves
        # this API. Host header must be "local-tailscaled.sock".
        local api_url="http://local-tailscaled.sock/localapi/v0/status"
        local api_json
        api_json=$(curl -s --max-time 3 --unix-socket "$vpn_socket" "$api_url" 2>/dev/null)
        [ -z "$api_json" ] && return

        # Get self IP to exclude from peer list
        local self_ip
        self_ip=$(echo "$api_json" | grep -oE '"100\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | tr -d '"')

        # Extract all unique 100.x.x.x IPs, excluding self
        echo "$api_json" | grep -oE '100\.[0-9]+\.[0-9]+\.[0-9]+' | sort -u | \
            grep -v "^${self_ip}$" | awk '{print $0"|0|0|0"}'
        return
    fi

    # Last resort: check routing table for 100.x.x.x/32 routes
    ip route show | awk '/^100\.[0-9.]+ dev/ { print $1"|0|0|0" }'
}

# Probe a peer's discovery endpoint, return JSON or empty
probe_peer() {
    local ip="$1"
    wget -q -T 1 -O- "http://${ip}:8081/cgi-bin/discovery.cgi" 2>/dev/null || echo ""
}

# Background discovery scan — runs probes and writes results to cache file
# Called as: run_discovery_scan &
DISCOVERY_CACHE="/tmp/l2bridge-discovery-cache.json"
DISCOVERY_LOCK="/tmp/l2bridge-discovery.lock"

run_discovery_scan() {
    # Prevent concurrent scans
    [ -f "$DISCOVERY_LOCK" ] && kill -0 "$(cat "$DISCOVERY_LOCK")" 2>/dev/null && return
    echo $$ > "$DISCOVERY_LOCK"
    trap "rm -f '$DISCOVERY_LOCK'" EXIT

    init_aircraft_file

    # Build bound IP lookup
    local bound_data=""
    [ -f "$AIRCRAFT_FILE" ] && bound_data=$(awk '
        /"[a-zA-Z0-9_-]+":[[:space:]]*\{/ { id=$0; sub(/^[^"]*"/, "", id); sub(/".*/, "", id); if (id != "profiles") cur_id=id }
        cur_id && /"name":/ { n=$0; sub(/.*"name":[[:space:]]*"/, "", n); sub(/".*/, "", n); p_name[cur_id]=n }
        cur_id && /"tailscale_ip":/ { n=$0; sub(/.*"tailscale_ip":[[:space:]]*"/, "", n); sub(/".*/, "", n); p_ip[cur_id]=n }
        cur_id && /"last_used":/ { print p_ip[cur_id] "|" cur_id "|" p_name[cur_id] }
    ' "$AIRCRAFT_FILE")

    # Self info
    local self_hostname=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "unknown")
    local self_role="unknown"
    [ -f /etc/init.d/kcptun-server ] && self_role="gcs"
    [ -f /etc/init.d/kcptun-client ] && self_role="aircraft"
    local self_gitver=$(cat /etc/l2bridge/version 2>/dev/null || echo "unknown")

    # Collect peer IPs from all sources
    local tmp_peers="/tmp/l2bridge-disc-peers.$$"
    enumerate_wg_peers > "$tmp_peers" 2>/dev/null
    [ -f "$AIRCRAFT_FILE" ] && awk '/"tailscale_ip":/ { gsub(/.*"tailscale_ip":[[:space:]]*"/, ""); gsub(/".*/, ""); print $0"|0|0|0" }' "$AIRCRAFT_FILE" >> "$tmp_peers"
    [ -f /etc/l2bridge/peers.conf ] && awk '/./ {print $0"|0|0|0"}' /etc/l2bridge/peers.conf >> "$tmp_peers"

    # Deduplicate
    local tmp_sorted="${tmp_peers}.s"
    sort -t'|' -k1,1 -u "$tmp_peers" > "$tmp_sorted" 2>/dev/null
    mv "$tmp_sorted" "$tmp_peers"

    # Probe peers in parallel
    local tmp_results="/tmp/l2bridge-disc-results.$$"
    : > "$tmp_results"
    local job_count=0

    while IFS='|' read -r ip handshake rx tx; do
        [ -z "$ip" ] && continue
        (
            if ! ping -c 1 -W 1 "$ip" >/dev/null 2>&1; then
                echo "$ip|$handshake|$rx|$tx|offline|unknown|unknown|unknown|unknown|0|unknown"
                exit 0
            fi
            probe_json=$(wget -q -T 1 -O- "http://${ip}:8081/cgi-bin/discovery.cgi" 2>/dev/null)
            if [ -n "$probe_json" ]; then
                p_hostname=$(echo "$probe_json" | sed -n 's/.*"hostname"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
                p_role=$(echo "$probe_json" | sed -n 's/.*"role"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
                p_gitver=$(echo "$probe_json" | sed -n 's/.*"git_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
                echo "$ip|$handshake|$rx|$tx|online|${p_hostname:-unknown}|${p_role:-unknown}||||${p_gitver:-unknown}"
            else
                echo "$ip|$handshake|$rx|$tx|offline|unknown|unknown|unknown|unknown|0|unknown"
            fi
        ) >> "$tmp_results" &
        job_count=$((job_count + 1))
        [ $job_count -ge 10 ] && { wait; job_count=0; }
    done < "$tmp_peers"
    wait

    # Build JSON result and write atomically to cache
    local tmp_cache="${DISCOVERY_CACHE}.tmp"
    {
        printf '{\n  "self": {\n'
        printf '    "hostname": "%s",\n' "$self_hostname"
        printf '    "ip": "",\n'
        printf '    "role": "%s",\n' "$self_role"
        printf '    "connection_mode": "online",\n'
        printf '    "git_version": "%s",\n' "$self_gitver"
        printf '    "is_self": true,\n'
        printf '    "is_bound": false,\n'
        printf '    "wg_rx_bytes": 0,\n'
        printf '    "wg_tx_bytes": 0\n'
        printf '  },\n  "peers": ['

        local first=1
        while IFS='|' read -r ip handshake rx tx mode hostname role _ _ _ gitver; do
            [ -z "$ip" ] && continue
            local is_bound="false" bound_id="" bound_name=""
            # Check bound status
            local match
            match=$(echo "$bound_data" | awk -F'|' -v pip="$ip" '$1==pip {print $2"|"$3; exit}')
            if [ -n "$match" ]; then
                is_bound="true"
                bound_id=$(echo "$match" | cut -d'|' -f1)
                bound_name=$(echo "$match" | cut -d'|' -f2)
            fi

            [ $first -eq 0 ] && printf ','
            printf '\n    {'
            printf '"hostname":"%s",' "${hostname:-unknown}"
            printf '"ip":"%s",' "$ip"
            printf '"role":"%s",' "${role:-unknown}"
            printf '"connection_mode":"%s",' "$mode"
            printf '"is_self":false,'
            printf '"is_bound":%s,' "$is_bound"
            [ -n "$bound_id" ] && printf '"bound_profile_id":"%s",' "$bound_id"
            [ -n "$bound_name" ] && printf '"bound_profile_name":"%s",' "$bound_name"
            printf '"git_version":"%s",' "${gitver:-unknown}"
            printf '"wg_rx_bytes":%s,' "${rx:-0}"
            printf '"wg_tx_bytes":%s,' "${tx:-0}"
            printf '"wg_last_handshake":%s' "${handshake:-0}"
            printf '}'
            first=0
        done < "$tmp_results"

        printf '\n  ]\n}\n'
    } > "$tmp_cache"
    mv "$tmp_cache" "$DISCOVERY_CACHE"

    rm -f "$tmp_peers" "$tmp_results" "$DISCOVERY_LOCK"
}

# discover_peers: returns cached results immediately, triggers background refresh
discover_peers() {
    # Always trigger a background scan
    run_discovery_scan >/dev/null 2>&1 &

    # Return cached results (or empty if no cache yet)
    echo "Content-Type: application/json"
    echo ""
    if [ -f "$DISCOVERY_CACHE" ]; then
        cat "$DISCOVERY_CACHE"
    else
        printf '{"self":{"hostname":"scanning...","ip":"","role":"unknown","connection_mode":"online","git_version":"unknown","is_self":true,"is_bound":false,"wg_rx_bytes":0,"wg_tx_bytes":0},"peers":[]}\n'
    fi
    exit 0
}

# Bind aircraft: save profile + run l2bridge setup in background
bind_aircraft_action() {
    local ip="$1"
    local name="$2"
    local password="$3"

    [ -z "$ip" ] && json_error "Tailscale IP is required"
    [ -z "$name" ] && json_error "Aircraft name is required"
    [ -z "$password" ] && json_error "SSH password is required"
    validate_ip "$ip" || json_error "Invalid Tailscale IP format (must be 100.x.x.x)"

    # Generate profile ID from name
    local id=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/-/g; s/--*/-/g; s/^-//; s/-$//')
    [ -z "$id" ] && id="aircraft-$(echo "$ip" | tr '.' '-')"

    # Save profile with password immediately
    init_aircraft_file
    add_aircraft "$id" "$name" "$ip" "$password" > /dev/null 2>&1

    # Run l2bridge setup in background (no nohup on BusyBox)
    acquire_lock
    "$L2BRIDGE" setup "$ip" "$name" > /tmp/l2bridge-setup.log 2>&1 &
    release_lock

    json_response "{\"success\": true, \"message\": \"Setup started in background\", \"id\": \"$id\", \"log_file\": \"/tmp/l2bridge-setup.log\"}"
}

# Unbind aircraft: stop + remove
unbind_aircraft_action() {
    local id="$1"
    [ -z "$id" ] && json_error "Profile ID is required"

    # Get IP for this profile
    local ip=""
    ip=$(awk -v id="$id" '
        /"'"$id"'"/ { found=1 }
        found && /"tailscale_ip"/ { gsub(/.*"tailscale_ip":[[:space:]]*"/, ""); gsub(/".*/, ""); print; exit }
    ' "$AIRCRAFT_FILE" 2>/dev/null)

    # Stop services and clean up
    if [ -n "$ip" ]; then
        "$L2BRIDGE" stop "$ip" > /dev/null 2>&1 || true
    fi

    # Delete profile
    delete_aircraft "$id" > /dev/null 2>&1

    json_response "{\"success\": true, \"message\": \"Aircraft unbound\"}"
}

# Connect to already-bound aircraft (lighter than full setup)
connect_aircraft_action() {
    local id="$1"
    [ -z "$id" ] && json_error "Profile ID is required"

    local ip=""
    ip=$(awk -v id="$id" '
        /"'"$id"'"/ { found=1 }
        found && /"tailscale_ip"/ { gsub(/.*"tailscale_ip":[[:space:]]*"/, ""); gsub(/".*/, ""); print; exit }
    ' "$AIRCRAFT_FILE" 2>/dev/null)
    [ -z "$ip" ] && json_error "Profile not found"

    acquire_lock
    local output
    output=$("$L2BRIDGE" add "$ip" 2>&1)
    local exit_code=$?
    release_lock

    local escaped_output=$(json_escape "$output")
    local success="false"
    [ $exit_code -eq 0 ] && success="true"

    json_response "{\"success\": $success, \"output\": \"$escaped_output\", \"exit_code\": $exit_code}"
}

# Get current link settings from kcptun server config
get_link_settings_action() {
    local config="/etc/kcptun/server.json"

    if [ ! -f "$config" ]; then
        json_error "KCPtun config not found (run setup first)"
    fi

    echo "Content-Type: application/json"
    echo ""

    # Parse kcptun server.json with awk
    awk '
    BEGIN { printf "{" }
    /"nodelay":/ { gsub(/.*"nodelay":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_nodelay\": %s, ", $0 }
    /"interval":/ { gsub(/.*"interval":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_interval\": %s, ", $0 }
    /"resend":/ { gsub(/.*"resend":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_resend\": %s, ", $0 }
    /"nc":/ { gsub(/.*"nc":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_nc\": %s, ", $0 }
    /"mtu":/ { gsub(/.*"mtu":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_segment_mtu\": %s, ", $0 }
    /"sndwnd":/ { gsub(/.*"sndwnd":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_sndwnd\": %s, ", $0 }
    /"rcvwnd":/ { gsub(/.*"rcvwnd":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_rcvwnd\": %s, ", $0 }
    /"sockbuf":/ { gsub(/.*"sockbuf":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_sockbuf\": %s, ", $0 }
    /"smuxbuf":/ { gsub(/.*"smuxbuf":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_smuxbuf\": %s, ", $0 }
    /"streambuf":/ { gsub(/.*"streambuf":[[:space:]]*/, ""); gsub(/,.*/, ""); printf "\"kcp_streambuf\": %s, ", $0 }
    END { printf "\"bridge_mtu\": 1500}\n" }
    ' "$config"
    exit 0
}

# Update link settings
update_link_settings_action() {
    local config="/etc/kcptun/server.json"
    [ ! -f "$config" ] && json_error "KCPtun config not found"

    # Parse settings from POST data — map our field names to kcptun JSON keys
    local nodelay=$(parse_json "kcp_nodelay" "$1")
    local interval=$(parse_json "kcp_interval" "$1")
    local resend=$(parse_json "kcp_resend" "$1")
    local nc=$(parse_json "kcp_nc" "$1")
    local mtu=$(parse_json "kcp_segment_mtu" "$1")
    local sndwnd=$(parse_json "kcp_sndwnd" "$1")
    local rcvwnd=$(parse_json "kcp_rcvwnd" "$1")
    local sockbuf=$(parse_json "kcp_sockbuf" "$1")
    local smuxbuf=$(parse_json "kcp_smuxbuf" "$1")
    local streambuf=$(parse_json "kcp_streambuf" "$1")

    # Apply changes with sed
    [ -n "$nodelay" ] && sed -i "s/\"nodelay\":[[:space:]]*[0-9]*/\"nodelay\": $nodelay/" "$config"
    [ -n "$interval" ] && sed -i "s/\"interval\":[[:space:]]*[0-9]*/\"interval\": $interval/" "$config"
    [ -n "$resend" ] && sed -i "s/\"resend\":[[:space:]]*[0-9]*/\"resend\": $resend/" "$config"
    [ -n "$nc" ] && sed -i "s/\"nc\":[[:space:]]*[0-9]*/\"nc\": $nc/" "$config"
    [ -n "$mtu" ] && sed -i "s/\"mtu\":[[:space:]]*[0-9]*/\"mtu\": $mtu/" "$config"
    [ -n "$sndwnd" ] && sed -i "s/\"sndwnd\":[[:space:]]*[0-9]*/\"sndwnd\": $sndwnd/" "$config"
    [ -n "$rcvwnd" ] && sed -i "s/\"rcvwnd\":[[:space:]]*[0-9]*/\"rcvwnd\": $rcvwnd/" "$config"
    [ -n "$sockbuf" ] && sed -i "s/\"sockbuf\":[[:space:]]*[0-9]*/\"sockbuf\": $sockbuf/" "$config"
    [ -n "$smuxbuf" ] && sed -i "s/\"smuxbuf\":[[:space:]]*[0-9]*/\"smuxbuf\": $smuxbuf/" "$config"
    [ -n "$streambuf" ] && sed -i "s/\"streambuf\":[[:space:]]*[0-9]*/\"streambuf\": $streambuf/" "$config"

    # Also update aircraft client config if connected
    local aircraft_ip=""
    [ -f /etc/l2bridge.conf ] && . /etc/l2bridge.conf
    if [ -n "$AIRCRAFT_IP" ] && [ -f "$SSH_KEY" ]; then
        local client_config="/etc/kcptun/client.json"
        timeout 5 dbclient -i "$SSH_KEY" -y root@"$AIRCRAFT_IP" "
            [ -f $client_config ] || exit 0
            $([ -n "$nodelay" ] && echo "sed -i 's/\"nodelay\":[[:space:]]*[0-9]*/\"nodelay\": $nodelay/' $client_config")
            $([ -n "$interval" ] && echo "sed -i 's/\"interval\":[[:space:]]*[0-9]*/\"interval\": $interval/' $client_config")
            $([ -n "$resend" ] && echo "sed -i 's/\"resend\":[[:space:]]*[0-9]*/\"resend\": $resend/' $client_config")
            $([ -n "$nc" ] && echo "sed -i 's/\"nc\":[[:space:]]*[0-9]*/\"nc\": $nc/' $client_config")
            $([ -n "$mtu" ] && echo "sed -i 's/\"mtu\":[[:space:]]*[0-9]*/\"mtu\": $mtu/' $client_config")
            $([ -n "$sndwnd" ] && echo "sed -i 's/\"sndwnd\":[[:space:]]*[0-9]*/\"sndwnd\": $sndwnd/' $client_config")
            $([ -n "$rcvwnd" ] && echo "sed -i 's/\"rcvwnd\":[[:space:]]*[0-9]*/\"rcvwnd\": $rcvwnd/' $client_config")
            $([ -n "$sockbuf" ] && echo "sed -i 's/\"sockbuf\":[[:space:]]*[0-9]*/\"sockbuf\": $sockbuf/' $client_config")
            $([ -n "$smuxbuf" ] && echo "sed -i 's/\"smuxbuf\":[[:space:]]*[0-9]*/\"smuxbuf\": $smuxbuf/' $client_config")
            $([ -n "$streambuf" ] && echo "sed -i 's/\"streambuf\":[[:space:]]*[0-9]*/\"streambuf\": $streambuf/' $client_config")
        " 2>/dev/null || true
    fi

    # Restart if requested
    local do_restart=$(parse_json "restart" "$1")
    if [ "$do_restart" = "true" ]; then
        /etc/init.d/kcptun-server restart 2>/dev/null || true
        if [ -n "$AIRCRAFT_IP" ] && [ -f "$SSH_KEY" ]; then
            timeout 5 dbclient -i "$SSH_KEY" -y root@"$AIRCRAFT_IP" \
                "/etc/init.d/kcptun-client restart" 2>/dev/null || true
        fi
    fi

    json_response "{\"success\": true, \"message\": \"Link settings updated\"}"
}

# Add a manual peer IP for discovery probing
add_manual_peer() {
    local ip="$1"
    [ -z "$ip" ] && json_error "IP address required"
    validate_ip "$ip" || json_error "Invalid IP format (must be 100.x.x.x)"

    local peers_file="/etc/l2bridge/peers.conf"
    mkdir -p /etc/l2bridge
    # Add if not already present
    if ! grep -qx "$ip" "$peers_file" 2>/dev/null; then
        echo "$ip" >> "$peers_file"
    fi
    json_response "{\"success\": true, \"message\": \"Peer IP added\"}"
}

# Remove a manual peer IP
remove_manual_peer() {
    local ip="$1"
    [ -z "$ip" ] && json_error "IP address required"
    local peers_file="/etc/l2bridge/peers.conf"
    [ -f "$peers_file" ] && sed -i "/^${ip}$/d" "$peers_file"
    json_response "{\"success\": true, \"message\": \"Peer IP removed\"}"
}

SSH_KEY="/root/.ssh/id_dropbear"

# Main request handling
main() {
    local post_data=$(read_post_data)
    local action=""
    local aircraft_ip=""
    local aircraft_name=""

    # Parse action from POST data or query string
    if [ -n "$post_data" ]; then
        # Try jsonfilter first
        if command -v jsonfilter >/dev/null 2>&1; then
            action=$(echo "$post_data" | jsonfilter -e '@.action' 2>/dev/null)
            aircraft_ip=$(echo "$post_data" | jsonfilter -e '@.aircraft_ip' 2>/dev/null)
            aircraft_name=$(echo "$post_data" | jsonfilter -e '@.aircraft_name' 2>/dev/null)
        fi
        # Fallback to simple parsing
        [ -z "$action" ] && action=$(parse_json "action" "$post_data")
        [ -z "$aircraft_ip" ] && aircraft_ip=$(parse_json "aircraft_ip" "$post_data")
        [ -z "$aircraft_name" ] && aircraft_name=$(parse_json "aircraft_name" "$post_data")
    fi

    # Handle GET requests
    if [ "$REQUEST_METHOD" = "GET" ]; then
        action=$(echo "$QUERY_STRING" | sed -n 's/.*action=\([^&]*\).*/\1/p')
    fi

    [ -z "$action" ] && json_error "No action specified"

    case "$action" in
        # L2Bridge commands
        setup|add)
            run_l2bridge_command "$action" "$aircraft_ip" "$aircraft_name"
            ;;
        start|stop|restart|debug)
            run_l2bridge_command "$action" "$aircraft_ip"
            ;;
        status)
            run_l2bridge_command "status" ""
            ;;
        config)
            run_l2bridge_command "config" ""
            ;;
        logs)
            run_l2bridge_command "logs" "50"
            ;;

        # Capture commands
        capture_start)
            local duration=$(parse_json "duration" "$post_data")
            duration="${duration:-60}"
            run_l2bridge_command "capture" "$duration"
            ;;
        capture_stop)
            run_l2bridge_command "capture" "stop"
            ;;

        # File management
        list_files)
            echo "Content-Type: application/json"
            echo ""
            printf '{"files":['
            first=1
            for f in /tmp/l2bridge-capture*.pcap /tmp/l2bridge-setup.log /tmp/l2bridge-watchdog.log; do
                [ -f "$f" ] || continue
                fname=$(basename "$f")
                fsize=$(wc -c < "$f" 2>/dev/null || echo 0)
                fdate=$(ls -l --full-time "$f" 2>/dev/null | awk '{print $6"T"$7}' || date '+%Y-%m-%dT%H:%M:%S')
                [ -z "$fdate" ] && fdate=$(date '+%Y-%m-%dT%H:%M:%S')
                ftype="log"
                echo "$fname" | grep -q '\.pcap$' && ftype="capture"
                [ $first -eq 0 ] && printf ','
                printf '{"name":"%s","path":"%s","size":%s,"modified":"%s","type":"%s"}' \
                    "$fname" "$f" "$fsize" "$fdate" "$ftype"
                first=0
            done
            printf ']}'
            exit 0
            ;;
        download)
            local filename=$(parse_json "file" "$post_data")
            [ -z "$filename" ] && filename=$(echo "$QUERY_STRING" | sed -n 's/.*file=\([^&]*\).*/\1/p')
            # Security: only allow specific files from /tmp/
            case "$filename" in
                l2bridge-capture*.pcap|l2bridge-setup.log|l2bridge-watchdog.log)
                    local filepath="/tmp/$filename"
                    if [ -f "$filepath" ]; then
                        echo "Content-Type: application/octet-stream"
                        echo "Content-Disposition: attachment; filename=\"$filename\""
                        echo "Content-Length: $(wc -c < "$filepath")"
                        echo ""
                        cat "$filepath"
                        exit 0
                    else
                        json_error "File not found"
                    fi
                    ;;
                *)
                    json_error "Access denied: invalid filename"
                    ;;
            esac
            ;;
        delete_file)
            local filename=$(parse_json "file" "$post_data")
            # Only allow deleting capture files
            case "$filename" in
                l2bridge-capture*.pcap)
                    local filepath="/tmp/$filename"
                    if [ -f "$filepath" ]; then
                        rm -f "$filepath"
                        json_response '{"success": true, "message": "File deleted"}'
                    else
                        json_error "File not found"
                    fi
                    ;;
                *)
                    json_error "Only capture files can be deleted"
                    ;;
            esac
            ;;

        # Aircraft profile management
        list_aircraft)
            list_aircraft
            ;;
        add_aircraft)
            local id=$(parse_json "id" "$post_data")
            local name=$(parse_json "name" "$post_data")
            local ip=$(parse_json "tailscale_ip" "$post_data")
            local password=$(parse_json "ssh_password" "$post_data")
            add_aircraft "$id" "$name" "$ip" "$password"
            ;;
        update_aircraft)
            local id=$(parse_json "id" "$post_data")
            local name=$(parse_json "name" "$post_data")
            local ip=$(parse_json "tailscale_ip" "$post_data")
            local password=$(parse_json "ssh_password" "$post_data")
            update_aircraft "$id" "$name" "$ip" "$password"
            ;;
        delete_aircraft)
            local id=$(parse_json "id" "$post_data")
            delete_aircraft "$id"
            ;;
        set_active)
            local id=$(parse_json "id" "$post_data")
            set_active_aircraft "$id"
            ;;

        # Binding management
        discover_peers)
            discover_peers
            ;;
        bind_aircraft)
            local ip=$(parse_json "tailscale_ip" "$post_data")
            local name=$(parse_json "name" "$post_data")
            local password=$(parse_json "ssh_password" "$post_data")
            bind_aircraft_action "$ip" "$name" "$password"
            ;;
        unbind_aircraft)
            local id=$(parse_json "id" "$post_data")
            unbind_aircraft_action "$id"
            ;;
        connect_aircraft)
            local id=$(parse_json "id" "$post_data")
            connect_aircraft_action "$id"
            ;;
        add_peer)
            local ip=$(parse_json "ip" "$post_data")
            add_manual_peer "$ip"
            ;;
        remove_peer)
            local ip=$(parse_json "ip" "$post_data")
            remove_manual_peer "$ip"
            ;;
        get_link_settings)
            get_link_settings_action
            ;;
        update_link_settings)
            # Pass the settings sub-object — parse_json handles nested extraction
            local settings_json=$(echo "$post_data" | sed 's/.*"settings"[[:space:]]*:[[:space:]]*{/{/' | sed 's/}[^}]*/}/')
            update_link_settings_action "$settings_json"
            ;;

        *)
            json_error "Unknown action: $action"
            ;;
    esac
}

main
