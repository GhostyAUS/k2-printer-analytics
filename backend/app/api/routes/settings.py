import logging
from fastapi import APIRouter, Depends, Request, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict

from app.core.config import settings
from app.core.database import get_db
from app.models.app_config import AppConfig
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULTS = {
    "electricity_rate_kwh": "0.49",
    "currency": "AUD",
    "default_filament_cost_per_kg": "24.0",
    "filament_density_pla": "1.24",
    "filament_density_abs": "1.04",
    "filament_density_petg": "1.27",
    "filament_density_tpu": "1.21",
    "filament_diameter_mm": "1.75",
    "moonraker_host": "192.168.1.146",
    "moonraker_port": "7125",
    "meross_email": "",
    "meross_password": "",
    "meross_device_name": "Printer",
    "meross_device_uuid": "",
}


class SettingUpdate(BaseModel):
    value: str


class ConnectionUpdate(BaseModel):
    moonraker_host: Optional[str] = None
    moonraker_port: Optional[int] = None
    meross_email: Optional[str] = None
    meross_password: Optional[str] = None
    meross_device_name: Optional[str] = None
    meross_device_uuid: Optional[str] = None
    timezone: Optional[str] = None
    currency: Optional[str] = None
    electricity_rate_kwh: Optional[float] = None


@router.get("/")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(AppConfig).all()
    stored = {r.key: r.value for r in rows}
    result = {**DEFAULTS, **stored}
    return result


@router.put("/{key}")
def set_setting(key: str, data: SettingUpdate, db: Session = Depends(get_db)):
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    if row:
        row.value = data.value
    else:
        row = AppConfig(key=key, value=data.value)
        db.add(row)
    db.commit()
    db.refresh(row)

    if key in ("moonraker_host", "moonraker_port"):
        logger.info(f"Moonraker config changed: {key}={data.value}")

    if key.startswith("meross_"):
        logger.info(f"Meross config changed: {key}")

    return {"key": row.key, "value": row.value}


@router.delete("/{key}")
def reset_setting(key: str, db: Session = Depends(get_db)):
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    if row:
        db.delete(row)
        db.commit()
    default = DEFAULTS.get(key)
    return {"key": key, "value": default, "default": True}


@router.put("/connection")
def set_connection(data: ConnectionUpdate, db: Session = Depends(get_db)):
    updates = {}
    for field, key in [
        ("moonraker_host", "moonraker_host"),
        ("moonraker_port", "moonraker_port"),
        ("meross_email", "meross_email"),
        ("meross_password", "meross_password"),
        ("meross_device_name", "meross_device_name"),
        ("meross_device_uuid", "meross_device_uuid"),
        ("timezone", "timezone"),
        ("currency", "currency"),
        ("electricity_rate_kwh", "electricity_rate_kwh"),
    ]:
        value = getattr(data, field)
        if value is not None:
            row = db.query(AppConfig).filter(AppConfig.key == key).first()
            if row:
                row.value = str(value)
            else:
                db.add(AppConfig(key=key, value=str(value)))
            updates[key] = str(value)
    db.commit()

    meross_changed = any(k.startswith("meross_") for k in updates)
    if meross_changed:
        from app.services.meross import meross_service
        meross_service._ready = False
        meross_service._device = None
        meross_service._manager = None
        meross_service._client = None
        logger.info("Meross service reset — will reconnect on next poll")

    moonraker_changed = any(k.startswith("moonraker_") for k in updates)
    if moonraker_changed:
        from app.services.moonraker import _update_moonraker_service
        _update_moonraker_service(db)
        logger.info("Moonraker service reconfigured")

    return {"updated": updates}


def get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    return row.value if row else default


@router.get("/setup/status")
def get_setup_status(db: Session = Depends(get_db)):
    moonraker_host = get_setting(db, "moonraker_host", settings.moonraker_host)
    moonraker_port = get_setting(db, "moonraker_port", str(settings.moonraker_port))

    has_moonraker = bool(moonraker_host)
    has_meross = bool(get_setting(db, "meross_email", settings.meross_email))
    has_user = db.query(User).first() is not None

    import httpx
    moonraker_connected = False
    try:
        resp = httpx.get(f"http://{moonraker_host}:{moonraker_port}/printer/info", timeout=3)
        moonraker_connected = resp.status_code == 200
    except Exception:
        pass

    return {
        "configured": has_moonraker,
        "moonraker_host": moonraker_host,
        "moonraker_port": int(moonraker_port),
        "moonraker_connected": moonraker_connected,
        "meross_configured": has_meross,
        "has_user": has_user,
    }


@router.get("/setup/test-connection")
def test_connection(host: str = Query(...), port: int = Query(7125)):
    import httpx
    try:
        resp = httpx.get(f"http://{host}:{port}/printer/info", timeout=5)
        return {"connected": resp.status_code == 200, "host": host, "port": port}
    except Exception as e:
        return {"connected": False, "host": host, "port": port, "error": str(e)}