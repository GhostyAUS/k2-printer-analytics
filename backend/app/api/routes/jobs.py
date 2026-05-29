import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.services.print_job_service import PrintJobService
from app.models.print_job import PrintJob, PrintStatus
from app.core.database import get_db
from app.schemas.print_job import PrintJobCreate, PrintJobResponse, PrintJobUpdate

router = APIRouter(prefix="/jobs", tags=["print jobs"])

# PLA density: 1.24 g/cm³
FILAMENT_DENSITY = 1.24  # g/cm³
FILAMENT_DIAMETER = 1.75  # mm
CROSS_SECTIONAL_AREA = 3.14159 * (FILAMENT_DIAMETER / 2) ** 2  # mm²


def _parse_duration_from_filename(filename: str) -> int | None:
    """Parse estimated duration from filename patterns like _19h10m43s or _5h49m."""
    m = re.search(r'_(\d+)h(\d+)m(\d+)s', filename)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
    m = re.search(r'_(\d+)h(\d+)m', filename)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60
    m = re.search(r'_(\d+)m(\d+)s', filename)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.search(r'_(\d+)m', filename)
    if m:
        return int(m.group(1)) * 60
    return None


def _filament_mm_to_g(length_mm: float) -> float:
    """Convert filament length (mm) to grams using PLA density."""
    volume_mm3 = length_mm * CROSS_SECTIONAL_AREA
    return round(volume_mm3 * FILAMENT_DENSITY / 1000, 2)

@router.post("/", response_model=PrintJobResponse)
def create_print_job(job_data: PrintJobCreate, db: Session = Depends(get_db)):
    service = PrintJobService(db)
    return service.create_print_job(job_data.model_dump(exclude_unset=True))

@router.get("/", response_model=List[PrintJobResponse])
def get_print_jobs(db: Session = Depends(get_db)):
    service = PrintJobService(db)
    return service.get_all_print_jobs()


@router.get("/paginated", response_model=dict)
def get_print_jobs_paginated(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    status: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = Query("start_time", pattern="^(start_time|filename|actual_duration_seconds|estimated_duration_seconds|electricity_cost|filament_cost|total_cost|filament_used_g|status)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func, or_
    query = db.query(PrintJob)

    if status:
        try:
            status_enum = PrintStatus(status.upper())
            query = query.filter(PrintJob.status == status_enum)
        except ValueError:
            pass

    if search:
        search_term = f"%{search}%"
        query = query.filter(or_(
            PrintJob.filename.ilike(search_term),
            PrintJob.filament_type.ilike(search_term),
        ))

    if sort_by == "total_cost":
        sort_expr = func.coalesce(PrintJob.electricity_cost, 0) + func.coalesce(PrintJob.filament_cost, 0)
        query = query.order_by(sort_expr.desc() if sort_order == "desc" else sort_expr.asc())
    else:
        sort_col = getattr(PrintJob, sort_by, PrintJob.start_time)
        if sort_order == "asc":
            query = query.order_by(sort_col.asc())
        else:
            query = query.order_by(sort_col.desc())

    if sort_by != "start_time":
        query = query.order_by(PrintJob.start_time.desc())

    total = query.count()
    items = query.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "items": [PrintJobResponse.model_validate(item) for item in items],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }

@router.get("/{job_id}", response_model=PrintJobResponse)
def get_print_job(job_id: int, db: Session = Depends(get_db)):
    service = PrintJobService(db)
    job = service.get_print_job_by_id(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")
    return job

@router.put("/{job_id}", response_model=PrintJobResponse)
def update_print_job(job_id: int, update_data: PrintJobUpdate, db: Session = Depends(get_db)):
    service = PrintJobService(db)
    job = service.update_print_job(job_id, update_data.model_dump(exclude_unset=True))
    if not job:
        raise HTTPException(status_code=404, detail="Print job not found")
    return job

@router.delete("/{job_id}")
def delete_print_job(job_id: int, db: Session = Depends(get_db)):
    service = PrintJobService(db)
    if not service.delete_print_job(job_id):
        raise HTTPException(status_code=404, detail="Print job not found")
    return {"message": "Print job deleted successfully"}


@router.post("/backfill-metadata")
def backfill_metadata(db: Session = Depends(get_db)):
    """Fill estimated_filament_g and estimated_duration_seconds for historical jobs."""
    from app.repositories.print_job_repo import PrintJobRepository
    repo = PrintJobRepository(db)
    jobs = repo.get_all()
    updated = 0

    for job in jobs:
        updates = {}

        # Fill estimated_filament_g from filament_length_mm
        if job.estimated_filament_g is None and job.filament_length_mm:
            updates["estimated_filament_g"] = _filament_mm_to_g(job.filament_length_mm)

        # Fill estimated_duration_seconds from filename
        if job.estimated_duration_seconds is None:
            parsed = _parse_duration_from_filename(job.filename)
            if parsed:
                updates["estimated_duration_seconds"] = parsed

        if updates:
            repo.update(job.id, updates)
            updated += 1

    return {"updated": updated, "total": len(jobs)}