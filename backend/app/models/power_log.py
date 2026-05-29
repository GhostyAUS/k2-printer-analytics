from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .base import BaseModel
from datetime import datetime, timezone


class PowerLog(BaseModel):
    __tablename__ = "power_logs"

    print_job_id = Column(Integer, ForeignKey("print_jobs.id"), nullable=False)
    timestamp = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    wattage = Column(Float, nullable=False)  # Power draw in Watts
    voltage = Column(Float, nullable=True)   # Voltage (if available)
    current = Column(Float, nullable=True)   # Current (if available)
    
    # Relationship to print job
    print_job = relationship("PrintJob", back_populates="power_logs")
    
    def __repr__(self):
        return f"<PowerLog(id={self.id}, job={self.print_job_id}, {self.wattage}W)>"