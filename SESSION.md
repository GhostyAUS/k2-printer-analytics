# K2 Printer Analytics — Session Summary

**Date:** 2026-06-01  
**Repo:** https://github.com/GhostyAUS/k2-printer-analytics (branch `main`)

---

## Goal
Consolidate CFS into Filament Library, fix data quality, enhance dashboard, replace SpoolmanDB with Open Filament Database, and deploy to Proxmox CT 104.

## Constraints & Preferences
- Frontend: React (TypeScript, Vite) at `frontend/src/`; API client at `frontend/src/api/index.ts`, types at `frontend/src/types/index.ts`
- Machine supports 4 CFS units (T1–T4) — all CFS UI must support dynamically
- RFID-tagged spools → `brand="Creality"` (Creality is the only RFID vendor the printer reads)
- `color_name` derived from `color_hex` via `color_name_from_hex()` — never set to material name
- Location format: `"CFS {slot_id}"` when in CFS; `"Storage box"` when removed with filament; `"Shelf A"` for new/empty rolls
- Brand/material/color_hex on matched stock roll must never be overwritten during sync — only `spool_id`, `location`, `remaining_weight_g`, `cost_per_kg`, `rfid_vendor` change
- `cfs_slot_overrides.remaining_pct` is authoritative (not CFS `remain_len`)
- Weight display: `formatGrams()` — 1000+ → whole number, 100-999 → 1dp, 10-99 → 2dp, <10 → 3dp
- CFS slot states during prints: only "feeding" or "standby" shown; all non-feeding slots display "standby" when `is_printing=true`
- Deploy via: `tar czf - ... | ssh root@192.168.1.248 "pct exec 104 -- bash -c 'cd /root/k2-printer-analytics && ... && docker compose up -d --build'"`
- Frontend runs Vite dev server inside Docker; `VITE_API_URL` must be empty so Vite proxy handles `/api` routing
- DB user: `k2user` in PostgreSQL on CT 104 (database `k2_analytics`)
- OFD data refresh cadence: 24-hour cache, daily bulk download of `all.json.gz` on startup

## Progress
### Done
- **CFS Units panel embedded in FilamentLibrary**: Compact slot grid per unit (T1–T4) with color swatches, material, remaining %, progress bars, live badges, RFID tags, override indicators
- **SlotOverrideModal**: Click any CFS slot to edit override (material, color, remaining %, spool weight, cost/kg, Reset to CFS)
- **Sync CFS → Library button** in CFS Units panel header
- **Dashboard CfsSlotsCard shrunk**: Compact card with active slot + mini grid; links to `/filament`
- **Spools.tsx fully removed**: File deleted, sidebar entry removed, `/spools` route removed
- **Data quality — brand**: RFID → `brand="Creality"`, `brand="CFS"` → `""` in all code paths + startup migration
- **Data quality — color_name**: `color_name_from_hex()` in `cfs_constants.py` (50+ colors); startup migration re-derives from hex
- **Data quality — location**: All code paths use `f"CFS {slot_id}"`; removal → `"Storage box"` / `"Shelf A"`; startup migration fixes existing
- **Data quality — stop overwriting**: "Existing roll, no change" paths no longer overwrite `material` or `color_hex`
- **Data quality — startup migrations** in `main.py`: Fix brand, color_name, location, "Removed from CFS", empty locations, duplicate spool_ids
- **GET /cfs/state enhanced**: Returns `slot_states` map per slot
- **Frontend SlotStatusBadge**: Feeding (pulsing blue), Active, Loading (pulsing amber), Standby
- **30s load fix**: Backend 5s aiohttp timeout on CFS fetch; frontend 3s axios timeout
- **Weight formatting**: `formatGrams()` replaces raw decimal display
- **Slot state logic**: `getSlotState()` promotes all non-feeding to "standby" when `is_printing=true`
- **React hooks order bug fixed**: `useMemo` moved above early return
- **API URL fix**: `VITE_API_URL` fallback `''`; `docker-compose.yml` sets `VITE_API_URL=` (empty)
- **match_vote.py**: Location format `f"CFS {vote.slot_id}"`
- **filament.py**: Auto-unlink sets `"Storage box"` / `"Shelf A"`
- **CFS override → roll weight sync**: `PUT /cfs/overrides/{slot_id}` calls `_sync_roll_weight()` to recalculate `remaining_weight_g`; DELETE also recalculates
- **Non-blocking startup**: Thumbnail backfill moved from `await` to `asyncio.create_task` with 120s timeout; `import asyncio` added to `main.py`
- **Missed filament deductions applied**: Jobs 470–472 completed during server restarts; manually applied via SQL
- **Dashboard print state row**: Printer Status card (State/Speed/Flow/Print Time) always visible on Dashboard, shows "N/A" when idle. Originally inside `{isPrinting && ...}` which hid it — moved to standalone card.
- **Dashboard overtime counter**: When progress ≥ 100%, progress bar turns red, live count-up timer shows `+Xm Ys over estimate`; "Remaining" label changes to "Over"; `overtime` state with 1s `setInterval`
- **Dashboard summary stats moved to System**: Total Prints, Total Cost, Filament Used, Print Hours, This Month, Success Rate cards moved from Dashboard to System page ("Print Analytics" section)
- **fetchPrinterStatus API path fixed**: Was calling `/api/v1/printer/status` (nonexistent), fixed to `/api/v1/system/printer-status`
- **Dashboard JSX structure fixed**: Misaligned closing `</div>` tags after edit caused TypeScript build failures (TS1005)
- **Open Filament Database (OFD) replaces SpoolmanDB**:
  - Backend: `backend/app/services/ofd.py` — downloads `all.json.gz` on startup, caches in memory (24h TTL), daily background refresh
  - Backend: `backend/app/api/routes/ofd.py` — `GET /ofd/brands` (139), `GET /ofd/materials` (658), `GET /ofd/search` (variant-level results)
  - Frontend: `api/index.ts` — `OFDBrand`, `OFDMaterial`, `OFDFilamentResult` types + `fetchOFDBrands`, `fetchOFDMaterials`, `searchOFDFilaments`
  - Frontend: FilamentPicker rewritten for OFD with brand dropdown (ID-based), material dropdown, free-text search
  - Frontend: `applyFilament` maps OFD fields: `brand`→brand, `material`→material, `variant_name`→color_name, `color_hex`→color_hex, `filament_weight`→total_weight_g
  - Button relabeled "OFD" (was "SpoolmanDB")
