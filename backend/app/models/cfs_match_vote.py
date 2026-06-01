from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, ForeignKey
from .base import BaseModel


class CfsMatchVote(BaseModel):
    __tablename__ = "cfs_match_votes"

    slot_id = Column(String(3), nullable=False, index=True)
    material_code = Column(String(10), nullable=True)
    color_hex = Column(String(10), nullable=True)
    rfid_vendor = Column(String(100), nullable=True)
    suggested_roll_id = Column(Integer, ForeignKey("filament_library.id"), nullable=True)
    confirmed_roll_id = Column(Integer, ForeignKey("filament_library.id"), nullable=True)
    auto_accepted = Column(Boolean, nullable=False, default=False)
    correct = Column(Boolean, nullable=True)
    responded_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<CfsMatchVote(slot_id={self.slot_id}, correct={self.correct})>"
