#!/bin/sh
# install.sh - RVR L2 Bridge v4.0 installer
# Run on any fresh OpenWrt device to download, install, and configure RVR.
#
# One-liner:
#   wget -qO /tmp/rvr-install.sh https://raw.githubusercontent.com/jack7169/RVR_v0.4/main/install.sh && sh /tmp/rvr-install.sh
#
# Or with role pre-selected:
#   sh install.sh --role gcs
#   sh install.sh --role aircraft

set -e

REPO_OWNER="jack7169"
REPO_NAME="RVR_v0.4"
REPO_BRANCH="main"
TARBALL_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_BRANCH}.tar.gz"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
INSTALL_DIR="/root/RVR_v0.4"
MIN_DISK_MB=40

# Package lists (no tinc — replaced by l2tap static binary)
COMMON_PKGS="kcptun-config kmod-tun libopenssl3 liblzo2 zlib git git-http libcurl4"
GCS_PKGS="kcptun-server sshpass"
AIRCRAFT_PKGS="kcptun-client"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${CYAN}[*]${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}[+]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$1"; }
fail()  { printf "${RED}[-]${NC} %s\n" "$1"; exit 1; }

#############################################
# ARGUMENT PARSING
#############################################
ROLE=""
NO_WEBUI=""

while [ $# -gt 0 ]; do
    case "$1" in
        --role)
            ROLE="$2"; shift 2
            case "$ROLE" in
                gcs|aircraft) ;;
                *) fail "Invalid role: $ROLE (must be gcs or aircraft)" ;;
            esac
            ;;
        --no-webui)  NO_WEBUI=1; shift ;;
        --help|-h)
            echo "Usage: $0 [--role gcs|aircraft] [--no-webui]"
            echo ""
            echo "Options:"
            echo "  --role gcs|aircraft   Skip interactive menu, install for given role"
            echo "  --no-webui            Skip web UI installation prompt"
            echo ""
            echo "Without --role, presents an interactive menu."
            exit 0
            ;;
        *) fail "Unknown option: $1" ;;
    esac
done

#############################################
# HTTP FETCH HELPER
#############################################
fetch() {
    local url="$1" output="$2"
    if command -v wget >/dev/null 2>&1; then
        wget -q -O "$output" "$url"
    elif command -v uclient-fetch >/dev/null 2>&1; then
        uclient-fetch -q -O "$output" "$url"
    elif command -v curl >/dev/null 2>&1; then
        curl -sfL -o "$output" "$url"
    else
        fail "No download tool found (need wget, uclient-fetch, or curl)"
    fi
}

#############################################
# PHASE 0: ENVIRONMENT VALIDATION
#############################################
check_environment() {
    if [ ! -f /etc/openwrt_release ]; then
        fail "This script must be run on an OpenWrt device."
    fi
    ok "OpenWrt detected"
}

check_disk_space() {
    local free_kb
    free_kb=$(df /overlay 2>/dev/null | tail -1 | awk '{print $4}')
    if [ -n "$free_kb" ]; then
        local free_mb=$((free_kb / 1024))
        if [ "$free_mb" -lt "$MIN_DISK_MB" ]; then
            warn "Low disk space on /overlay: ${free_mb}MB free (${MIN_DISK_MB}MB recommended)"
            printf "Continue anyway? [y/N] "
            read ans
            case "$ans" in y|Y) ;; *) exit 1 ;; esac
        else
            ok "Disk space: ${free_mb}MB free"
        fi
    fi
}

check_kernel_version() {
    local manifest="$INSTALL_DIR/packages/manifest.txt"
    [ -f "$manifest" ] || return 0

    local current_kernel bundle_kernel
    current_kernel=$(uname -r)
    bundle_kernel=$(grep "^# Kernel:" "$manifest" | awk '{print $3}')

    if [ -n "$bundle_kernel" ] && [ "$current_kernel" != "$bundle_kernel" ]; then
        warn "Kernel mismatch: device runs $current_kernel, packages built for $bundle_kernel"
        warn "kmod-tun may fail to load. Use 'Refresh packages' from menu to re-download."
        printf "Continue anyway? [y/N] "
        read ans
        case "$ans" in y|Y) ;; *) exit 1 ;; esac
    fi
}

