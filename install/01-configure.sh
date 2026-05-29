#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/defaults.sh"

log_step "Configuring K2 Analytics"

if [[ ! -d "$INSTALL_DIR" ]]; then
    log_info "Cloning repository into $INSTALL_DIR..."
    git clone -b "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
    log_success "Repository cloned"
else
    log_info "Install directory $INSTALL_DIR already exists — pulling latest..."
    git -C "$INSTALL_DIR" pull origin "$REPO_BRANCH" 2>/dev/null || true
fi

cd "$INSTALL_DIR"

mkdir -p data

log_info "Generating .env configuration..."

cat > .env <<EOF
# Database Configuration
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@db:${DB_PORT}/${DB_NAME}

# Moonraker Configuration
MOONRAKER_HOST=${MOONRAKER_HOST}
MOONRAKER_PORT=${MOONRAKER_PORT}

# Meross Configuration
MEROSS_EMAIL=${MEROSS_EMAIL}
MEROSS_PASSWORD=${MEROSS_PASSWORD}
MEROSS_DEVICE_NAME=${MEROSS_DEVICE_NAME}
MEROSS_DEVICE_UUID=${MEROSS_DEVICE_UUID}

# Power Monitoring
ELECTRICITY_RATE_KWH=${ELECTRICITY_RATE}
TIMEZONE=${TIMEZONE}
CURRENCY=${CURRENCY}

# Application
APP_NAME=K2 Analytics API
DEBUG=False
EOF

chmod 600 .env
log_success ".env written with permissions 600"

log_info "Validating Moonraker connectivity at ${MOONRAKER_HOST}:${MOONRAKER_PORT}..."
MOONRAKER_URL="http://${MOONRAKER_HOST}:${MOONRAKER_PORT}"
if curl -sf -o /dev/null --connect-timeout 5 "${MOONRAKER_URL}/printer/info" 2>/dev/null; then
    log_success "Moonraker reachable at ${MOONRAKER_URL}"
else
    log_warn "Cannot reach Moonraker at ${MOONRAKER_URL}"
    log_warn "The app will start but printer features will be unavailable until Moonraker is reachable."
    log_warn "You can reconfigure the Moonraker host/port later via Settings UI."
fi

log_info "Generating docker-compose.override.yml..."
OVERRIDE_FILE="docker-compose.override.yml"

if [[ "$SELF_SIGNED_CERT" == "true" ]]; then
cat > "$OVERRIDE_FILE" <<EOF
services:
  backend:
    environment:
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@db:${DB_PORT}/${DB_NAME}
      - MOONRAKER_HOST=${MOONRAKER_HOST}
      - MOONRAKER_PORT=${MOONRAKER_PORT}
      - POWER_POLL_INTERVAL=5
      - ELECTRICITY_RATE_KWH=${ELECTRICITY_RATE}
      - TZ=${TIMEZONE}
    volumes:
      - ./data:/app/data
      - ./certs:/app/certs:ro
  frontend:
    environment:
      - VITE_API_URL=http://${MOONRAKER_HOST}:${API_PORT}
EOF
else
cat > "$OVERRIDE_FILE" <<EOF
services:
  backend:
    environment:
      - DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@db:${DB_PORT}/${DB_NAME}
      - MOONRAKER_HOST=${MOONRAKER_HOST}
      - MOONRAKER_PORT=${MOONRAKER_PORT}
      - POWER_POLL_INTERVAL=5
      - ELECTRICITY_RATE_KWH=${ELECTRICITY_RATE}
      - TZ=${TIMEZONE}
    volumes:
      - ./data:/app/data
  frontend:
    environment:
      - VITE_API_URL=http://${MOONRAKER_HOST}:${API_PORT}
EOF
fi

log_success "Configuration written"

log_info "Writing config state for other scripts..."
cat > "${SCRIPT_DIR}/config.env" <<CONFEOF
INSTALL_DIR=${INSTALL_DIR}
MOONRAKER_HOST=${MOONRAKER_HOST}
MOONRAKER_PORT=${MOONRAKER_PORT}
APP_PORT=${APP_PORT}
API_PORT=${API_PORT}
INSTALL_NPM=${INSTALL_NPM}
SELF_SIGNED_CERT=${SELF_SIGNED_CERT}
CERT_DOMAIN=${CERT_DOMAIN}
REPO_URL=${REPO_URL}
REPO_BRANCH=${REPO_BRANCH}
CONFEOF

log_success "Configuration complete"