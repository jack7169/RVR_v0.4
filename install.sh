#!/bin/sh
# install.sh - RVR v0.4 installer
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

# Package lists (no tinc — replaced by tap2tcp static binary)
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
        cd "$INSTALL_DIR" && git fetch --depth=1 origin "$REPO_BRANCH" 2>&1 || true
        git reset --hard "origin/$REPO_BRANCH" 2>&1 || true
        git reflog expire --expire=now --all 2>/dev/null
        git gc --prune=all -q 2>/dev/null
        ok "Updated to latest"
        return 0
    fi

    info "Downloading RVR v0.4..."
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
    chmod +x "$INSTALL_DIR/robust_virtual_radio"
    chmod +x "$INSTALL_DIR/www/cgi-bin/"*.cgi 2>/dev/null || true

    ok "Extracted to $INSTALL_DIR"
}

#############################################
# PHASE 2: INSTALL PACKAGES
#############################################
install_tap2tcp() {
    if [ -x /usr/bin/tap2tcp ]; then
        ok "tap2tcp already installed"
        return 0
    fi

    local binary="$INSTALL_DIR/packages/common/tap2tcp-aarch64"
    if [ -f "$binary" ]; then
        cp "$binary" /usr/bin/tap2tcp
        chmod +x /usr/bin/tap2tcp
        ok "tap2tcp binary installed"
    else
        fail "tap2tcp binary not found at $binary"
    fi
}

install_packages() {
    local role="$1"
    local pkg_dir="$INSTALL_DIR/packages"

    mkdir -p "$pkg_dir/common" "$pkg_dir/gcs" "$pkg_dir/aircraft"

    # Install tap2tcp binary first
    install_tap2tcp

    # Check if bundled .ipk files exist
    local has_bundles=0
    ls "$pkg_dir/common/"*.ipk >/dev/null 2>&1 && has_bundles=1

    if [ $has_bundles -eq 1 ]; then
        # Offline install from bundled .ipk files
        case "$role" in
            gcs)
                info "Installing GCS packages from bundles..."
                opkg install "$pkg_dir/common/"*.ipk "$pkg_dir/gcs/"*.ipk \
                    --force-depends 2>&1 | grep -vE "has no valid architecture|Configuring" || true
                ;;
            aircraft)
                info "Installing Aircraft packages from bundles..."
                opkg install "$pkg_dir/common/"*.ipk "$pkg_dir/aircraft/"*.ipk \
                    --force-depends 2>&1 | grep -vE "has no valid architecture|Configuring" || true
                ;;
        esac
    else
        # Online install from opkg feeds
        info "No bundled .ipk files found, installing from opkg feeds..."
        ensure_opkg_config
        opkg update 2>&1 | grep -vE "has no valid architecture" || true

        local pkgs="$COMMON_PKGS"
        case "$role" in
            gcs)      pkgs="$pkgs $GCS_PKGS" ;;
            aircraft) pkgs="$pkgs $AIRCRAFT_PKGS" ;;
        esac

        for pkg in $pkgs; do
            info "  Installing $pkg..."
            opkg install "$pkg" 2>&1 | grep -vE "has no valid architecture|Configuring|already installed" || true
        done
    fi

    # Verify critical packages
    local verify_pkg=""
    case "$role" in
        gcs)      verify_pkg="kcptun-server" ;;
        aircraft) verify_pkg="kcptun-client" ;;
    esac

    if [ -x /usr/bin/tap2tcp ] && command -v "$verify_pkg" >/dev/null 2>&1 && command -v git >/dev/null 2>&1; then
        ok "$role packages installed (including git)"
    else
        [ -x /usr/bin/tap2tcp ] || warn "tap2tcp binary missing"
        command -v "$verify_pkg" >/dev/null 2>&1 || warn "$verify_pkg missing"
        command -v git >/dev/null 2>&1 || warn "git missing"
        fail "Package verification failed — check network and retry"
    fi
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

    # Try bundled .ipk files first
    local pkg_dir="$INSTALL_DIR/packages/common"
    if ls "$pkg_dir"/git_*.ipk >/dev/null 2>&1; then
        opkg install \
            "$pkg_dir"/zlib_*.ipk \
            "$pkg_dir"/libopenssl3_*.ipk \
            "$pkg_dir"/libcurl4_*.ipk \
            "$pkg_dir"/ca-bundle_*.ipk \
            "$pkg_dir"/git_*.ipk \
            "$pkg_dir"/git-http_*.ipk \
            --force-depends 2>&1 | grep -vE "has no valid architecture|Configuring" || true
    else
        # Fall back to opkg feeds
        info "No bundled git .ipk, installing from feeds..."
        ensure_opkg_config
        opkg update 2>&1 | grep -vE "has no valid architecture" || true
        opkg install git git-http 2>&1 | grep -vE "has no valid architecture|Configuring" || true
    fi

    command -v git >/dev/null 2>&1 || fail "Git bootstrap failed — check network connectivity"
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
    git fetch --depth=1 -q origin "$REPO_BRANCH" 2>&1 || {
        warn "Git fetch failed (network issue or private repo)"
        warn "rvr update will not work until this is resolved"
        return 0
    }
    git checkout -b "$REPO_BRANCH" 2>/dev/null || true
    git reset --hard "origin/$REPO_BRANCH" 2>/dev/null || true
    # Save branch for update tracking
    mkdir -p /etc/rvr
    echo "$REPO_BRANCH" > /etc/rvr/branch
    ok "Git repository initialized"
}

