import logging
from fastapi import APIRouter, Request, Query
from typing import List, Optional
from pydantic import BaseModel

from app.services.ofd import load_ofd_data, get_brands, get_materials, search_filaments

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ofd", tags=["ofd"])


class OFDBrand(BaseModel):
    id: str
    name: str
    slug: str = ""


class OFDMaterial(BaseModel):
    id: str
    name: str
    material_class: str = ""


class OFDFilamentResult(BaseModel):
    brand: str
    material: str
    filament_name: str
    variant_name: str
    color_hex: Optional[str] = None
    traits: Optional[dict] = None
    density: Optional[float] = None
    diameter: Optional[float] = None
    filament_weight: Optional[int] = None
    min_print_temperature: Optional[int] = None
    max_print_temperature: Optional[int] = None
    min_bed_temperature: Optional[int] = None
    max_bed_temperature: Optional[int] = None
    filament_id: Optional[str] = None
    variant_id: Optional[str] = None
    size_id: Optional[str] = None
    discontinued: bool = False


@router.get("/brands", response_model=List[OFDBrand])
async def list_brands(request: Request, search: Optional[str] = Query(None)):
    data = await load_ofd_data(getattr(request.app.state, "http_session", None))
    return get_brands(data, search)


@router.get("/materials", response_model=List[OFDMaterial])
async def list_materials(request: Request, brand_id: Optional[str] = Query(None)):
    data = await load_ofd_data(getattr(request.app.state, "http_session", None))
    return get_materials(data, brand_id)


@router.get("/search", response_model=List[OFDFilamentResult])
async def search(
    request: Request,
    brand_id: Optional[str] = Query(None),
    material: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    data = await load_ofd_data(getattr(request.app.state, "http_session", None))
    return search_filaments(data, brand_id, material, search, limit)
