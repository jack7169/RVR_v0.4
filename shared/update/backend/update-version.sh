#!/bin/sh
# shared/update/backend/update-version.sh
# Version check logic for status/version CGI endpoints.
# Sourced by status.cgi (RVR) or version.cgi (Starnav).
#
# Required variables (set by caller before sourcing):
#   UPDATE_CONFIG_DIR     — e.g., /etc/rvr or /etc/starnav
#   UPDATE_REPO_PATH      — e.g., jack7169/RVR_v0.4 (fallback if /etc/.../repo missing)
#   UPDATE_CACHE_PREFIX   — e.g., rvr or starnav
#
# Output variables (set by this script):
#   VERSION_CURRENT       — short commit hash or "unknown"
#   VERSION_LATEST        — short commit hash of remote HEAD or ""
#   VERSION_BRANCH        — current branch name
#   VERSION_UPDATE        — "true" or "false"

VERSION_CURRENT=$(cat "$UPDATE_CONFIG_DIR/version" 2>/dev/null || echo "unknown")
VERSION_BRANCH=$(cat "$UPDATE_CONFIG_DIR/branch" 2>/dev/null || echo "main")
VERSION_LATEST=""
VERSION_UPDATE="false"

_UPDATE_REPO_PATH=$(cat "$UPDATE_CONFIG_DIR/repo" 2>/dev/null || echo "")
[ -z "$_UPDATE_REPO_PATH" ] && _UPDATE_REPO_PATH="$UPDATE_REPO_PATH"

if [ -n "$_UPDATE_REPO_PATH" ] && [ "$VERSION_CURRENT" != "unknown" ]; then
    _CACHE_FILE="/tmp/${UPDATE_CACHE_PREFIX}-latest-version"
    _CACHE_AGE=600  # 10 minutes

    # Use cached value if fresh enough
    if [ -f "$_CACHE_FILE" ]; then
        _FILE_AGE=$(( $(date +%s) - $(date -r "$_CACHE_FILE" +%s 2>/dev/null || echo 0) ))
        if [ "$_FILE_AGE" -lt "$_CACHE_AGE" ]; then
            VERSION_LATEST=$(cat "$_CACHE_FILE" 2>/dev/null || echo "")
        fi
    fi

    # Fetch from GitHub if cache miss (with 3s timeout to avoid blocking CGI)
    if [ -z "$VERSION_LATEST" ]; then
        VERSION_LATEST=$(wget -q -T 3 -O- "https://api.github.com/repos/$_UPDATE_REPO_PATH/commits/$VERSION_BRANCH" 2>/dev/null | \
            awk -F'"' '/"sha"/ {print substr($4,1,7); exit}')
        if [ -n "$VERSION_LATEST" ]; then
            echo "$VERSION_LATEST" > "$_CACHE_FILE"
        fi
    fi

    # Only show update if latest differs from current AND version file is older than cache.
    # This prevents false positives when we just updated (version file is newer than cache).
    if [ -n "$VERSION_LATEST" ] && [ "$VERSION_LATEST" != "$VERSION_CURRENT" ]; then
        _VERSION_FILE="$UPDATE_CONFIG_DIR/version"
        if [ -f "$_CACHE_FILE" ] && [ -f "$_VERSION_FILE" ]; then
            _CACHE_MTIME=$(date -r "$_CACHE_FILE" +%s 2>/dev/null || echo 0)
            _VERSION_MTIME=$(date -r "$_VERSION_FILE" +%s 2>/dev/null || echo 0)
            # If version file is newer than cache, we just updated — stale cache
            if [ "$_VERSION_MTIME" -gt "$_CACHE_MTIME" ]; then
                rm -f "$_CACHE_FILE"
                VERSION_LATEST="$VERSION_CURRENT"
            else
                VERSION_UPDATE="true"
            fi
        else
            VERSION_UPDATE="true"
        fi
    fi
fi

# Clean up temp variables
unset _UPDATE_REPO_PATH _CACHE_FILE _CACHE_AGE _FILE_AGE _VERSION_FILE _CACHE_MTIME _VERSION_MTIME
