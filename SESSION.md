# K2 Printer Analytics — Session Summary

**Date:** 2026-05-30  
**Repo:** https://github.com/GhostyAUS/k2-printer-analytics (branch `main`)

---

## Goal
Full-stack K2 printer analytics platform with live monitoring, cost tracking, filament management, CFS per-slot tracking, SpoolmanDB integration, reporting, thumbnails, and zero-code deployment.

## Constraints & Preferences
- Model: `ollama/qinen3-coder:30b-q3` on 192.168.1.110:11434
- No `depends_on: moonraker` in docker-compose.yml
- Moonraker at 192.168.1.146:7125 (short-form query `?print_stats`)
- AdGuard Home at 192.168.1.250:8081; NPM at 192.168.1.252
- Power rate: $0.49/kWh AUD (configurable via settings API), TZ: Australia/Perth
- PrintStatus enum values stored UPPERCASE in DB (`COMPLETE`, `CANCELLED`, `PRINTING`, `FAILED`)
- All `datetime.utcnow()` → `datetime.now(timezone.utc)`
- Backend Dockerfile: no `--reload` flag
- Frontend: Vite dev server on port 3000 (Docker), proxies `/api` → backend:8000
- Moonraker host/port and Meross credentials configurable via Settings UI (stored in `app_config` DB, override `.env` defaults)
- GitHub repo: https://github.com/GhostyAUS/k2-printer-analytics (branch `main`)
- JWT auth: `secret_key` in config, SHA256+salt password hashing, 7-day token expiry
- SpoolmanDB at `https://donkie.github.io/SpoolmanDB/` — `filaments.json` (id is string like `"creality_abs_black..."`, color_hex without `#` prefix), `materials.json`
- `version` removed from docker-compose.yml (was obsolete)
- Slicer accuracy displayed as +/- h:mm:ss delta instead of percentage

## Progress

### Done
- All original bug fixes (P1–P22)
- Historical cost backfill, filament_type parsing, estimated_filament_g columns
- PrintJobs page: server-side pagination, sorting, status filter tabs, search, expandable rows with per-slot CFS usage
- Analytics page: cost breakdown, monthly trend, slicer accuracy (now +/- h:mm:ss), CSV export
- Spools & CFS page: live CFS slot data with active slot highlighting during prints, remaining weight in grams, Sync CFS→Library button
- Camera, Files, Compare, Maintenance tracker pages
- Mobile responsive layout, WebSocket hook, dynamic Moonraker/Meross config
- Dynamic CORS middleware, JWT auth system, login page, setup wizard
- Filament Library: Spoolman-style card grid, SVG progress arcs, grid/table toggle, weigh dialog, SpoolmanDB picker
- SpoolmanDB integration: Backend proxy, frontend FilamentPicker, id is string, color_hex needs `#` prefix
- Spool weighing system: `spool_weight_g` column, `POST /filament/{id}/weigh`, WeighDialog
- CFS active slot detection, feed state tracking, dashboard display
- Per-slot CFS filament tracking: `cfs_slot_usage` table, measuring_wheel deltas, slot change detection
- Filament decrement per-slot with CFS override `remaining_pct` updates
- Notification webhooks, live power graph with Y-axis labels/X-axis time markers/avg, monthly/weekly summary, export CSV, print queue, maintenance tracker
- Install/bootstrap system with OS detection, NPM, certs
- REST-only print tracker, orphaned job finalization, cross-tray MW guard
- CFS→Filament Library sync, color normalization, toast notifications, power graph improvements
- **Debug/test system completed**: 22/22 tests passing; `backend/app/api/routes/debug.py`; frontend Debug section in Settings with green tick/red X per test, category grouping, toast summary
  - Fixed: `from sqlalchemy import text` (not `from sqlalchemy.text`); DB tests use `text()` wrapper for SQLAlchemy 2.x; frontend tests use Docker hostname `frontend:3000` and accept any non-5xx response
