#!/usr/bin/env bash
set -euo pipefail

VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/defaults.sh"

usage() {
    cat <<EOF
K2 Analytics Installer v${VERSION}

Usage: $(basename "$0") [OPTIONS]

Options:
  --moonraker-host HOST     Moonraker IP address (default: ${MOONRAKER_HOST})
  --moonraker-port PORT     Moonraker port (default: ${MOONRAKER_PORT})
  --meross-email EMAIL     Meross account email
  --meross-password PASS   Meross account password
  --meross-device NAME     Meross device name (default: ${MEROSS_DEVICE_NAME})
  --meross-uuid UUID       Meross device UUID
  --electricity-rate RATE  Cost per kWh (default: ${ELECTRICITY_RATE})
  --timezone TZ            Timezone (default: ${TIMEZONE})
  --currency CODE          Currency code (default: ${CURRENCY})
  --app-port PORT          Frontend port (default: ${APP_PORT})
  --api-port PORT          Backend API port (default: ${API_PORT})
  --install-dir DIR        Installation directory (default: ${INSTALL_DIR})
  --repo-url URL           Git repository URL (default: ${REPO_URL})
  --repo-branch BRANCH     Git branch (default: ${REPO_BRANCH})
  --with-npm               Install Nginx Proxy Manager
  --self-signed-cert       Generate self-signed TLS certificate
  --cert-domain DOMAIN     Domain for certificate (default: ${CERT_DOMAIN})
  --skip-prerequisites     Skip Docker/git installation (assume installed)
  --skip-deploy            Skip container deployment (config only)
  --dry-run                Show configuration and exit without changes
  -h, --help               Show this help message

Examples:
  # Full install with defaults
  sudo ./install/master.sh

  # Custom Moonraker host
  sudo ./install/master.sh --moonraker-host 10.0.0.50

  # Full install with NPM and custom timezone
  sudo ./install/master.sh --moonraker-host 10.0.0.50 --timezone America/New_York --with-npm

  # Dry run to see what would happen
  ./install/master.sh --moonraker-host 10.0.0.50 --dry-run

Environment variables:
  All options can also be set as environment variables (see install/lib/defaults.sh)
EOF
    exit 0
}

SKIP_PREREQUISITES=false
SKIP_DEPLOY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --moonraker-host)   MOONRAKER_HOST="$2"; shift 2 ;;
        --moonraker-port)   MOONRAKER_PORT="$2"; shift 2 ;;
        --meross-email)     MEROSS_EMAIL="$2"; shift 2 ;;
        --meross-password)  MEROSS_PASSWORD="$2"; shift 2 ;;
        --meross-device)    MEROSS_DEVICE_NAME="$2"; shift 2 ;;
        --meross-uuid)      MEROSS_DEVICE_UUID="$2"; shift 2 ;;
        --electricity-rate) ELECTRICITY_RATE="$2"; shift 2 ;;
        --timezone)         TIMEZONE="$2"; shift 2 ;;
        --currency)         CURRENCY="$2"; shift 2 ;;
        --app-port)         APP_PORT="$2"; shift 2 ;;
        --api-port)         API_PORT="$2"; shift 2 ;;
        --install-dir)      INSTALL_DIR="$2"; shift 2 ;;
        --repo-url)         REPO_URL="$2"; shift 2 ;;
        --repo-branch)      REPO_BRANCH="$2"; shift 2 ;;
        --with-npm)         INSTALL_NPM="true"; shift ;;
        --self-signed-cert) SELF_SIGNED_CERT="true"; shift ;;
        --cert-domain)      CERT_DOMAIN="$2"; shift 2 ;;
        --skip-prerequisites) SKIP_PREREQUISITES="true"; shift ;;
        --skip-deploy)      SKIP_DEPLOY="true"; shift ;;
        --dry-run)          DRY_RUN="true"; shift ;;
        -h|--help)          usage ;;
        *) log_error "Unknown option: $1"; usage ;;
    esac
done

export MOONRAKER_HOST MOONRAKER_PORT APP_PORT API_PORT DB_NAME DB_USER DB_PASS \
       ELECTRICITY_RATE CURRENCY TIMEZONE MEROSS_EMAIL MEROSS_PASSWORD \
       MEROSS_DEVICE_NAME MEROSS_DEVICE_UUID INSTALL_DIR REPO_URL REPO_BRANCH \
       INSTALL_NPM SELF_SIGNED_CERT CERT_DOMAIN CERT_DAYS

echo -e "${CYAN}"
echo -e "  K2 Analytics Installer v${VERSION}"
echo ""

detect_os
log_info "OS: $OS_NAME"

if ! validate_ip "$MOONRAKER_HOST"; then
    log_error "Invalid Moonraker IP: $MOONRAKER_HOST"
    exit 1
fi
if ! validate_port "$MOONRAKER_PORT"; then
    log_error "Invalid Moonraker port: $MOONRAKER_PORT"
    exit 1
fi

echo -e "${BLUE}Configuration:${NC}"
echo -e "  Moonraker:        ${MOONRAKER_HOST}:${MOONRAKER_PORT}"
echo -e "  Install dir:      ${INSTALL_DIR}"
echo -e "  API port:         ${API_PORT}"
echo -e "  Frontend port:    ${APP_PORT}"
echo -e "  Electricity rate:  ${ELECTRICITY_RATE} ${CURRENCY}/kWh"
echo -e "  Timezone:         ${TIMEZONE}"
echo -e "  Meross email:     ${MEROSS_EMAIL:-(not configured)}"
echo -e "  Install NPM:      ${INSTALL_NPM}"
echo -e "  Self-signed cert: ${SELF_SIGNED_CERT}"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    log_info "Dry run — no changes made. Exiting."
    exit 0
fi

require_root

if [[ "$SKIP_PREREQUISITES" != "true" ]]; then
    bash "${SCRIPT_DIR}/00-prerequisites.sh"
else
    log_info "Skipping prerequisites (--skip-prerequisites)"
fi

bash "${SCRIPT_DIR}/01-configure.sh"

if [[ "$SELF_SIGNED_CERT" == "true" ]]; then
    bash "${SCRIPT_DIR}/04-certs.sh"
fi

if [[ "$SKIP_DEPLOY" != "true" ]]; then
    bash "${SCRIPT_DIR}/02-deploy.sh"
else
    log_info "Skipping deployment (--skip-deploy)"
fi

if [[ "$INSTALL_NPM" == "true" ]]; then
    bash "${SCRIPT_DIR}/03-npm.sh"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Dashboard:   ${CYAN}http://localhost:${APP_PORT}${NC}"
echo -e "  Setup wizard: ${CYAN}http://localhost:${APP_PORT}/setup${NC}"
echo -e "  API:         ${CYAN}http://localhost:${API_PORT}/docs${NC}"
echo ""

if [[ "$INSTALL_NPM" == "true" ]]; then
    echo -e "  NPM admin:   ${CYAN}http://localhost:${NPM_PORT}${NC}"
    echo -e "               ${YELLOW}Login: admin@example.com / changeme${NC}"
    echo ""
fi

echo -e "  ${YELLOW}Next steps:${NC}"
if [[ "$MEROSS_EMAIL" == "" ]]; then
    echo -e "  - Configure Meross credentials in Settings UI"
fi
echo -e "  - Visit the setup wizard to test your printer connection"
if [[ "$INSTALL_NPM" == "true" ]]; then
    echo -e "  - Configure NPM proxy host for ${CERT_DOMAIN}"
    echo -e "  - Set up DNS to point ${CERT_DOMAIN} to this server"
fi
echo ""