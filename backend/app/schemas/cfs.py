from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class CfsSlotOverrideCreate(BaseModel):
    slot_id: str
    material_name: Optional[str] = None
    color_hex: Optional[str] = None
    remaining_pct: Optional[float] = None
    cost_per_kg: Optional[float] = None
    spool_weight_g: Optional[float] = None


class CfsSlotOverrideUpdate(BaseModel):
    material_name: Optional[str] = None
    color_hex: Optional[str] = None
    remaining_pct: Optional[float] = None
    cost_per_kg: Optional[float] = None
    spool_weight_g: Optional[float] = None


class CfsSlotOverrideResponse(BaseModel):
    id: int
    slot_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    material_name: Optional[str] = None
    color_hex: Optional[str] = None
    remaining_pct: Optional[float] = None
    cost_per_kg: Optional[float] = None
    spool_weight_g: Optional[float] = None

    class Config:
        from_attributes = True
