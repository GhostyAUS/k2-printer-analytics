from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import Dict, List, Optional
import aiohttp
from app.core.config import settings
from app.core.database import get_db
from app.models.app_config import AppConfig
from app.models.cfs_override import CfsSlotOverride

from app.core.cfs_constants import MATERIAL_MAP, normalize_hex, build_name_map

router = APIRouter(prefix="/cfs", tags=["cfs"])


def _get_moonraker_url(db: Session) -> str:
    host_row = db.query(AppConfig).filter(AppConfig.key == "moonraker_host").first()
    port_row = db.query(AppConfig).filter(AppConfig.key == "moonraker_port").first()
    host = host_row.value if host_row else settings.moonraker_host
    port = int(port_row.value) if port_row else settings.moonraker_port
    return f"http://{host}:{port}"


async def _get_session(request: Request) -> aiohttp.ClientSession:
    session: aiohttp.ClientSession = request.app.state.http_session
    if session.closed:
        session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        request.app.state.http_session = session
    return session


def _load_overrides(db: Session) -> dict[str, CfsSlotOverride]:
    rows = db.query(CfsSlotOverride).all()
    return {r.slot_id: r for r in rows}


def _merge_slot(slot: dict, overrides: dict[str, CfsSlotOverride], library: dict[str, "FilamentRoll"] = None, pending_votes: dict[str, int] = None) -> dict:
    o = overrides.get(slot["slot"])
    if o is None:
        slot["has_override"] = False
    else:
        if o.material_name:
            slot["material_name"] = o.material_name
        if o.color_hex:
            slot["color_hex"] = normalize_hex(o.color_hex)
        if o.remaining_pct is not None:
            slot["remaining_pct"] = int(o.remaining_pct)
        slot["has_override"] = True
        slot["cost_per_kg"] = o.cost_per_kg
        slot["spool_weight_g"] = o.spool_weight_g
        slot["calibrated"] = o.calibrated or False
        slot["match_confidence"] = o.match_confidence or 0.0
        slot["auto_approve"] = o.auto_approve or False
        slot["match_attempts"] = o.match_attempts or 0
        slot["match_hits"] = o.match_hits or 0
        if o.cost_per_kg and o.spool_weight_g:
            slot["estimated_spool_cost"] = round(o.cost_per_kg * o.spool_weight_g / 1000, 2)

    if library:
        roll = library.get(slot["slot"])
        if roll:
            slot["remaining_weight_g"] = round(roll.remaining_weight_g, 1)
            slot["total_weight_g"] = roll.total_weight_g
            if roll.cost_per_kg and not slot.get("cost_per_kg"):
                slot["cost_per_kg"] = roll.cost_per_kg
            if roll.rfid_vendor and not slot.get("rfid_vendor"):
                slot["rfid_vendor"] = roll.rfid_vendor
            if roll.runout_detected:
                slot["runout_detected"] = True
        elif slot["remaining_pct"] is not None:
            spool_w = slot.get("spool_weight_g") or 1000.0
            slot["remaining_weight_g"] = round(slot["remaining_pct"] / 100.0 * spool_w, 1)
            slot["total_weight_g"] = spool_w
    elif slot["remaining_pct"] is not None:
        spool_w = slot.get("spool_weight_g") or 1000.0
        slot["remaining_weight_g"] = round(slot["remaining_pct"] / 100.0 * spool_w, 1)
        slot["total_weight_g"] = spool_w

    if pending_votes and slot["slot"] in pending_votes:
        slot["match_vote_pending"] = True
        slot["pending_vote_id"] = pending_votes[slot["slot"]]

    return slot


def _load_pending_votes(db: Session) -> dict[str, int]:
    from app.models.cfs_match_vote import CfsMatchVote
    rows = db.query(CfsMatchVote).filter(
        CfsMatchVote.correct.is_(None),
        CfsMatchVote.auto_accepted == False,
    ).all()
    return {r.slot_id: r.id for r in rows}