- **Export logs endpoint**: `GET /debug/export-logs` returns plain-text diagnostic bundle (system info, Docker status, env vars, DB config, all 22 test results, tracker state, DB stats, recent jobs, CFS overrides); token passed as `?token=` query param; path added to auth middleware public_paths
- **Help page** (`/help`): User guide for all 12 app sections, diagnostics reference (22 tests documented), troubleshooting guides (Moonraker, Meross, DB, auth, CFS), export logs button, GitHub repo link
- **Enhanced System page**: Real-time (3s refresh) temperatures (hotend, bed, chamber), fans (part cooling, chamber fan, hotend fan), board sensors (MCU temp, chamber sensor with min/max), MCU info (firmware, clock freq, load, comms stats), print state (speed factor, flow rate, idle timeout); backend `GET /system/printer-status` queries correct Moonraker object names
- **Reports page** (`/reports`): Daily/weekly/monthly period selector with back/forward navigation; summary cards (filament used, power cost, print time, total cost); status breakdown (completed/failed/cancelled counts and %); jobs over time stacked chart; filament & cost dual bars; print hours trend; power cost trend; per-filament-type breakdown; job details table with status badges; backend `GET /analytics/report?period=daily|weekly|monthly` and `GET /analytics/report/series`
- **Slicer accuracy changed to +/- h:mm:ss**: Backend `fmt_diff()` converts seconds delta to `+1h 23m` / `-5m 12s` format; frontend `fmtDiff()` matches; summary shows avg/median/min/max as h:mm:ss instead of percentages
- **Auth retry logic**: `App.tsx` `checkAuth()` retries `fetchAuthStatus()` up to 5 times with 1s delay on failure; prevents redirect to `/setup` when backend not ready after deploy
- Filament decrement on print end, double-finalization guard
- Job 453/454 backfilled
- **Print job thumbnails**: Backend `_find_thumbnail_path()` searches Moonraker metadata, 3MF project directories, and file listing for preview PNGs; `GET /files/thumbnail-image` proxies PNG directly; `thumbnail_path` column on `print_jobs` table (saved when job created); frontend shows thumbnail in Dashboard active print card, Print Jobs table column, and expanded row larger preview; `getThumbnailUrl()` for on-demand lookup
- **Reports weekly period fix**: Fixed `NameError` in weekly period calculation (referenced `start` before assignment); now correctly finds Monday of current week and offsets by whole weeks

### In Progress
- (none)

### Blocked
- K2 built-in camera: Creality camera module responds on port 8000 but returns 0-byte responses; needs enabling in printer touchscreen Settings → Camera
- `temperature_sensor pi_temp` defined in Klipper but returns empty (needs `sensor_type: temperature_host` + Linux host MCU setup)
- `temperature_sensor nevermore_temp` and `cfs_board` defined but return empty (likely need hardware probes)
- Meross cloud API rate-limited ("too many tokens without logging out")

## Key Decisions
- `measuring_wheel` is per-TRAY (T1, T2), NOT per-slot — deltas between different trays are meaningless; cross-tray slot changes must NOT compute mm/g from measuring_wheel
- `measuring_wheel` is cumulative since CFS power-on, confirmed negative direction is convention; must use deltas
- `T{N}.mode` is string `"2"` not int `2` — must compare with `str()`
- `T{N}.filament` is string `"A"/"B"/"C"/"D"` or `"None"` — marks active slot
- CFS `remain_len` is static/unreliable — our `cfs_slot_overrides.remaining_pct` + filament library tracking is authoritative
- Purge/retract waste between slot switches attributed to the NEW slot
- REST-only tracker chosen over WebSocket to avoid coroutine contention
- CFS 7-char color codes normalized to `#rrggbb` format on storage and display
- SpoolmanDB `id` field is string; `color_hex` values lack `#` prefix
- `spool_weight_g` default 0.0 so weighing without tare still works
- Progress >100% shows red bar + "Exceeds estimation" text
- When tracker restarts mid-print, stale CFS records are deleted and fresh one created
- Slicer accuracy shown as +/- time delta (more intuitive than %)
- Moonraker object names for K2: `temperature_sensor mcu_temp` (not `mcu`), `temperature_sensor chamber_temp` (not `chamber`), `heater_fan hotend_fan`, `temperature_fan chamber_fan`, `heater_generic chamber_heater`, `output_pin fan0/fan1/fan2/extruder_fan`
- Export-logs uses `?token=` query param for auth (window.open can't set headers); path is public in auth middleware but handler validates token
- **Thumbnails**: Creality Print embeds thumbnails as Base64 in G-code headers (`; thumbnail begin NxN` markers). Moonraker's metadata parser often doesn't recognize these. The `_extract_gcode_thumbnail()` function fetches the first 64KB of the G-code from Moonraker via HTTP Range header, parses the markers, and decodes the largest available thumbnail. For 3MF project directories, separate PNG files exist. Thumbnail lookup priority: 1) Moonraker metadata, 2) 3MF directory PNGs, 3) embedded G-code Base64 extraction. `thumbnail_path` is saved in DB when a job is created so it persists if the file is deleted from the printer. Auth uses `?token=` query param on `/files/thumbnail-image` since `<img src>` can't send Authorization headers. `thumbnail_path` column is TEXT (not VARCHAR) because embedded base64 thumbnails are 30KB+. `POST /files/thumbnail-backfill` extracts and saves thumbnails for existing jobs. `ThumbnailImg` component with 4 sizes (xs/sm/md/lg), click-to-zoom to 300x300 modal.
- **Reports weekly**: Must calculate Monday of current week first (`now - timedelta(days=now.weekday())`), then offset by whole weeks. Previous code had a NameError referencing `start` before assignment.

