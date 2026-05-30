from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from .base import BaseModel


class FilamentRoll(BaseModel):
    __tablename__ = "filament_library"

    brand = Column(String(100), nullable=False, default="")
    material = Column(String(50), nullable=False, default="PLA")
    color_name = Column(String(100), nullable=True)
    color_hex = Column(String(10), nullable=True)
    total_weight_g = Column(Float, nullable=False, default=1000.0)
    spool_weight_g = Column(Float, nullable=False, default=0.0)
    remaining_weight_g = Column(Float, nullable=False, default=1000.0)
    cost_per_kg = Column(Float, nullable=True)
    purchase_date = Column(DateTime, nullable=True)
    location = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    spool_id = Column(String(10), nullable=True)

    def __repr__(self):
        return f"<FilamentRoll(id={self.id}, {self.brand} {self.material})>"