#############################################
# OPKG CONFIGURATION
#############################################
ensure_opkg_config() {
    info "Configuring package manager..."

    if ! grep -q "arch aarch64_cortex-a53_neon-vfpv4 " /etc/opkg.conf 2>/dev/null; then
        echo "arch aarch64_cortex-a53_neon-vfpv4 10" >> /etc/opkg.conf
    fi
    if ! grep -q "arch aarch64_cortex-a53 " /etc/opkg.conf 2>/dev/null; then
        echo "arch aarch64_cortex-a53 5" >> /etc/opkg.conf
    fi
    if ! grep -q "arch all " /etc/opkg.conf 2>/dev/null; then
        echo "arch all 1" >> /etc/opkg.conf
    fi

    local arch
    arch=$(opkg print-architecture 2>/dev/null | grep -oE "aarch64_cortex-a53_neon-vfpv4" | head -1)
    if [ -n "$arch" ]; then
        local release feed_ver feed_url feeds_file="/etc/opkg/customfeeds.conf"
        release=$(. /etc/openwrt_release 2>/dev/null; echo "$DISTRIB_RELEASE")
        case "$release" in
            *SNAPSHOT*) feed_ver="23.05.5" ;;
            [0-9]*)     feed_ver="$release" ;;
            *)          feed_ver="23.05.5" ;;
        esac
        feed_url="https://downloads.openwrt.org/releases/${feed_ver}/packages/aarch64_cortex-a53/packages"
        if ! grep -q "openwrt_packages" "$feeds_file" 2>/dev/null; then
            echo "src/gz openwrt_packages $feed_url" >> "$feeds_file"
        fi
    fi

    ok "Package manager configured"
}

#############################################
# PHASE 1: DOWNLOAD & EXTRACT
#############################################
download_repo() {
    if [ -d "$INSTALL_DIR/.git" ] && command -v git >/dev/null 2>&1; then
        info "Existing installation found, pulling latest..."
        cd "$INSTALL_DIR" && git fetch origin "$REPO_BRANCH" 2>&1 || true
        git reset --hard "origin/$REPO_BRANCH" 2>&1 || true
        ok "Updated to latest"
        return 0
    fi

    info "Downloading RVR L2 Bridge v4.0..."
    local tmp_tar="/tmp/rvr-download.tar.gz"
    rm -f "$tmp_tar"

    if ! fetch "$TARBALL_URL" "$tmp_tar" 2>/dev/null; then
        warn "Download failed. Repository may require authentication."
        printf "GitHub personal access token (or Enter to skip): "
        read token
        if [ -n "$token" ]; then
            local auth_url="https://${token}@github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${REPO_BRANCH}.tar.gz"
            fetch "$auth_url" "$tmp_tar" || fail "Download failed with token"
            REPO_URL="https://${token}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
        else
            fail "Cannot proceed without repository access"
        fi
    fi

    info "Extracting..."
    cd /tmp
    tar xzf "$tmp_tar"
    rm -f "$tmp_tar"

    local extracted="${REPO_NAME}-${REPO_BRANCH}"
    if [ ! -d "/tmp/$extracted" ]; then
        extracted=$(ls -d /tmp/${REPO_NAME}* 2>/dev/null | head -1)
        [ -z "$extracted" ] && fail "Extraction failed - no directory found"
        extracted=$(basename "$extracted")
    fi

    rm -rf "$INSTALL_DIR"
    mv "/tmp/$extracted" "$INSTALL_DIR"
    chmod +x "$INSTALL_DIR/l2bridge"
    chmod +x "$INSTALL_DIR/www/cgi-bin/"*.cgi 2>/dev/null || true

    ok "Extracted to $INSTALL_DIR"
}

