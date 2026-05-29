from sqlalchemy import Column, Integer, String, Float
from sqlalchemy.orm import relationship
from .base import BaseModel


class Spool(BaseModel):
    __tablename__ = "spools"
    
    brand = Column(String(100), nullable=False)
    material = Column(String(20), nullable=False)  # PLA, PETG, ABS, etc.
    color = Column(String(50), nullable=False)
    initial_weight_g = Column(Float, nullable=False)
    remaining_weight_g = Column(Float, nullable=False)
    cost_per_kg = Column(Float, nullable=True)  # Optional cost tracking
    
    # Relationship to print jobs
    print_jobs = relationship("PrintJob", back_populates="spool")
    
    def __repr__(self):
        return f"<Spool(id={self.id}, {self.brand} {self.material} {self.color})>"
    
    @property
    def usage_percentage(self) -> float:
        """Calculate how much of the spool has been used (0-100)"""
        if self.initial_weight_g <= 0:
            return 0.0
        used = self.initial_weight_g - self.remaining_weight_g
        return (used / self.initial_weight_g) * 100
    
    @property
    def is_empty(self) -> bool:
        """Check if spool is effectively empty (< 50g remaining)"""
        return self.remaining_weight_g < 50.0