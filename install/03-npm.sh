#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/defaults.sh"

if [[ -f "${SCRIPT_DIR}/config.env" ]]; then
    source "${SCRIPT_DIR}/config.env"
fi

log_step "Setting up Nginx Proxy Manager"

NPM_DIR="${INSTALL_DIR}/npm"
NPM_DATA="${NPM_DATA:-${NPM_DIR}/data}"
NPM_LE="${NPM_LE:-${NPM_DIR}/letsencrypt}"

mkdir -p "$NPM_DATA" "$NPM_LE"

log_info "Writing NPM docker-compose.yml..."
cat > "${NPM_DIR}/docker-compose.yml" <<'EOF'
version: '3.8'

services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    restart: unless-stopped
    ports:
      - '80:80'
      - '81:81'
      - '443:443'
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:81 || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
EOF

cd "$NPM_DIR"

log_info "Starting Nginx Proxy Manager..."
docker_compose up -d 2>&1

log_info "Waiting for NPM to start..."
if wait_for_http "http://localhost:81" 30; then
    log_success "Nginx Proxy Manager is running"
else
    log_error "NPM did not start within 60 seconds"
    docker_compose logs npm --tail=20
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Nginx Proxy Manager is running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Admin UI:    ${CYAN}http://localhost:81${NC}"
echo -e "  HTTP:        ${CYAN}http://localhost:80${NC}"
echo -e "  HTTPS:       ${CYAN}https://localhost:443${NC}"
echo ""
echo -e "  Default login:"
echo -e "    Email:    ${CYAN}admin@example.com${NC}"
echo -e "    Password: ${CYAN}changeme${NC}"
echo ""
echo -e "  ${YELLOW}Change the default credentials immediately!${NC}"
echo ""
echo -e "  To proxy K2 Analytics through NPM:"
echo -e "    1. Add a Proxy Host"
echo -e "    2. Domain: ${CERT_DOMAIN}"
echo -e "    3. Forward to: http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo -e "    4. Enable SSL (Let's Encrypt or use self-signed cert)"
echo ""