- **All docs updated**: README.md, feature-summary.md, SESSION.md, problems.md, Help.tsx

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Filament Library is single source of truth for CFS display — old CFS Units page fully absorbed
- `cfs_slot_overrides.remaining_pct` is authoritative; clamped to 0–100 in frontend only (backend doesn't validate)
- CFS slot display during prints: only "feeding" and "standby"
- `color_name_from_hex()` maps hex to closest named color — never from material name
- `brand="Creality"` for RFID-tagged spools
- Override saves sync `remaining_weight_g` to linked roll
- Thumbnail backfill non-blocking (background task) — startup completes in seconds
- Dashboard overtime uses client-side `setInterval` counting seconds since progress hit 100%
- Printer Status card is always visible on Dashboard — shows "N/A" when idle (not hidden)
- Summary stat cards (Total Prints, Total Cost, etc.) belong on System page, not Dashboard
- OFD replaces SpoolmanDB: 139 brands / 1,978 filaments / 14,219 variants vs SpoolmanDB's ~40 brands / ~1,800 flat entries
- OFD data loaded as `all.json.gz` bulk download on startup, cached in Python module-level dict, 24h TTL
- OFD field mapping: `brand.name`→brand, `material`→material, `variant.name`→color_name, `variant.color_hex`→color_hex (already has `#`), `size.filament_weight`→total_weight_g

## Next Steps
- Remove old `backend/app/api/routes/spoolmandb.py` and its router registration
- Remove dead `GET /cfs/slots` and `GET /cfs/active` endpoints from `cfs.py`
- Consider removing `backend/app/api/routes/spools.py` (old model, still registered)
- Fix `cfs_slot_overrides.remaining_pct` validation on backend write (values > 100 possible)
- Consider production frontend Dockerfile serving built static files instead of Vite dev server

## Critical Context
- **React hooks must be unconditional**: Early returns before hooks cause "Rendered more hooks than during previous render"
- **VITE_API_URL must be empty**: Forces Vite proxy on port 3000; direct port 8000 may be blocked
- **`remaining_pct` can exceed 100 in DB**: Frontend clamps display but backend doesn't validate on write
- **Frontend Dockerfile runs `npm run dev`** — not ideal for production
- **After backend container restart, frontend Vite proxy caches stale backend IP**: Must restart frontend container after backend recreate
- **Filament deductions missed during server restarts**: If backend is down when print completes, `_decrement_filament_rolls` never runs — must manually apply via SQL
- **Thumbnail backfill must be non-blocking**: Previously blocked lifespan startup for minutes
- **OFD base URL**: `https://api.openfilamentdatabase.org/json/all.json.gz` — static JSON rebuilt daily
- **OFD data is 1.9MB gzipped**: Loads in seconds on startup; cached in memory for fast search

## Relevant Files
- `frontend/src/pages/FilamentLibrary.tsx`: CFS Units panel, SlotOverrideModal, FilamentPicker (OFD), getSlotState, formatGrams
- `frontend/src/pages/Dashboard.tsx`: Active Print card with overtime counter, Printer Status card (always visible), CfsSlotsCard, power chart, maintenance, recent jobs
- `frontend/src/pages/SystemHealth.tsx`: Print Analytics section (summary stats), temperatures, fans, board sensors, system resources, MCU, print state
- `frontend/src/api/index.ts`: `VITE_API_URL` fallback `''`, fetchCfsState, fetchPrinterStatus, OFD types + fetch functions
- `frontend/src/pages/Help.tsx`: Updated for OFD picker, Printer Status card, Print Analytics on System
- `backend/app/services/ofd.py`: OFD data download, cache, search functions (get_brands, get_materials, search_filaments)
- `backend/app/api/routes/ofd.py`: GET /ofd/brands, GET /ofd/materials, GET /ofd/search
- `backend/app/core/cfs_constants.py`: MATERIAL_MAP, normalize_hex, build_name_map, color_name_from_hex (50+ colors)
- `backend/app/api/routes/cfs.py`: GET /state with slot_states + 5s timeout, POST /sync-library with data quality fixes
- `backend/app/api/routes/cfs_overrides.py`: PUT with `_sync_roll_weight()`, DELETE with roll recalculation
- `backend/app/services/print_tracker.py`: Brand/color/location fixes in _sync_cfs_to_library, _detect_vacancy, _detect_slot_changes, _decrement_filament_rolls
- `backend/app/main.py`: OFD startup loading + daily refresh, non-blocking thumbnail backfill, startup migrations
- `backend/app/api/routes/filament.py`: Auto-unlink sets Storage box/Shelf A
- `backend/app/api/routes/match_vote.py`: Location format `CFS {slot_id}`
- `docker-compose.yml`: `VITE_API_URL=` (empty)
