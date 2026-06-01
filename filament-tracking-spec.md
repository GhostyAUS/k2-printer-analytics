# K2 Printer Analytics — Filament & CFS Tracking Specification

## Overview

This document describes how the K2 Printer Analytics system tracks filament usage through the Creality Filament System (CFS) during print jobs. It covers the database schema, the print lifecycle, slot tracking, material calculations, and the guardrails that prevent common tracking errors.

---

## 1. Database Schema

### 1.1 Filament Roll (`filament_library`)

Table storing all known filament spools (both in-CFS and in-stock).

| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | PK |
| `brand` | String(100) | Spool manufacturer. RFID-tagged rolls → `"Creality"` (only RFID vendor). Non-RFID `"CFS"` brand → `""` |
| `material` | String(50) | PLA, PETG, ABS, TPU, etc. |
| `color_name` | String(100) | Human-readable colour derived from `color_hex` via `color_name_from_hex()`. Never set to material name. |
| `color_hex` | String(10) | Normalised to `#rrggbb` (6 chars plus `#`) |
| `total_weight_g` | Float | Full spool weight (including empty spool) |
| `spool_weight_g` | Float | Empty spool tare weight (for net filament calc) |
| `remaining_weight_g` | Float | Current remaining filament weight |
| `cost_per_kg` | Float | Cost per kilogram for this spool |
| `spool_id` | String(10) | CFS slot ID when loaded (e.g. `T1A`, `T2B`), or `NULL` when in stock |
| `rfid_vendor` | String(100) | RFID vendor identifier from CFS |
| `runout_detected` | Boolean | Set to `True` when filament sensor confirms runout |
| `location` | String(100) | `"CFS {slot_id}"` (e.g. `CFS T1A`) when in CFS; `"Storage box"` for removed partial rolls; `"Shelf A"` for new/empty rolls |

### 1.2 CFS Slot Override (`cfs_slot_overrides`)

