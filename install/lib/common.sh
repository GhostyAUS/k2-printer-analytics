#!/usr/bin/env bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()    { echo -e "\n${CYAN}====> $* ${NC}"; }

require_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (or with sudo)"
        exit 1
    fi
}

detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS_ID="${ID}"
        OS_VERSION="${VERSION_ID}"
        OS_NAME="${PRETTY_NAME}"
    elif [[ -f /etc/debian_version ]]; then
        OS_ID="debian"
        OS_VERSION=$(cat /etc/debian_version | cut -d. -f1)
        OS_NAME="Debian $(cat /etc/debian_version)"
    else
        OS_ID="unknown"
        OS_VERSION="0"
        OS_NAME="Unknown"
    fi
    export OS_ID OS_VERSION OS_NAME
}

pkg_manager() {
    case "$OS_ID" in
        ubuntu|debian|linuxmint|pop)
            echo "apt"
            ;;
        centos|rhel|rocky|alma|fedora)
            echo "dnf"
            ;;
        arch|manjaro|endeavouros)
            echo "pacman"
            ;;
        opensuse*|sles)
            echo "zypper"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

pkg_update() {
    case "$(pkg_manager)" in
        apt)  apt-get update -qq ;;
        dnf)  dnf check-update -q ;;
        pacman) pacman -Sy --noconfirm ;;
        zypper) zypper refresh -q ;;
    esac
}

pkg_install() {
    local pkgs="$*"
    case "$(pkg_manager)" in
        apt)    apt-get install -y -qq $pkgs ;;
        dnf)    dnf install -y -q $pkgs ;;
        pacman) pacman -S --noconfirm --needed $pkgs ;;
        zypper) zypper install -y --quiet $pkgs ;;
        *)
            log_error "Unsupported package manager for: $pkgs"
            return 1
            ;;
    esac
}

pkg_installed() {
    command -v "$1" &>/dev/null
}

check_port() {
    local port="$1"
    if ss -tlnp 2>/dev/null | grep -q ":${port} " || \
       netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
        return 0
    fi
    return 1
}

wait_for_http() {
    local url="$1"
    local max_attempts="${2:-30}"
    local attempt=1
    while (( attempt <= max_attempts )); do
        if curl -sf -o /dev/null "$url" 2>/dev/null; then
            return 0
        fi
        log_info "Waiting for $url... (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    return 1
}

validate_ip() {
    local ip="$1"
    if [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        local IFS='.'
        read -ra octets <<< "$ip"
        for octet in "${octets[@]}"; do
            if ((octet > 255)); then
                return 1
            fi
        done
        return 0
    fi
    return 1
}

validate_port() {
    local port="$1"
    if [[ "$port" =~ ^[0-9]+$ ]] && ((port >= 1 && port <= 65535)); then
        return 0
    fi
    return 1
}

docker_compose() {
    if command -v docker &>/dev/null; then
        if docker compose version &>/dev/null 2>&1; then
            docker compose "$@"
        elif command -v docker-compose &>/dev/null; then
            docker-compose "$@"
        else
            log_error "Neither 'docker compose' nor 'docker-compose' found"
            return 1
        fi
    else
        log_error "Docker is not installed"
        return 1
    fi
}

check_deps() {
    local missing=()
    for cmd in curl git; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done
    if (( ${#missing[@]} > 0 )); then
        log_info "Installing missing dependencies: ${missing[*]}"
        pkg_install "${missing[@]}"
    fi
}