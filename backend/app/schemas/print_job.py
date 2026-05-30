from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class PrintJobCreate(BaseModel):
    filename: str
    status: str = "PRINTING"
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    actual_duration_seconds: Optional[int] = None
    estimated_duration_seconds: Optional[int] = None
    estimated_filament_g: Optional[float] = None
    filament_used_g: Optional[float] = None
    filament_length_mm: Optional[float] = None
    filament_type: Optional[str] = None
    spool_id: Optional[int] = None

class PrintJobUpdate(BaseModel):
    status: Optional[str] = None
    end_time: Optional[datetime] = None
    actual_duration_seconds: Optional[int] = None
    estimated_filament_g: Optional[float] = None
    filament_used_g: Optional[float] = None
    filament_length_mm: Optional[float] = None
    total_power_kwh: Optional[float] = None
    electricity_cost: Optional[float] = None
    filament_cost: Optional[float] = None
    spool_id: Optional[int] = None

class PrintJobResponse(BaseModel):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    filename: str
    status: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    estimated_duration_seconds: Optional[int] = None
    actual_duration_seconds: Optional[int] = None
    estimated_filament_g: Optional[float] = None
    filament_used_g: Optional[float] = None
    filament_length_mm: Optional[float] = None
    filament_type: Optional[str] = None
    total_power_kwh: Optional[float] = None
    electricity_cost: Optional[float] = None
    filament_cost: Optional[float] = None
    spool_id: Optional[int] = None
    thumbnail_path: Optional[str] = None

    class Config:
        from_attributes = True
