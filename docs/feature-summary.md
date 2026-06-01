# K2 Analytics — Feature Summary & Outstanding Work

## Features — Complete

### Dashboard
- Live print progress with M73 display_status
- Power usage graph (last 60 min, updates every 10s)
- KPI cards: total prints, cost, filament kg, hours, avg cost/print, success rate, projected monthly cost
- CFS slot overview (compact card with active slot + mini grid, links to Filament Library)
- Print queue display when jobs are queued
- Low stock filament warnings (<20%)
- Maintenance progress bars (nozzle, belt, bearing) with reset buttons

### Print Jobs
- Server-side paginated table (448 jobs)
- Sorting on all columns including computed `total_cost`
- Status filter tabs (Complete, Cancelled, Failed, Printing)
- Search by filename
- Expandable rows with full job details
- Historical cost backfill: 421 jobs with electricity_cost + filament_cost

### Filament Library (includes CFS Units)
- Full CRUD for filament rolls (brand, material, color, weight, cost, location, slot)
- Sortable columns (remaining%, cost/kg, brand, material)
- Material filter and search
- Auto-decrement on print completion (matches by material type)
- SpoolmanDB catalog picker (auto-opens on add)
- Bulk add: quantity field for adding multiple identical spools at once
- CFS slot grouping: separate sections for CFS 1 (T1A–D), CFS 2 (T2A–D), and "Spools in Stock"
- Slot-order sorting: T1A→T1D, T2A→T2D (not by remaining %)
- **CFS Units panel**: Compact slot grid per unit (T1–T4) with color swatches, material, remaining %, progress bars, live feeding/loading/standby badges, RFID tags, override indicators
- **Slot Override Modal**: Click any CFS slot to edit override (material, color, remaining %, spool weight, cost/kg, Reset to CFS) — handles manual updates when printer is off
- **Sync CFS → Library button** in CFS Units panel header — pulls current CFS data from Moonraker and creates/updates filament library entries
- **Data quality enforcement**: RFID rolls → brand="Creality"; color_name derived from color_hex via `color_name_from_hex()`; location format `"CFS {slot_id}"` when in CFS, `"Storage box"` or `"Shelf A"` when removed
- **Weight display**: `formatGrams()` — 1000+ → whole number, 100–999 → 1dp, 10–99 → 2dp, <10 → 3dp
- **CFS slot states during prints**: only "feeding" (pulsing blue) or "standby" shown; all non-feeding slots display "standby" when `is_printing=true`
- **Override → roll sync**: Saving a slot override recalculates `remaining_weight_g` on the linked filament roll

### Camera
- Live stream viewer (defaults to printer IP:8000/stream)
- Test connection button with helpful error messages

### Files on Printer
- Browse all gcode files on printer via Moonraker
- Sortable/searchable table
- Click for metadata panel (est time, filament, object height, estimated cost)
- Storage summary card

### Analytics
- Sortable/filterable cost breakdown table
- Monthly cost trend chart
- Slicer accuracy scatter plot (estimated vs actual, ±h:mm:ss format)
- CSV export of all jobs with costs
- Summary endpoint: totals, month/week breakdowns, projected costs, low stock count
- `per_page` capped at 100 (backend validation)

### Reports
- Daily/weekly/monthly period selector with back/forward navigation
- Summary cards (cost, filament, print hours)
- Stacked bar charts for filament and cost breakdown
- Job details table per period

### Compare
- Side-by-side comparison of any two print jobs
- Percentage difference highlighting (green ≤5%, amber ≤20%, red >20%)

### System Health
- Moonraker system info (CPU, memory, uptime, etc.)
- Live power readings from Meross smart plug
- Meross plug on/off control

### Settings
- Printer Connection: Moonraker IP/port with Test button
- Meross Power Plug: email/password/device name/UUID with reconnect
- Power & Currency: electricity rate, currency, default filament cost
- Filament Density: PLA, ABS, PETG, TPU, diameter
- Notifications: webhook URL, on_complete/on_failed/on_cancelled toggles
- Data Export: CSV download button
- CFS Slot Overrides: cost/kg and spool weight per slot

