from fastapi import APIRouter, Depends, Request, Query
from sqlalchemy.orm import Session
import aiohttp
from app.core.config import settings
from app.core.database import get_db
from app.models.app_config import AppConfig

router = APIRouter(prefix="/files", tags=["files"])


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


@router.get("/list")
async def list_files(request: Request, db: Session = Depends(get_db), root: str = Query("gcodes")):
    """List gcode files on the printer via Moonraker."""
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/server/files/list?root={root}"
    async with session.get(url) as resp:
        if resp.status != 200:
            return {"files": [], "error": f"Moonraker returned {resp.status}"}
        data = await resp.json()
    files = data.get("result", [])
    result = []
    for f in files:
        path = f.get("path", "")
        size = f.get("size", 0)
        modified = f.get("modified", 0)
        filename = path.split("/")[-1] if "/" in path else path
        if not filename or filename.startswith("."):
            continue
        result.append({
            "filename": filename,
            "path": path,
            "size": size,
            "size_mb": round(size / (1024 * 1024), 1) if size else 0,
            "modified": modified,
        })
    result.sort(key=lambda x: x.get("modified", 0) or 0, reverse=True)
    return {"files": result, "total": len(result)}


@router.get("/metadata")
async def get_file_metadata(request: Request, db: Session = Depends(get_db), filename: str = Query(...)):
    """Get metadata for a specific gcode file."""
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/server/files/metadata?filename={filename}"
    async with session.get(url) as resp:
        if resp.status != 200:
            return {"error": f"Moonraker returned {resp.status}"}
        data = await resp.json()
    result = data.get("result", {})
    return {
        "filename": result.get("filename", filename),
        "size": result.get("size"),
        "object_height": result.get("object_height"),
        "first_layer_height": result.get("first_layer_height"),
        "slicer": result.get("slicer"),
        "modified": result.get("modified"),
        "estimated_time": result.get("estimated_time"),
        "filament_total": result.get("filament_total"),
        "thumbnails": result.get("thumbnails", []),
    }


@router.get("/thumbnail")
async def get_file_thumbnail(request: Request, db: Session = Depends(get_db), filename: str = Query(...)):
    """Get thumbnail path for a gcode file."""
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    url = f"{moonraker_url}/server/files/metadata?filename={filename}"
    async with session.get(url) as resp:
        if resp.status != 200:
            return {"thumbnail": None}
        data = await resp.json()
    result = data.get("result", {})
    thumbnails = result.get("thumbnails", [])
    if thumbnails:
        thumb = thumbnails[-1]
        return {"thumbnail": f"{moonraker_url}/server/files/{thumb.get('relative_path', '')}"}
    return {"thumbnail": None}