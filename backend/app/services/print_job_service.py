from typing import List, Optional
from sqlalchemy.orm import Session
from app.repositories.print_job_repo import PrintJobRepository
from app.models.print_job import PrintJob, PrintStatus
from datetime import datetime, timezone

class PrintJobService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = PrintJobRepository(db)

    def create_print_job(self, job_data: dict) -> PrintJob:
        status_value = job_data.get("status", "PRINTING")
        try:
            status = PrintStatus(status_value)
        except ValueError:
            status = PrintStatus.PRINTING

        job = PrintJob(
            filename=job_data["filename"],
            status=status,
            start_time=job_data.get("start_time", datetime.now(timezone.utc)),
            end_time=job_data.get("end_time"),
            actual_duration_seconds=job_data.get("actual_duration_seconds"),
            estimated_duration_seconds=job_data.get("estimated_duration_seconds"),
            estimated_filament_g=job_data.get("estimated_filament_g"),
            filament_used_g=job_data.get("filament_used_g"),
            filament_length_mm=job_data.get("filament_length_mm"),
            filament_type=job_data.get("filament_type"),
            spool_id=job_data.get("spool_id"),
        )
        return self.repository.create(job)

    def get_print_job_by_id(self, job_id: int) -> Optional[PrintJob]:
        return self.repository.get_by_id(job_id)

    def get_all_print_jobs(self) -> List[PrintJob]:
        return self.repository.get_all()

    def update_print_job(self, job_id: int, update_data: dict) -> Optional[PrintJob]:
        return self.repository.update(job_id, update_data)

    def delete_print_job(self, job_id: int) -> bool:
        return self.repository.delete(job_id)

    def get_jobs_with_spool_info(self) -> List[PrintJob]:
        return self.repository.get_jobs_with_spool_info()