Authoritative source for per-slot state (not the CFS's unreliable `remain_len`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | PK |
| `slot_id` | String(3) | Positional slot ID: `T1A`–`T4D` (unique, indexed) |
| `material_name` | String(100) | Override name shown in UI (can differ from CFS code) |
| `color_hex` | String(10) | Override colour (stored with `#` prefix) |
| `remaining_pct` | Float | Authoritative remaining percentage (0–100) |
| `cost_per_kg` | Float | Cost per kg for this slot |
| `spool_weight_g` | Float | Full spool weight (including spool) for this slot |
| `calibrated` | Boolean | Set to `True` after first completed print with measured data |

### 1.3 CFS Slot Usage (`cfs_slot_usage`)

Records each period of active feeding from a specific slot during a print job.

| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer | PK |
| `print_job_id` | Integer | FK → `print_jobs.id` |
| `slot_id` | String(10) | e.g. `T1A` |
| `tray_id` | String(2) | e.g. `T1` |
| `material_name` | String(100) | Resolved material name at time of slot activation |
| `color_hex` | String(10) | Resolved colour at time of slot activation |
| `measuring_wheel_start` | Float | CFS measuring wheel reading when slot activated |
| `measuring_wheel_end` | Float | CFS measuring wheel reading when slot deactivated |
| `filament_used_mm` | Float | Calculated delta in millimetres |
| `filament_used_g` | Float | Calculated weight in grams |
| `checkpoint_g` | Float | Mid-print checkpoint value (updated every ~60s) |
| `started_at` | DateTime | When slot became active |
| `ended_at` | DateTime | When slot was deactivated |

### 1.4 Print Job (`print_jobs`) — filament-related columns

| Column | Type | Notes |
|--------|------|-------|
| `filament_type` | String(50) | Material parsed from filename or CFS data |
| `filament_used_g` | Float | Total filament used from Moonraker metadata |
| `filament_length_mm` | Float | Total filament length from Moonraker |
| `estimated_filament_g` | Float | Estimated usage from G-code metadata |
| `filament_cost` | Float | Calculated from slot/roll cost data |

---

## 2. Print Job Lifecycle

### 2.1 Start (`_on_print_start`)

Triggered when Moonraker reports `print_stats.state == "printing"` and filename changed.

1. **Bootstrap check**: If the same filename is already tracked as `PRINTING`, delete any stale `cfs_slot_usage` records and reuse.
2. **Create job**: Insert `print_jobs` row with:
   - Material parsed from filename via `_parse_material()` (checks for PLA, PETG, ABS, TPU, ASA, NYLON, PC, HIPS) — first link in the fallback chain
   - Estimated duration from G-code metadata, then Moonraker metadata, then regex from filename (`_(\d+)h(\d+)m(\d+)s.gcode`)
   - Estimated filament usage from G-code metadata
3. **Thumbnail lookup**: Attempt to find thumbnail (Moonraker metadata → 3MF directory → G-code embedded)
4. **Poll CFS state**: Capture initial active slot and measuring wheel reading.

### 2.2 Active Monitoring (`poll_updates`)

Every 5 seconds:

1. Query Moonraker for `print_stats` + `virtual_sdcard`
2. If still printing the same job: update `filament_length_mm`, `actual_duration_seconds`
3. If printing and filename changed: finalize old job, start new one
4. If state is complete/error/cancelled: call `_on_print_end`
5. Every tick if printing: log power, poll CFS, checkpoint save, check runout
6. Every 12 ticks (~60s) if idle: poll CFS for slot changes (`_idle_cfs_poll`)

### 2.3 End (`_on_print_end`)

1. **Read final measuring wheel** from the CFS (same tray)
2. **Close current CFS slot record** using final MW reading
3. **Close all open slot records** using proportional attribution for cross-tray records
4. **Update job**: Status, end time, duration, filament usage metrics; if `filament_type` is still null, fall back to CFS active-slot material data
5. **Calculate costs**: Power kWh + filament cost from slot/roll data
6. **Decrement filament rolls**: Deduct from `FilamentRoll.remaining_weight_g`
7. **Mark calibrated**: Set `calibrated=True` on slots that had measured data
8. **Send notification** if webhook configured
9. **Reset tracker state**

---

## 3. CFS Slot Tracking

### 3.1 Slot Detection (`_poll_cfs_state`)

During a print, queries Moonraker for `box` object state every 5 seconds:

```
GET /printer/objects/query?box&filament_rack&filament_switch_sensor%20filament_sensor
```

For each tray (T1–T4):
- Tray `state` must not be `"None"`
- Tray `mode` must be `"2"` and active `filament` label must be `"A"`, `"B"`, `"C"`, or `"D"`
- First match is the active slot

When the active slot **changes** compared to `self._active_cfs_slot`:
1. **Close old slot record** — if same tray and MW available, compute mm/g delta; if different tray, close with `NULL` mm/g (cross-tray guard)
2. **Create new slot record** — capture `measuring_wheel_start`, `material_name`, `color_hex`

### 3.2 Measuring Wheel Logic

- The measuring wheel is **per-TRAY** (T1, T2, T3, T4), not per-slot
- It is a cumulative counter since CFS power-on (confirmed to count in negative direction by convention)
- Deltas are computed as `abs(current - start)` to handle negative direction
- **Cross-tray changes**: When the active slot moves from one tray to another (e.g. T1A → T2B), the measuring wheel delta between the two is **meaningless**. The slot record is closed with `NULL` for `filament_used_mm` and `filament_used_g`.
- **Within-tray changes**: Same-tray slot changes (e.g. T1A → T1C) can use the MW delta because both slots share the same measuring wheel.

### 3.3 Material & Colour Resolution

When a CFS slot activates, material is resolved in this priority order:
1. `same_material` name map (from CFS `same_material` array, which maps slot IDs to user-set names)
2. `MATERIAL_MAP` lookup by material code hex string (e.g. `"0e1001"` → `"PLA+"`, `"101001"` → `"PLA"`)
3. Fallback to `"Unknown"`

Colour hex is normalised:
- Strip `#` prefix
- If 7 chars starting with `0`, drop leading `0`
- Re-add `#` prefix if exactly 6 chars remain
- Empty or `"-1"` → empty string

### 3.4 Slot Record Close & Weight Calculation

When closing a within-tray slot record with valid MW delta:

```
delta_mm = abs(measuring_wheel_now - measuring_wheel_start)
area = π * (diameter / 2)²          // diameter from settings (default 1.75mm)
density_key = material → settings lookup
filament_used_g = delta_mm * area * density / 1000
```

Density defaults (g/cm³):
| Material | Density |
|----------|---------|
| PLA | 1.24 |
| ABS | 1.04 |
| PETG | 1.27 |
| TPU | 1.21 |

### 3.5 Proportional Attribution for Cross-Tray Records

When a print ends with open slot records that have `NULL` `filament_used_g` (cross-tray changes where MW delta was invalid):

```
moonraker_total_g = filament_mm * area * density / 1000    // from Moonraker metadata
tracked_total = sum of all records with valid filament_used_g
untracked_g = moonraker_total_g - tracked_total

For each null record:
    proportion = record_duration / total_duration_of_null_records
    filament_used_g = untracked_g * proportion
```

This ensures the total tracked filament always matches Moonraker's reported total.

### 3.6 Checkpoint Save (`_checkpoint_save`)

Every 60 seconds during a print, saves in-progress data:

1. Reads current MW for each open slot record
2. Computes `checkpoint_g` as if the slot closed now (same formula as final close)
3. Partially decrements matched `FilamentRoll` by 10% of checkpoint value (approximate — for display purposes only)
4. Updates `cfs_slot_overrides.remaining_pct` proportionally

---

## 4. Filament Decrement Logic

### 4.1 Decrement on Print End (`_decrement_filament_rolls`)

Two paths:

**Path A: CFS slot usage records exist**

For each `CfsSlotUsage` with valid `filament_used_g`:
1. Update `CfsSlotOverride.remaining_pct`:
   ```
   new_pct = max(0, current_pct - (filament_used_g / spool_weight * 100))
   ```
2. Find the matching `FilamentRoll` (by `spool_id`), deduct `filament_used_g`
3. If no exact match, fall back to material match (first roll with `material` ILIKE containing the slot's material, ordered by `remaining_weight_g DESC`)

**Path B: No slot usage records (legacy/fallback)**

1. If an active CFS slot was tracked, update its override via percentage deduction
2. Material match fallback using `job.filament_type`
3. Deduct from the best-matching `FilamentRoll`

### 4.2 Runout Detection (`_check_runout_during_print`)

If `filament_switch_sensor` reports `enabled=True` and `filament_detected=False`:
- Check if active slot's `remaining_pct < 5%`
- If yes and the `FilamentRoll` hasn't already been flagged:
  - Set `runout_detected = True`
  - Set `remaining_weight_g = 0`
  - Set `override.remaining_pct = 0`
  - Record in `notes`

### 4.3 Vacancy Detection (`_detect_vacancy`)

When idle polling detects a slot disappeared:
- If `remaining_pct < 5%`: auto-empty the roll (set to 0, mark runout)
- Otherwise: return to stock (`spool_id = NULL`, location = "Removed from CFS")

### 4.4 Slot Change Detection (`_detect_slot_changes`)

When idle polling detects colour/material/RFID change or `remain_len` reset on a slot:
1. Unlink old `FilamentRoll` from slot (`spool_id = NULL`)
2. Create new `FilamentRoll` for the new spool
3. Preserve override settings (cost/kg, spool weight) on the new roll

---

## 5. Key Design Decisions & Guardrails

| Decision | Rationale |
|----------|-----------|
| **MW is per-tray, not per-slot** | Measuring wheels are physical devices on each CFS tray. Deltas across trays are meaningless. |
| **Cross-tray changes get NULL mm/g** | Prevents wild filament deductions when the measuring wheel resets between trays. |
| **`cfs_slot_overrides.remaining_pct` is authoritative** | CFS hardware `remain_len` is static/unreliable. Our tracked percentage is the source of truth. |
| **Purge/retract waste attributed to the new slot** | Wipe/purge/purge-retract sequences during filament changes are charged to the slot being switched to. |
| **Spool change via `color_hex + rfid_vendor` mismatch** | Colour code + RFID vendor together provide high confidence of a spool swap. |
| **Proportional attribution for cross-tray records** | Ensures Moonraker's total filament used matches the sum of all tracked slot usage. |
| **Checkpoint saves every 60s** | Limits data loss if the tracker crashes mid-print. |
| **Finalization guard** | If a new print starts while an old job is still `PRINTING`, the old job is force-finalized first. |
| **Stale CFS records deleted on reuse** | When a running print is detected and it matches an existing tracked job (e.g. after tracker restart), stale open slot records are cleaned up. |
| **`spool_weight_g` default 1000g** | Provides a reasonable default when the user hasn't configured per-slot spool weights. The `calibrated` flag tracks whether the data has been verified. |
| **`filament_type` fallback chain** | `_parse_material(filename)` → CFS active-slot material (at print finalization) → `filament_type` from Moonraker metadata. If all are null, decrement is skipped. |
| **Brand assignment** | RFID-tagged rolls always get `brand="Creality"`. Non-RFID `brand="CFS"` is cleared to `""`. Brand/material/color_hex on matched stock roll are never overwritten during sync — only `spool_id`, `location`, `remaining_weight_g`, `cost_per_kg`, `rfid_vendor` change. |
| **Color name derivation** | `color_name` is always derived from `color_hex` via `color_name_from_hex()` (50+ color entries). Never set to material name. Startup migration re-derives empty `color_name` from `color_hex`. |
| **Location format** | CFS rolls use `"CFS {slot_id}"` (e.g. `"CFS T1A"`). Removed partial rolls → `"Storage box"`. New/empty rolls → `"Shelf A"`. |
| **Override → roll sync** | When a CFS override is saved via `PUT /cfs/overrides/{slot_id}`, `remaining_weight_g` on the linked filament roll is recalculated as `remaining_pct / 100 * spool_weight_g`. This keeps override and roll in sync. |

---

<!-- Sections 6–8 shifted to 7–9 below -->

## 6. Smart Spool Matching & Confidence Learning

### 6.1 Problem

`_detect_slot_changes` and `_sync_cfs_to_library` always create a new `FilamentRoll(brand="CFS", ...)` on every detected spool change. The user manages inventory manually and needs the system to find existing stock rolls that match what was loaded, but **confirm with the user** before linking.

### 6.2 Match Learning Table

```sql
CREATE TABLE IF NOT EXISTS cfs_match_votes (
    id SERIAL PRIMARY KEY,
    slot_id VARCHAR(3) NOT NULL,
    material_code VARCHAR(10),
    color_hex VARCHAR(10),
    rfid_vendor VARCHAR(100),
    suggested_roll_id INTEGER REFERENCES filament_library(id),
    confirmed_roll_id INTEGER REFERENCES filament_library(id),
    auto_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    correct BOOLEAN,                 -- NULL = pending, True = correct match, False = user corrected
    created_at TIMESTAMP DEFAULT NOW(),
    responded_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_match_votes_slot ON cfs_match_votes(slot_id);
CREATE INDEX IF NOT EXISTS idx_match_votes_pending ON cfs_match_votes(correct) WHERE correct IS NULL;
```

### 6.3 Per-Slot Confidence Tracking

New columns on `cfs_slot_overrides`:

```
match_confidence FLOAT DEFAULT 0.0      -- rolling accuracy 0.0–1.0
auto_approve    BOOLEAN DEFAULT FALSE   -- if True, skip confirmation
match_attempts  INTEGER DEFAULT 0       -- total votes for this slot
match_hits      INTEGER DEFAULT 0       -- correct votes for this slot
```

Confidence is recalculated after each vote response:

```
match_confidence = match_hits / GREATEST(match_attempts, 1)
auto_approve = (match_confidence >= 0.9 AND match_attempts >= 20)
```

### 6.4 Smart Matching Algorithm

Replace the unconditional `FilamentRoll(brand="CFS", ...)` creation in `_detect_slot_changes` and `_sync_cfs_to_library`:

```python
# Priority:
# 1. Exact RFID vendor match (spool_id IS NULL, remaining_weight_g > 0)
# 2. Material ILIKE match with color hex proximity sorting

def _hex_distance(a: str, b: str) -> float:
    a = (a or "").lstrip("#")
    b = (b or "").lstrip("#")
    if len(a) != 6 or len(b) != 6:
        return 999.0
    ra, ga, ba = int(a[0:2], 16), int(a[2:4], 16), int(a[4:6], 16)
    rb, gb, bb = int(b[0:2], 16), int(b[2:4], 16), int(b[4:6], 16)
    return ((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) ** 0.5

candidates.sort(key=lambda r: (_hex_distance(cfs_hex, r.color_hex), -r.remaining_weight_g))
```

The closest color match among same-material rolls in stock wins.

### 6.5 Confirmation Flow

When a spool change is detected AND `auto_approve = False` for that slot:

1. Unlink old roll (set `spool_id = NULL, location = "Removed from CFS"`)
2. Run smart matching to find best candidate from stock
3. **Do NOT link the candidate** to the slot yet
4. Create `cfs_match_vote` row with `suggested_roll_id` set
5. Send webhook notification:

```json
{
  "event": "spool_match_suggestion",
  "slot_id": "T1A",
  "suggested_roll_id": 42,
  "suggested_name": "eSun PLA+ Black",
  "material": "PLA+",
  "color_hex": "#000000",
  "remaining_pct": 87.0,
  "confirm_url": "/api/cfs/match-vote/{vote_id}/confirm",
  "deny_url": "/api/cfs/match-vote/{vote_id}/deny",
  "correct_with_url": "/api/cfs/match-vote/{vote_id}/correct?roll_id=55"
}
```

6. Temporarily set the CFS slot to an **unlinked state** in the UI (shows the CFS-reported data but no library roll is associated). A small banner reads *"Waiting for confirmation of spool in T1A"*.

### 6.6 Polling / Confirmation Endpoint

`PATCH /api/cfs/match-vote/{vote_id}/confirm`

- Sets `correct = True, responded_at = NOW()`
- Links `suggested_roll_id` to the slot (`spool_id = slot_id`)
- Recalculates confidence for the slot
- Clears the "waiting" state

`PATCH /api/cfs/match-vote/{vote_id}/correct?roll_id=55`

- Same as confirm, but links the user-provided `roll_id` instead of the suggested one
- Sets `confirmed_roll_id = 55, correct = False`
- Recalculates confidence (will decrease)

`PATCH /api/cfs/match-vote/{vote_id}/deny`

- Sets `correct = False, confirmed_roll_id = NULL`
- The slot remains unlinked
- User must manually link a stock roll via the Filament Library page

### 6.7 Auto-Approval

When `auto_approve = True`:

1. Run smart matching
2. Directly link the best candidate (`spool_id = slot_id`)
3. Record vote with `auto_accepted = True, correct = True`
4. No webhook sent
5. If the user later manually changes the link (via Filament Library), the vote is corrected, confidence drops, and `auto_approve` flips back to `False`

### 6.8 Per-Slot Independence

Each slot (T1A, T2B, etc.) has its own `match_attempts` / `match_hits` / `match_confidence`. A slot that always uses eSun PLA+ Black will reach auto-approve quickly. A slot that frequently changes material will never be trusted — the user confirms every time.

---

## 7. Settings (Filament Density in `app_config`)

| Key | Default | Purpose |
|-----|---------|---------|
| `filament_density_pla` | 1.24 | g/cm³ |
| `filament_density_abs` | 1.04 | g/cm³ |
| `filament_density_petg` | 1.27 | g/cm³ |
| `filament_density_tpu` | 1.21 | g/cm³ |
| `filament_diameter_mm` | 1.75 | Standard 1.75mm filament |
| `default_filament_cost_per_kg` | 24.0 | AUD, fallback cost |
| `electricity_rate_kwh` | 0.49 | AUD per kWh |

---

## 8. Debug Tests

Three test cases in `backend/app/api/routes/debug.py` validate filament tracking:

| Test | Purpose |
|------|---------|
| `cross_tray_guard` | Checks no `cfs_slot_usage` record has an MW delta > 100,000mm (would indicate cross-tray contamination) |
| `filament_decrement` | Verifies no `FilamentRoll` has negative `remaining_weight_g` |
| `cfs_override_decrement` | Verifies no `CfsSlotOverride` has negative `remaining_pct` |

---

## 9. Cost Calculation

On print end (`_calculate_costs`):

### Power Cost
```
total_kwh = sum of wattage * delta_h / 1000 across all PowerLogs
if total_kwh == 0 and actual_duration > 0:
    total_kwh = 151.0 * duration_h / 1000    // fallback to 151W avg
electricity_cost = total_kwh * rate
```

### Filament Cost
For each `CfsSlotUsage` with valid `filament_used_g`:
```
cost_per_kg = (slot override cost) OR (roll cost) OR (material-type roll cost) OR (default)
filament_cost += (filament_used_g / 1000) * cost_per_kg
```

Legend fallback chain for cost_per_kg:
1. `CfsSlotOverride.cost_per_kg` for that slot
2. `FilamentRoll` matched by `spool_id`
3. `FilamentRoll` matched by material type (ILike, ordered by remaining_weight_g DESC)
4. `default_filament_cost_per_kg` from settings ($24.0 AUD)
