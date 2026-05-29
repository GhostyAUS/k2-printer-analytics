from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.power_log import PowerLog

class PowerLogRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, power_log: PowerLog) -> PowerLog:
        self.db.add(power_log)
        self.db.commit()
        self.db.refresh(power_log)
        return power_log

    def get_by_id(self, log_id: int) -> Optional[PowerLog]:
        return self.db.query(PowerLog).filter(PowerLog.id == log_id).first()

    def get_all(self) -> List[PowerLog]:
        return self.db.query(PowerLog).all()

    def update(self, log_id: int, update_data: dict) -> Optional[PowerLog]:
        power_log = self.get_by_id(log_id)
        if power_log:
            for key, value in update_data.items():
                setattr(power_log, key, value)
            self.db.commit()
            self.db.refresh(power_log)
        return power_log

    def delete(self, log_id: int) -> bool:
        power_log = self.get_by_id(log_id)
        if power_log:
            self.db.delete(power_log)
            self.db.commit()
            return True
        return False

    def get_power_logs_by_date_range(self, start_date, end_date) -> List[PowerLog]:
        return self.db.query(PowerLog).filter(
            PowerLog.timestamp >= start_date,
            PowerLog.timestamp <= end_date
        ).all()