#############################################
# PHASE 2: INSTALL PACKAGES
#############################################
install_l2tap() {
    if [ -x /usr/bin/l2tap ]; then
        ok "l2tap already installed"
        return 0
    fi

    local binary="$INSTALL_DIR/packages/common/l2tap-aarch64"
    if [ -f "$binary" ]; then
        cp "$binary" /usr/bin/l2tap
        chmod +x /usr/bin/l2tap
        ok "l2tap binary installed"
    else
        fail "l2tap binary not found at $binary"
    fi
}

install_packages() {
    local role="$1"
    local pkg_dir="$INSTALL_DIR/packages"

    if [ ! -d "$pkg_dir/common" ]; then
        fail "packages/ directory not found in $INSTALL_DIR"
    fi

    # Install l2tap binary first
    install_l2tap

    case "$role" in
        gcs)
            info "Installing GCS packages (common + gcs)..."
            opkg install "$pkg_dir/common/"*.ipk "$pkg_dir/gcs/"*.ipk \
                --force-depends 2>&1 | grep -vE "has no valid architecture|Configuring" || true

            if [ -x /usr/bin/l2tap ] && command -v kcptun-server >/dev/null 2>&1; then
                ok "GCS packages installed"
            else
                fail "Package verification failed (l2tap or kcptun-server missing)"
            fi
            ;;
        aircraft)
            info "Installing Aircraft packages (common + aircraft)..."
            opkg install "$pkg_dir/common/"*.ipk "$pkg_dir/aircraft/"*.ipk \
                --force-depends 2>&1 | grep -vE "has no valid architecture|Configuring" || true

            if [ -x /usr/bin/l2tap ] && command -v kcptun-client >/dev/null 2>&1; then
                ok "Aircraft packages installed"
            else
                fail "Package verification failed (l2tap or kcptun-client missing)"
            fi
            ;;
    esac
}

#############################################
# PHASE 3: GIT BOOTSTRAP
#############################################
bootstrap_git() {
    if command -v git >/dev/null 2>&1; then
        ok "Git already available"
        return 0
    fi

    info "Git not found after package install, bootstrapping..."
    local pkg_dir="$INSTALL_DIR/packages/common"
    opkg install \
        "$pkg_dir"/zlib_*.ipk \
        "$pkg_dir"/libopenssl3_*.ipk \
        "$pkg_dir"/libcurl4_*.ipk \
        "$pkg_dir"/ca-bundle_*.ipk \
        "$pkg_dir"/git_*.ipk \
        "$pkg_dir"/git-http_*.ipk \
        --force-depends 2>&1 | grep -vE "has no valid architecture|Configuring" || true

    command -v git >/dev/null 2>&1 || fail "Git bootstrap failed"
    ok "Git installed"
}

setup_git_repo() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        ok "Already a git repository"
        return 0
    fi

    info "Initializing git repository..."
    cd "$INSTALL_DIR"
    git init -q
    git remote add origin "$REPO_URL"
    git fetch -q origin "$REPO_BRANCH" 2>&1 || {
        warn "Git fetch failed (network issue or private repo)"
        warn "l2bridge update will not work until this is resolved"
        return 0
    }
    git checkout -b "$REPO_BRANCH" 2>/dev/null || true
    git reset --hard "origin/$REPO_BRANCH" 2>/dev/null || true
    ok "Git repository initialized"
}

#############################################
# PHASE 4: INSTALL L2BRIDGE
#############################################
install_l2bridge_cli() {
    info "Installing l2bridge to /usr/bin/..."
    ln -sf "$INSTALL_DIR/l2bridge" /usr/bin/l2bridge
    chmod +x "$INSTALL_DIR/l2bridge"

    if l2bridge help >/dev/null 2>&1; then
        ok "l2bridge installed -> $INSTALL_DIR/l2bridge"
    else
        fail "l2bridge installation failed"
    fi
}