### Setup Wizard (`/setup`)
- Step 1: Moonraker IP/port, test connection, only proceed if reachable
- Step 2: Optional Meross credentials or skip
- Accessible outside main layout (no sidebar)

### Backend Infrastructure
- Dynamic Moonraker host/port from `app_config` DB with `.env` fallback
- Dynamic Meross credentials with service reconnect on save
- Dynamic CORS origin reflection (supports any host)
- `aiohttp.ClientSession` shared on `app.state` with auto-recovery `_get_session()`
- Print tracker: auto-creates jobs, tracks progress, decrements filament, sends notifications
- Filament type fallback: if filename doesn't contain material, uses CFS slot data at finalization
- Analytics service: summary, power history, monthly trend, slicer accuracy, maintenance
- Prometheus metrics: `prometheus-fastapi-instrumentator` on `/metrics`
- JWT auth: login, setup wizard, admin/user roles, 7-day token expiry
- Bulk filament creation: `POST /api/v1/filament/bulk` with `{roll, quantity}`
- Debug tests: 23 tests including filament_type null check
- Startup migrations: fix brand (Creality for RFID), color_name from hex, location format (CFS {slot_id}), duplicate spool_id cleanup
- Thumbnail backfill runs as background task (non-blocking startup)
- CFS override save syncs remaining_weight_g to filament roll

### Deployment
- Docker Compose: PostgreSQL, backend (FastAPI), frontend (Vite dev server), Prometheus
- PostgreSQL exposed on port 5432 for Grafana queries
- Prometheus scrapes backend `/metrics` every 10s
- Grafana: 7 pre-built dashboards (Print Operations, Power & Energy, Filament & CFS, Cost Analytics, Slicer Accuracy, System Health, Moonraker Live)
- Installer scripts for Ubuntu/Debian/CentOS/Arch/openSUSE
- GitHub repo: https://github.com/GhostyAUS/k2-printer-analytics

### Frontend Performance
- Route-based lazy loading: `React.lazy()` + `Suspense` for all 13 pages
- Vite manual chunks: `vendor-react`, `vendor-router`, `vendor-chart`
- Dashboard: memoized sub-components, `Promise.allSettled`, paginated job fetch (8 per page)
- `useFetch` cache hook: request dedup + 30s TTL
- Skeleton placeholders instead of blocking spinners

---

## Outstanding Work

### High Priority
- [ ] **Multi-stage Docker build** — production frontend should use nginx to serve built assets instead of Vite dev server; reduces image size and improves performance
- [ ] **Remove dead endpoints** — `GET /cfs/slots`, `GET /cfs/active`, `backend/app/api/routes/spools.py` are unused after CFS consolidation
- [ ] **Validate remaining_pct** — backend doesn't clamp `cfs_slot_overrides.remaining_pct` on write (T1A had 255%)

### Medium Priority
- [ ] **AdGuard DNS setup helper** — simplified DNS rewrite instructions (user does this manually in their environment; just needs example configs)
- [ ] **NPM SSL termination** — document setup for Let's Encrypt via NPM for external HTTPS access
- [ ] **Error boundaries** — frontend has no error boundaries; a failed API call can crash the whole app

### Low Priority / Nice-to-Have
- [ ] **Camera enable instructions** — popup or tooltip explaining how to enable K2 built-in camera in printer touchscreen Settings → Camera
- [ ] **Toast notifications** — settings saves, connection tests, errors all lack user feedback beyond console.log
- [ ] **Dark/light theme toggle** — currently dark-only
- [ ] **Print job notes** — allow users to add notes/tags to print jobs
- [ ] **Filament roll swap tracking** — record when a roll is swapped in CFS
- [ ] **Multiple printer support** — currently hardcoded single Moonraker instance
- [ ] **Backup/restore** — export/import settings and historical data

### Blocked
- [ ] **K2 built-in camera** — Creality camera module responds on port 8000 but returns 0-byte responses; requires enabling in printer touchscreen Settings → Camera (hardware/firmware issue, not software)
- [ ] **Meross cloud API** — currently rate-limited ("too many tokens without logging out"); power readings return None