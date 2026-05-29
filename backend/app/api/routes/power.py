from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.services.meross import meross_service
from app.services.print_tracker import print_tracker
from app.core.database import get_db
from app.models.print_job import PrintJob, PrintStatus
from app.models.power_log import PowerLog
from datetime import datetime, timezone

router = APIRouter(prefix="/power", tags=["power"])


@router.get("/current")
async def get_current_power():
    """Get current power reading from Meross plug."""
    watts = await meross_service.async_get_power()
    return {"wattage": watts, "available": watts is not None}


@router.get("/print-session")
async def get_print_session_power(db: Session = Depends(get_db)):
    """Get total power used in the current active print session."""
    if not print_tracker.active_job_id:
        return {"active": False, "total_kwh": 0, "current_wattage": None}

    job = db.query(PrintJob).filter(PrintJob.id == print_tracker.active_job_id).first()
    if not job:
        return {"active": False, "total_kwh": 0, "current_wattage": None}

    watts = await meross_service.async_get_power()
    logs = db.query(PowerLog).filter(
        PowerLog.print_job_id == print_tracker.active_job_id
    ).order_by(PowerLog.timestamp).all()

    total_kwh = 0.0
    prev = None
    for log in logs:
        if prev and prev.wattage:
            delta_h = (log.timestamp - prev.timestamp).total_seconds() / 3600
            total_kwh += prev.wattage * delta_h / 1000
        prev = log

    # Estimate ongoing consumption since last log
    if watts and prev and prev.wattage:
        delta_now_h = (datetime.now(timezone.utc) - prev.timestamp.replace(tzinfo=timezone.utc)).total_seconds() / 3600
        if delta_now_h > 0:
            total_kwh += prev.wattage * delta_now_h / 1000

    return {
        "active": True,
        "job_id": job.id,
        "current_wattage": watts,
        "total_kwh": round(total_kwh, 4),
    }
