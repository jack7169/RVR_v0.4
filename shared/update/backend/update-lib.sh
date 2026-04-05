#!/bin/sh
# shared/update/backend/update-lib.sh
# Generic, storage-safe git update library for OpenWrt devices.
# Sourced by project CLI scripts and CGI backends.
#
# Required variables (set by caller before sourcing):
#   UPDATE_REPO_DIR       — default repo path (e.g., /root/RVR_v0.4 or /opt/starnav)
#   UPDATE_CONFIG_DIR     — version/branch config (e.g., /etc/rvr or /etc/starnav)
#   UPDATE_WEBUI_ROOT     — web UI install dir (e.g., /www/rvr) or empty to skip
#   UPDATE_CACHE_PREFIX   — temp file prefix (e.g., rvr or starnav)
#   UPDATE_REPO_PATH      — GitHub owner/repo (e.g., jack7169/RVR_v0.4)
#
# Optional callback (define before calling update_fetch_and_apply):
#   update_post_apply()   — called after git reset + web UI copy, before completion message
#                           receives $repo_dir and $new_hash as positional args

# ── Locate git repo ──────────────────────────────────────────────────

# Sets _update_repo_dir. Tries script directory first, then UPDATE_REPO_DIR.
# Returns 1 if no .git found.
update_find_repo() {
    _update_repo_dir=""
    local script_path
    script_path=$(readlink -f "$0" 2>/dev/null || echo "$0")
    local script_dir
    script_dir=$(dirname "$script_path")

    if [ -d "$script_dir/.git" ]; then
        _update_repo_dir="$script_dir"
    elif [ -n "$UPDATE_REPO_DIR" ] && [ -d "$UPDATE_REPO_DIR/.git" ]; then
        _update_repo_dir="$UPDATE_REPO_DIR"
    fi

    [ -n "$_update_repo_dir" ]
}

# ── Pre-flight space check ───────────────────────────────────────────

# Returns 0 if enough space, 1 if not. Prints error to stdout.
update_check_space() {
    local free_kb
    free_kb=$(df /overlay 2>/dev/null | tail -1 | awk '{print $4}')
    if [ "${free_kb:-999999}" -lt 30720 ]; then
        echo "[ERROR] Not enough space for update (${free_kb}KB free, need 30MB)"
        echo "  Free /overlay space: ${free_kb}KB — minimum 30MB required"
        return 1
    fi
    return 0
}

# ── Web UI asset install ─────────────────────────────────────────────

# Copies web UI from repo www/ to UPDATE_WEBUI_ROOT.
# Cleans old assets before copy to prevent stale chunk accumulation.
# Args: $1 = repo_dir
update_install_webui() {
    local repo_dir="$1"
    local src_www="$repo_dir/www"
    [ -d "$src_www" ] || return 0

    cp "$src_www/index.html" "$UPDATE_WEBUI_ROOT/" 2>/dev/null
    # Clean old assets before copying new — prevents stale chunk accumulation
    if [ -d "$src_www/assets" ]; then
        rm -rf "$UPDATE_WEBUI_ROOT/assets"
        mkdir -p "$UPDATE_WEBUI_ROOT/assets"
        cp -r "$src_www/assets/"* "$UPDATE_WEBUI_ROOT/assets/"
    fi
    # Copy CGI scripts
    for ext in cgi py; do
        for f in "$src_www/cgi-bin/"*."$ext" ; do
            [ -f "$f" ] && cp "$f" "$UPDATE_WEBUI_ROOT/cgi-bin/"
        done
    done
    chmod +x "$UPDATE_WEBUI_ROOT/cgi-bin/"*.cgi 2>/dev/null
    chmod +x "$UPDATE_WEBUI_ROOT/cgi-bin/"*.py 2>/dev/null
}

# ── Main update flow ─────────────────────────────────────────────────

