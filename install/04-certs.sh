#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/defaults.sh"

if [[ -f "${SCRIPT_DIR}/config.env" ]]; then
    source "${SCRIPT_DIR}/config.env"
fi

log_step "Generating self-signed TLS certificate"

CERT_DIR="${INSTALL_DIR}/certs"
mkdir -p "$CERT_DIR"

if command -v openssl &>/dev/null; then
    log_success "OpenSSL found"
else
    log_info "Installing openssl..."
    pkg_install openssl
fi

HOST_IP=$(hostname -I | awk '{print $1}')

log_info "Generating self-signed certificate for ${CERT_DOMAIN} (${HOST_IP})..."

openssl req -x509 -nodes -days "${CERT_DAYS}" -newkey rsa:2048 \
    -keyout "${CERT_DIR}/server.key" \
    -out "${CERT_DIR}/server.crt" \
    -subj "/C=AU/ST=WA/L=Perth/O=K2Analytics/CN=${CERT_DOMAIN}" \
    -addext "subjectAltName=DNS:${CERT_DOMAIN},DNS:localhost,IP:${HOST_IP},IP:127.0.0.1" \
    2>/dev/null

chmod 640 "${CERT_DIR}/server.key"
chmod 644 "${CERT_DIR}/server.crt"

log_success "Certificate generated:"
log_success "  Cert: ${CERT_DIR}/server.crt"
log_success "  Key:  ${CERT_DIR}/server.key"
log_success "  Valid for ${CERT_DAYS} days"
log_success "  SANs: ${CERT_DOMAIN}, localhost, ${HOST_IP}"

if [[ -f "${INSTALL_DIR}/docker-compose.override.yml" ]]; then
    log_info "Verifying certs volume mount in docker-compose.override.yml..."
    if grep -q "certs" "${INSTALL_DIR}/docker-compose.override.yml"; then
        log_success "Certs volume mount already configured"
    else
        log_warn "Certs volume mount not found — add to docker-compose.override.yml:"
        log_warn "  volumes:"
        log_warn "    - ./certs:/app/certs:ro"
    fi
fi

echo ""
echo -e "  ${CYAN}Self-signed certificate generated.${NC}"
echo -e "  ${YELLOW}Browsers will show a security warning.${NC}"
echo -e "  ${YELLOW}For production, use NPM + Let's Encrypt for trusted SSL.${NC}"
echo ""