#############################################
# REFRESH PACKAGES
#############################################
refresh_packages() {
    info "Refreshing bundled packages from opkg feeds..."

    local pkg_dir="$INSTALL_DIR/packages"

    info "Updating package feeds (this may take ~30 seconds)..."
    opkg update >/dev/null 2>&1 || { warn "opkg update failed"; return 1; }

    # Keep l2tap binary if it exists
    local l2tap_backup=""
    if [ -f "$pkg_dir/common/l2tap-aarch64" ]; then
        l2tap_backup="/tmp/l2tap-aarch64.bak"
        cp "$pkg_dir/common/l2tap-aarch64" "$l2tap_backup"
    fi

    rm -rf "$pkg_dir/common" "$pkg_dir/gcs" "$pkg_dir/aircraft"
    mkdir -p "$pkg_dir/common" "$pkg_dir/gcs" "$pkg_dir/aircraft"

    # Restore l2tap binary
    [ -n "$l2tap_backup" ] && [ -f "$l2tap_backup" ] && mv "$l2tap_backup" "$pkg_dir/common/l2tap-aarch64"

    local tmp_dl="/tmp/rvr-pkg-download"
    rm -rf "$tmp_dl" && mkdir -p "$tmp_dl"
    cd "$tmp_dl"

    info "Downloading packages..."
    local all_pkgs="$COMMON_PKGS $GCS_PKGS $AIRCRAFT_PKGS ca-bundle"
    for pkg in $all_pkgs; do
        opkg download "$pkg" 2>/dev/null || warn "Failed to download: $pkg"
    done

    local pkg
    for pkg in $COMMON_PKGS; do
        mv "${tmp_dl}"/${pkg}_*.ipk "$pkg_dir/common/" 2>/dev/null || true
    done
    mv "${tmp_dl}"/ca-bundle_*.ipk "$pkg_dir/common/" 2>/dev/null || true

    for pkg in $GCS_PKGS; do
        mv "${tmp_dl}"/${pkg}_*.ipk "$pkg_dir/gcs/" 2>/dev/null || true
    done
    for pkg in $AIRCRAFT_PKGS; do
        mv "${tmp_dl}"/${pkg}_*.ipk "$pkg_dir/aircraft/" 2>/dev/null || true
    done
    rm -rf "$tmp_dl"

    # Write manifest
    local arch kernel
    arch=$(opkg print-architecture 2>/dev/null | grep -oE "aarch64_cortex-a53[^ ]*" | head -1)
    kernel=$(uname -r)

    cat > "$pkg_dir/manifest.txt" << EOF
# RVR v4.0 Offline Package Bundle
# Downloaded: $(date +%Y-%m-%d)
# Source: localhost ($(cat /proc/sys/kernel/hostname 2>/dev/null || echo 'unknown'))
# Architecture: ${arch:-unknown}
# Kernel: ${kernel:-unknown}
#
# common/ - shared dependencies (GCS + Aircraft)
#   l2tap-aarch64 (static binary, not .ipk)
EOF
    for f in "$pkg_dir/common/"*.ipk; do
        [ -f "$f" ] && echo "#   $(basename "$f")" >> "$pkg_dir/manifest.txt"
    done
    echo "#" >> "$pkg_dir/manifest.txt"
    echo "# gcs/ - GCS-only packages" >> "$pkg_dir/manifest.txt"
    for f in "$pkg_dir/gcs/"*.ipk; do
        [ -f "$f" ] && echo "#   $(basename "$f")" >> "$pkg_dir/manifest.txt"
    done
    echo "#" >> "$pkg_dir/manifest.txt"
    echo "# aircraft/ - Aircraft-only packages" >> "$pkg_dir/manifest.txt"
    for f in "$pkg_dir/aircraft/"*.ipk; do
        [ -f "$f" ] && echo "#   $(basename "$f")" >> "$pkg_dir/manifest.txt"
    done
    cat >> "$pkg_dir/manifest.txt" << 'EOF'
#
# WARNING: kmod-tun is kernel-version specific. If the target router
# runs a different kernel, kmod-tun may fail to load. Check: uname -r
EOF

    local common_count gcs_count aircraft_count
    common_count=$(ls "$pkg_dir/common/"*.ipk 2>/dev/null | wc -l | tr -d ' ')
    gcs_count=$(ls "$pkg_dir/gcs/"*.ipk 2>/dev/null | wc -l | tr -d ' ')
    aircraft_count=$(ls "$pkg_dir/aircraft/"*.ipk 2>/dev/null | wc -l | tr -d ' ')

    echo ""
    ok "Packages refreshed:"
    echo "    common/:   $common_count packages + l2tap binary"
    echo "    gcs/:      $gcs_count packages"
    echo "    aircraft/: $aircraft_count packages"
    echo "    Total: $(du -sh "$pkg_dir" | awk '{print $1}')"
    echo ""
    echo "    Commit packages/ to git to bundle with the repo."
}

