# K2 Printer Analytics — Session Summary

**Date:** 2026-06-01  
**Repo:** https://github.com/GhostyAUS/k2-printer-analytics (branch `main`)

---

## Goal
Consolidate CFS Units functionality into Filament Library as single source of truth, fix data quality (brand, color, location), and deploy to ailab CT 104 (192.168.1.203).

## Constraints & Preferences
- Frontend: React (TypeScript, Vite) at `frontend/src/`; API client at `frontend/src/api/index.ts`, types at `frontend/src/types/index.ts`
- Machine supports 4 CFS units (T1–T4) — all CFS UI must support dynamically
- RFID-tagged spools → `brand="Creality"` (Creality is the only RFID vendor the printer reads)
- `color_name` derived from `color_hex` via `color_name_from_hex()` — never set to material name
- Location format: `"CFS {slot_id}"` (e.g. `"CFS T1A"`) when in CFS; `"Storage box"` when removed with filament; `"Shelf A"` for new/empty rolls
- Brand/material/color_hex on matched stock roll must never be overwritten during sync — only `spool_id`, `location`, `remaining_weight_g`, `cost_per_kg`, `rfid_vendor` change
- `cfs_slot_overrides.remaining_pct` is authoritative (not CFS `remain_len`)
- Weight display: `formatGrams()` — 1000+ → whole number, 100-999 → 1dp, 10-99 → 2dp, <10 → 3dp
- CFS slot states during prints: only "feeding" or "standby" shown; all non-feeding slots display "standby" when `is_printing=true`
- Deploy via: `tar czf - ... | ssh root@192.168.1.248 "pct exec 104 -- bash -c 'cd /root/k2-printer-analytics && ... && docker compose up -d --build'"`
- Frontend runs Vite dev server inside Docker (not built static files); `VITE_API_URL` must be empty so Vite proxy handles `/api` routing
- DB user: `k2user` in PostgreSQL on CT 104

## Progress

### Done
- **CFS Units panel embedded in FilamentLibrary**: Compact slot grid per unit (T1–T4) with color swatches, material, remaining %, progress bars, live feeding/loading/standby badges, RFID tags, override indicators
- **SlotOverrideModal**: Click any CFS slot to edit override (material, color, remaining %, spool weight, cost/kg, Reset to CFS) — handles manual updates when printer is off
- **Sync CFS → Library button** in CFS Units panel header
- **Dashboard CfsSlotsCard shrunk**: Compact card showing only active slot + mini 2-col grid of all slots with %; links to `/filament` ("View in Filament Library →")
- **Spools.tsx fully removed**: File deleted from disk, sidebar "CFS Units" entry removed, `/spools` route removed from App.tsx
- **Help.tsx updated**: SpoolsHelp component removed, FilamentHelp expanded to cover CFS tracking, SpoolmanDB picker, weighing, sync
- **Data quality — brand**: RFID rolls → `brand="Creality"`, `brand="CFS"` → `""` in all code paths (cfs.py, print_tracker.py) and startup migration
- **Data quality — color_name**: `color_name_from_hex()` added to `cfs_constants.py` with 50+ color entries; all new roll creation uses it; startup migration derives color_name from hex for rolls with empty color_name
- **Data quality — location**: All code paths use `f"CFS {slot_id}"` (not `f"CFS {tray_id}"`); removal → `"Storage box"` (partial) or `"Shelf A"` (empty); migration fixes existing DB records
- **Data quality — stop overwriting**: `cfs.py` and `print_tracker.py` "existing roll, no change" paths no longer overwrite `material` or `color_hex`
- **Data quality — startup migrations** in `main.py`: Fix brand, color_name, location, "Removed from CFS", empty locations, duplicate spool_ids; all ran successfully on deploy (5 RFID brand fixes, 2 CFS brand clears, 14 color_name fixes, 8 location fixes, 11 "Removed from CFS" fixes, 25 empty location fixes, 6 full CFS slot locations)
- **GET /cfs/state enhanced**: Returns `slot_states` map (per-slot: feeding/active/loading/standby/idle/empty) in addition to `active_slot_id`, `feed_state`, `is_printing`
- **Frontend SlotStatusBadge**: Feeding (pulsing blue), Active, Loading (pulsing amber), Standby
- **Frontend location UI**: CFS1–CFS4 options with T1–T4 slot sub-dropdowns; location format `CFS {slot_id}`
- **30s load fix**: Backend `GET /cfs/state` uses `aiohttp.ClientTimeout(total=5)` per request; frontend `fetchCfsState()` has 3s axios timeout
- **Weight formatting**: `formatGrams()` replaces raw decimal display everywhere in FilamentLibrary
- **Slot state logic**: `getSlotState()` promotes all non-feeding states to "standby" when `is_printing=true`
- **React hooks order bug fixed**: `useMemo` for `cfsUnitSlots` moved above `if (loading) return` early return
- **API URL fix**: `VITE_API_URL` fallback changed from `http://localhost:8000` to `''` in `api/index.ts`; `docker-compose.yml` set `VITE_API_URL=` (empty) so Vite proxy handles all API routing through port 3000
- **match_vote.py**: Location format fixed to `f"CFS {vote.slot_id}"` (was `f"CFS {slot_id[:2]}"`)
- **filament.py**: Auto-unlink sets `location="Storage box"` or `"Shelf A"` instead of leaving empty
- **T1A data fix**: Direct DB update — `remaining_weight_g` corrected from 2550 to 800 (matching 80% × 1000g)
- **CFS override → roll weight sync**: `PUT /cfs/overrides/{slot_id}` now recalculates `remaining_weight_g` on the linked filament roll via `_sync_roll_weight()`; delete override recalculates from roll's own weight data
- **Non-blocking startup**: Thumbnail backfill moved from `await` (blocking) to `asyncio.create_task` (background) with 120s timeout; added `import asyncio` to `main.py`
- **Missed filament deductions applied**: 3 recent prints (jobs 470–472) completed during server restarts; manually applied deductions via SQL: T2B -49.04g, T2A -10.79g, T2C -10.44g, T1B -1.07g; also applied proportional attribution for job 472 untracked filament (T2A 4.97g, T1B 1.07g)
- **Dashboard print state row**: State, Speed, Flow, Print Time from `/system/printer-status` displayed in compact row under active print card; auto-hides when not printing
- **Dashboard overtime counter**: When print exceeds 100% progress, live count-up timer shows `+Xm Ys over estimate` instead of static "Exceeds estimation" text; "Remaining" label changes to "Over"

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Filament Library is the single source of truth for CFS display — old CFS Units page fully absorbed
- `GET /cfs/state` returns live state + per-slot `slot_states` map — slot details come from library
- `cfs_slot_overrides.remaining_pct` is authoritative; `remaining_pct` clamped to 0–100 in frontend
- CFS slot display during prints: only "feeding" and "standby" — no "active" or "idle"
- `color_name_from_hex()` maps hex to closest named color — never derived from material name
- `brand="Creality"` for RFID-tagged spools (only Creality makes RFID spools the printer reads)
- Location `"Storage box"` for removed partial rolls, `"Shelf A"` for new/full/empty
- Vite dev server proxy handles all API routing — `VITE_API_URL` must be empty
- Deploy via tar pipe over SSH to Proxmox CT 104
- CFS override saves sync `remaining_weight_g` to linked roll — keeping override and roll in sync
- Thumbnail backfill is non-blocking (background task) — startup completes in seconds not minutes
- Dashboard overtime uses client-side `setInterval` counting seconds since progress reached 100%
- Print state row (State/Speed/Flow/Print Time) auto-hides when not printing

