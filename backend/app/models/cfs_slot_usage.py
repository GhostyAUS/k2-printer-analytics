from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text
from .base import BaseModel


class CfsSlotUsage(BaseModel):
    __tablename__ = "cfs_slot_usage"

    print_job_id = Column(Integer, ForeignKey("print_jobs.id"), nullable=False, index=True)
    slot_id = Column(String(10), nullable=False)
    tray_id = Column(String(2), nullable=False)
    material_name = Column(String(100), nullable=True)
    color_hex = Column(String(10), nullable=True)
    measuring_wheel_start = Column(Float, nullable=True)
    measuring_wheel_end = Column(Float, nullable=True)
    filament_used_mm = Column(Float, nullable=True)
    filament_used_g = Column(Float, nullable=True)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<CfsSlotUsage(job={self.print_job_id} slot={self.slot_id} {self.filament_used_mm}mm)>"
