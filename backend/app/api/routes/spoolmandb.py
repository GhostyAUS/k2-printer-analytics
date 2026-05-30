import logging
import time
from fastapi import APIRouter, Request, Query
from typing import List, Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/spoolmandb", tags=["spoolmandb"])

SPOOLMANDB_FILAMENTS_URL = "https://donkie.github.io/SpoolmanDB/filaments.json"
SPOOLMANDB_MATERIALS_URL = "https://donkie.github.io/SpoolmanDB/materials.json"

_cache: dict = {"filaments": None, "materials": None, "filaments_ts": 0, "materials_ts": 0}
CACHE_TTL = 3600


async def _fetch_json(request: Request, url: str, cache_key: str, ts_key: str):
    now = time.time()
    if _cache[cache_key] and (now - _cache[ts_key]) < CACHE_TTL:
        return _cache[cache_key]
    session = getattr(request.app.state, "http_session", None)
    if not session or session.closed:
        import aiohttp
        session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30))
    try:
        async with session.get(url) as resp:
            if resp.status != 200:
                logger.error("SpoolmanDB fetch %s failed: %s", url, resp.status)
                return _cache[cache_key] or []
            data = await resp.json(content_type=None)
            _cache[cache_key] = data
            _cache[ts_key] = now
            return data
    except Exception as e:
        logger.error("SpoolmanDB fetch error: %s", e)
        return _cache[cache_key] or []


class SpoolmanDBFilament(BaseModel):
    id: str
    manufacturer: str
    name: str
    material: str
    density: float = 1.24
    weight: float = 1000.0
    spool_weight: float = 0
    diameter: float = 1.75
    color_hex: Optional[str] = None
    extruder_temp: Optional[int] = None
    bed_temp: Optional[int] = None


class SpoolmanDBMaterial(BaseModel):
    name: str
    density: float
    extruder_temp: Optional[int] = None
    bed_temp: Optional[int] = None


@router.get("/materials", response_model=List[SpoolmanDBMaterial])
async def list_materials(request: Request):
    raw = await _fetch_json(request, SPOOLMANDB_MATERIALS_URL, "materials", "materials_ts")
    if isinstance(raw, list):
        return [SpoolmanDBMaterial(
            name=m.get("name", "Unknown"),
            density=float(m.get("density", 1.24)),
            extruder_temp=m.get("extruder_temp"),
            bed_temp=m.get("bed_temp"),
        ) for m in raw]
    if isinstance(raw, dict):
        return [SpoolmanDBMaterial(
            name=k,
            density=float(v.get("density", 1.24)),
            extruder_temp=v.get("extruder_temp"),
            bed_temp=v.get("bed_temp"),
        ) for k, v in raw.items()]
    return []


@router.get("/brands", response_model=List[str])
async def list_brands(request: Request, search: Optional[str] = Query(None)):
    raw = await _fetch_json(request, SPOOLMANDB_FILAMENTS_URL, "filaments", "filaments_ts")
    if not isinstance(raw, list):
        return []
    brands = sorted(set(f.get("manufacturer", "") for f in raw if f.get("manufacturer")))
    if search:
        s = search.lower()
        brands = [b for b in brands if s in b.lower()]
    return brands


@router.get("/material-names", response_model=List[str])
async def list_material_names(request: Request):
    raw = await _fetch_json(request, SPOOLMANDB_FILAMENTS_URL, "filaments", "filaments_ts")
    if not isinstance(raw, list):
        return []
    return sorted(set(f.get("material", "") for f in raw if f.get("material")))


@router.get("/filaments", response_model=List[SpoolmanDBFilament])
async def search_filaments(
    request: Request,
    brand: Optional[str] = Query(None),
    material: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    raw = await _fetch_json(request, SPOOLMANDB_FILAMENTS_URL, "filaments", "filaments_ts")
    if not isinstance(raw, list):
        return []
    results = raw
    if brand:
        brand_l = brand.lower()
        results = [f for f in results if f.get("manufacturer", "").lower() == brand_l]
    if material:
        mat_l = material.lower()
        results = [f for f in results if mat_l in f.get("material", "").lower()]
    if search:
        s = search.lower()
        results = [f for f in results if
            s in f.get("manufacturer", "").lower() or
            s in f.get("name", "").lower() or
            s in f.get("material", "").lower()]
    def safe_int(v, default=None):
        if v is None:
            return default
        try:
            return int(v)
        except (ValueError, TypeError):
            return default

    def safe_float(v, default=0.0):
        if v is None:
            return default
        try:
            return float(v)
        except (ValueError, TypeError):
            return default

    return [SpoolmanDBFilament(
        id=str(f.get("id", "")),
        manufacturer=f.get("manufacturer", ""),
        name=f.get("name", ""),
        material=f.get("material", ""),
        density=safe_float(f.get("density"), 1.24),
        weight=safe_float(f.get("weight"), 1000),
        spool_weight=safe_float(f.get("spool_weight"), 0),
        diameter=safe_float(f.get("diameter"), 1.75),
        color_hex=f.get("color_hex"),
        extruder_temp=safe_int(f.get("extruder_temp")),
        bed_temp=safe_int(f.get("bed_temp")),
    ) for f in results[:limit]]
