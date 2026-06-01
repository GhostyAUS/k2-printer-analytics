from fastapi import APIRouter, Depends, Request, Query
from fastapi.responses import Response, RedirectResponse
from sqlalchemy.orm import Session
from urllib.parse import quote
import aiohttp
import base64
import logging
from app.core.config import settings
from app.core.database import get_db
from app.models.app_config import AppConfig

logger = logging.getLogger(__name__)

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


async def _extract_gcode_thumbnail(session: aiohttp.ClientSession, moonraker_url: str, filename: str) -> bytes | None:
    gcode_url = f"{moonraker_url}/server/files/gcodes/{quote(filename, safe='/')}"
    headers = {"Range": "bytes=0-65535"}
    try:
        async with session.get(gcode_url, headers=headers) as resp:
            if resp.status not in (200, 206):
                return None
            data = await resp.text()
    except Exception:
        return None

    best_b64 = None
    best_size = 0
    lines = data.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("; thumbnail begin") or line.startswith("; png begin"):
            parts = line.split()
            dims = None
            for p in parts:
                if "x" in p and p.replace("x", "").isdigit():
                    dims = p
                    break
            width = 0
            if dims:
                try:
                    width = int(dims.split("x")[0])
                except ValueError:
                    pass
            b64_lines = []
            i += 1
            while i < len(lines):
                l = lines[i].strip()
                if l.startswith("; thumbnail end") or l.startswith("; png end"):
                    break
                if l.startswith(";"):
                    b64_lines.append(l[1:].strip())
                i += 1
            if b64_lines and width >= best_size:
                try:
                    img_bytes = base64.b64decode("".join(b64_lines))
                    best_b64 = img_bytes
                    best_size = width
                except Exception:
                    pass
        i += 1

    return best_b64


async def _find_thumbnail_path(session: aiohttp.ClientSession, moonraker_url: str, filename: str) -> str | None:
    url = f"{moonraker_url}/server/files/metadata?filename={quote(filename)}"
    async with session.get(url) as resp:
        if resp.status == 200:
            data = await resp.json()
            result = data.get("result", {})
            thumbnails = result.get("thumbnails", [])
            if thumbnails:
                best = max(thumbnails, key=lambda t: t.get("width", 0))
                rel = best.get("relative_path", "")
                if rel:
                    return f"{moonraker_url}/server/files/{rel}"

    if "/" in filename:
        parent = filename.rsplit("/", 1)[0]
        gcode_name = filename.rsplit("/", 1)[1]
        png_name = gcode_name.rsplit(".", 1)[0] + ".png"
        for prefix in ("", "."):
            dir_path = f"{parent}/{prefix}{parent}" if "/" not in parent else f"gcodes/{prefix}{parent}"
            test_url = f"{moonraker_url}/server/files/{quote(dir_path + '/' + png_name, safe='/')}"
            async with session.get(test_url) as resp:
                if resp.status == 200:
                    return test_url

    all_url = f"{moonraker_url}/server/files/list?root=gcodes"
    async with session.get(all_url) as resp:
        if resp.status != 200:
            return None
        all_files = (await resp.json()).get("result", [])

    gcode_base = filename.rsplit("/", 1)[-1] if "/" in filename else filename
    png_base = gcode_base.rsplit(".", 1)[0] + ".png"

    for f in all_files:
        fpath = f.get("path", "")
        if fpath.endswith("/" + png_base):
            return f"{moonraker_url}/server/files/gcodes/{quote(fpath, safe='/')}"

    dirs_url = f"{moonraker_url}/server/files/directory?path=gcodes/"
    async with session.get(dirs_url) as resp:
        if resp.status != 200:
            return None
        dir_data = (await resp.json()).get("result", {})
        dirs = dir_data.get("dirs", [])

    for d in dirs:
        dirname = d.get("dirname", "") if isinstance(d, dict) else str(d)
        if not dirname.startswith("."):
            continue
        dir_path = f"gcodes/{dirname}"
        sub_url = f"{moonraker_url}/server/files/directory?path={quote(dir_path)}"
        async with session.get(sub_url) as resp:
            if resp.status != 200:
                continue
            sub_data = (await resp.json()).get("result", {})
            sub_files = sub_data.get("files", [])
            has_gcode = any(sf.get("filename", "").lower() == gcode_base.lower() for sf in sub_files)
            if not has_gcode:
                continue
            for sf in sub_files:
                sfn = sf.get("filename", "")
                if sfn == png_base:
                    return f"{moonraker_url}/server/files/gcodes/{quote(dirname + '/' + sfn, safe='/')}"
            for sf in sub_files:
                sfn = sf.get("filename", "")
                if sfn.endswith(".png") and "plate" in sfn:
                    return f"{moonraker_url}/server/files/gcodes/{quote(dirname + '/' + sfn, safe='/')}"

    return None