def _build_slots(box: dict, filament_rack: dict, name_map: dict, overrides: dict[str, CfsSlotOverride], is_printing: bool = False, library: dict = None, pending_votes: dict[str, int] = None) -> list[dict]:
    rack_color = filament_rack.get("remain_material_color", "-1")
    rack_mat = filament_rack.get("remain_material_type", "-1")
    rack_velocity = filament_rack.get("remain_material_velocity", 0)

    slots = []
    active_slot_id = None

    for tray_id in ("T1", "T2", "T3", "T4"):
        tray = box.get(tray_id, {})
        if tray.get("state") == "None":
            continue
        remaining_pct = tray.get("remain_len", ["0", "0", "0", "0"])
        colors = tray.get("color_value", ["-1", "-1", "-1", "-1"])
        materials = tray.get("material_type", ["-1", "-1", "-1", "-1"])
        vendors = tray.get("vender", ["unknown"] * 4)
        tray_filament = tray.get("filament", "None")
        tray_mode = tray.get("mode", 0)
        measuring_wheel = tray.get("measuring_wheel")

        for i, label in enumerate(["A", "B", "C", "D"]):
            slot_id = f"{tray_id}{label}"
            color_hex = colors[i] if i < len(colors) else "-1"
            mat_code = materials[i] if i < len(materials) else "-1"
            vendor = vendors[i] if i < len(vendors) else "unknown"
            if mat_code == "-1" or color_hex == "-1":
                continue
            norm_hex = color_hex
            if norm_hex and norm_hex != "-1":
                h = norm_hex.replace('#', '')
                if len(h) == 7 and h.startswith('0'):
                    h = h[1:]
                norm_hex = f"#{h}" if len(h) == 6 else norm_hex
            override_name = name_map.get(slot_id, "")
            slot = {
                "slot": slot_id,
                "tray": tray_id,
                "position": label,
                "color_hex": norm_hex,
                "material_code": mat_code,
                "material_name": override_name or MATERIAL_MAP.get(mat_code, "Unknown"),
                "remaining_pct": int(remaining_pct[i]) if i < len(remaining_pct) else 0,
                "temperature": tray.get("temperature"),
                "humidity": tray.get("dry_and_humidity"),
                "rfid_vendor": vendor if vendor != "unknown" else None,
            }

            is_active = False
            feed_state = "idle"

            if is_printing and str(tray_mode) == "2" and str(tray_filament) == label:
                is_active = True
                active_slot_id = slot_id
                if rack_velocity and isinstance(rack_velocity, (int, float)) and rack_velocity > 0:
                    feed_state = "feeding"
                else:
                    feed_state = "active"

            slot["is_active"] = is_active
            slot["feed_state"] = feed_state

            slots.append(_merge_slot(slot, overrides, library, pending_votes))

    if active_slot_id and is_printing:
        for s in slots:
            if s["slot"] == active_slot_id:
                s["is_active"] = True
                if s["feed_state"] == "idle":
                    s["feed_state"] = "active"

    return slots


@router.get("/state")
async def get_cfs_state(request: Request, db: Session = Depends(get_db)) -> dict:
    """Lightweight CFS state: active slot, feed state, is_printing, per-slot states."""
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/printer/objects/query?filament_rack&box&print_stats"
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
        if resp.status != 200:
            return {"active_slot_id": None, "feed_state": "idle", "is_printing": False, "slot_states": {}}
        data = await resp.json()

    result = data.get("result", {}).get("status", {})
    box = result.get("box", {})
    filament_rack = result.get("filament_rack", {})
    print_stats = result.get("print_stats", {})
    is_printing = print_stats.get("state") == "printing"
    rack_velocity = filament_rack.get("remain_material_velocity", 0)

    active_slot_id = None
    feed_state = "idle"
    slot_states: dict[str, str] = {}

    for tray_id in ("T1", "T2", "T3", "T4"):
        tray = box.get(tray_id, {})
        tray_state = tray.get("state", "None")
        tray_filament = tray.get("filament", "None")
        tray_mode = tray.get("mode", 0)
        for label in ["A", "B", "C", "D"]:
            slot_id = f"{tray_id}{label}"
            if tray_state == "None":
                slot_states[slot_id] = "empty"
                continue
            if str(tray_mode) == "1":
                slot_states[slot_id] = "loading"
            elif is_printing and str(tray_mode) == "2" and str(tray_filament) == label:
                slot_states[slot_id] = "feeding" if (rack_velocity and isinstance(rack_velocity, (int, float)) and rack_velocity > 0) else "active"
                if not active_slot_id:
                    active_slot_id = slot_id
                    feed_state = slot_states[slot_id]
            elif is_printing and str(tray_mode) == "2":
                slot_states[slot_id] = "standby"
            else:
                slot_states[slot_id] = "idle"

    return {"active_slot_id": active_slot_id, "feed_state": feed_state, "is_printing": is_printing, "slot_states": slot_states}


