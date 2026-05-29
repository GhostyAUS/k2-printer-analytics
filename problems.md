# K2 Printer Analytics — Problems & Solutions

## Resolved ✅

| # | Problem | Solution |
|---|---------|----------|
| P1 | PrintStatus `.name` stored uppercase enum names in DB | Changed Python enum values to uppercase to match DB; fixed all mapping code |
| P2 | Historical costs missing | Backfilled: 151W avg power + $24/kg filament for 421 jobs via SQL |
| P3 | `create_print_job` missing `filament_used_g` | Added to service constructor |
| P4 | `PrintJobCreate` schema missing fields | Added `end_time`, `actual_duration_seconds`, `filament_used_g`, `filament_length_mm`, `filament_type` |
| P5 | MoonrakerClient singleton ignored config | Now passes `settings.moonraker_host`/`port`; added missing import |
| P6 | Docker env var `ELECTRICITY_RATE_PER_KWH` didn't match `ELECTRICITY_RATE_KWH` | Fixed in docker-compose.yml |
| P7 | Docker health check `/health` → `/api/v1/health` | Fixed endpoint path |
| P8 | SystemHealth used raw `fetch()` | Switched to axios `api` instance |
| P9 | Dashboard hardcoded `0.49` electricity rate | Now fetches from settings API |
| P10 | `_on_print_end` no guard for None `active_job_id` | Added early return |
| P11 | Density always fell back to PLA | Now parses material from filename, looks up correct density key |
| P12 | DB enum values uppercase, code expected lowercase | Changed Python enum values to uppercase to match existing DB data |
| P13 | `datetime.utcnow()` deprecated (Python 3.12+) | Replaced all with `datetime.now(timezone.utc)` across models + services |
| P15 | `filament_type` not in model/schema | Added column, schema fields, backfilled 438 jobs from filename parsing |
| P18 | Backend `--reload` in production Dockerfile | Removed flag |
| P19 | Dead code (unused charts/hooks) | Deleted 6 files |
| P20 | `analytics_service.py` wrong status strings | Rewrote to use `PrintStatus.COMPLETE` enum; removed dead `get_material_efficiency` |
| P22 | Settings page only 8 CFS slots | Now generates all 16 (T1A-T4D) |

---

## Active / Deferred

### P14: Shared aiohttp.ClientSession across routes
- **Severity**: MEDIUM → **RESOLVED ✅**
- **Solution**: Created shared `aiohttp.ClientSession` in lifespan handler, stored on `app.state.http_session`. All routes (cfs, system, history) now use `request.app.state.http_session` instead of creating new sessions per request.

### P16: No authentication on endpoints
- **Severity**: LOW (local network tool)
- **Problem**: Anyone on network can read/modify everything.
- **Solution options**:
  1. **API key middleware** (recommended): Env var `API_KEY`, FastAPI middleware checks `X-API-Key` header or `?api_key=` param. Frontend stores key in localStorage.
  2. **Basic auth**: Username/password via HTTP Basic. Simpler but less flexible.
  3. **Skip**: Acceptable for trusted local network.
- **Implementation**: 15-line middleware + env var + frontend login prompt.

### P17: Frontend uses dev server in production Docker
- **Severity**: LOW
- **Problem**: `npm run dev` (Vite dev server) runs in production container. nginx.conf exists but unused and has wrong ports.
- **Solution options**:
  1. **Multi-stage build** (recommended): Stage 1 builds with node, Stage 2 serves with nginx. nginx proxies `/api` to backend.
  2. **Keep dev server**: Works fine for a small local tool. Not production-grade but functional.
- **Implementation**:
  ```dockerfile
  # Stage 1: Build
  FROM node:18-alpine AS build
  WORKDIR /app
  COPY package.json ./
  RUN npm install
  COPY . .
  RUN npm run build
  
  # Stage 2: Serve
  FROM nginx:alpine
  COPY --from=build /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  ```
  nginx.conf needs: `proxy_pass http://backend:8000;` for `/api/`.

### P21: Frontend WebSocket hook broken + unused
- **Severity**: LOW → **RESOLVED ✅**
- **Solution**: Deleted `usePrinterWebSocket.ts`.

### P23: PowerLog timestamp timezone consistency
- **Severity**: LOW
- **Problem**: Stored as naive `DateTime` in PostgreSQL. Code does `.replace(tzinfo=timezone.utc)` for comparison which works if all values are consistently naive UTC, but is fragile.
- **Solution options**:
  1. **Use `TIMESTAMP WITH TIME ZONE`** (proper): Change SQLAlchemy to `DateTime(timezone=True)`. Requires DB migration.
  2. **Keep naive UTC consistently** (pragmatic): Ensure all code writes naive UTC, strip tzinfo before comparison. Current approach works.
- **Recommendation**: Option 2 for now — works correctly, no migration needed.

### P24: Exposed Meross credentials in .env
- **Severity**: CRITICAL (but local-only deployment)
- **Problem**: Real cloud credentials in plaintext `.env` file.
- **Solution**: `.env` is in `.gitignore`. For Docker, move credentials to docker-compose `environment:` section instead of `env_file:`. Rotate the Meross password since it appeared in conversation context.
