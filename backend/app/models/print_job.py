from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from .base import BaseModel
import enum
from datetime import datetime, timezone


class PrintStatus(enum.Enum):
    PRINTING = "PRINTING"
    COMPLETE = "COMPLETE"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


class PrintJob(BaseModel):
    __tablename__ = "print_jobs"
    
    filename = Column(String(255), nullable=False)
    status = Column(Enum(PrintStatus), nullable=False, default=PrintStatus.PRINTING)
    start_time = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    end_time = Column(DateTime, nullable=True)
    
    # Print metrics
    estimated_duration_seconds = Column(Integer, nullable=True)
    actual_duration_seconds = Column(Integer, nullable=True)
    estimated_filament_g = Column(Float, nullable=True)
    filament_used_g = Column(Float, nullable=True)
    filament_length_mm = Column(Float, nullable=True)
    filament_type = Column(String(50), nullable=True)
    
    # Cost calculations
    total_power_kwh = Column(Float, nullable=True)
    electricity_cost = Column(Float, nullable=True)
    filament_cost = Column(Float, nullable=True)
    
    # Foreign key to spool
    spool_id = Column(Integer, ForeignKey("spools.id"), nullable=True)
    spool = relationship("Spool", back_populates="print_jobs")
    
    # Relationship to power logs
    power_logs = relationship("PowerLog", back_populates="print_job", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<PrintJob(id={self.id}, {self.filename}, {self.status.value})>"
    
    @property
    def duration_minutes(self) -> int:
        """Get actual or estimated duration in minutes"""
        if self.actual_duration_seconds:
            return self.actual_duration_seconds // 60
        elif self.estimated_duration_seconds:
            return self.estimated_duration_seconds // 60
        return 0
    
    @property
    def is_active(self) -> bool:
        """Check if print job is currently active"""
        return self.status == PrintStatus.PRINTING
    
    def calculate_costs(self, electricity_rate_kwh: float) -> dict:
        """Calculate various costs for this print job"""
        costs = {
            "electricity": 0.0,
            "filament": 0.0,
            "total": 0.0
        }
        
        if self.total_power_kwh:
            costs["electricity"] = self.total_power_kwh * electricity_rate_kwh
        
        if self.filament_used_g and self.spool and self.spool.cost_per_kg:
            costs["filament"] = (self.filament_used_g / 1000) * self.spool.cost_per_kg
        
        costs["total"] = costs["electricity"] + costs["filament"]
        return costs