@router.get("/slots")
async def get_cfs_slots(request: Request, db: Session = Depends(get_db)) -> dict:
    from app.models.filament_roll import FilamentRoll
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/printer/objects/query?filament_rack&box&print_stats"
    async with session.get(url) as resp:
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Moonraker request failed")
        data = await resp.json()

    result = data.get("result", {}).get("status", {})
    box = result.get("box", {})
    filament_rack = result.get("filament_rack", {})
    same_material = box.get("same_material", [])
    print_stats = result.get("print_stats", {})
    is_printing = print_stats.get("state") == "printing"

    name_map = build_name_map(same_material)
    overrides = _load_overrides(db)
    library = {r.spool_id: r for r in db.query(FilamentRoll).filter(FilamentRoll.spool_id.isnot(None)).all()}
    pending_votes = _load_pending_votes(db)
    slots = _build_slots(box, filament_rack, name_map, overrides, is_printing, library, pending_votes)

    return {"slots": slots, "is_printing": is_printing}


@router.get("/active")
async def get_active_slot(request: Request, db: Session = Depends(get_db)) -> dict:
    from app.models.filament_roll import FilamentRoll
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/printer/objects/query?filament_rack&box&print_stats"
    async with session.get(url) as resp:
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Moonraker request failed")
        data = await resp.json()

    result = data.get("result", {}).get("status", {})
    box = result.get("box", {})
    filament_rack = result.get("filament_rack", {})
    print_stats = result.get("print_stats", {})
    same_material = box.get("same_material", [])

    if print_stats.get("state") != "printing":
        return {"active_slot": None, "is_printing": False, "feed_state": "idle", "slots": []}

    name_map = build_name_map(same_material)
    overrides = _load_overrides(db)
    library = {r.spool_id: r for r in db.query(FilamentRoll).filter(FilamentRoll.spool_id.isnot(None)).all()}
    pending_votes = _load_pending_votes(db)
    slots = _build_slots(box, filament_rack, name_map, overrides, True, library, pending_votes)

    active = None
    feed_state = "idle"
    for s in slots:
        if s.get("is_active"):
            active = s
            feed_state = s.get("feed_state", "idle")
            break

    return {"active_slot": active, "slots": slots, "is_printing": True, "feed_state": feed_state}


