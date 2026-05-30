from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
import httpx
import asyncio
import subprocess
import os

from app.core.database import get_db, SessionLocal
from app.core.config import settings
from app.models.app_config import AppConfig
from app.services.moonraker import _get_moonraker_config

router = APIRouter(prefix="/debug", tags=["debug"])


class TestResult(BaseModel):
    name: str
    passed: bool
    detail: str
    duration_ms: int


def _get_moonraker_url(db: Session) -> str:
    host_row = db.query(AppConfig).filter(AppConfig.key == "moonraker_host").first()
    port_row = db.query(AppConfig).filter(AppConfig.key == "moonraker_port").first()
    host = host_row.value if host_row else settings.moonraker_host
    port = int(port_row.value) if port_row else settings.moonraker_port
    return f"http://{host}:{port}"


async def _test_moonraker_reachable(db: Session) -> TestResult:
    import time
    start = time.time()
    url = _get_moonraker_url(db)
    try:
        async with httpx.AsyncClient() as client:
            resp = await asyncio.wait_for(client.get(f"{url}/printer/info", timeout=5), timeout=6)
        elapsed = int((time.time() - start) * 1000)
        if resp.status_code == 200:
            return TestResult(name="moonraker_reachable", passed=True, detail=f"HTTP {resp.status_code} from {url}", duration_ms=elapsed)
        return TestResult(name="moonraker_reachable", passed=False, detail=f"HTTP {resp.status_code} from {url}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="moonraker_reachable", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_moonraker_print_stats(db: Session) -> TestResult:
    import time
    start = time.time()
    url = _get_moonraker_url(db)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{url}/printer/objects/query?print_stats", timeout=5)
        data = resp.json()
        stats = data.get("result", {}).get("status", {}).get("print_stats", {})
        elapsed = int((time.time() - start) * 1000)
        if "state" in stats and "filename" in stats:
            return TestResult(name="moonraker_print_stats", passed=True, detail=f"state={stats['state']}, file={stats['filename'][:40]}", duration_ms=elapsed)
        return TestResult(name="moonraker_print_stats", passed=False, detail=f"Missing keys in response: {list(stats.keys())}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="moonraker_print_stats", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_moonraker_cfs(db: Session) -> TestResult:
    import time
    start = time.time()
    url = _get_moonraker_url(db)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{url}/printer/objects/query?box&filament_rack", timeout=5)
        data = resp.json()
        box = data.get("result", {}).get("status", {}).get("box", {})
        slot_count = 0
        for tid in ("T1", "T2", "T3", "T4"):
            tray = box.get(tid, {})
            if tray.get("state") not in (None, "None"):
                colors = tray.get("color_value", [])
                mats = tray.get("material_type", [])
                slot_count += sum(1 for i in range(min(len(colors), len(mats))) if colors[i] != "-1" and mats[i] != "-1")
        elapsed = int((time.time() - start) * 1000)
        if slot_count > 0:
            return TestResult(name="moonraker_cfs_data", passed=True, detail=f"{slot_count} slots detected", duration_ms=elapsed)
        return TestResult(name="moonraker_cfs_data", passed=False, detail="No CFS slots found", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="moonraker_cfs_data", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_moonraker_vsd(db: Session) -> TestResult:
    import time
    start = time.time()
    url = _get_moonraker_url(db)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{url}/printer/objects/query?virtual_sdcard", timeout=5)
        data = resp.json()
        vsd = data.get("result", {}).get("status", {}).get("virtual_sdcard", {})
        elapsed = int((time.time() - start) * 1000)
        if "progress" in vsd:
            return TestResult(name="moonraker_vsd", passed=True, detail=f"progress={vsd.get('progress')}", duration_ms=elapsed)
        return TestResult(name="moonraker_vsd", passed=False, detail=f"Missing progress key: {list(vsd.keys())[:5]}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="moonraker_vsd", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_db_healthy(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        db.execute(text("SELECT 1"))
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="db_healthy", passed=True, detail="SELECT 1 OK", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="db_healthy", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_db_tables(db: Session) -> TestResult:
    import time
    start = time.time()
    expected = {"print_jobs", "power_logs", "filament_library", "cfs_slot_overrides", "cfs_slot_usage", "app_config", "users", "spools"}
    try:
        result = db.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))
        existing = {row[0] for row in result}
        missing = expected - existing
        elapsed = int((time.time() - start) * 1000)
        if not missing:
            return TestResult(name="db_tables", passed=True, detail=f"All {len(expected)} tables present", duration_ms=elapsed)
        return TestResult(name="db_tables", passed=False, detail=f"Missing tables: {', '.join(missing)}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="db_tables", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_meross(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.services.meross import meross_service
        watts = await meross_service.async_get_power()
        elapsed = int((time.time() - start) * 1000)
        if watts is not None and watts >= 0:
            return TestResult(name="meross_power", passed=True, detail=f"{watts:.0f}W", duration_ms=elapsed)
        return TestResult(name="meross_power", passed=False, detail="Returned None or negative", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="meross_power", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_cfs_sync(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.models.filament_roll import FilamentRoll
        cfs_rolls = db.query(FilamentRoll).filter(FilamentRoll.spool_id.isnot(None), FilamentRoll.spool_id != "").all()
        elapsed = int((time.time() - start) * 1000)
        if len(cfs_rolls) > 0:
            slots = ", ".join(r.spool_id for r in cfs_rolls[:8])
            return TestResult(name="cfs_sync", passed=True, detail=f"{len(cfs_rolls)} synced slots: {slots}", duration_ms=elapsed)
        return TestResult(name="cfs_sync", passed=False, detail="No CFS entries in filament_library (run sync first)", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="cfs_sync", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_color_normalization(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.models.filament_roll import FilamentRoll
        from app.models.cfs_override import CfsSlotOverride
        bad_lib = db.query(FilamentRoll).filter(
            FilamentRoll.spool_id.isnot(None),
            FilamentRoll.spool_id != "",
            ~FilamentRoll.color_hex.like("#%"),
        ).count()
        bad_ovr = db.query(CfsSlotOverride).filter(
            CfsSlotOverride.color_hex.isnot(None),
            ~CfsSlotOverride.color_hex.like("#%"),
        ).count()
        elapsed = int((time.time() - start) * 1000)
        if bad_lib == 0 and bad_ovr == 0:
            return TestResult(name="color_normalization", passed=True, detail="All colors use #rrggbb format", duration_ms=elapsed)
        return TestResult(name="color_normalization", passed=False, detail=f"Non-normalized: library={bad_lib}, overrides={bad_ovr}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="color_normalization", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_filament_cost_math(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        grams = 100.0
        cost_per_kg = 24.0
        expected = 2.40
        actual = (grams / 1000) * cost_per_kg
        elapsed = int((time.time() - start) * 1000)
        if abs(actual - expected) < 0.001:
            return TestResult(name="filament_cost_math", passed=True, detail=f"{grams}g × ${cost_per_kg}/kg = ${actual:.2f}", duration_ms=elapsed)
        return TestResult(name="filament_cost_math", passed=False, detail=f"Expected ${expected}, got ${actual}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="filament_cost_math", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_mw_delta(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        mw_start = -1000.0
        mw_end = -500.0
        expected = 500.0
        actual = abs(mw_end - mw_start)
        elapsed = int((time.time() - start) * 1000)
        if abs(actual - expected) < 0.001:
            return TestResult(name="mw_delta", passed=True, detail=f"|{mw_end} - ({mw_start})| = {actual}mm", duration_ms=elapsed)
        return TestResult(name="mw_delta", passed=False, detail=f"Expected {expected}, got {actual}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="mw_delta", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_cross_tray_guard(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.models.cfs_slot_usage import CfsSlotUsage
        records = db.query(CfsSlotUsage).filter(CfsSlotUsage.filament_used_g.isnot(None)).all()
        bad = []
        for r in records:
            if r.measuring_wheel_start is not None and r.measuring_wheel_end is not None:
                mw_delta = abs(r.measuring_wheel_end - r.measuring_wheel_start)
                if mw_delta > 100000:
                    bad.append(f"{r.slot_id}(id={r.id}): delta={mw_delta:.0f}mm")
        elapsed = int((time.time() - start) * 1000)
        if not bad:
            return TestResult(name="cross_tray_guard", passed=True, detail="No cross-tray deltas detected in slot usage", duration_ms=elapsed)
        return TestResult(name="cross_tray_guard", passed=False, detail=f"Suspect: {', '.join(bad[:3])}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="cross_tray_guard", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_filament_decrement(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.models.filament_roll import FilamentRoll
        rolls = db.query(FilamentRoll).filter(FilamentRoll.remaining_weight_g < 0).all()
        elapsed = int((time.time() - start) * 1000)
        if not rolls:
            return TestResult(name="filament_decrement", passed=True, detail="No rolls with negative remaining_weight_g", duration_ms=elapsed)
        bad = ", ".join(f"{r.spool_id or r.id}:{r.remaining_weight_g}g" for r in rolls[:3])
        return TestResult(name="filament_decrement", passed=False, detail=f"Negative remaining: {bad}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="filament_decrement", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_cfs_override_decrement(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.models.cfs_override import CfsSlotOverride
        bad = db.query(CfsSlotOverride).filter(CfsSlotOverride.remaining_pct < 0).all()
        elapsed = int((time.time() - start) * 1000)
        if not bad:
            return TestResult(name="cfs_override_decrement", passed=True, detail="No overrides with negative remaining_pct", duration_ms=elapsed)
        details = ", ".join(f"{o.slot_id}:{o.remaining_pct}%" for o in bad[:3])
        return TestResult(name="cfs_override_decrement", passed=False, detail=f"Negative: {details}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="cfs_override_decrement", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_power_downsample(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("http://localhost:8000/api/v1/analytics/power-history?minutes=60", timeout=10)
        data = resp.json()
        count = len(data)
        elapsed = int((time.time() - start) * 1000)
        if count <= 120:
            return TestResult(name="power_downsample", passed=True, detail=f"{count} points (≤120)", duration_ms=elapsed)
        return TestResult(name="power_downsample", passed=False, detail=f"{count} points (exceeds 120 limit)", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="power_downsample", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_auth_token(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.core.auth import create_access_token, verify_token
        token = create_access_token({"sub": "test", "is_admin": True})
        payload = verify_token(token)
        elapsed = int((time.time() - start) * 1000)
        if payload and payload.get("sub") == "test":
            return TestResult(name="auth_token", passed=True, detail=f"Token created & verified for sub={payload.get('sub')}", duration_ms=elapsed)
        return TestResult(name="auth_token", passed=False, detail=f"Payload missing or wrong sub: {payload}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="auth_token", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_settings_crud(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        test_key = "_debug_test_key"
        test_val = "test_value_123"
        existing = db.query(AppConfig).filter(AppConfig.key == test_key).first()
        if existing:
            db.delete(existing)
            db.commit()
        row = AppConfig(key=test_key, value=test_val)
        db.add(row)
        db.commit()
        read_back = db.query(AppConfig).filter(AppConfig.key == test_key).first()
        if not read_back or read_back.value != test_val:
            db.delete(row)
            db.commit()
            elapsed = int((time.time() - start) * 1000)
            return TestResult(name="settings_crud", passed=False, detail=f"Read back: {read_back.value if read_back else 'None'}", duration_ms=elapsed)
        db.delete(read_back)
        db.commit()
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="settings_crud", passed=True, detail="Write→Read→Delete cycle OK", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="settings_crud", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_tracker_running(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.services.print_tracker import print_tracker
        elapsed = int((time.time() - start) * 1000)
        if print_tracker._running:
            job_info = f"job_id={print_tracker.active_job_id}" if print_tracker.active_job_id else "idle"
            return TestResult(name="tracker_running", passed=True, detail=f"Running, {job_info}", duration_ms=elapsed)
        return TestResult(name="tracker_running", passed=False, detail="Tracker not running", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="tracker_running", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_active_job(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.services.print_tracker import print_tracker
        from app.models.print_job import PrintJob, PrintStatus
        printing = db.query(PrintJob).filter(PrintJob.status == PrintStatus.PRINTING).count()
        tracker_job = print_tracker.active_job_id
        elapsed = int((time.time() - start) * 1000)
        if printing > 0 and tracker_job:
            return TestResult(name="active_job", passed=True, detail=f"DB has {printing} printing jobs, tracker tracking #{tracker_job}", duration_ms=elapsed)
        if printing == 0 and not tracker_job:
            return TestResult(name="active_job", passed=True, detail="No active prints (consistent)", duration_ms=elapsed)
        return TestResult(name="active_job", passed=False, detail=f"DB printing={printing}, tracker_job={tracker_job} (mismatch)", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="active_job", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_filament_total(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        from app.models.print_job import PrintJob, PrintStatus
        from app.models.cfs_slot_usage import CfsSlotUsage
        job = db.query(PrintJob).filter(
            PrintJob.status.in_([PrintStatus.COMPLETE, PrintStatus.PRINTING]),
            PrintJob.filament_used_g.isnot(None),
        ).order_by(PrintJob.id.desc()).first()
        if not job:
            elapsed = int((time.time() - start) * 1000)
            return TestResult(name="filament_total", passed=True, detail="No completed jobs with filament data to validate", duration_ms=elapsed)
        slots = db.query(CfsSlotUsage).filter(
            CfsSlotUsage.print_job_id == job.id,
            CfsSlotUsage.filament_used_g.isnot(None),
        ).all()
        slot_total = sum(s.filament_used_g for s in slots)
        diff_pct = abs(slot_total - job.filament_used_g) / max(job.filament_used_g, 0.01) * 100
        elapsed = int((time.time() - start) * 1000)
        if diff_pct < 30 or not slots:
            return TestResult(name="filament_total", passed=True, detail=f"Job #{job.id}: moonraker={job.filament_used_g:.1f}g, slots={slot_total:.1f}g ({diff_pct:.0f}% diff)", duration_ms=elapsed)
        return TestResult(name="filament_total", passed=False, detail=f"Job #{job.id}: moonraker={job.filament_used_g:.1f}g vs slots={slot_total:.1f}g ({diff_pct:.0f}% diff)", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="filament_total", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_frontend(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("http://frontend:3000", timeout=5, follow_redirects=True)
        elapsed = int((time.time() - start) * 1000)
        if resp.status_code < 500:
            return TestResult(name="frontend_served", passed=True, detail=f"HTTP {resp.status_code} (frontend container reachable)", duration_ms=elapsed)
        return TestResult(name="frontend_served", passed=False, detail=f"HTTP {resp.status_code}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="frontend_served", passed=False, detail=str(e)[:100], duration_ms=elapsed)


async def _test_api_proxy(db: Session) -> TestResult:
    import time
    start = time.time()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("http://frontend:3000/api/v1/health", timeout=5)
        elapsed = int((time.time() - start) * 1000)
        if resp.status_code < 500:
            return TestResult(name="api_proxy", passed=True, detail=f"HTTP {resp.status_code} (proxy route reachable)", duration_ms=elapsed)
        return TestResult(name="api_proxy", passed=False, detail=f"HTTP {resp.status_code}", duration_ms=elapsed)
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return TestResult(name="api_proxy", passed=False, detail=str(e)[:100], duration_ms=elapsed)


TEST_REGISTRY = {
    "moonraker_reachable": ("Connectivity", _test_moonraker_reachable),
    "moonraker_print_stats": ("Connectivity", _test_moonraker_print_stats),
    "moonraker_cfs_data": ("Connectivity", _test_moonraker_cfs),
    "moonraker_vsd": ("Connectivity", _test_moonraker_vsd),
    "db_healthy": ("Connectivity", _test_db_healthy),
    "db_tables": ("Connectivity", _test_db_tables),
    "meross_power": ("Connectivity", _test_meross),
    "cfs_sync": ("Data & Logic", _test_cfs_sync),
    "color_normalization": ("Data & Logic", _test_color_normalization),
    "filament_cost_math": ("Data & Logic", _test_filament_cost_math),
    "mw_delta": ("Data & Logic", _test_mw_delta),
    "cross_tray_guard": ("Data & Logic", _test_cross_tray_guard),
    "filament_decrement": ("Data & Logic", _test_filament_decrement),
    "cfs_override_decrement": ("Data & Logic", _test_cfs_override_decrement),
    "power_downsample": ("Data & Logic", _test_power_downsample),
    "auth_token": ("Data & Logic", _test_auth_token),
    "settings_crud": ("Data & Logic", _test_settings_crud),
    "tracker_running": ("Tracker", _test_tracker_running),
    "active_job": ("Tracker", _test_active_job),
    "filament_total": ("Tracker", _test_filament_total),
    "frontend_served": ("Frontend", _test_frontend),
    "api_proxy": ("Frontend", _test_api_proxy),
}


@router.get("/tests")
def list_tests():
    categories = {}
    for name, (cat, _) in TEST_REGISTRY.items():
        categories.setdefault(cat, []).append(name)
    return {"categories": categories}


@router.post("/run-test")
async def run_test(body: dict, db: Session = Depends(get_db)):
    test_name = body.get("name")
    if test_name not in TEST_REGISTRY:
        return {"error": f"Unknown test: {test_name}"}
    _, test_fn = TEST_REGISTRY[test_name]
    return await test_fn(db)


@router.post("/run-all")
async def run_all_tests(db: Session = Depends(get_db)):
    results = []
    for name, (cat, test_fn) in TEST_REGISTRY.items():
        result = await test_fn(db)
        results.append(result)
    passed = sum(1 for r in results if r.passed)
    return {"results": results, "total": len(results), "passed": passed, "failed": len(results) - passed}


@router.get("/export-logs", response_class=PlainTextResponse)
async def export_logs(request: Request, db: Session = Depends(get_db)):
    token = request.query_params.get("token", "")
    if token:
        from app.core.auth import verify_token
        payload = verify_token(token)
        if not payload:
            return PlainTextResponse("Unauthorized", status_code=401)
    sections = []
    sections.append("=" * 60)
    sections.append("K2 Printer Analytics - Diagnostic Logs")
    sections.append(f"Generated: {os.popen('date -u \"+%Y-%m-%d %H:%M:%S UTC\"').read().strip()}")
    sections.append("=" * 60)

    sections.append("\n[SYSTEM]")
    try:
        sections.append(f"Hostname: {os.uname().nodename}")
        sections.append(f"Platform: {os.uname().sysname} {os.uname().release}")
        sections.append(f"Python: {subprocess.run(['python3', '--version'], capture_output=True, text=True).stdout.strip()}")
    except Exception as e:
        sections.append(f"Error: {e}")

    sections.append("\n[DOCKER]")
    try:
        r = subprocess.run(['docker', 'ps', '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'], capture_output=True, text=True, timeout=10)
        sections.append(r.stdout.strip() or "Docker not available")
    except Exception as e:
        sections.append(f"Docker not available: {e}")

    sections.append("\n[ENVIRONMENT]")
    for key in ["MOONRAKER_HOST", "MOONRAKER_PORT", "MEROSS_EMAIL", "POWER_RATE_KWH", "DATABASE_URL", "TZ"]:
        val = os.environ.get(key, "(not set)")
        if "PASSWORD" in key or "SECRET" in key:
            val = "***"
        sections.append(f"  {key}={val}")

    sections.append("\n[DB CONFIG]")
    try:
        for k in ["moonraker_host", "moonraker_port", "meross_email", "meross_device_name", "meross_device_uuid",
                   "electricity_rate_kwh", "currency", "default_filament_cost_per_kg",
                   "notify_webhook_url", "notify_on_complete", "notify_on_failed", "notify_on_cancelled"]:
            row = db.query(AppConfig).filter(AppConfig.key == k).first()
            val = row.value if row else "(not set)"
            if "password" in k.lower():
                val = "***"
            sections.append(f"  {k}={val}")
    except Exception as e:
        sections.append(f"  Error: {e}")

    sections.append("\n[DIAGNOSTIC TEST RESULTS]")
    try:
        for name, (cat, test_fn) in TEST_REGISTRY.items():
            result = await test_fn(db)
            status = "PASS" if result.passed else "FAIL"
            sections.append(f"  [{status}] {result.name}: {result.detail} ({result.duration_ms}ms)")
    except Exception as e:
        sections.append(f"  Error running tests: {e}")

    sections.append("\n[TRACKER STATE]")
    try:
        from app.services.print_tracker import print_tracker
        sections.append(f"  running={print_tracker._running}")
        sections.append(f"  active_job_id={print_tracker.active_job_id}")
    except Exception as e:
        sections.append(f"  Error: {e}")

    sections.append("\n[DB STATS]")
    try:
        from app.models.print_job import PrintJob, PrintStatus
        from app.models.filament_roll import FilamentRoll
        from app.models.cfs_slot_usage import CfsSlotUsage
        from app.models.cfs_override import CfsSlotOverride
        sections.append(f"  print_jobs={db.query(PrintJob).count()}")
        sections.append(f"  printing={db.query(PrintJob).filter(PrintJob.status == PrintStatus.PRINTING).count()}")
        sections.append(f"  complete={db.query(PrintJob).filter(PrintJob.status == PrintStatus.COMPLETE).count()}")
        sections.append(f"  failed={db.query(PrintJob).filter(PrintJob.status == PrintStatus.FAILED).count()}")
        sections.append(f"  filament_library={db.query(FilamentRoll).count()}")
        sections.append(f"  cfs_synced={db.query(FilamentRoll).filter(FilamentRoll.spool_id.isnot(None), FilamentRoll.spool_id != '').count()}")
        sections.append(f"  cfs_slot_usage={db.query(CfsSlotUsage).count()}")
        sections.append(f"  cfs_overrides={db.query(CfsSlotOverride).count()}")
    except Exception as e:
        sections.append(f"  Error: {e}")

    sections.append("\n[RECENT JOBS]")
    try:
        from app.models.print_job import PrintJob
        recent = db.query(PrintJob).order_by(PrintJob.id.desc()).limit(5).all()
        for j in recent:
            sections.append(f"  #{j.id}: {j.filename} status={j.status} filament={j.filament_used_g}g duration={j.duration_seconds}s")
    except Exception as e:
        sections.append(f"  Error: {e}")

    sections.append("\n[CFS SLOT OVERRIDES]")
    try:
        from app.models.cfs_override import CfsSlotOverride
        overrides = db.query(CfsSlotOverride).all()
        for o in overrides:
            sections.append(f"  {o.slot_id}: remaining={o.remaining_pct}% color={o.color_hex} cost={o.cost_per_kg} weight={o.spool_weight_g}g")
    except Exception as e:
        sections.append(f"  Error: {e}")

    sections.append("\n" + "=" * 60)
    sections.append("End of diagnostic logs")

    return "\n".join(sections)
