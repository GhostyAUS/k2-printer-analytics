import asyncio
import gzip
import json
import logging
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

OFD_ALL_JSON_GZ_URL = "https://api.openfilamentdatabase.org/json/all.json.gz"
CACHE_TTL = 86400

_ofd_data: Optional[Dict[str, Any]] = None
_ofd_ts: float = 0
_ofd_lock = asyncio.Lock()


async def _download_ofd(session) -> Dict[str, Any]:
    url = OFD_ALL_JSON_GZ_URL
    logger.info("OFD: downloading %s", url)
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=60)) as resp:
            if resp.status != 200:
                raise RuntimeError(f"OFD download failed: HTTP {resp.status}")
            raw = await resp.read()
    except Exception:
        import aiohttp
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as fallback:
            async with fallback.get(url) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"OFD download failed: HTTP {resp.status}")
                raw = await resp.read()
    data = json.loads(gzip.decompress(raw))
    logger.info(
        "OFD: loaded %d brands, %d materials, %d filaments, %d variants, %d sizes",
        len(data.get("brands", [])),
        len(data.get("materials", [])),
        len(data.get("filaments", [])),
        len(data.get("variants", [])),
        len(data.get("sizes", [])),
    )
    return data


async def load_ofd_data(session=None) -> Dict[str, Any]:
    global _ofd_data, _ofd_ts
    now = time.time()
    if _ofd_data and (now - _ofd_ts) < CACHE_TTL:
        return _ofd_data
    async with _ofd_lock:
        if _ofd_data and (time.time() - _ofd_ts) < CACHE_TTL:
            return _ofd_data
        try:
            _ofd_data = await _download_ofd(session)
            _ofd_ts = time.time()
        except Exception as e:
            logger.error("OFD: download failed: %s", e)
            if _ofd_data:
                logger.warning("OFD: serving stale cache")
                return _ofd_data
            _ofd_data = {"brands": [], "materials": [], "filaments": [], "variants": [], "sizes": []}
            _ofd_ts = time.time()
    return _ofd_data


def _brand_map(data: Dict[str, Any]) -> Dict[str, str]:
    return {b["id"]: b["name"] for b in data.get("brands", []) if "id" in b and "name" in b}


def _material_map(data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {m["id"]: m for m in data.get("materials", []) if "id" in m}


def _filament_map(data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {f["id"]: f for f in data.get("filaments", []) if "id" in f}


def _variant_map(data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {v["id"]: v for v in data.get("variants", []) if "id" in v}


def get_brands(data: Dict[str, Any], search: Optional[str] = None) -> List[Dict[str, str]]:
    brands = sorted(
        [{"id": b["id"], "name": b["name"], "slug": b.get("slug", "")} for b in data.get("brands", []) if b.get("name")],
        key=lambda x: x["name"].lower(),
    )
    if search:
        s = search.lower()
        brands = [b for b in brands if s in b["name"].lower()]
    return brands


def get_materials(data: Dict[str, Any], brand_id: Optional[str] = None) -> List[Dict[str, Any]]:
    materials = data.get("materials", [])
    if brand_id:
        materials = [m for m in materials if m.get("brand_id") == brand_id]
    seen = set()
    result = []
    for m in sorted(materials, key=lambda x: x.get("material", "")):
        name = m.get("material", "")
        if name and name not in seen:
            seen.add(name)
            result.append({"id": m["id"], "name": name, "material_class": m.get("material_class", "")})
    return result


def search_filaments(
    data: Dict[str, Any],
    brand_id: Optional[str] = None,
    material: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    brands = _brand_map(data)
    filaments = data.get("filaments", [])
    variants = data.get("variants", [])
    sizes = data.get("sizes", [])

    if brand_id:
        filaments = [f for f in filaments if f.get("brand_id") == brand_id]
    if material:
        m_lower = material.lower()
        filaments = [f for f in filaments if m_lower in f.get("material", "").lower()]
    if search:
        s = search.lower()
        matched_fids = set()
        for f in filaments:
            if s in brands.get(f.get("brand_id"), "").lower() or s in f.get("name", "").lower() or s in f.get("material", "").lower():
                matched_fids.add(f["id"])
        for v in variants:
            if s in v.get("name", "").lower():
                matched_fids.add(v.get("filament_id"))
        filaments = [f for f in filaments if f.get("id") in matched_fids]

    filament_ids = {f["id"] for f in filaments}
    variant_by_fid: Dict[str, List[Dict]] = {}
    for v in variants:
        fid = v.get("filament_id")
        if fid in filament_ids:
            variant_by_fid.setdefault(fid, []).append(v)

    size_by_vid: Dict[str, List[Dict]] = {}
    for sz in sizes:
        vid = sz.get("variant_id")
        if vid:
            size_by_vid.setdefault(vid, []).append(sz)

    results = []
    for f in filaments[:limit * 3]:
        if len(results) >= limit:
            break
        brand_name = brands.get(f.get("brand_id"), "")
        for v in variant_by_fid.get(f.get("id"), []):
            if len(results) >= limit:
                break
            for sz in size_by_vid.get(v.get("id"), []):
                if len(results) >= limit:
                    break
                results.append({
                    "brand": brand_name,
                    "material": f.get("material", ""),
                    "filament_name": f.get("name", ""),
                    "variant_name": v.get("name", ""),
                    "color_hex": v.get("color_hex"),
                    "traits": v.get("traits"),
                    "density": f.get("density"),
                    "diameter": sz.get("diameter"),
                    "filament_weight": sz.get("filament_weight"),
                    "min_print_temperature": f.get("min_print_temperature"),
                    "max_print_temperature": f.get("max_print_temperature"),
                    "min_bed_temperature": f.get("min_bed_temperature"),
                    "max_bed_temperature": f.get("max_bed_temperature"),
                    "filament_id": f.get("id"),
                    "variant_id": v.get("id"),
                    "size_id": sz.get("id"),
                    "discontinued": f.get("discontinued") or v.get("discontinued") or sz.get("discontinued"),
                })
    return results


async def refresh_ofd(app):
    try:
        import aiohttp
        session = getattr(app.state, "http_session", None)
        if not session or session.closed:
            session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60))
            app.state.http_session = session
        await load_ofd_data(session)
    except Exception as e:
        logger.error("OFD background refresh failed: %s", e)


def start_ofd_refresh_loop(app):
    async def _loop():
        while True:
            await asyncio.sleep(CACHE_TTL)
            await refresh_ofd(app)
    asyncio.create_task(_loop())
