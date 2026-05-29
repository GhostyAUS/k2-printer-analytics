from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from app.repositories.print_job_repo import PrintJobRepository
from app.repositories.spool_repo import SpoolRepository
from app.models.print_job import PrintJob, PrintStatus
from app.models.spool import Spool
from datetime import datetime, timedelta, timezone

class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db
        self.print_job_repo = PrintJobRepository(db)
        self.spool_repo = SpoolRepository(db)

    def get_print_statistics(self) -> Dict[str, int]:
        total_jobs = self.db.query(PrintJob).count()
        completed_jobs = self.db.query(PrintJob).filter(PrintJob.status == PrintStatus.COMPLETE).count()
        failed_jobs = self.db.query(PrintJob).filter(PrintJob.status == PrintStatus.FAILED).count()

        return {
            'total': total_jobs,
            'completed': completed_jobs,
            'failed': failed_jobs
        }

    def get_recent_jobs(self, days: int = 7) -> List[PrintJob]:
        start_date = datetime.now(timezone.utc) - timedelta(days=days)
        return self.db.query(PrintJob).filter(PrintJob.start_time >= start_date).all()