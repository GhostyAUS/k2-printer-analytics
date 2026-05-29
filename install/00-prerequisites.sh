#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/defaults.sh"

log_step "Installing prerequisites"

require_root
detect_os
log_info "Detected OS: $OS_NAME"

PKG_MGR=$(pkg_manager)
if [[ "$PKG_MGR" == "unknown" ]]; then
    log_error "Unsupported OS: $OS_NAME"
    log_error "Supported: Ubuntu, Debian, CentOS, Rocky, Alma, Fedora, Arch, Manjaro, openSUSE"
    exit 1
fi

log_info "Using package manager: $PKG_MGR"

log_info "Updating package indexes..."
pkg_update

log_info "Installing base dependencies..."
case "$PKG_MGR" in
    apt)
        pkg_install curl git wget ca-certificates gnupg lsb-release apt-transport-https
        ;;
    dnf)
        pkg_install curl git wget ca-certificates gnupg
        ;;
    pacman)
        pkg_install curl git wget ca-certificates gnupg
        ;;
    zypper)
        pkg_install curl git wget ca-certificates gpg2
        ;;
esac

check_deps

if pkg_installed docker; then
    log_success "Docker is already installed: $(docker --version)"
else
    log_info "Installing Docker..."
    case "$PKG_MGR" in
        apt)
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/${OS_ID}/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${OS_ID} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
            apt-get update -qq
            pkg_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        dnf)
            pkg_install dnf-plugins-core
            dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
            ;;
        pacman)
        pacman -Sy --noconfirm archlinux-keyring
        pacman -S --noconfirm docker docker-compose
        ;;
        zypper)
        zypper addrepo https://download.docker.com/linux/opensuse/docker-ce.repo
        zypper install -y docker docker-cli containerd docker-compose
        ;;
    esac

    systemctl enable docker
    systemctl start docker
    log_success "Docker installed: $(docker --version)"
fi

if ! docker compose version &>/dev/null 2>&1 && ! command -v docker-compose &>/dev/null; then
    log_error "Docker Compose plugin not found. Installing..."
    case "$PKG_MGR" in
        apt)  pkg_install docker-compose-plugin ;;
        dnf)  dnf install -y docker-compose-plugin ;;
        pacman) pacman -S --noconfirm docker-compose ;;
        zypper) zypper install -y docker-compose ;;
    esac
fi
log_success "Docker Compose: $(docker compose version 2>/dev/null || docker-compose --version)"

if systemctl is-active --quiet docker && systemctl is-enabled --quiet docker; then
    log_success "Docker daemon is running and enabled on boot"
else
    log_warn "Docker daemon not running — attempting to start..."
    systemctl enable docker
    systemctl start docker
fi

if id "k2admin" &>/dev/null 2>&1; then
    log_success "User k2admin already exists"
else
    log_info "Creating service user 'k2admin'..."
    useradd -r -s /bin/bash -d "$INSTALL_DIR" k2admin 2>/dev/null || true
    usermod -aG docker k2admin
    log_success "User k2admin created and added to docker group"
fi

log_success "Prerequisites installation complete"