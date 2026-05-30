import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional
import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.services.print_job_service import PrintJobService
from app.models.print_job import PrintJob, PrintStatus
from app.services.meross import meross_service

logger = logging.getLogger(__name__)

MATERIAL_MAP = {
    "0e1001": "PLA+", "101001": "PLA", "001001": "PETG", "000001": "ABS",
    "0E1001": "PLA+", "0ff614b": "PLA Matte", "0C12E1F": "PLA Silk",
    "0FFFFFF": "PLA White", "000a3ff": "PLA Blue", "09ea7ae": "PLA+ Green",
    "0000000": "PLA Black", "01b04ae": "PLA Blue", "0fc9da9": "PLA Orange",
}


def _normalize_hex(hex_val: str) -> str:
    if not hex_val or hex_val == "-1":
        return ""
    h = hex_val.replace('#', '')
    if len(h) == 7 and h.startswith('0'):
        h = h[1:]
    return f"#{h}" if len(h) == 6 else hex_val


class MoonrakerPrintTracker:
    def __init__(self):
        self.active_job_id: Optional[int] = None
        self.active_filename: Optional[str] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._active_cfs_slot: Optional[str] = None
        self._active_cfs_tray: Optional[str] = None
        self._measuring_wheel_at_slot_start: Optional[float] = None
        self._cfs_material_name: Optional[str] = None
        self._cfs_color_hex: Optional[str] = None

    async def _check_running_print(self):
        from app.services.moonraker import _get_moonraker_config
        host, port = _get_moonraker_config()
        url = f"http://{host}:{port}/printer/objects/query?print_stats&virtual_sdcard"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=10)
            data = resp.json()
        ps = data.get("result", {}).get("status", {}).get("print_stats", {})
        vsd = data.get("result", {}).get("status", {}).get("virtual_sdcard", {})
        if ps and ps.get("state") == "printing" and ps.get("filename"):
            logger.info(f"REST bootstrap: print is active — {ps['filename']}")
            await self._on_print_start(ps, vsd)

    async def _on_print_start(self, print_stats: dict, vsd: Optional[dict] = None):
        db: Session = SessionLocal()
        try:
            service = PrintJobService(db)

            existing = db.query(PrintJob).filter(
                PrintJob.filename == print_stats["filename"],
                PrintJob.status == PrintStatus.PRINTING,
            ).order_by(PrintJob.id.desc()).first()
            if existing:
                self.active_job_id = existing.id
                self.active_filename = print_stats["filename"]
                logger.info(f"Reusing existing print job {existing.id}: {existing.filename}")
                from app.models.cfs_slot_usage import CfsSlotUsage
                open_records = db.query(CfsSlotUsage).filter(
                    CfsSlotUsage.print_job_id == existing.id,
                    CfsSlotUsage.ended_at.is_(None),
                ).all()
                for record in open_records:
                    db.delete(record)
                    logger.info(f"Deleted stale CFS slot record {record.id} ({record.slot_id}) on reuse")
                db.commit()
                await self._poll_cfs_state()
                return

            meta = (vsd or {}).get("cur_print_data", {}).get("metadata", {})
            estimated_duration = meta.get("estimated_time")
            if not estimated_duration:
                estimated_duration = print_stats.get("estimated_duration_seconds")
            if not estimated_duration:
                import re
                m = re.search(r'_(\d+)h(\d+)m(\d+)s\.gcode$', print_stats["filename"])
                if m:
                    estimated_duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))

            fg = meta.get("filament_used_g", [None])[0] if meta.get("filament_used_g") else None
            estimated_filament_g = float(fg) if fg else None

            job = service.create_print_job({
                "filename": print_stats["filename"],
                "status": "PRINTING",
                "start_time": datetime.now(timezone.utc),
                "estimated_duration_seconds": estimated_duration,
                "estimated_filament_g": estimated_filament_g,
                "filament_type": self._parse_material(print_stats["filename"]),
            })

            try:
                from app.api.routes.files import _find_thumbnail_path
                import aiohttp
                from app.services.moonraker import _get_moonraker_config
                h, p = _get_moonraker_config()
                murl = f"http://{h}:{p}"
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as ts:
                    thumb = await _find_thumbnail_path(ts, murl, print_stats["filename"])
                if thumb:
                    job.thumbnail_path = thumb
                    db2 = SessionLocal()
                    try:
                        db2.query(PrintJob).filter(PrintJob.id == job.id).update({"thumbnail_path": thumb})
                        db2.commit()
                    finally:
                        db2.close()
                    logger.info(f"Thumbnail saved for job {job.id}: {thumb}")
            except Exception as te:
                logger.warning(f"Thumbnail lookup failed for {print_stats['filename']}: {te}")

            self.active_job_id = job.id
            self.active_filename = print_stats["filename"]

            self._active_cfs_slot = None
            self._active_cfs_tray = None
            self._measuring_wheel_at_slot_start = None
            self._cfs_material_name = None
            self._cfs_color_hex = None

            await self._poll_cfs_state()

            logger.info(f"Started tracking print job {job.id}: {job.filename} (est {estimated_duration}s, {estimated_filament_g}g)")
        except Exception as e:
            logger.error(f"Error creating print job: {e}")
        finally:
            db.close()

    async def _poll_cfs_state(self):
        if not self.active_job_id:
            return
        from app.services.moonraker import _get_moonraker_config
        host, port = _get_moonraker_config()
        url = f"http://{host}:{port}/printer/objects/query?box&filament_rack"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=10)
                if resp.status_code != 200:
                    return
                data = resp.json()
        except Exception:
            return

        result = data.get("result", {}).get("status", {})
        box = result.get("box", {})
        same_material = box.get("same_material", [])

        name_map = {}
        for entry in same_material:
            if len(entry) >= 4 and isinstance(entry[2], list):
                name = entry[3] or ""
                for sid in entry[2]:
                    if name:
                        name_map[sid] = name

        current_slot = None
        current_tray = None
        measuring_wheel = None
        mat_code = None
        color_hex = None

        for tray_id in ("T1", "T2", "T3", "T4"):
            tray = box.get(tray_id, {})
            if tray.get("state") == "None":
                continue
            tray_filament = str(tray.get("filament", "None"))
            tray_mode = str(tray.get("mode", "0"))
            if tray_mode == "2" and tray_filament in ("A", "B", "C", "D"):
                current_slot = f"{tray_id}{tray_filament}"
                current_tray = tray_id
                mw_val = tray.get("measuring_wheel")
                measuring_wheel = float(mw_val) if mw_val is not None and str(mw_val) != "None" else None
                colors = tray.get("color_value", [])
                materials = tray.get("material_type", [])
                idx = ["A", "B", "C", "D"].index(tray_filament)
                color_hex = colors[idx] if idx < len(colors) else None
                mat_code = materials[idx] if idx < len(materials) else None
                break

        if current_slot and current_slot != self._active_cfs_slot:
            if self._active_cfs_slot:
                if self._active_cfs_tray == current_tray and self._measuring_wheel_at_slot_start is not None and measuring_wheel is not None:
                    await self._close_cfs_slot_record(measuring_wheel)
                else:
                    await self._close_cfs_slot_record(None)

            if current_slot:
                self._active_cfs_slot = current_slot
                self._active_cfs_tray = current_tray
                self._measuring_wheel_at_slot_start = measuring_wheel
                override_name = name_map.get(current_slot, "")
                self._cfs_material_name = override_name or MATERIAL_MAP.get(mat_code, "Unknown") if mat_code else None
                self._cfs_color_hex = _normalize_hex(color_hex)

                db: Session = SessionLocal()
                try:
                    from app.models.cfs_slot_usage import CfsSlotUsage
                    usage = CfsSlotUsage(
                        print_job_id=self.active_job_id,
                        slot_id=current_slot,
                        tray_id=current_tray,
                        material_name=self._cfs_material_name,
                        color_hex=self._cfs_color_hex,
                        measuring_wheel_start=measuring_wheel,
                        started_at=datetime.now(timezone.utc),
                    )
                    db.add(usage)
                    db.commit()
                    logger.info(f"CFS slot {current_slot} activated (mw_start={measuring_wheel})")
                except Exception as e:
                    logger.error(f"Error creating CFS slot usage record: {e}")
                    db.rollback()
                finally:
                    db.close()

    async def _close_cfs_slot_record(self, measuring_wheel_now: Optional[float]):
        if not self.active_job_id or not self._active_cfs_slot:
            return

        db: Session = SessionLocal()
        try:
            from app.models.cfs_slot_usage import CfsSlotUsage
            record = db.query(CfsSlotUsage).filter(
                CfsSlotUsage.print_job_id == self.active_job_id,
                CfsSlotUsage.slot_id == self._active_cfs_slot,
                CfsSlotUsage.ended_at.is_(None),
            ).order_by(CfsSlotUsage.id.desc()).first()

            if record:
                record.ended_at = datetime.now(timezone.utc)
                if measuring_wheel_now is not None and self._measuring_wheel_at_slot_start is not None:
                    delta_mm = abs(measuring_wheel_now - self._measuring_wheel_at_slot_start)
                    record.measuring_wheel_end = measuring_wheel_now
                    record.filament_used_mm = round(delta_mm, 2)
                    diameter = float(self._get_setting(db, "filament_diameter_mm", "1.75"))
                    area = 3.14159 * (diameter / 2) ** 2
                    material = self._cfs_material_name or "PLA"
                    density_key = {"PLA": "filament_density_pla", "ABS": "filament_density_abs", "PETG": "filament_density_petg", "TPU": "filament_density_tpu"}.get(material.upper().split("+")[0].split(" ")[0], "filament_density_pla")
                    density = float(self._get_setting(db, density_key, "1.24"))
                    record.filament_used_g = round(delta_mm * area * density / 1000, 2)
                    logger.info(f"CFS slot {self._active_cfs_slot}: {delta_mm:.1f}mm = {record.filament_used_g:.1f}g")
                else:
                    logger.info(f"CFS slot {self._active_cfs_slot}: closed (cross-tray change, no mm/g calc)")

                db.commit()
                logger.info(f"CFS slot {self._active_cfs_slot}: {delta_mm:.1f}mm = {record.filament_used_g:.1f}g")
        except Exception as e:
            logger.error(f"Error closing CFS slot record: {e}")
            db.rollback()
        finally:
            db.close()

    async def _close_all_open_slot_records(self, job_id: int, final_mw: Optional[float] = None, final_tray: Optional[str] = None):
        db: Session = SessionLocal()
        try:
            from app.models.cfs_slot_usage import CfsSlotUsage
            open_records = db.query(CfsSlotUsage).filter(
                CfsSlotUsage.print_job_id == job_id,
                CfsSlotUsage.ended_at.is_(None),
            ).all()
            for record in open_records:
                same_tray = final_tray and record.tray_id == final_tray
                if same_tray and record.measuring_wheel_start is not None and final_mw is not None:
                    delta_mm = abs(final_mw - record.measuring_wheel_start)
                    record.measuring_wheel_end = final_mw
                    record.filament_used_mm = round(delta_mm, 2)
                    diameter = float(self._get_setting(db, "filament_diameter_mm", "1.75"))
                    area = 3.14159 * (diameter / 2) ** 2
                    material = (record.material_name or "PLA").upper().split("+")[0].split(" ")[0]
                    density_key = {"PLA": "filament_density_pla", "ABS": "filament_density_abs", "PETG": "filament_density_petg", "TPU": "filament_density_tpu"}.get(material, "filament_density_pla")
                    density = float(self._get_setting(db, density_key, "1.24"))
                    record.filament_used_g = round(delta_mm * area * density / 1000, 2)
                record.ended_at = datetime.now(timezone.utc)
                logger.info(f"Closed CFS slot record {record.id} ({record.slot_id}): {record.filament_used_mm or 0}mm = {record.filament_used_g or 0}g")
            db.commit()
        except Exception as e:
            logger.error(f"Error closing open slot records: {e}")
            db.rollback()
        finally:
            db.close()

    async def _calculate_costs(self, db: Session, job_id: int):
        from app.models.power_log import PowerLog
        from app.models.cfs_override import CfsSlotOverride
        from app.models.print_job import PrintJob
        from app.models.cfs_slot_usage import CfsSlotUsage
        from app.models.filament_roll import FilamentRoll

        job = db.query(PrintJob).filter(PrintJob.id == job_id).first()
        if not job:
            return

        logs = db.query(PowerLog).filter(PowerLog.print_job_id == job_id).order_by(PowerLog.timestamp).all()
        total_kwh = 0.0
        prev: Optional[PowerLog] = None
        for log in logs:
            if prev and prev.wattage:
                delta_h = (log.timestamp - prev.timestamp).total_seconds() / 3600
                total_kwh += prev.wattage * delta_h / 1000
            prev = log

        if total_kwh == 0 and job.actual_duration_seconds and job.actual_duration_seconds > 0:
            total_kwh = round(151.0 * job.actual_duration_seconds / 3600.0 / 1000.0, 4)

        total_kwh = round(total_kwh, 4)
        rate = float(self._get_setting(db, "electricity_rate_kwh", str(settings.electricity_rate_kwh)))
        electricity_cost = round(total_kwh * rate, 4)

        filament_cost = 0.0
        slot_usages = db.query(CfsSlotUsage).filter(CfsSlotUsage.print_job_id == job_id).all()
        if slot_usages:
            for su in slot_usages:
                if su.filament_used_g and su.filament_used_g > 0:
                    cost_per_kg = None
                    override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == su.slot_id).first()
                    if override and override.cost_per_kg:
                        cost_per_kg = override.cost_per_kg
                    else:
                        roll = db.query(FilamentRoll).filter(
                            FilamentRoll.spool_id == su.slot_id,
                            FilamentRoll.remaining_weight_g > 0,
                        ).first()
                        if roll and roll.cost_per_kg:
                            cost_per_kg = roll.cost_per_kg
                        else:
                            if su.material_name:
                                mat = su.material_name.upper().split("+")[0].split(" ")[0]
                                roll = db.query(FilamentRoll).filter(
                                    FilamentRoll.material.ilike(f"%{mat}%"),
                                    FilamentRoll.remaining_weight_g > 0,
                                ).order_by(FilamentRoll.remaining_weight_g.desc()).first()
                                if roll and roll.cost_per_kg:
                                    cost_per_kg = roll.cost_per_kg
                    if not cost_per_kg:
                        cost_per_kg = float(self._get_setting(db, "default_filament_cost_per_kg", "24.0"))
                    filament_cost += (su.filament_used_g / 1000) * cost_per_kg
        elif job.filament_used_g:
            slot_id = (self.active_filename or "")[:3]
            override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first() if slot_id else None
            cost_per_kg = None
            if override and override.cost_per_kg:
                cost_per_kg = override.cost_per_kg
            elif job.spool and job.spool.cost_per_kg:
                cost_per_kg = job.spool.cost_per_kg
            if not cost_per_kg:
                cost_per_kg = float(self._get_setting(db, "default_filament_cost_per_kg", "24.0"))
            filament_cost = (job.filament_used_g / 1000) * cost_per_kg

        filament_cost = round(filament_cost, 4)
        update = {
            "total_power_kwh": total_kwh,
            "electricity_cost": electricity_cost,
            "filament_cost": filament_cost,
        }
        service = PrintJobService(db)
        service.update_print_job(job_id, update)
        logger.info(f"Costs for job {job_id}: {total_kwh}kWh=${electricity_cost}, filament=${filament_cost}")

    async def _on_print_end(self, print_stats: dict):
        if not self.active_job_id:
            return

        job_id = self.active_job_id
        self.active_job_id = None

        from app.services.moonraker import _get_moonraker_config
        host, port = _get_moonraker_config()
        url = f"http://{host}:{port}/printer/objects/query?box"
        final_mw = None
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=10)
                if resp.status_code == 200:
                    box = resp.json().get("result", {}).get("status", {}).get("box", {})
                    if self._active_cfs_tray:
                        tray = box.get(self._active_cfs_tray, {})
                        mw_val = tray.get("measuring_wheel")
                        if mw_val is not None and str(mw_val) != "None":
                            final_mw = float(mw_val)
        except Exception:
            pass

        if final_mw is not None and self._measuring_wheel_at_slot_start is not None:
            await self._close_cfs_slot_record(final_mw)

        await self._close_all_open_slot_records(job_id, final_mw, self._active_cfs_tray)

        db: Session = SessionLocal()
        try:
            service = PrintJobService(db)
            state = print_stats.get("state", "complete")
            status_map = {
                "complete": PrintStatus.COMPLETE,
                "error": PrintStatus.FAILED,
                "cancelled": PrintStatus.CANCELLED,
            }
            filament_mm = print_stats.get("filament_used")
            filament_g = None
            if filament_mm and filament_mm > 0:
                diameter = float(self._get_setting(db, "filament_diameter_mm", "1.75"))
                area = 3.14159 * (diameter / 2) ** 2
                material = self._parse_material(self.active_filename or "")
                density_key = {"PLA": "filament_density_pla", "ABS": "filament_density_abs", "PETG": "filament_density_petg", "TPU": "filament_density_tpu"}.get(material or "PLA", "filament_density_pla")
                density = float(self._get_setting(db, density_key, "1.24"))
                filament_g = round(filament_mm * area * density / 1000, 2)

            update = {
                "status": status_map.get(state, PrintStatus.COMPLETE).value,
                "end_time": datetime.now(timezone.utc),
                "actual_duration_seconds": int(print_stats.get("print_duration", 0)),
                "filament_length_mm": filament_mm,
                "filament_used_g": filament_g,
            }
            result = service.update_print_job(job_id, update)
            if result:
                logger.info(f"Finalized print job {job_id}: {state}")

            await self._calculate_costs(db, job_id)

            await self._decrement_filament_rolls(db, job_id)

            await self._send_notification(db, job_id, state, result)

            self.active_filename = None
            self._active_cfs_slot = None
            self._active_cfs_tray = None
            self._measuring_wheel_at_slot_start = None
            self._cfs_material_name = None
            self._cfs_color_hex = None
        except Exception as e:
            logger.error(f"Error finalizing print job: {e}")
        finally:
            db.close()

    async def _finalize_active_job(self):
        if not self.active_job_id:
            return
        job_id = self.active_job_id
        db: Session = SessionLocal()
        try:
            job = db.query(PrintJob).filter(PrintJob.id == job_id).first()
            if job and job.status == PrintStatus.PRINTING:
                final_stats = {
                    "state": "complete",
                    "filament_used": job.filament_length_mm,
                    "print_duration": job.actual_duration_seconds or 0,
                }
                logger.info(f"Finalizing orphaned job {job_id} (new print detected)")
                await self._on_print_end(final_stats)
        except Exception as e:
            logger.error(f"Error finalizing active job {job_id}: {e}")
        finally:
            db.close()

    async def poll_updates(self):
        while self._running:
            try:
                from app.services.moonraker import _get_moonraker_config
                host, port = _get_moonraker_config()
                url = f"http://{host}:{port}/printer/objects/query?print_stats&virtual_sdcard"
                async with httpx.AsyncClient() as client:
                    resp = await client.get(url, timeout=10)
                    if resp.status_code != 200:
                        await asyncio.sleep(5)
                        continue
                    data = resp.json()
                stats = data.get("result", {}).get("status", {}).get("print_stats", {})
                vsd = data.get("result", {}).get("status", {}).get("virtual_sdcard", {})
                state = stats.get("state")
                filename = stats.get("filename", "")

                if state == "printing" and filename:
                    if filename != self.active_filename:
                        if self.active_job_id:
                            await self._finalize_active_job()
                        await self._on_print_start(stats, vsd)
                    elif self.active_job_id:
                        db: Session = SessionLocal()
                        try:
                            service = PrintJobService(db)
                            service.update_print_job(self.active_job_id, {
                                "filament_length_mm": stats.get("filament_used"),
                                "actual_duration_seconds": int(stats.get("print_duration", 0)),
                            })
                        finally:
                            db.close()
                elif state in ("complete", "error", "cancelled") and self.active_job_id:
                    await self._on_print_end(stats)

                if self.active_job_id and state == "printing":
                    await self._log_power()
                    await self._poll_cfs_state()
            except Exception as e:
                logger.warning(f"Poll error: {e}")
            await asyncio.sleep(5)

    async def _log_power(self):
        from app.models.power_log import PowerLog
        try:
            watts = await meross_service.async_get_power()
            if watts is not None:
                db: Session = SessionLocal()
                try:
                    log = PowerLog(
                        print_job_id=self.active_job_id,
                        wattage=watts,
                        timestamp=datetime.now(timezone.utc),
                    )
                    db.add(log)
                    db.commit()
                finally:
                    db.close()
        except Exception as e:
            logger.debug(f"Power log error: {e}")

    async def _decrement_filament_rolls(self, db: Session, job_id: int):
        from app.models.cfs_slot_usage import CfsSlotUsage
        from app.models.filament_roll import FilamentRoll
        from app.models.cfs_override import CfsSlotOverride

        slot_usages = db.query(CfsSlotUsage).filter(CfsSlotUsage.print_job_id == job_id).all()
        if slot_usages:
            for su in slot_usages:
                if not su.filament_used_g or su.filament_used_g <= 0:
                    continue
                override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == su.slot_id).first()
                spool_weight = (override.spool_weight_g if override and override.spool_weight_g else 1000.0)
                current_pct = override.remaining_pct if override and override.remaining_pct is not None else 100
                new_pct = max(0, current_pct - (su.filament_used_g / spool_weight * 100))
                if not override:
                    override = CfsSlotOverride(slot_id=su.slot_id, remaining_pct=new_pct)
                    db.add(override)
                else:
                    override.remaining_pct = new_pct
                logger.info(f"CFS {su.slot_id}: {current_pct}% → {new_pct:.0f}% (-{su.filament_used_g:.1f}g)")

                roll = db.query(FilamentRoll).filter(
                    FilamentRoll.spool_id == su.slot_id,
                    FilamentRoll.remaining_weight_g > 0,
                ).first()
                if not roll and su.material_name:
                    mat = su.material_name.upper().split("+")[0].split(" ")[0]
                    roll = db.query(FilamentRoll).filter(
                        FilamentRoll.material.ilike(f"%{mat}%"),
                        FilamentRoll.remaining_weight_g > 0,
                    ).order_by(FilamentRoll.remaining_weight_g.desc()).first()
                if roll:
                    roll.remaining_weight_g = max(0, roll.remaining_weight_g - su.filament_used_g)
                    logger.info(f"Decremented roll '{roll.brand} {roll.material}' ({su.slot_id}) by {su.filament_used_g:.1f}g (now {roll.remaining_weight_g:.1f}g)")
            db.commit()
        else:
            from app.models.print_job import PrintJob as PJ
            job = db.query(PJ).filter(PJ.id == job_id).first()
            if not job or not job.filament_used_g or job.filament_used_g <= 0:
                return
            if not job.filament_type:
                return
            if self._active_cfs_slot:
                override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == self._active_cfs_slot).first()
                spool_weight = (override.spool_weight_g if override and override.spool_weight_g else 1000.0)
                current_pct = override.remaining_pct if override and override.remaining_pct is not None else 100
                new_pct = max(0, current_pct - (job.filament_used_g / spool_weight * 100))
                if not override:
                    override = CfsSlotOverride(slot_id=self._active_cfs_slot, remaining_pct=new_pct)
                    db.add(override)
                else:
                    override.remaining_pct = new_pct
                logger.info(f"CFS {self._active_cfs_slot}: {current_pct}% → {new_pct:.0f}% (-{job.filament_used_g:.1f}g)")
            material = job.filament_type.upper()
            roll = db.query(FilamentRoll).filter(
                FilamentRoll.material.ilike(f"%{material}%"),
                FilamentRoll.remaining_weight_g > 0,
            ).order_by(FilamentRoll.remaining_weight_g.desc()).first()
            if roll:
                roll.remaining_weight_g = max(0, roll.remaining_weight_g - job.filament_used_g)
            db.commit()

    async def _send_notification(self, db: Session, job_id: int, state: str, job):
        from app.models.app_config import AppConfig

        webhook_url = None
        row = db.query(AppConfig).filter(AppConfig.key == "notify_webhook_url").first()
        if row and row.value:
            webhook_url = row.value.strip()

        if not webhook_url:
            return

        notify_key = f"notify_on_{state}" if state != "error" else "notify_on_failed"
        notify_row = db.query(AppConfig).filter(AppConfig.key == notify_key).first()
        if notify_row and notify_row.value.lower() == "false":
            return

        status_label = {"complete": "Complete", "error": "Failed", "cancelled": "Cancelled"}.get(state, state)
        duration = ""
        if job and job.actual_duration_seconds:
            h = job.actual_duration_seconds // 3600
            m = (job.actual_duration_seconds % 3600) // 60
            duration = f"{h}h {m}m"

        cost = ""
        if job:
            total = (job.electricity_cost or 0) + (job.filament_cost or 0)
            if total > 0:
                cost = f" | Cost: ${total:.2f}"

        payload = {
            "event": "print_finished",
            "status": status_label,
            "job_id": job_id,
            "filename": job.filename if job else "Unknown",
            "duration": duration,
            "cost": cost,
        }

        try:
            async with httpx.AsyncClient() as client:
                await client.post(webhook_url, json=payload, timeout=10)
                logger.info(f"Notification sent to {webhook_url}: {status_label}")
        except Exception as e:
            logger.warning(f"Failed to send notification: {e}")

    @staticmethod
    def _get_setting(db: Session, key: str, default: str) -> str:
        from app.models.app_config import AppConfig
        row = db.query(AppConfig).filter(AppConfig.key == key).first()
        return row.value if row else default

    @staticmethod
    def _parse_material(filename: str) -> str | None:
        upper = filename.upper()
        for mat in ("PLA", "PETG", "ABS", "TPU", "ASA", "NYLON", "PC", "HIPS"):
            if mat in upper:
                return mat.capitalize()
        return None

    async def _sync_cfs_to_library(self):
        try:
            from app.services.moonraker import _get_moonraker_config
            from app.models.filament_roll import FilamentRoll
            from app.models.cfs_override import CfsSlotOverride
            from app.api.routes.cfs import MATERIAL_MAP, _build_name_map
            host, port = _get_moonraker_config()
            url = f"http://{host}:{port}/printer/objects/query?filament_rack&box"
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=10)
                if resp.status_code != 200:
                    return
                data = resp.json()
            result = data.get("result", {}).get("status", {})
            box = result.get("box", {})
            same_material = box.get("same_material", [])
            name_map = _build_name_map(same_material)

            db: Session = SessionLocal()
            try:
                overrides = {o.slot_id: o for o in db.query(CfsSlotOverride).all()}
                for tray_id in ("T1", "T2", "T3", "T4"):
                    tray = box.get(tray_id, {})
                    if tray.get("state") == "None" and str(tray.get("mode", "-1")) == "-1":
                        continue
                    colors = tray.get("color_value", ["-1"] * 4)
                    materials = tray.get("material_type", ["-1"] * 4)
                    remain_lens = tray.get("remain_len", ["0"] * 4)
                    for i, label in enumerate(["A", "B", "C", "D"]):
                        slot_id = f"{tray_id}{label}"
                        mat_code = materials[i] if i < len(materials) else "-1"
                        color_hex = colors[i] if i < len(colors) else "-1"
                        if mat_code == "-1" or color_hex == "-1":
                            continue
                        override = overrides.get(slot_id)
                        mat_name = override.material_name if override and override.material_name else name_map.get(slot_id, "") or MATERIAL_MAP.get(mat_code, "Unknown")
                        spool_weight = override.spool_weight_g if override and override.spool_weight_g else 1000.0
                        cost_per_kg = override.cost_per_kg if override and override.cost_per_kg else None
                        remaining_pct = override.remaining_pct if override and override.remaining_pct is not None else int(remain_lens[i]) if i < len(remain_lens) else 100
                        remaining_g = round(remaining_pct / 100.0 * spool_weight, 1)
                        cfs_hex = color_hex
                        if cfs_hex and cfs_hex != "-1":
                            h = cfs_hex.replace('#', '')
                            if len(h) == 7 and h.startswith('0'):
                                h = h[1:]
                            cfs_hex = f"#{h}" if len(h) == 6 else cfs_hex
                        roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == slot_id).first()
                        if roll:
                            roll.material = mat_name
                            roll.color_hex = cfs_hex
                            roll.total_weight_g = spool_weight
                            roll.remaining_weight_g = remaining_g
                            if cost_per_kg:
                                roll.cost_per_kg = cost_per_kg
                            roll.location = f"CFS {tray_id}"
                        else:
                            roll = FilamentRoll(
                                brand="CFS", material=mat_name, color_hex=cfs_hex, color_name=mat_name,
                                total_weight_g=spool_weight, remaining_weight_g=remaining_g,
                                spool_weight_g=0, cost_per_kg=cost_per_kg, spool_id=slot_id,
                                location=f"CFS {tray_id}",
                            )
                            db.add(roll)
                db.commit()
                logger.info("Synced CFS slots to filament library")
            except Exception as e:
                logger.error(f"Error syncing CFS to library: {e}")
                db.rollback()
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"CFS sync failed: {e}")

    async def _run(self):
        self._running = True
        try:
            await self._sync_cfs_to_library()
        except Exception as e:
            logger.warning(f"Failed to sync CFS on startup: {e}")
        try:
            await self._check_running_print()
        except Exception as e:
            logger.warning(f"Failed to check running print on startup: {e}")
        await self.poll_updates()

    def start(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None


print_tracker = MoonrakerPrintTracker()
