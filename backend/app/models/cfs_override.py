from sqlalchemy import Column, String, Float, Boolean, Integer
from .base import BaseModel


class CfsSlotOverride(BaseModel):
    __tablename__ = "cfs_slot_overrides"

    slot_id = Column(String(3), unique=True, nullable=False, index=True)
    material_name = Column(String(100), nullable=True)
    color_hex = Column(String(10), nullable=True)
    remaining_pct = Column(Float, nullable=True)
    cost_per_kg = Column(Float, nullable=True)
    spool_weight_g = Column(Float, nullable=True)
    calibrated = Column(Boolean, nullable=True, default=False)
    match_confidence = Column(Float, nullable=True, default=0.0)
    auto_approve = Column(Boolean, nullable=True, default=False)
    match_attempts = Column(Integer, nullable=True, default=0)
    match_hits = Column(Integer, nullable=True, default=0)

    def __repr__(self):
        return f"<CfsSlotOverride(slot_id={self.slot_id})>"
