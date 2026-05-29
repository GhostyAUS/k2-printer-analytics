from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.print_job import PrintJob
from app.models.spool import Spool

class PrintJobRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, print_job: PrintJob) -> PrintJob:
        self.db.add(print_job)
        self.db.commit()
        self.db.refresh(print_job)
        return print_job

    def get_by_id(self, job_id: int) -> Optional[PrintJob]:
        return self.db.query(PrintJob).filter(PrintJob.id == job_id).first()

    def get_all(self) -> List[PrintJob]:
        return self.db.query(PrintJob).all()

    def update(self, job_id: int, update_data: dict) -> Optional[PrintJob]:
        print_job = self.get_by_id(job_id)
        if print_job:
            for key, value in update_data.items():
                setattr(print_job, key, value)
            self.db.commit()
            self.db.refresh(print_job)
        return print_job

    def delete(self, job_id: int) -> bool:
        print_job = self.get_by_id(job_id)
        if print_job:
            self.db.delete(print_job)
            self.db.commit()
            return True
        return False

    def get_jobs_with_spool_info(self) -> List[PrintJob]:
        """Get print jobs with spool information using outerjoin"""
        return self.db.query(PrintJob).outerjoin(Spool).all()