@router.post("/sync-library")
async def sync_cfs_to_library(request: Request, db: Session = Depends(get_db)):
    from app.models.filament_roll import FilamentRoll
    from app.core.cfs_constants import MATERIAL_MAP, normalize_hex, build_name_map, color_name_from_hex
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/printer/objects/query?filament_rack&box"
    async with session.get(url) as resp:
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Moonraker request failed")
        data = await resp.json()

    result = data.get("result", {}).get("status", {})
    box = result.get("box", {})
    same_material = box.get("same_material", [])
    name_map = _build_name_map(same_material)
    overrides = _load_overrides(db)

    synced = []
    for tray_id in ("T1", "T2", "T3", "T4"):
        tray = box.get(tray_id, {})
        if tray.get("state") == "None" and str(tray.get("mode", "-1")) == "-1":
            continue
        colors = tray.get("color_value", ["-1"] * 4)
        materials = tray.get("material_type", ["-1"] * 4)
        remain_lens = tray.get("remain_len", ["0"] * 4)
        vendors = tray.get("vender", ["unknown"] * 4)
        for i, label in enumerate(["A", "B", "C", "D"]):
            slot_id = f"{tray_id}{label}"
            mat_code = materials[i] if i < len(materials) else "-1"
            color_hex = colors[i] if i < len(colors) else "-1"
            vendor = vendors[i] if i < len(vendors) else "unknown"
            rfid_vendor = vendor if vendor != "unknown" else None
            if mat_code == "-1" or color_hex == "-1":
                continue

            override = overrides.get(slot_id)
            mat_name = override.material_name if override and override.material_name else name_map.get(slot_id, "") or MATERIAL_MAP.get(mat_code, "Unknown")
            spool_weight = override.spool_weight_g if override and override.spool_weight_g else 1000.0
            cost_per_kg = override.cost_per_kg if override and override.cost_per_kg else None
            if override and override.calibrated and override.remaining_pct is not None:
                remaining_pct = override.remaining_pct
            elif override and override.remaining_pct is not None:
                remaining_pct = override.remaining_pct
            else:
                remaining_pct = int(remain_lens[i]) if i < len(remain_lens) else 100
            remaining_g = round(remaining_pct / 100.0 * spool_weight, 1)
            cfs_hex = color_hex
            if cfs_hex and cfs_hex != "-1":
                h = cfs_hex.replace('#', '')
                if len(h) == 7 and h.startswith('0'):
                    h = h[1:]
                cfs_hex = f"#{h}" if len(h) == 6 else cfs_hex

            roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == slot_id).first()
            if roll:
                roll_color = (roll.color_hex or "").replace('#', '').lower()
                cfs_color = cfs_hex.replace('#', '').lower() if cfs_hex else ""
                roll_rfid = roll.rfid_vendor or ""
                cfs_rfid = rfid_vendor or ""
                spool_changed = (roll_color and cfs_color and roll_color != cfs_color) or (roll_rfid and cfs_rfid and roll_rfid != cfs_rfid)

                if spool_changed:
                    roll.spool_id = None
                    roll.location = "Storage box" if (roll.remaining_weight_g or 0) > 0 else "Shelf A"
                    c_name = color_name_from_hex(cfs_hex)
                    roll = FilamentRoll(
                        brand="Creality" if rfid_vendor else "",
                        material=mat_name,
                        color_hex=cfs_hex,
                        color_name=c_name,
                        total_weight_g=spool_weight,
                        remaining_weight_g=remaining_g,
                        spool_weight_g=0,
                        cost_per_kg=cost_per_kg,
                        spool_id=slot_id,
                        location=f"CFS {slot_id}",
                        rfid_vendor=rfid_vendor,
                    )
                    db.add(roll)
                    if override:
                        override.remaining_pct = remaining_pct
                        override.calibrated = False
                        override.color_hex = None
                        override.material_name = None
                else:
                    roll.total_weight_g = spool_weight
                    roll.remaining_weight_g = remaining_g
                    if cost_per_kg:
                        roll.cost_per_kg = cost_per_kg
                    roll.location = f"CFS {slot_id}"
                    if rfid_vendor:
                        roll.rfid_vendor = rfid_vendor
            else:
                c_name = color_name_from_hex(cfs_hex)
                roll = FilamentRoll(
                    brand="Creality" if rfid_vendor else "",
                    material=mat_name,
                    color_hex=cfs_hex,
                    color_name=c_name,
                    total_weight_g=spool_weight,
                    remaining_weight_g=remaining_g,
                    spool_weight_g=0,
                    cost_per_kg=cost_per_kg,
                    spool_id=slot_id,
                    location=f"CFS {slot_id}",
                    rfid_vendor=rfid_vendor,
                )
                db.add(roll)
            synced.append({
                "slot_id": slot_id,
                "material": mat_name,
                "color_hex": cfs_hex,
                "remaining_pct": remaining_pct,
                "remaining_g": remaining_g,
            })

    db.commit()
    return {"synced": synced, "count": len(synced)}