#############################################
# BRIDGE SETUP
#############################################
run_bridge_setup() {
    printf "Enter aircraft Tailscale IP: "
    read aircraft_ip
    if [ -z "$aircraft_ip" ]; then
        warn "Aircraft IP is required"
        return 1
    fi
    printf "Enter aircraft name [aircraft]: "
    read aircraft_name
    aircraft_name="${aircraft_name:-aircraft}"
    info "Running: l2bridge setup $aircraft_ip $aircraft_name"
    l2bridge setup "$aircraft_ip" "$aircraft_name"
}

#############################################
# INTERACTIVE MENU
#############################################
show_menu() {
    while true; do
        echo ""
        echo "=========================================="
        echo "  RVR L2 Bridge v4.0 Installer"
        echo "=========================================="
        echo "  Device: $(cat /proc/sys/kernel/hostname 2>/dev/null || echo 'unknown')"
        echo "  Kernel: $(uname -r)"
        [ -d "$INSTALL_DIR/.git" ] && echo "  Repo:   $INSTALL_DIR (git)"
        echo "=========================================="
        echo ""
        echo "  1) Setup as GCS (Ground Control Station)"
        echo "  2) Setup as Aircraft"
        echo "  3) Install Web UI"
        echo "  4) Run bridge setup (configure connection)"
        echo "  5) Refresh bundled packages (re-download from feeds)"
        echo "  6) Uninstall everything"
        echo "  7) Exit"
        echo ""
        printf "Choose an option [1-7]: "
        read choice

        case "$choice" in
            1)
                install_packages gcs
                install_l2bridge_cli
                echo ""
                ok "GCS setup complete. Use option 3 for Web UI, option 4 to configure bridge."
                ;;
            2)
                install_packages aircraft
                install_l2bridge_cli
                echo ""
                ok "Aircraft setup complete. The GCS will configure this device during bridge setup."
                ;;
            3)
                info "Installing Web UI..."
                l2bridge webui-install
                ;;
            4)
                run_bridge_setup
                ;;
            5)
                refresh_packages
                ;;
            6)
                info "Running uninstall..."
                l2bridge uninstall
                echo "Installer will now exit."
                exit 0
                ;;
            7)
                echo "Goodbye."
                exit 0
                ;;
            *)
                warn "Invalid option: $choice"
                ;;
        esac
    done
}

#############################################
# MAIN
#############################################
echo ""
echo "=========================================="
echo "  RVR L2 Bridge v4.0 Installer"
echo "=========================================="
echo ""

# Phase 0: Validate
check_environment
check_disk_space

# Phase 1: Download or update repo
download_repo

# Kernel check
check_kernel_version

# Phase 2: Configure opkg
ensure_opkg_config

# Non-interactive mode
if [ -n "$ROLE" ]; then
    install_packages "$ROLE"
    bootstrap_git
    setup_git_repo
    install_l2bridge_cli

    # Always install web UI — required for peer discovery endpoint
    if [ -z "$NO_WEBUI" ]; then
        l2bridge webui-install
    fi

    echo ""
    ok "Installation complete! Run 'l2bridge help' to get started."
    exit 0
fi

# Interactive: bootstrap git before menu
bootstrap_git
setup_git_repo
install_l2bridge_cli

# Interactive menu
show_menu