## Next Steps
- Consider removing dead `GET /cfs/slots` and `GET /cfs/active` endpoints from `cfs.py`
- Consider removing `backend/app/api/routes/spools.py` (old model, still registered in main.py)
- Clean up remaining `cfs.py` infrastructure (`_build_slots`, `_merge_slot`, `_load_pending_votes`) only used by dead endpoints
- Fix `cfs_slot_overrides.remaining_pct` values > 100 in DB (e.g. T1A was 255%)
- Consider making frontend Dockerfile serve built static files instead of Vite dev server for production
- Add diagnostic test for override→roll weight sync consistency

## Critical Context
- **React hooks must be unconditional**: The `if (loading) return` early return caused "Rendered more hooks than during previous render" crash when a `useMemo` was placed after it
- **VITE_API_URL must be empty**: If set to `http://192.168.1.203:8000`, browser tries to hit port 8000 directly which may be blocked; empty value forces Vite proxy on port 3000
- **`remaining_pct` in overrides can exceed 100**: T1A had 255% — frontend clamps display but backend doesn't validate on write
- **Frontend Dockerfile runs `npm run dev`** (Vite dev server), not serving built files — this is pre-existing, not ideal for production
- **Backend container healthcheck**: `curl -f http://localhost:8000/api/v1/health` — may show "unhealthy" briefly on restart but recovers
- **Thumbnail backfill must be non-blocking**: Previously `await _run_thumbnail_backfill()` blocked lifespan startup, making the backend unable to serve requests for minutes
- **After backend container restart, frontend Vite proxy caches stale backend IP**: Must restart frontend container after backend recreate
- **Filament deductions missed during server restarts**: If the backend is down when a print completes, `_decrement_filament_rolls` never runs — must manually apply via SQL

## Relevant Files
- `frontend/src/pages/FilamentLibrary.tsx`: CFS Units panel at top, SlotOverrideModal, cfsSlots/cfsUnitSlots memos, getSlotState with standby logic, formatGrams, all hooks above early return
- `frontend/src/pages/Dashboard.tsx`: Shrunken CfsSlotsCard (compact, links to /filament), print state row (State/Speed/Flow/Print Time) with auto-hide, overtime count-up timer
- `frontend/src/pages/Dashboard.tsx`: `fetchPrinterStatus()` added to loadLive, `printerStatus` state, `overtime` state with 1s interval counter
- `frontend/src/api/index.ts`: `VITE_API_URL` fallback `''`, fetchCfsState returns slot_states, 3s timeout on cfs/state, fetchPrinterStatus
- `backend/app/core/cfs_constants.py`: MATERIAL_MAP, normalize_hex, build_name_map, color_name_from_hex (50+ colors)
- `backend/app/api/routes/cfs.py`: GET /state with slot_states + 5s timeout, POST /sync-library with Creality brand + color_name_from_hex + CFS {slot_id} location
- `backend/app/api/routes/cfs_overrides.py`: PUT with `_sync_roll_weight()` recalculates `remaining_weight_g` on linked roll; DELETE recalculates from roll weight
- `backend/app/services/print_tracker.py`: Same brand/color/location fixes in _sync_cfs_to_library, _detect_vacancy, _detect_slot_changes
- `backend/app/main.py`: `import asyncio` added; non-blocking thumbnail backfill with 120s timeout; comprehensive startup migrations
- `backend/app/api/routes/match_vote.py`: Location format `CFS {slot_id}`
- `backend/app/api/routes/filament.py`: Auto-unlink sets Storage box/Shelf A
- `docker-compose.yml`: `VITE_API_URL=` (empty)
- `frontend/src/pages/Help.tsx`: FilamentHelp expanded, SpoolsHelp removed
- `backend/app/api/routes/system.py`: GET /system/printer-status with print_state (idle_state, printing_time, speed_factor, speed_mm_s, extrude_factor)
