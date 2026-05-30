from fastapi import APIRouter, HTTPException, Request, Depends
from sqlalchemy.orm import Session
from typing import Dict, Any
import aiohttp

from app.core.config import settings
from app.core.database import get_db
from app.models.app_config import AppConfig

router = APIRouter(prefix="/system", tags=["system"])


def _get_moonraker_url(db: Session) -> str:
    host_row = db.query(AppConfig).filter(AppConfig.key == "moonraker_host").first()
    port_row = db.query(AppConfig).filter(AppConfig.key == "moonraker_port").first()
    host = host_row.value if host_row else settings.moonraker_host
    port = int(port_row.value) if port_row else settings.moonraker_port
    return f"http://{host}:{port}"


async def _get_session(request: Request) -> aiohttp.ClientSession:
    session: aiohttp.ClientSession = request.app.state.http_session
    if session.closed:
        session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        request.app.state.http_session = session
    return session


@router.get("/health")
async def get_system_health(request: Request, db: Session = Depends(get_db)) -> Dict[str, Any]:
    session = await _get_session(request)
    url = f"{_get_moonraker_url(db)}/printer/objects/query?system_stats"
    async with session.get(url) as resp:
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Moonraker request failed")
        data = await resp.json()

    ss = data.get("result", {}).get("status", {}).get("system_stats", {})
    sysload = ss.get("sysload", 0)
    memavail_kb = ss.get("memavail", 0)
    uptime_s = ss.get("monotonic", 0)

    return {
        "cpu_load": round(sysload, 2),
        "memory_available_mb": round(memavail_kb / 1024, 1),
        "uptime_seconds": int(uptime_s),
        "uptime_hours": round(uptime_s / 3600, 1),
    }


@router.get("/printer-status")
async def get_printer_status(request: Request, db: Session = Depends(get_db)) -> Dict[str, Any]:
    session = await _get_session(request)
    objects = (
        "extruder"
        "&heater_bed"
        "&heater_generic chamber_heater"
        "&temperature_sensor chamber_temp"
        "&temperature_sensor mcu_temp"
        "&temperature_fan chamber_fan"
        "&heater_fan hotend_fan"
        "&heater_fan chamber_fan"
        "&fan"
        "&output_pin fan0"
        "&output_pin fan1"
        "&output_pin extruder_fan"
        "&mcu"
        "&idle_timeout"
        "&gcode_move"
        "&system_stats"
        "&toolhead"
        "&print_stats"
        "&display_status"
    )
    url = f"{_get_moonraker_url(db)}/printer/objects/query?{objects}"
    async with session.get(url) as resp:
        if resp.status != 200:
            raise HTTPException(status_code=502, detail="Moonraker request failed")
        data = await resp.json()

    status = data.get("result", {}).get("status", {})

    extruder = status.get("extruder", {})
    heater_bed = status.get("heater_bed", {})
    heater_chamber = status.get("heater_generic chamber_heater", {})
    temp_chamber = status.get("temperature_sensor chamber_temp", {})
    temp_mcu = status.get("temperature_sensor mcu_temp", {})
    chamber_fan = status.get("temperature_fan chamber_fan", {})
    hotend_fan = status.get("heater_fan hotend_fan", {})
    part_fan = status.get("fan", {})
    fan0 = status.get("output_pin fan0", {})
    extruder_fan = status.get("output_pin extruder_fan", {})
    mcu = status.get("mcu", {})
    idle = status.get("idle_timeout", {})
    gcode = status.get("gcode_move", {})
    sys_stats = status.get("system_stats", {})

    return {
        "extruder": {
            "temperature": extruder.get("temperature"),
            "target": extruder.get("target"),
            "power": extruder.get("power"),
            "nozzle_diameter": extruder.get("nozzle_diameter"),
            "pressure_advance": extruder.get("pressure_advance"),
        },
        "heater_bed": {
            "temperature": heater_bed.get("temperature"),
            "target": heater_bed.get("target"),
            "power": heater_bed.get("power"),
        },
        "heater_chamber": {
            "temperature": heater_chamber.get("temperature"),
            "target": heater_chamber.get("target"),
            "power": heater_chamber.get("power"),
        },
        "sensors": {
            "chamber": temp_chamber.get("temperature"),
            "chamber_min": temp_chamber.get("measured_min_temp"),
            "chamber_max": temp_chamber.get("measured_max_temp"),
            "mcu": temp_mcu.get("temperature"),
            "mcu_min": temp_mcu.get("measured_min_temp"),
            "mcu_max": temp_mcu.get("measured_max_temp"),
        },
        "fans": {
            "part_cooling_speed": part_fan.get("speed"),
            "part_cooling_rpm": part_fan.get("rpm"),
            "chamber_fan_speed": chamber_fan.get("speed"),
            "chamber_fan_rpm": chamber_fan.get("rpm"),
            "chamber_fan_temp": chamber_fan.get("temperature"),
            "chamber_fan_target": chamber_fan.get("target"),
            "hotend_fan_speed": hotend_fan.get("speed"),
            "hotend_fan_rpm": hotend_fan.get("rpm"),
            "fan0_value": fan0.get("value"),
            "extruder_fan_value": extruder_fan.get("value"),
        },
        "mcu": {
            "mcu_version": mcu.get("mcu_version"),
            "mcu_model": (mcu.get("mcu_constants") or {}).get("MCU"),
            "clock_freq": (mcu.get("mcu_constants") or {}).get("CLOCK_FREQ"),
            "last_stats": mcu.get("last_stats"),
        },
        "system": {
            "sysload": sys_stats.get("sysload"),
            "memavail_kb": sys_stats.get("memavail"),
            "uptime_s": sys_stats.get("monotonic"),
        },
        "print_state": {
            "idle_state": idle.get("state"),
            "printing_time": idle.get("printing_time"),
            "speed_factor": gcode.get("speed_factor"),
            "speed_mm_s": gcode.get("speed"),
            "extrude_factor": gcode.get("extrude_factor"),
        },
    }