@router.get("/thumbnail")
async def get_file_thumbnail(request: Request, db: Session = Depends(get_db), filename: str = Query(...)):
    """Get thumbnail URL or extracted base64 for a gcode file."""
    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)
    thumb_url = await _find_thumbnail_path(session, moonraker_url, filename)
    if thumb_url:
        return {"thumbnail": thumb_url}

    img_bytes = await _extract_gcode_thumbnail(session, moonraker_url, filename)
    if img_bytes:
        import hashlib
        h = hashlib.md5(img_bytes).hexdigest()[:12]
        b64 = base64.b64encode(img_bytes).decode("ascii")
        return {"thumbnail": f"data:image/png;base64,{b64}", "thumbnail_hash": h}

    return {"thumbnail": None}


@router.get("/thumbnail-image")
async def get_thumbnail_image(request: Request, db: Session = Depends(get_db), filename: str = Query(...), token: str = Query(None)):
    """Proxy thumbnail image for a gcode file. Returns PNG directly or 404."""
    if token:
        from app.core.auth import verify_token
        payload = verify_token(token)
        if not payload:
            return Response(status_code=401, content=b"Invalid token")

    session = await _get_session(request)
    moonraker_url = _get_moonraker_url(db)

    thumb_url = await _find_thumbnail_path(session, moonraker_url, filename)
    if thumb_url:
        async with session.get(thumb_url) as resp:
            if resp.status == 200:
                body = await resp.read()
                return Response(content=body, media_type="image/png")

    img_bytes = await _extract_gcode_thumbnail(session, moonraker_url, filename)
    if img_bytes:
        return Response(content=img_bytes, media_type="image/png")

    return Response(status_code=404, content=b"Not found")


async def _run_thumbnail_backfill(session: aiohttp.ClientSession, db: Session, limit: int = 100) -> dict:
    """Extract and save thumbnails for jobs that don't have one yet."""
    from app.models.print_job import PrintJob
    moonraker_url = _get_moonraker_url(db)

    jobs = db.query(PrintJob).filter(PrintJob.thumbnail_path.is_(None)).order_by(PrintJob.id.desc()).limit(limit).all()
    updated = 0
    failed = 0

    for job in jobs:
        try:
            thumb_url = await _find_thumbnail_path(session, moonraker_url, job.filename)
            if thumb_url:
                job.thumbnail_path = thumb_url
                updated += 1
                continue

            img_bytes = await _extract_gcode_thumbnail(session, moonraker_url, job.filename)
            if img_bytes:
                b64 = base64.b64encode(img_bytes).decode("ascii")
                job.thumbnail_path = f"data:image/png;base64,{b64}"
                updated += 1
                continue

            failed += 1
        except Exception as e:
            logger.warning(f"Backfill failed for job {job.id}: {e}")
            failed += 1

    db.commit()
    return {"updated": updated, "failed": failed, "skipped": len(jobs) - updated - failed, "checked": len(jobs)}


@router.post("/thumbnail-backfill")
async def thumbnail_backfill(request: Request, db: Session = Depends(get_db), limit: int = Query(100, ge=1, le=500)):
    """Extract and save thumbnails for jobs that don't have one yet."""
    session = await _get_session(request)
    return await _run_thumbnail_backfill(session, db, limit=limit)