#############################################
# PHASE 4: INSTALL L2BRIDGE
#############################################
install_rvr_cli() {
    info "Installing rvr to /usr/bin/..."
    ln -sf "$INSTALL_DIR/robust_virtual_radio" /usr/bin/rvr
    chmod +x "$INSTALL_DIR/robust_virtual_radio"

    if rvr help >/dev/null 2>&1; then
        ok "rvr installed -> $INSTALL_DIR/robust_virtual_radio"
    else
        fail "rvr installation failed"
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

    # Keep tap2tcp binary if it exists
    local tap2tcp_backup=""
    if [ -f "$pkg_dir/common/tap2tcp-aarch64" ]; then
        tap2tcp_backup="/tmp/tap2tcp-aarch64.bak"
        cp "$pkg_dir/common/tap2tcp-aarch64" "$tap2tcp_backup"
    fi

    rm -rf "$pkg_dir/common" "$pkg_dir/gcs" "$pkg_dir/aircraft"
    mkdir -p "$pkg_dir/common" "$pkg_dir/gcs" "$pkg_dir/aircraft"

    # Restore tap2tcp binary
    [ -n "$tap2tcp_backup" ] && [ -f "$tap2tcp_backup" ] && mv "$tap2tcp_backup" "$pkg_dir/common/tap2tcp-aarch64"

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
# RVR v0.4 Offline Package Bundle
# Downloaded: $(date +%Y-%m-%d)
# Source: localhost ($(cat /proc/sys/kernel/hostname 2>/dev/null || echo 'unknown'))
# Architecture: ${arch:-unknown}
# Kernel: ${kernel:-unknown}
#
# common/ - shared dependencies (GCS + Aircraft)
#   tap2tcp-aarch64 (static binary, not .ipk)
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
    echo "    common/:   $common_count packages + tap2tcp binary"
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
    info "Running: rvr setup $aircraft_ip $aircraft_name"
    rvr setup "$aircraft_ip" "$aircraft_name"
}

#############################################
# INTERACTIVE MENU
#############################################
show_menu() {
    while true; do
        echo ""
        echo "=========================================="
        echo "  RVR v0.4 Installer"
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
                install_rvr_cli
                echo ""
                ok "GCS setup complete. Use option 3 for Web UI, option 4 to configure bridge."
                ;;
            2)
                install_packages aircraft
                install_rvr_cli
                echo ""
                ok "Aircraft setup complete. The GCS will configure this device during bridge setup."
                ;;
            3)
                info "Installing Web UI..."
                rvr webui-install
                ;;
            4)
                run_bridge_setup
                ;;
            5)
                refresh_packages
                ;;
            6)
                info "Running uninstall..."
                rvr uninstall
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
echo "  RVR v0.4 Installer"
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
    install_rvr_cli

    # Always install web UI — required for peer discovery endpoint
    if [ -z "$NO_WEBUI" ]; then
        rvr webui-install
    fi

    echo ""
    ok "Installation complete! Run 'rvr help' to get started."
    exit 0
fi

# Interactive: bootstrap git before menu
bootstrap_git
setup_git_repo
install_rvr_cli

# Interactive menu
show_menu
