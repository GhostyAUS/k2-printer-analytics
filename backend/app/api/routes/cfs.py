from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import Dict, List, Optional
import aiohttp
from app.core.config import settings
from app.core.database import get_db
from app.models.app_config import AppConfig
from app.models.cfs_override import CfsSlotOverride

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

MATERIAL_MAP = {
    "0e1001": "PLA+",
    "101001": "PLA",
    "001001": "PETG",
    "000001": "ABS",
    "0E1001": "PLA+",
    "0ff614b": "PLA Matte",
    "0C12E1F": "PLA Silk",
    "0FFFFFF": "PLA White",
    "000a3ff": "PLA Blue",
    "09ea7ae": "PLA+ Green",
    "0000000": "PLA Black",
    "01b04ae": "PLA Blue",
    "0fc9da9": "PLA Orange",
}

VALID_SLOTS = [f"T{t}{p}" for t in ("1", "2", "3", "4") for p in ("A", "B", "C", "D")]


def _build_name_map(same_material: list) -> dict[str, str]:
    name_map: dict[str, str] = {}
    for entry in same_material:
        if len(entry) >= 4:
            slots_list = entry[2] if isinstance(entry[2], list) else []
            name = entry[3] or ""
            for sid in slots_list:
                if name:
                    name_map[sid] = name
    return name_map


def _load_overrides(db: Session) -> dict[str, CfsSlotOverride]:
    rows = db.query(CfsSlotOverride).all()
    return {r.slot_id: r for r in rows}


def _merge_slot(slot: dict, overrides: dict[str, CfsSlotOverride]) -> dict:
    o = overrides.get(slot["slot"])
    if o is None:
        slot["has_override"] = False
        return slot

    if o.material_name:
        slot["material_name"] = o.material_name
    if o.color_hex:
        slot["color_hex"] = o.color_hex
    if o.remaining_pct is not None:
        slot["remaining_pct"] = int(o.remaining_pct)

    slot["has_override"] = True
    slot["cost_per_kg"] = o.cost_per_kg
    slot["spool_weight_g"] = o.spool_weight_g
    if o.cost_per_kg and o.spool_weight_g:
        slot["estimated_spool_cost"] = round(o.cost_per_kg * o.spool_weight_g / 1000, 2)
    return slot


@router.get("/slots")
async def get_cfs_slots(request: Request, db: Session = Depends(get_db)) -> Dict[str, List[dict]]:
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/printer/objects/query?filament_rack&box"
    async with session.get(url) as resp:
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Moonraker request failed")
        data = await resp.json()

    result = data.get("result", {}).get("status", {})
    box = result.get("box", {})
    filament_rack = result.get("filament_rack", {})
    same_material = box.get("same_material", [])

    name_map = _build_name_map(same_material)
    overrides = _load_overrides(db)

    slots = []
    for tray_id in ("T1", "T2", "T3", "T4"):
        tray = box.get(tray_id, {})
        if tray.get("state") == "None":
            continue
        remaining_pct = tray.get("remain_len", ["0", "0", "0", "0"])
        colors = tray.get("color_value", ["-1", "-1", "-1", "-1"])
        materials = tray.get("material_type", ["-1", "-1", "-1", "-1"])
        for i, label in enumerate(["A", "B", "C", "D"]):
            slot_id = f"{tray_id}{label}"
            color_hex = colors[i] if i < len(colors) else "-1"
            mat_code = materials[i] if i < len(materials) else "-1"
            if mat_code == "-1" or color_hex == "-1":
                continue
            override_name = name_map.get(slot_id, "")
            slot = {
                "slot": slot_id,
                "tray": tray_id,
                "position": label,
                "color_hex": color_hex,
                "material_code": mat_code,
                "material_name": override_name or MATERIAL_MAP.get(mat_code, "Unknown"),
                "remaining_pct": int(remaining_pct[i]) if i < len(remaining_pct) else 0,
                "temperature": tray.get("temperature"),
                "humidity": tray.get("dry_and_humidity"),
            }
            slots.append(_merge_slot(slot, overrides))

    return {"slots": slots}


@router.get("/active")
async def get_active_slot(request: Request, db: Session = Depends(get_db)) -> dict:
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

    name_map = _build_name_map(same_material)
    overrides = _load_overrides(db)

    if print_stats.get("state") != "printing":
        return {"active_slot": None, "is_printing": False}

    # filament_rack uses remain_material_* when a material is loaded
    rack_color = filament_rack.get("remain_material_color") or filament_rack.get("color_value", "-1")
    rack_mat = filament_rack.get("remain_material_type") or filament_rack.get("material_type", "-1")

    slots = []
    active = None

    for tray_id in ("T1", "T2", "T3", "T4"):
        tray = box.get(tray_id, {})
        if tray.get("state") == "None":
            continue
        remaining_pct = tray.get("remain_len", ["0", "0", "0", "0"])
        colors = tray.get("color_value", ["-1", "-1", "-1", "-1"])
        materials = tray.get("material_type", ["-1", "-1", "-1", "-1"])
        for i, label in enumerate(["A", "B", "C", "D"]):
            slot_id = f"{tray_id}{label}"
            color_hex = colors[i] if i < len(colors) else "-1"
            mat_code = materials[i] if i < len(materials) else "-1"
            if mat_code == "-1" or color_hex == "-1":
                continue
            override_name = name_map.get(slot_id, "")
            entry = {
                "slot": slot_id,
                "tray": tray_id,
                "position": label,
                "color_hex": color_hex,
                "material_code": mat_code,
                "material_name": override_name or MATERIAL_MAP.get(mat_code, "Unknown"),
                "remaining_pct": int(remaining_pct[i]) if i < len(remaining_pct) else 0,
            }
            merged = _merge_slot(entry, overrides)
            slots.append(merged)
            # Active matching uses raw CFS data, not overrides
            if color_hex == rack_color and mat_code == rack_mat:
                active = merged

    return {"active_slot": active, "slots": slots, "is_printing": True}
