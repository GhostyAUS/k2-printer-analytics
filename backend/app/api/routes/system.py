from fastapi import APIRouter, HTTPException, Request, Depends
from sqlalchemy.orm import Session
from typing import Dict, Any
import aiohttp

from app.core.config import settings
from app.core.database import get_db
from app.models.app_config import AppConfig

router = APIRouter(prefix="/system", tags=["system"])


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


@router.get("/health")
async def get_system_health(request: Request, db: Session = Depends(get_db)) -> Dict[str, Any]:
    session = await _get_session(request)
    url = f"{_get_moonraker_url(db)}/printer/objects/query?system_stats"
    async with session.get(url) as resp:
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Moonraker request failed")
        data = await resp.json()

    ss = data.get("result", {}).get("status", {}).get("system_stats", {})
    sysload = ss.get("sysload", 0)
    memavail_kb = ss.get("memavail", 0)
    uptime_s = ss.get("monotonic", 0)

    return {
        "cpu_load": round(sysload, 2),
        "memory_available_mb": round(memavail_kb / 1024, 1),
        "uptime_seconds": int(uptime_s),
        "uptime_hours": round(uptime_s / 3600, 1),
    }
