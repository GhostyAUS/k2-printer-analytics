# K2 Analytics — Feature Summary & Outstanding Work

## Features — Complete

### Dashboard
- Live print progress with M73 display_status
- Power usage graph (last 60 min, updates every 10s)
- KPI cards: total prints, cost, filament kg, hours, avg cost/print, success rate, projected monthly cost
- CFS slot overview (8 slots T1A–T4D)
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

### Spools & CFS
- Live CFS slot data from Moonraker (8 slots T1A–T4D)
- CFS slot overrides for cost/kg and spool weight per slot
- Material name resolution from CFS color codes

### Filament Library
- Full CRUD for filament rolls (brand, material, color, weight, cost, location, slot)
- Sortable columns (remaining%, cost/kg, brand, material)
- Material filter and search
- Auto-decrement on print completion (matches by material type)

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
- Slicer accuracy scatter plot (estimated vs actual)
- CSV export of all jobs with costs
- Summary endpoint: totals, month/week breakdowns, projected costs, low stock count

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
- WebSocket endpoint at `/api/v1/ws` with MoonrakerClient
- Print tracker: auto-creates jobs, tracks progress, decrements filament, sends notifications
- Analytics service: summary, power history, monthly trend, slicer accuracy, maintenance

### Deployment
- Docker Compose: PostgreSQL, backend (FastAPI), frontend (Vite dev server)
- Installer scripts for Ubuntu/Debian/CentOS/Arch/openSUSE
- GitHub repo: https://github.com/GhostyAUS/k2-printer-analytics

---

## Outstanding Work

### High Priority
- [ ] **Meross dynamic credential reconnect** — service reset wired in settings.py but not fully tested end-to-end; verify reconnect works after saving new Meross credentials via UI
- [ ] **WebSocket live updates on Dashboard** — `useMoonrakerWS.ts` hook exists but not wired into Dashboard components for real-time progress/power updates
- [ ] **Multi-stage Docker build** — production frontend should use nginx to serve built assets instead of Vite dev server; reduces image size and improves performance
- [ ] **Production nginx config** — frontend Dockerfile currently runs `npm run dev`; needs `npm run build` + nginx serving static assets

### Medium Priority
- [ ] **First-run detection in App.tsx** — currently `/setup` route exists but no auto-redirect for new users; should check `/api/v1/settings/setup/status` and redirect to `/setup` if not configured
- [ ] **AdGuard DNS setup helper** — simplified DNS rewrite instructions (user does this manually in their environment; just needs example configs)
- [ ] **NPM SSL termination** — document setup for Let's Encrypt via NPM for external HTTPS access
- [ ] **Error boundaries** — frontend has no error boundaries; a failed API call can crash the whole app
- [ ] **Loading states** — many pages show empty state briefly before data loads; add skeleton loaders

### Low Priority / Nice-to-Have
- [ ] **Camera enable instructions** — popup or tooltip explaining how to enable K2 built-in camera in printer touchscreen Settings → Camera
- [ ] **Toast notifications** — settings saves, connection tests, errors all lack user feedback beyond console.log
- [ ] **Dark/light theme toggle** — currently dark-only
- [ ] **Print job notes** — allow users to add notes/tags to print jobs
- [ ] **Filament roll swap tracking** — record when a roll is swapped in CFS
- [ ] **Multiple printer support** — currently hardcoded single Moonraker instance
- [ ] **Backup/restore** — export/import settings and historical data
- [ ] **User authentication** — no login system; app is open to anyone on the network

### Blocked
- [ ] **K2 built-in camera** — Creality camera module responds on port 8000 but returns 0-byte responses; requires enabling in printer touchscreen Settings → Camera (hardware/firmware issue, not software)