import math
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from datetime import datetime, timezone
import aiohttp

from app.core.config import settings
from app.core.database import get_db
from app.services.print_job_service import PrintJobService
from app.models.print_job import PrintJob
from app.models.app_config import AppConfig

router = APIRouter(prefix="/history", tags=["history"])


def _get_moonraker_url(db: Session) -> str:
    from app.models.app_config import AppConfig
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

STATUS_MAP = {
    "completed": "COMPLETE",
    "cancelled": "CANCELLED",
    "error": "FAILED",
    "in_progress": "PRINTING",
    "printing": "PRINTING",
}

FILAMENT_DIAMETER = 1.75
CROSS_SECTION = math.pi * (FILAMENT_DIAMETER / 2) ** 2
PLA_DENSITY = 1.24


def _mm_to_g(mm: float, density: float = PLA_DENSITY) -> float:
    return round(mm * CROSS_SECTION * density / 1000, 2)


def _get_density(db: Session, material: str | None) -> float:
    key_map = {"PLA": "filament_density_pla", "ABS": "filament_density_abs", "PETG": "filament_density_petg", "TPU": "filament_density_tpu"}
    key = key_map.get(material or "PLA", "filament_density_pla")
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    return float(row.value) if row else PLA_DENSITY


@router.post("/sync")
async def sync_history(request: Request, db: Session = Depends(get_db)):
    """Import print history from Moonraker into our database."""
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/server/history/list?limit=500"
    async with session.get(url) as resp:
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Moonraker request failed")
        data = await resp.json()

    moonraker_jobs = data.get("result", {}).get("jobs", [])
    service = PrintJobService(db)
    imported = 0
    updated = 0

    for mj in moonraker_jobs:
        filename = mj.get("filename", "")
        if not filename:
            continue

        start_ts = mj.get("start_time", 0)
        start_dt = datetime.fromtimestamp(start_ts, tz=timezone.utc)
        existing = db.query(PrintJob).filter(
            PrintJob.filename == filename,
            PrintJob.start_time == start_dt,
        ).first()

        filament_mm = mj.get("filament_used", 0)
        meta = mj.get("metadata", {})
        fg_list = meta.get("filament_used_g", [None]) if isinstance(meta.get("filament_used_g"), list) else []
        estimated_filament_g = float(fg_list[0]) if fg_list and fg_list[0] else None

        if existing:
            needs_update = False
            u = {}
            mat = _parse_material(filename)
            if not existing.actual_duration_seconds and mj.get("print_duration"):
                u["actual_duration_seconds"] = int(mj["print_duration"])
            if not existing.filament_length_mm and filament_mm and filament_mm > 0:
                u["filament_length_mm"] = filament_mm
            if not existing.filament_used_g and filament_mm and filament_mm > 0:
                u["filament_used_g"] = _mm_to_g(filament_mm, _get_density(db, mat))
            if not existing.estimated_filament_g and estimated_filament_g:
                u["estimated_filament_g"] = estimated_filament_g
            if not existing.estimated_duration_seconds and meta.get("estimated_time"):
                u["estimated_duration_seconds"] = meta["estimated_time"]
            if not existing.end_time and mj.get("end_time"):
                u["end_time"] = datetime.fromtimestamp(mj["end_time"], tz=timezone.utc)
            if not existing.filament_type and mat:
                u["filament_type"] = mat
            if u:
                service.update_print_job(existing.id, u)
                updated += 1
            continue

        status_raw = mj.get("status", "completed")
        status = STATUS_MAP.get(status_raw, "COMPLETE")
        end_ts = mj.get("end_time")
        print_duration = mj.get("print_duration", 0)

        filament_g = None
        mat = _parse_material(filename)
        if filament_mm and filament_mm > 0:
            filament_g = _mm_to_g(filament_mm, _get_density(db, mat))

        service.create_print_job({
            "filename": filename,
            "status": status,
            "start_time": start_dt if start_ts else datetime.now(timezone.utc),
            "end_time": datetime.fromtimestamp(end_ts, tz=timezone.utc) if end_ts else None,
            "actual_duration_seconds": int(print_duration) if print_duration else None,
            "estimated_duration_seconds": meta.get("estimated_time") if meta.get("estimated_time") else None,
            "estimated_filament_g": estimated_filament_g,
            "filament_length_mm": filament_mm if filament_mm else None,
            "filament_used_g": filament_g,
            "filament_type": mat,
        })
        imported += 1

    return {"imported": imported, "updated": updated, "total": len(moonraker_jobs)}


def _parse_material(filename: str) -> str | None:
    upper = filename.upper()
    for mat in ("PLA", "PETG", "ABS", "TPU", "ASA", "NYLON", "PC", "HIPS"):
        if mat in upper:
            return mat.capitalize()
    return None
