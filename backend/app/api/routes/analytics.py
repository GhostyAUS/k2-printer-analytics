import logging
import io
import aiohttp
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.models.print_job import PrintJob, PrintStatus
from app.models.power_log import PowerLog
from app.models.filament_roll import FilamentRoll
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)
    seven_days_ago = now - timedelta(days=7)

    all_jobs_count = db.query(PrintJob).count()
    completed = db.query(PrintJob).filter(PrintJob.status == PrintStatus.COMPLETE)
    total_completed = completed.count()

    total_elec = float(completed.with_entities(func.coalesce(func.sum(PrintJob.electricity_cost), 0)).scalar() or 0)
    total_fil = float(completed.with_entities(func.coalesce(func.sum(PrintJob.filament_cost), 0)).scalar() or 0)
    total_hours = float(completed.with_entities(func.coalesce(func.sum(PrintJob.actual_duration_seconds), 0)).scalar() or 0)
    total_filament_g = float(completed.with_entities(func.coalesce(func.sum(PrintJob.filament_used_g), 0)).scalar() or 0)

    month_q = completed.filter(PrintJob.end_time >= thirty_days_ago)
    month_completed = month_q.count()
    month_elec = float(month_q.with_entities(func.coalesce(func.sum(PrintJob.electricity_cost), 0)).scalar() or 0)
    month_fil = float(month_q.with_entities(func.coalesce(func.sum(PrintJob.filament_cost), 0)).scalar() or 0)
    month_cost = month_elec + month_fil
    month_hours = float(month_q.with_entities(func.coalesce(func.sum(PrintJob.actual_duration_seconds), 0)).scalar() or 0)

    week_q = completed.filter(PrintJob.end_time >= seven_days_ago)
    week_completed = week_q.count()
    week_elec = float(week_q.with_entities(func.coalesce(func.sum(PrintJob.electricity_cost), 0)).scalar() or 0)
    week_fil = float(week_q.with_entities(func.coalesce(func.sum(PrintJob.filament_cost), 0)).scalar() or 0)
    week_cost = week_elec + week_fil
    week_hours = float(week_q.with_entities(func.coalesce(func.sum(PrintJob.actual_duration_seconds), 0)).scalar() or 0)

    avg_cost = (total_elec + total_fil) / max(total_completed, 1) if total_completed > 0 else 0
    projected_monthly = (week_cost / 7 * 30) if week_cost else 0

    low_stock_rolls = db.query(FilamentRoll).filter(
        FilamentRoll.total_weight_g > 0,
        (FilamentRoll.remaining_weight_g / FilamentRoll.total_weight_g) < 0.2
    ).count()
    total_rolls = db.query(FilamentRoll).count()

    return {
        "total_prints": total_completed,
        "total_cost": round(total_elec + total_fil, 2),
        "total_filament_kg": round(total_filament_g / 1000, 2),
        "total_print_hours": round(total_hours / 3600, 1),
        "avg_cost_per_print": round(avg_cost, 2),
        "success_rate": round(total_completed / max(all_jobs_count, 1) * 100, 1),
        "month": {
            "prints": month_completed,
            "cost": round(month_cost, 2),
            "hours": round(month_hours / 3600, 1),
            "projected_monthly_cost": round(projected_monthly, 2),
        },
        "week": {
            "prints": week_completed,
            "cost": round(week_cost, 2),
            "hours": round(week_hours / 3600, 1),
        },
        "low_stock_rolls": low_stock_rolls,
        "total_rolls": total_rolls,
    }


