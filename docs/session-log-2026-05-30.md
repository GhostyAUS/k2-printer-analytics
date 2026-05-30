# K2 Analytics — Session Log (2026-05-30)

## OVERVIEW — Project Purpose
Full-stack analytics platform for Creality K2 printers running Klipper/Moonraker. PostgreSQL + FastAPI backend, React/Vite/TypeScript frontend, Docker Compose deployment. Live monitoring, cost tracking, filament management, file browsing.

## DEPLOYMENT — Infrastructure
- **Proxmox host**: `ailab` at 192.168.1.248, CT 104 IP: 192.168.1.203
- **Deploy command**: `tar czf - --exclude=node_modules --exclude=__pycache__ --exclude=.git backend frontend docker-compose.yml | ssh root@192.168.1.248 "pct exec 104 -- bash -c 'cd /root/k2-printer-analytics && rm -rf backend frontend && tar xzf - && docker compose up -d --build'"`
- **Frontend**: port 3000 (Docker, Vite dev server proxying `/api` → backend:8000)
- **Backend**: port 8000
- **Database**: PostgreSQL `k2user:k2pass@db:5432/k2_analytics`, 448 print jobs (359 complete, 86 cancelled, 2 failed, 1 printing)
- **GitHub**: https://github.com/GhostyAUS/k2-printer-analytics

## MOONRAKER — Dynamic Configuration
- Moonraker default: 192.168.1.146:7125
- Host/port stored in `app_config` DB table, read dynamically via `_get_moonraker_url(db)` or `_get_moonraker_config(db)`
- Falls back to `.env` values if no DB row exists
- Settings UI saves Moonraker host/port, triggers `_update_moonraker_service()` to recreate `MoonrakerClient`
- Files affected: `cfs.py`, `system.py`, `history.py`, `analytics.py`, `files.py`, `moonraker.py`, `print_tracker.py`
- Removed all hardcoded `MOONRAKER_URL` constants — every route now reads from DB with env fallback

## MEROSS — Dynamic Credentials
- Meross email/password/device_name/device_uuid stored in `app_config` DB
- Settings UI "Connection" section has save + reconnect buttons
- `PUT /api/v1/settings/connection` resets Meross service (`_ready=False, _device=None, _manager=None, _client=None`) and reconfigures Moonraker
- Backend: `settings.py` lines 82-118

## CORS — Dynamic Origin Reflection
- Replaced static `CORSMiddleware` with custom `DynamicCORSMiddleware` in `main.py`
- Handles preflight OPTIONS with `Access-Control-Allow-Origin: <request origin>`
- Mirrors `Origin` header back in response (required for `credentials: true` to work across hosts)
- Removed `fastapi.middleware.cors.CORSMiddleware` import — no longer used

## AISESSION — Session Recovery Pattern
- `aiohttp.ClientSession` created in `lifespan()` on `app.state.http_session`
- `_get_session(request)` helper in `cfs.py`, `system.py`, `history.py`, `analytics.py` checks `session.closed`, recreates if needed
- Prevents "Session is closed" errors after container restart

## SETTINGS — Backend API Sections
- `GET /api/v1/settings` — returns all config key-values with defaults
- `PUT /api/v1/settings/{key}` — update single key
- `DELETE /api/v1/settings/{key}` — reset to default
- `PUT /api/v1/settings/connection` — batch save Moonraker/Meross config, triggers service reconnect
- `GET /api/v1/settings/setup/status` — checks Moonraker reachability, returns connection state (used by Setup Wizard)
- `GET /api/v1/settings/notifications/config` — notification webhook config
- `PUT /api/v1/settings/notifications/config` — update webhook toggles

## SETTINGS — Frontend Connection Section
- Settings page now has two top cards: Printer Connection (Moonraker IP/port + Test button) and Meross Power Plug (email/password/device/UUID)
- `InputField` component added at bottom of Settings.tsx — reusable labeled input
- `fetchSetupStatus()` and `saveConnection()` added to `api/index.ts`

## SETUP-WIZARD — First-Run Flow
- New `SetupWizard.tsx` page with 2 steps
- Step 1: Enter Moonraker IP/port, Test Connection button, next only if connected
- Step 2: Optional Meross credentials, skip checkbox
- Calls `saveConnection()` on finish, then reloads page
- Route: `/setup` (outside Layout, no sidebar)
- Backend: `GET /api/v1/settings/setup/status` returns `{configured, moonraker_host, moonraker_port, moonraker_connected, meross_configured}`

## PRINT-STATUS — Enum Convention
- PrintStatus enum values stored UPPERCASE in DB: `COMPLETE`, `CANCELLED`, `PRINTING`, `FAILED`

## DATETIME — Timezone-Aware UTC
- All `datetime.utcnow()` → `datetime.now(timezone.utc)` throughout codebase

## BACKEND — Dockerfile
- No `--reload` flag in Dockerfile (production build)

## POWER-COST — Calculation Rules
- Power rate: $0.49/kWh AUD (configurable via settings)
- Electricity cost computed from actual `power_logs` on job completion
- 151W fallback used for historical jobs without power data
- Filament cost: CFS override `cost_per_kg` > `FilamentRoll.cost_per_kg` > settings default $24/kg