# Performs a storage-safe shallow git update.
# Parses --branch from args. Falls back to stored branch or "main".
# Calls update_post_apply() hook if defined.
# Returns 0 on success, 1 on failure.
update_fetch_and_apply() {
    # Find repo
    update_find_repo || { echo "[ERROR] Cannot find git repository"; return 1; }
    local repo_dir="$_update_repo_dir"

    # Parse --branch argument (default: stored branch or main)
    local branch="main"
    [ -f "$UPDATE_CONFIG_DIR/branch" ] && branch=$(cat "$UPDATE_CONFIG_DIR/branch")
    while [ $# -gt 0 ]; do
        case "$1" in
            --branch) branch="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    # Pre-flight space check
    update_check_space || return 1

    echo "Updating from GitHub..."
    echo "  Repository: $repo_dir"
    echo "  Branch: $branch"

    local old_hash
    old_hash=$(cd "$repo_dir" && git rev-parse --short HEAD 2>/dev/null)
    echo "  Current version: $old_hash"

    cd "$repo_dir" || return 1

    # Shallow fetch — only latest commit, saves ~90% storage vs full history
    git fetch --depth=1 origin "$branch" 2>&1 || { echo "[ERROR] Failed to fetch branch '$branch'"; return 1; }

    local new_hash
    new_hash=$(git rev-parse --short "origin/$branch" 2>/dev/null)

    # Warn if fetched version differs from what UI reported as latest
    local expected
    expected=$(cat "/tmp/${UPDATE_CACHE_PREFIX}-latest-version" 2>/dev/null)
    if [ -n "$expected" ] && [ -n "$new_hash" ] && [ "$new_hash" != "$expected" ]; then
        echo "  Note: fetched $new_hash (UI showed $expected — CI may have pushed since check)"
    fi

    # Already up to date?
    if [ "$old_hash" = "$new_hash" ] && [ "$(cat "$UPDATE_CONFIG_DIR/branch" 2>/dev/null)" = "$branch" ]; then
        echo "  Already up to date ($old_hash on $branch)"
        rm -f "/tmp/${UPDATE_CACHE_PREFIX}-latest-version"
        return 0
    fi

    # Apply
    git reset --hard "origin/$branch" 2>&1 || { echo "[ERROR] Failed to apply updates"; return 1; }

    # Update submodules (no-op if none exist)
    git submodule update --init --recursive 2>/dev/null || true

    # Clean stale git objects to reclaim storage
    git reflog expire --expire=now --all 2>/dev/null
    git gc --prune=all -q 2>/dev/null

    # Fix CGI permissions
    chmod +x "$repo_dir/www/cgi-bin/"*.cgi 2>/dev/null
    chmod +x "$repo_dir/www/cgi-bin/"*.py 2>/dev/null

    echo "  Updated: $old_hash -> $new_hash ($branch)"

    # Install web UI if configured
    if [ -n "$UPDATE_WEBUI_ROOT" ] && [ -d "$UPDATE_WEBUI_ROOT" ]; then
        echo "  Updating web UI files..."
        update_install_webui "$repo_dir"
        echo "  Web UI updated"
    fi

    # Save version + branch
    mkdir -p "$UPDATE_CONFIG_DIR"
    echo "$new_hash" > "$UPDATE_CONFIG_DIR/version"
    echo "$branch" > "$UPDATE_CONFIG_DIR/branch"

    # Clear version caches
    rm -f "/tmp/${UPDATE_CACHE_PREFIX}-latest-version"
    rm -f "/tmp/${UPDATE_CACHE_PREFIX}_git_remote"

    # Project-specific post-update hook
    if type update_post_apply >/dev/null 2>&1; then
        update_post_apply "$repo_dir" "$new_hash" "$branch"
    fi

    echo ""
    echo "Update complete. ($branch:$new_hash)"
    return 0
}

# ── Branch listing (CLI) ─────────────────────────────────────────────

# Human-readable branch listing for CLI output.
update_list_branches_cli() {
    update_find_repo || { echo "[ERROR] Cannot find git repository"; return 1; }
    local repo_dir="$_update_repo_dir"

    local current
    current=$(cat "$UPDATE_CONFIG_DIR/branch" 2>/dev/null || echo "main")
    echo "Current branch: $current"
    echo ""
    echo "Available branches:"
    cd "$repo_dir" || return 1
    git ls-remote --heads origin 2>/dev/null | awk '{
        branch = substr($2, 12)
        print "  " branch
    }'
}

# ── Branch listing (JSON for CGI) ────────────────────────────────────

# JSON branch listing for CGI output. Writes directly to stdout.
# Caller must have already sent Content-Type header.
update_list_branches_json() {
    local repo_dir=""
    if [ -n "$UPDATE_REPO_DIR" ] && [ -d "$UPDATE_REPO_DIR/.git" ]; then
        repo_dir="$UPDATE_REPO_DIR"
    fi
    [ -z "$repo_dir" ] && { echo '{"error":"Git repository not found"}'; return 1; }

    local current
    current=$(cat "$UPDATE_CONFIG_DIR/branch" 2>/dev/null || echo "main")

    cd "$repo_dir" || return 1
    local branches
    branches=$(git ls-remote --heads origin 2>/dev/null | awk '{print substr($2, 12)}')

    printf '{"current":"%s","branches":[' "$current"
    local first=1
    for b in $branches; do
        [ -z "$b" ] && continue
        [ $first -eq 0 ] && printf ','
        printf '"%s"' "$b"
        first=0
    done
    printf ']}'
}
