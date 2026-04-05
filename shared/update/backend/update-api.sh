#!/bin/sh
# shared/update/backend/update-api.sh
# CGI action handlers for update management.
# Sourced by each project's api.cgi.
#
# Required variables (set by caller before sourcing):
#   UPDATE_CONFIG_DIR     — e.g., /etc/rvr or /etc/starnav
#   UPDATE_CLI_BIN        — e.g., /usr/bin/rvr or empty (for projects without CLI)
#   UPDATE_CACHE_PREFIX   — e.g., rvr or starnav
#   UPDATE_REPO_PATH      — e.g., jack7169/RVR_v0.4 or jack7169/Starnav
#   UPDATE_REPO_DIR       — e.g., /root/RVR_v0.4 or /opt/starnav
#
# Required functions from parent (api.cgi):
#   json_response "$json"
#   json_error "$message"
#
# Optional functions from parent (for multi-device updates):
#   _ssh_remote "$ip" "$command"   — SSH to remote device
#   run_discovery_scan             — refresh device cache after update
#
# Optional variables:
#   SSH_KEY               — path to SSH key (enables remote device updates)
#   DISCOVERY_CACHE       — path to discovery cache file (cleared after update)

SETUP_LOG="/tmp/${UPDATE_CACHE_PREFIX}-setup.log"

# ── Update devices (local + remote) ──────────────────────────────────

# Triggers update on one or more devices. Remote updates run first (VPN
# tunnel still intact), local last (bridge restart won't affect SSH).
# Runs in background subshell; progress written to SETUP_LOG.
# Args: $1=remote_ips (comma-separated), $2=include_local, $3=branch
update_devices_action() {
    local remote_ips="$1"
    local include_local="$2"
    local branch="$3"

    [ -z "$remote_ips" ] && [ "$include_local" != "true" ] && json_error "No devices selected"
    [ "$include_local" = "true" ] && [ -n "$UPDATE_CLI_BIN" ] && { [ -x "$UPDATE_CLI_BIN" ] || json_error "CLI binary not found"; }
    if [ -n "$remote_ips" ]; then
        [ -n "$SSH_KEY" ] && { [ -f "$SSH_KEY" ] || json_error "SSH key not available"; }
    fi

    local branch_arg=""
    [ -n "$branch" ] && branch_arg="--branch $branch"

    : > "$SETUP_LOG"
    (
        rc=0

        # Remote devices FIRST — VPN tunnel still intact before local bridge restart
        if [ -n "$remote_ips" ] && type _ssh_remote >/dev/null 2>&1; then
            while IFS= read -r ip; do
                [ -z "$ip" ] && continue
                echo "[UPDATE REMOTE] Starting update on $ip${branch:+ (branch: $branch)}..." >> "$SETUP_LOG"
                _ssh_remote "$ip" "$(basename "$UPDATE_CLI_BIN") update $branch_arg" >> "$SETUP_LOG" 2>&1
                [ $? -ne 0 ] && rc=1
                echo "" >> "$SETUP_LOG"
            done <<EOF
$(echo "$remote_ips" | tr ',' '\n')
EOF
        fi

        # Local LAST — bridge restart at end won't affect remote SSH
        if [ "$include_local" = "true" ]; then
            local host
            host=$(cat /proc/sys/kernel/hostname 2>/dev/null || echo "unknown")
            echo "[UPDATE LOCAL] Starting update on $host${branch:+ (branch: $branch)}..." >> "$SETUP_LOG"
            if [ -n "$UPDATE_CLI_BIN" ] && [ -x "$UPDATE_CLI_BIN" ]; then
                "$UPDATE_CLI_BIN" update $branch_arg >> "$SETUP_LOG" 2>&1
            else
                # No CLI binary — run update directly via shared library
                . "$UPDATE_REPO_DIR/shared/update/backend/update-lib.sh"
                update_fetch_and_apply $branch_arg >> "$SETUP_LOG" 2>&1
            fi
            [ $? -ne 0 ] && rc=1
        fi

        # Post-update: refresh device discovery cache
        if [ -n "$DISCOVERY_CACHE" ]; then
            rm -f "$DISCOVERY_CACHE"
        fi
        if type run_discovery_scan >/dev/null 2>&1; then
            run_discovery_scan >/dev/null 2>&1 &
        fi

        echo "[UPDATE COMPLETE] exit_code=$rc" >> "$SETUP_LOG"
    ) >> "$SETUP_LOG" 2>&1 &

    json_response '{"success": true, "message": "Update started", "log_file": "'"$SETUP_LOG"'"}'
}

# Single-device update (convenience wrapper for projects without multi-device)
update_local_action() {
    update_devices_action "" "true" "$1"
}

# ── Check for updates ────────────────────────────────────────────────

# Force-refresh version check (clears cache, re-fetches from GitHub).
# Returns JSON with current/latest/branch/update_available.
check_update_action() {
    rm -f "/tmp/${UPDATE_CACHE_PREFIX}-latest-version"
    rm -f "/tmp/${UPDATE_CACHE_PREFIX}_git_remote"

    local current=""
    [ -f "$UPDATE_CONFIG_DIR/version" ] && current=$(cat "$UPDATE_CONFIG_DIR/version")

    local branch
    branch=$(cat "$UPDATE_CONFIG_DIR/branch" 2>/dev/null || echo "main")

    local repo_path
    repo_path=$(cat "$UPDATE_CONFIG_DIR/repo" 2>/dev/null || echo "")
    [ -z "$repo_path" ] && repo_path="$UPDATE_REPO_PATH"

    local latest=""
    if [ -n "$repo_path" ]; then
        latest=$(wget -q -T 3 -O - "https://api.github.com/repos/$repo_path/commits/$branch" 2>/dev/null | \
            sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([a-f0-9]*\)".*/\1/p' | head -1)
        [ -n "$latest" ] && latest=$(echo "$latest" | cut -c1-7)
    fi

    [ -n "$latest" ] && echo "$latest" > "/tmp/${UPDATE_CACHE_PREFIX}-latest-version"

    local update_available="false"
    if [ -n "$current" ] && [ -n "$latest" ] && [ "$current" != "$latest" ]; then
        update_available="true"
    fi

    json_response "{\"current\": \"${current:-unknown}\", \"latest\": \"${latest:-unknown}\", \"branch\": \"$branch\", \"update_available\": $update_available}"
}

# ── List branches ────────────────────────────────────────────────────

# List available remote branches as JSON.
list_branches_action() {
    [ -d "$UPDATE_REPO_DIR/.git" ] || json_error "Git repository not found"

    . "$UPDATE_REPO_DIR/shared/update/backend/update-lib.sh"

    echo "Content-Type: application/json"
    echo ""
    update_list_branches_json
    exit 0
}

# ── Setup log ────────────────────────────────────────────────────────

# Return the current setup/update log as JSON.
get_update_log() {
    local log=""
    [ -f "$SETUP_LOG" ] && log=$(cat "$SETUP_LOG" 2>/dev/null)
    # Escape for JSON
    local escaped
    escaped=$(printf '%s' "$log" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | tr '\n' '\\' | sed 's/\\/\\n/g')
    json_response "{\"log\": \"$escaped\"}"
}
