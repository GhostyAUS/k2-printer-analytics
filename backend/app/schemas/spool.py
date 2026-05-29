from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class SpoolCreate(BaseModel):
    brand: str
    material: str
    color: str
    initial_weight_g: float
    remaining_weight_g: Optional[float] = None
    cost_per_kg: Optional[float] = None

class SpoolUpdate(BaseModel):
    brand: Optional[str] = None
    material: Optional[str] = None
    color: Optional[str] = None
    initial_weight_g: Optional[float] = None
    remaining_weight_g: Optional[float] = None
    cost_per_kg: Optional[float] = None

class SpoolResponse(BaseModel):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    brand: str
    material: str
    color: str
    initial_weight_g: float
    remaining_weight_g: float
    cost_per_kg: Optional[float] = None

    class Config:
        from_attributes = True