## FILAMENT — Auto-Decrement and Metadata
- `_decrement_filament_roll()` in `print_tracker.py` matches roll by material type, subtracts `filament_used_g` from `remaining_weight_g`
- `estimated_filament_g` + `filament_type` columns on `print_jobs`
- `filament_type` parsed from filename for all jobs (438/448 matched)

## NOTIFICATIONS — Webhook System
- Settings UI: webhook URL + toggles for on_complete/on_failed/on_cancelled
- `_send_notification()` in `print_tracker.py` POSTs JSON payload on print end

## MAINTENANCE — Tracker
- Nozzle clean (500h), belt check (1000h), bearing lube (2000h)
- Stored in `app_config`, progress bars on Dashboard, "Done" button resets counter

## ANALYTICS — Endpoints and Features
- `/api/v1/analytics/summary` — total prints, cost, filament kg, hours, avg cost, success rate, month/week breakdowns, projected monthly cost, low stock roll count
- `/api/v1/analytics/power-history` — last 60 min power readings
- `/api/v1/analytics/monthly-trend` — monthly cost/time breakdown
- `/api/v1/analytics/slicer-accuracy` — estimated vs actual for completed jobs
- `/api/v1/analytics/export/csv` — CSV download of all jobs with costs
- `/api/v1/analytics/queue` — Moonraker job queue
- `/api/v1/analytics/maintenance` — maintenance tracker with reset

## PRINT-JOBS — Paginated Table
- Server-side pagination via `/api/v1/jobs/paginated`
- Sorting on all columns including `total_cost` (computed field)
- Status filter tabs, search, expandable rows

## COMPARE — Print Comparison Page
- `/compare` — select two jobs, side-by-side table with percentage difference
- Green (≤5%), amber (≤20%), red (>20%) highlighting

## FILES — Moonraker File Browser
- `/api/v1/files/list` — lists gcodes from Moonraker
- `/api/v1/files/metadata` — file details with estimated time, filament, cost
- `/api/v1/files/thumbnail` — thumbnail path
- Frontend: sortable/searchable table, click for metadata panel

## CAMERA — Live Stream
- Defaults to `http://192.168.1.146:8000/stream`
- Test button, helpful error when camera not enabled
- K2 built-in camera currently returns 0-byte responses (needs enabling in printer touchscreen Settings → Camera)

## WEBSOCKET — Real-Time Updates
- `useMoonrakerWS.ts` hook with auto-reconnect and exponential backoff
- Backend websocket at `/api/v1/ws`

## MOBILE — Responsive Layout
- Sidebar collapses off-screen with hamburger menu
- `onNavigate` callback closes menu
- Header: menu toggle, dynamic page name, printer status, power reading

## APP-CONFIG — Database Settings Table
- Stores: electricity_rate_kwh, currency, densities, filament settings, moonraker_host/port, meross credentials, maintenance intervals, notification config
- `DEFAULTS` dict in `settings.py` provides fallback values

## BUGFIX — CFS/Spools Blank Page
- Root cause: `aiohttp.ClientSession` closed after container restart
- Fix: `_get_session()` helper in cfs.py, system.py, history.py, analytics.py recreates session if closed

## INSTALLER — Bootstrap System
- `install/master.sh` — entry point, parses CLI flags and env vars, calls scripts in order
- `install/lib/common.sh` — logging, OS detection (apt/dnf/pacman/zypper), package install, port checks, HTTP wait, IP validation, `docker_compose` wrapper
- `install/lib/defaults.sh` — all configurable defaults as env vars
- `install/00-prerequisites.sh` — installs Docker, Docker Compose, git, creates k2admin user
- `install/01-configure.sh` — clones repo, generates `.env`, writes `docker-compose.override.yml`, validates Moonraker reachability
- `install/02-deploy.sh` — `docker compose up -d --build`, waits for DB/API/frontend health, prints access URLs
- `install/03-npm.sh` — optional Nginx Proxy Manager in its own docker-compose
- `install/04-certs.sh` — optional self-signed TLS cert (openssl, SANs for domain+localhost+IP)
- Flags: `--moonraker-host`, `--meross-email`, `--with-npm`, `--self-signed-cert`, `--dry-run`, `--skip-prerequisites`, etc.

## BLOCKED — Known Issues
- K2 built-in camera: Creality module responds on port 8000 but returns 0-byte responses; needs enabling in printer touchscreen Settings → Camera

## KEY-DECISIONS — Architecture Choices
- Progress: uses `display_status.progress` (M73) as primary source
- Time remaining: prefers slicer `metadata.estimated_time` over calculation
- `estimated_filament_g`: stored at job creation from gcode metadata
- Power cost: uses actual `power_logs` on completion; 151W fallback for historical jobs
- Filament cost: CFS override > FilamentRoll.cost_per_kg > settings $24/kg
- Sortable/filterable tables: server-side pagination for PrintJobs (448 jobs), client-side for Analytics/FilamentLibrary
- Filament Library and Spools/CFS are separate pages: Library = stock inventory, Spools = live CFS data