@router.get("/power-history")
def get_power_history(minutes: int = Query(60, ge=1, le=1440), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    logs = db.query(PowerLog).filter(PowerLog.timestamp >= since).order_by(PowerLog.timestamp).all()
    if not logs:
        return []
    max_points = 120
    if len(logs) <= max_points:
        return [{
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            "wattage": log.wattage,
            "job_id": log.print_job_id,
        } for log in logs]
    bucket_size = len(logs) / max_points
    result = []
    for i in range(max_points):
        start = int(i * bucket_size)
        end = int((i + 1) * bucket_size)
        bucket = logs[start:end]
        avg_w = sum(l.wattage for l in bucket) / len(bucket)
        result.append({
            "timestamp": bucket[-1].timestamp.isoformat() if bucket[-1].timestamp else None,
            "wattage": round(avg_w, 1),
            "job_id": bucket[-1].print_job_id,
        })
    return result


@router.get("/slicer-accuracy")
def get_slicer_accuracy(db: Session = Depends(get_db)):
    jobs = db.query(PrintJob).filter(
        PrintJob.status == PrintStatus.COMPLETE,
        PrintJob.actual_duration_seconds.isnot(None),
        PrintJob.estimated_duration_seconds.isnot(None),
        PrintJob.estimated_duration_seconds > 0,
    ).all()

    data = []
    for j in jobs:
        pct = (j.actual_duration_seconds / j.estimated_duration_seconds) * 100
        diff_seconds = j.actual_duration_seconds - j.estimated_duration_seconds
        sign = "+" if diff_seconds >= 0 else "-"
        abs_diff = abs(diff_seconds)
        d_h = int(abs_diff // 3600)
        d_m = int((abs_diff % 3600) // 60)
        d_s = int(abs_diff % 60)
        if d_h > 0:
            diff_str = f"{sign}{d_h}h {d_m}m {d_s}s"
        elif d_m > 0:
            diff_str = f"{sign}{d_m}m {d_s}s"
        else:
            diff_str = f"{sign}{d_s}s"
        data.append({
            "id": j.id,
            "filename": j.filename,
            "estimated_hours": round(j.estimated_duration_seconds / 3600, 2),
            "actual_hours": round(j.actual_duration_seconds / 3600, 2),
            "estimated_seconds": j.estimated_duration_seconds,
            "actual_seconds": j.actual_duration_seconds,
            "diff_seconds": diff_seconds,
            "diff_hms": diff_str,
            "variance_pct": round(pct, 1),
            "filament_type": j.filament_type,
        })

    if data:
        avg_variance = sum(d["variance_pct"] for d in data) / len(data)
        median_variance = sorted(d["variance_pct"] for d in data)[len(data) // 2]
        avg_diff = sum(d["diff_seconds"] for d in data) / len(data)
        median_diff = sorted(d["diff_seconds"] for d in data)[len(data) // 2]
    else:
        avg_variance = 0
        median_variance = 0
        avg_diff = 0
        median_diff = 0

    return {
        "jobs": data,
        "summary": {
            "count": len(data),
            "avg_variance_pct": round(avg_variance, 1),
            "median_variance_pct": round(median_variance, 1),
            "avg_diff_seconds": round(avg_diff, 1),
            "median_diff_seconds": round(median_diff, 1),
        }
    }


@router.get("/monthly-trend")
def get_monthly_trend(months: int = Query(6, ge=1, le=24), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    results = []
    for i in range(months - 1, -1, -1):
        month_start = (now - timedelta(days=i * 30)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if i == 0:
            month_end = now
        else:
            next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
            month_end = next_month

        q = db.query(PrintJob).filter(
            PrintJob.status == PrintStatus.COMPLETE,
            PrintJob.end_time >= month_start,
            PrintJob.end_time < month_end,
        )
        count = q.count()
        elec = float(q.with_entities(func.coalesce(func.sum(PrintJob.electricity_cost), 0)).scalar() or 0)
        fil = float(q.with_entities(func.coalesce(func.sum(PrintJob.filament_cost), 0)).scalar() or 0)
        hours = float(q.with_entities(func.coalesce(func.sum(PrintJob.actual_duration_seconds), 0)).scalar() or 0)
        filament_g = float(q.with_entities(func.coalesce(func.sum(PrintJob.filament_used_g), 0)).scalar() or 0)

        results.append({
            "month": month_start.strftime("%Y-%m"),
            "prints": count,
            "cost": round(elec + fil, 2),
            "electricity_cost": round(elec, 2),
            "filament_cost": round(fil, 2),
            "hours": round(hours / 3600, 1),
            "filament_kg": round(filament_g / 1000, 2),
        })

    return results


@router.get("/export/csv")
def export_csv(db: Session = Depends(get_db)):
    jobs = db.query(PrintJob).order_by(PrintJob.start_time.desc()).all()
    buf = io.StringIO()
    buf.write("id,filename,status,start_time,end_time,estimated_duration_seconds,actual_duration_seconds,")
    buf.write("estimated_filament_g,filament_used_g,filament_length_mm,filament_type,")
    buf.write("total_power_kwh,electricity_cost,filament_cost,total_cost\n")
    for j in jobs:
        total_cost = (j.electricity_cost or 0) + (j.filament_cost or 0)
        buf.write(f'{j.id},"{j.filename}",{j.status.value},')
        buf.write(f'{j.start_time.isoformat() if j.start_time else ""},')
        buf.write(f'{j.end_time.isoformat() if j.end_time else ""},')
        buf.write(f'{j.estimated_duration_seconds or ""},{j.actual_duration_seconds or ""},')
        buf.write(f'{j.estimated_filament_g or ""},{j.filament_used_g or ""},')
        buf.write(f'{j.filament_length_mm or ""},{j.filament_type or ""},')
        buf.write(f'{j.total_power_kwh or ""},{j.electricity_cost or ""},')
        buf.write(f'{j.filament_cost or ""},{total_cost:.2f}\n')
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=k2_print_jobs.csv"}
    )


@router.get("/notifications/config")
def get_notification_config(db: Session = Depends(get_db)):
    from app.models.app_config import AppConfig
    keys = ["notify_webhook_url", "notify_on_complete", "notify_on_failed", "notify_on_cancelled"]
    result = {}
    for key in keys:
        row = db.query(AppConfig).filter(AppConfig.key == key).first()
        result[key] = row.value if row else ""
    result.setdefault("notify_on_complete", "true")
    result.setdefault("notify_on_failed", "true")
    result.setdefault("notify_on_cancelled", "false")
    return result


@router.put("/notifications/config")
def update_notification_config(body: dict, db: Session = Depends(get_db)):
    from app.models.app_config import AppConfig
    for key, value in body.items():
        row = db.query(AppConfig).filter(AppConfig.key == key).first()
        if row:
            row.value = str(value)
        else:
            db.add(AppConfig(key=key, value=str(value)))
    db.commit()
    return {"status": "ok"}


@router.get("/queue")
async def get_print_queue(request: Request, db: Session = Depends(get_db)):
    from app.models.app_config import AppConfig
    host_row = db.query(AppConfig).filter(AppConfig.key == "moonraker_host").first()
    port_row = db.query(AppConfig).filter(AppConfig.key == "moonraker_port").first()
    host = host_row.value if host_row else "192.168.1.146"
    port = int(port_row.value) if port_row else 7125
    url = f"http://{host}:{port}/server/job_queue/status"
    try:
        session: aiohttp.ClientSession = request.app.state.http_session
        if session.closed:
            session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
            request.app.state.http_session = session
        async with session.get(url) as resp:
            if resp.status == 200:
                data = await resp.json()
                result = data.get("result", {})
                queued = result.get("queued_jobs", [])
                return {"queue": queued, "count": len(queued)}
    except Exception:
        pass
    return {"queue": [], "count": 0}


@router.get("/maintenance")
def get_maintenance(db: Session = Depends(get_db)):
    from app.models.app_config import AppConfig
    total_hours = float(db.query(PrintJob).filter(
        PrintJob.status == PrintStatus.COMPLETE
    ).with_entities(func.coalesce(func.sum(PrintJob.actual_duration_seconds), 0)).scalar() or 0) / 3600

    items = []
    maintenance_keys = [row for row in db.query(AppConfig).filter(AppConfig.key.like("maintenance_%")).all()]
    defaults = {
        "maintenance_nozzle_clean_hours": 500,
        "maintenance_belt_check_hours": 1000,
        "maintenance_bearing_lube_hours": 2000,
    }
    for key, default_hrs in defaults.items():
        row = next((r for r in maintenance_keys if r.key == key), None)
        interval = float(row.value) if row else default_hrs
        last_done_key = key.replace("_hours", "_last_done")
        last_done_row = next((r for r in maintenance_keys if r.key == last_done_key), None)
        last_done_hrs = float(last_done_row.value) if last_done_row else 0
        items.append({
            "key": key,
            "label": key.replace("maintenance_", "").replace("_hours", "").replace("_", " ").title(),
            "interval_hours": interval,
            "last_done_hours": last_done_hrs,
            "hours_until_due": max(0, (last_done_hrs + interval) - total_hours),
            "overdue": total_hours > (last_done_hrs + interval),
        })

    return {"total_print_hours": round(total_hours, 1), "items": items}


@router.post("/maintenance/{key}/done")
def mark_maintenance_done(key: str, db: Session = Depends(get_db)):
    from app.models.app_config import AppConfig
    total_hours_q = db.query(PrintJob).filter(
        PrintJob.status == PrintStatus.COMPLETE
    ).with_entities(func.coalesce(func.sum(PrintJob.actual_duration_seconds), 0)).scalar() or 0
    total_hours = float(total_hours_q) / 3600

    last_done_key = key.replace("_hours", "_last_done")
    row = db.query(AppConfig).filter(AppConfig.key == last_done_key).first()
    if row:
        row.value = str(total_hours)
    else:
        db.add(AppConfig(key=last_done_key, value=str(total_hours)))
    db.commit()
    return {"status": "ok", "hours_reset_at": round(total_hours, 1)}


@router.get("/slot-usage/{job_id}")
def get_slot_usage(job_id: int, db: Session = Depends(get_db)):
    from app.models.cfs_slot_usage import CfsSlotUsage
    usages = db.query(CfsSlotUsage).filter(CfsSlotUsage.print_job_id == job_id).order_by(CfsSlotUsage.id).all()
    return [{"slot_id": u.slot_id, "tray_id": u.tray_id, "material_name": u.material_name,
             "color_hex": u.color_hex, "filament_used_mm": u.filament_used_mm,
             "filament_used_g": u.filament_used_g, "measuring_wheel_start": u.measuring_wheel_start,
             "measuring_wheel_end": u.measuring_wheel_end, "started_at": u.started_at,
             "ended_at": u.ended_at} for u in usages]


@router.get("/report")
def get_report(period: str = Query("weekly", regex="^(daily|weekly|monthly)$"), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)

    if period == "daily":
        start = (now - timedelta(days=offset)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        label = start.strftime("%Y-%m-%d")
    elif period == "weekly":
        days_since_monday = start.weekday() if offset == 0 else 0
        start = (now - timedelta(days=offset * 7 + days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
        if offset == 0:
            start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)
        label = f"{start.strftime('%b %d')} – {(end - timedelta(days=1)).strftime('%b %d')}"
    else:
        start = (now - timedelta(days=offset * 30)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        label = start.strftime("%B %Y")

    all_jobs = db.query(PrintJob).filter(PrintJob.start_time >= start, PrintJob.start_time < end).all()
    completed = [j for j in all_jobs if j.status == PrintStatus.COMPLETE]
    failed = [j for j in all_jobs if j.status == PrintStatus.FAILED]
    cancelled = [j for j in all_jobs if j.status == PrintStatus.CANCELLED]
    printing = [j for j in all_jobs if j.status == PrintStatus.PRINTING]

    total_filament_g = sum(j.filament_used_g or 0 for j in completed)
    total_duration_s = sum(j.actual_duration_seconds or 0 for j in completed)
    total_power_kwh = sum(j.total_power_kwh or 0 for j in completed)
    total_elec_cost = sum(j.electricity_cost or 0 for j in completed)
    total_fil_cost = sum(j.filament_cost or 0 for j in completed)

    filament_by_type: Dict[str, float] = {}
    for j in completed:
        ft = j.filament_type or "Unknown"
        filament_by_type[ft] = filament_by_type.get(ft, 0) + (j.filament_used_g or 0)

    avg_duration_s = total_duration_s / len(completed) if completed else 0
    avg_filament_g = total_filament_g / len(completed) if completed else 0

    return {
        "period": period,
        "label": label,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "summary": {
            "total_jobs": len(all_jobs),
            "completed": len(completed),
            "failed": len(failed),
            "cancelled": len(cancelled),
            "printing": len(printing),
            "success_rate": round(len(completed) / max(len(all_jobs), 1) * 100, 1),
        },
        "filament": {
            "total_g": round(total_filament_g, 1),
            "total_kg": round(total_filament_g / 1000, 2),
            "avg_per_print_g": round(avg_filament_g, 1),
            "by_type": {k: round(v, 1) for k, v in sorted(filament_by_type.items(), key=lambda x: -x[1])},
            "total_cost": round(total_fil_cost, 2),
        },
        "power": {
            "total_kwh": round(total_power_kwh, 3),
            "total_cost": round(total_elec_cost, 2),
            "avg_per_print_kwh": round(total_power_kwh / max(len(completed), 1), 3),
        },
        "time": {
            "total_hours": round(total_duration_s / 3600, 1),
            "avg_per_print_hours": round(avg_duration_s / 3600, 1),
            "avg_per_print_minutes": round(avg_duration_s / 60, 1),
        },
        "cost": {
            "total": round(total_elec_cost + total_fil_cost, 2),
            "electricity": round(total_elec_cost, 2),
            "filament": round(total_fil_cost, 2),
            "avg_per_print": round((total_elec_cost + total_fil_cost) / max(len(completed), 1), 2),
        },
        "jobs": [{
            "id": j.id,
            "filename": j.filename,
            "status": j.status.value,
            "duration_hours": round((j.actual_duration_seconds or 0) / 3600, 2),
            "filament_g": round(j.filament_used_g or 0, 1),
            "filament_type": j.filament_type,
            "total_cost": round((j.electricity_cost or 0) + (j.filament_cost or 0), 2),
        } for j in all_jobs],
    }


@router.get("/report/series")
def get_report_series(period: str = Query("weekly", regex="^(daily|weekly|monthly)$"), count: int = Query(8, ge=1, le=52), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    results = []

    for i in range(count - 1, -1, -1):
        if period == "daily":
            start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
            label = start.strftime("%m/%d")
        elif period == "weekly":
            s = now - timedelta(days=i * 7 + now.weekday())
            start = s.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=7)
            label = f"{start.strftime('%m/%d')}"
        else:
            start = (now - timedelta(days=i * 30)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end = (start.replace(day=28) + timedelta(days=4)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            label = start.strftime("%b")

        jobs = db.query(PrintJob).filter(PrintJob.start_time >= start, PrintJob.start_time < end)
        all_count = jobs.count()
        comp = jobs.filter(PrintJob.status == PrintStatus.COMPLETE)
        comp_count = comp.count()
        filament_g = float(comp.with_entities(func.coalesce(func.sum(PrintJob.filament_used_g), 0)).scalar() or 0)
        duration_s = float(comp.with_entities(func.coalesce(func.sum(PrintJob.actual_duration_seconds), 0)).scalar() or 0)
        elec = float(comp.with_entities(func.coalesce(func.sum(PrintJob.electricity_cost), 0)).scalar() or 0)
        fil = float(comp.with_entities(func.coalesce(func.sum(PrintJob.filament_cost), 0)).scalar() or 0)
        failed_count = jobs.filter(PrintJob.status == PrintStatus.FAILED).count()
        cancelled_count = jobs.filter(PrintJob.status == PrintStatus.CANCELLED).count()

        results.append({
            "label": label,
            "start": start.isoformat(),
            "total_jobs": all_count,
            "completed": comp_count,
            "failed": failed_count,
            "cancelled": cancelled_count,
            "filament_g": round(filament_g, 1),
            "filament_kg": round(filament_g / 1000, 2),
            "hours": round(duration_s / 3600, 1),
            "cost": round(elec + fil, 2),
            "electricity_cost": round(elec, 2),
            "filament_cost": round(fil, 2),
        })

    return results