## Next Steps
- Configure AdGuard DNS rewrite: `k2-analytics.local` → 192.168.1.203
- Configure NPM SSL for external access
- Multi-stage Docker build (nginx serving built frontend assets)
- Error boundaries and loading states for frontend
- Enable `pi_temp` sensor in Klipper with `sensor_type: temperature_host`
- Investigate `nevermore_temp` and `cfs_board` sensor enablement
- Backfill thumbnail_path for historical jobs (only 3MF-path jobs have thumbnails currently)
- Consider generating thumbnails from G-code for standalone files (would require G-code parser)

## Critical Context
- Proxmox host `ailab` at 192.168.1.248, CT 104 IP: 192.168.1.203
- Deploy: `cd /home/clint/Projects/k2-printer-analytics && tar czf - --exclude=node_modules --exclude=__pycache__ --exclude=.git backend frontend docker-compose.yml | ssh root@192.168.1.248 "pct exec 104 -- bash -c 'cd /root/k2-printer-analytics && rm -rf backend frontend && tar xzf - && docker compose up -d --build'"`
- DB: PostgreSQL `k2user:k2pass@db:5432/k2_analytics`; manual migrations via direct psql when needed
- Auth tokens: `docker exec k2-printer-analytics-backend-1 python3 -c 'from app.core.auth import create_access_token; print(create_access_token({"sub":"clint","is_admin":True}))'`
- CFS slot usage records for cross-tray changes have NULL `filament_used_mm/g` (by design)
- Current T2B remaining: 30% (302g) after correction from erroneous 218g deduction
- Klipper `printer.cfg` already has `[temperature_sensor mcu_temp]` (sensor_type: temperature_mcu) and `[temperature_sensor chamber_temp]` (EPCOS 100K on PC5); `[mcu rpi]` with serial `/tmp/klipper_host_mcu` exists but `pi_temp` sensor not configured
- Meross cloud API currently rate-limited ("too many tokens without logging out") — power readings return None
- 3MF project directories on printer: `.729c1ef89923bf8fa6dabcdbbf0ee329_gcode.3mf/`, `.Excavator+0.4+Nozzle_gcode.3mf/`, `.Skeleton_gcode.3mf/` — each contains `{base}_plate_{N}.png`, `{base}_top_{N}.png`, `{base}_face_image.png`, `{base}_config_image.png`

## Relevant Files
- `backend/app/api/routes/files.py`: `_find_thumbnail_path()` (searches metadata → 3MF dirs → file listing); `GET /files/thumbnail` (returns URL); `GET /files/thumbnail-image` (proxies PNG)
- `backend/app/api/routes/analytics.py`: `GET /analytics/report` (daily/weekly/monthly with proper Monday-based weekly calc); `GET /analytics/report/series`; `GET /analytics/slicer-accuracy` with `fmt_diff()`; power-history with downsampling; `GET /slot-usage/{job_id}`
- `backend/app/api/routes/debug.py`: 22 tests + `GET /debug/export-logs`
- `backend/app/api/routes/system.py`: `GET /system/printer-status` queries Moonraker objects
- `backend/app/api/routes/cfs.py`: `/cfs/slots` and `/cfs/active` merge `filament_library` data; `POST /cfs/sync-library`; `_normalize_hex()`; `_merge_slot()`
- `backend/app/services/print_tracker.py`: REST-only tracker; cross-tray guard; `_finalize_active_job()`; `_sync_cfs_to_library()` on startup; `_decrement_filament_rolls()`; thumbnail lookup on job creation
- `backend/app/models/print_job.py`: `PrintJob` model with `thumbnail_path` column
- `backend/app/schemas/print_job.py`: `PrintJobResponse` with `thumbnail_path`
- `frontend/src/api/index.ts`: `getThumbnailUrl()`, `fetchReport()`, all CFS/filament API functions
- `frontend/src/pages/Reports.tsx`: Daily/weekly/monthly period selector; summary cards; jobs over time; filament & cost; print hours; power cost; filament by type; job details table
- `frontend/src/pages/Dashboard.tsx`: Thumbnail in active print card; thumbnails in recent jobs table
- `frontend/src/pages/PrintJobs.tsx`: Thumbnail column; larger thumbnail in expanded row
- `frontend/src/pages/Help.tsx`: User guide (12 sections including Reports), diagnostics reference, troubleshooting, export logs, GitHub link
- `frontend/src/pages/SystemHealth.tsx`: Real-time (3s) temps, fans, board sensors, MCU info, print state, system stats
- `frontend/src/pages/Analytics.tsx`: Slicer accuracy with `fmtDiff()` showing +/- h:mm:ss
- `frontend/src/pages/Settings.tsx`: Debug section with Run All Tests, category grouping, green tick/red X; toast notifications
- `frontend/src/types/index.ts`: `PrintJob` type with `thumbnail_path` field
