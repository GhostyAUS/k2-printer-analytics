#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/defaults.sh"

if [[ -f "${SCRIPT_DIR}/config.env" ]]; then
    source "${SCRIPT_DIR}/config.env"
fi

log_step "Deploying K2 Analytics"

cd "$INSTALL_DIR"

log_info "Checking for port conflicts..."
for port in "$API_PORT" "$APP_PORT"; do
    if check_port "$port"; then
        PID=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | head -1)
        log_error "Port $port is already in use (PID: ${PID:-unknown})"
        log_error "Stop the conflicting service or change the port in docker-compose.override.yml"
        exit 1
    fi
done
log_success "Ports $API_PORT and $APP_PORT are available"

log_info "Building and starting containers..."
docker_compose up -d --build 2>&1

log_info "Waiting for database to be ready..."
for i in $(seq 1 30); do
    if docker_compose exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" &>/dev/null; then
        log_success "Database is ready"
        break
    fi
    if (( i == 30 )); then
        log_error "Database did not become ready within 60 seconds"
        docker_compose logs db --tail=20
        exit 1
    fi
    sleep 2
done

log_info "Waiting for backend API..."
if wait_for_http "http://localhost:${API_PORT}/api/v1/health" 30; then
    log_success "Backend API is responding"
else
    log_error "Backend API did not start within 60 seconds"
    log_info "Last 30 log lines:"
    docker_compose logs backend --tail=30
    exit 1
fi

log_info "Waiting for frontend..."
if wait_for_http "http://localhost:${APP_PORT}" 30; then
    log_success "Frontend is responding"
else
    log_error "Frontend did not start within 60 seconds"
    docker_compose logs frontend --tail=30
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  K2 Analytics is running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  Frontend:  ${CYAN}http://localhost:${APP_PORT}${NC}"
echo -e "  Backend:   ${CYAN}http://localhost:${API_PORT}${NC}"
echo -e "  API Docs:  ${CYAN}http://localhost:${API_PORT}/docs${NC}"
echo ""

if [[ "${MOONRAKER_HOST}" != "" ]]; then
    if curl -sf -o /dev/null --connect-timeout 3 "http://${MOONRAKER_HOST}:${MOONRAKER_PORT}/printer/info" 2>/dev/null; then
        echo -e "  Printer:   ${GREEN}Connected to Moonraker at ${MOONRAKER_HOST}:${MOONRAKER_PORT}${NC}"
    else
        echo -e "  Printer:   ${YELLOW}Moonraker not reachable at ${MOONRAKER_HOST}:${MOONRAKER_PORT}${NC}"
        echo -e "             ${YELLOW}Configure via Settings UI after login${NC}"
    fi
fi

echo ""
echo -e "  ${CYAN}First time? Visit http://localhost:${APP_PORT}/setup${NC}"
echo ""