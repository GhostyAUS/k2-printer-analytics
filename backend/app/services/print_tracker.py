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
        self._idle_cfs_slots: dict[str, dict] = {}
        self._last_checkpoint: Optional[float] = None
        self._last_checkpoint_mw: dict[int, float] = {}
        self._notified_low_stock: set[str] = set()
        self._notified_critical_stock: set[str] = set()
        self._http_client: Optional[httpx.AsyncClient] = None

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
        url = f"http://{host}:{port}/printer/objects/query?box&filament_rack&filament_switch_sensor%20filament_sensor"
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
        sensor = result.get("filament_switch_sensor filament_sensor", {})
        self._filament_sensor_enabled = sensor.get("enabled", False)
        self._filament_detected = sensor.get("filament_detected", None)

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
                from app.core.cfs_constants import MATERIAL_MAP, normalize_hex
                override_name = name_map.get(current_slot, "")
                self._cfs_material_name = override_name or MATERIAL_MAP.get(mat_code, "Unknown") if mat_code else None
                self._cfs_color_hex = normalize_hex(color_hex)

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

    async def _idle_cfs_poll(self):
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

        from app.core.cfs_constants import MATERIAL_MAP
        current_slots: dict[str, dict] = {}
        for tray_id in ("T1", "T2", "T3", "T4"):
            tray = box.get(tray_id, {})
            if tray.get("state") == "None":
                continue
            colors = tray.get("color_value", ["-1"] * 4)
            materials = tray.get("material_type", ["-1"] * 4)
            remain_lens = tray.get("remain_len", ["0"] * 4)
            vendors = tray.get("vender", ["unknown"] * 4)
            for i, label in enumerate(["A", "B", "C", "D"]):
                slot_id = f"{tray_id}{label}"
                mat_code = materials[i] if i < len(materials) else "-1"
                color_hex = colors[i] if i < len(colors) else "-1"
                vendor = vendors[i] if i < len(vendors) else "unknown"
                if mat_code == "-1" or color_hex == "-1":
                    continue
                current_slots[slot_id] = {
                    "mat_code": mat_code,
                    "color_hex": color_hex,
                    "material_name": name_map.get(slot_id, "") or MATERIAL_MAP.get(mat_code, "Unknown"),
                    "remaining_pct": int(remain_lens[i]) if i < len(remain_lens) else 100,
                    "rfid_vendor": vendor if vendor != "unknown" else None,
                }

        await self._detect_vacancy(current_slots)
        await self._detect_slot_changes(current_slots)
        await self._check_low_stock()

        self._idle_cfs_slots = current_slots

    async def _detect_vacancy(self, current_slots: dict[str, dict]):
        for slot_id, prev in self._idle_cfs_slots.items():
            if slot_id in current_slots:
                continue
            db: Session = SessionLocal()
            try:
                from app.models.filament_roll import FilamentRoll
                from app.models.cfs_override import CfsSlotOverride
                roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == slot_id).first()
                override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first()
                remaining_pct = override.remaining_pct if override and override.remaining_pct is not None else prev.get("remaining_pct", 100)

                if remaining_pct < 5 and roll:
                    roll.remaining_weight_g = 0
                    roll.runout_detected = True
                    roll.spool_id = None
                    roll.location = "Storage box"
                    roll.notes = (roll.notes or "") + "Auto-emptied (runout detected, spool removed from CFS)\n"
                    logger.info(f"Slot {slot_id}: auto-emptied (remaining was {remaining_pct}%)")
                elif roll:
                    roll.spool_id = None
                    roll.location = "Storage box"
                    logger.info(f"Slot {slot_id}: spool manually removed, returned to stock ({remaining_pct}% remaining)")

                from app.models.cfs_match_vote import CfsMatchVote
                pending = db.query(CfsMatchVote).filter(
                    CfsMatchVote.slot_id == slot_id,
                    CfsMatchVote.correct.is_(None),
                ).all()
                for p in pending:
                    p.correct = False
                    p.responded_at = datetime.now(timezone.utc)
                    logger.info(f"Invalidated pending vote {p.id} for vacated slot {slot_id}")

                if override:
                    if remaining_pct < 5:
                        override.remaining_pct = 0
                db.commit()
            except Exception as e:
                logger.error(f"Error detecting vacancy for {slot_id}: {e}")
                db.rollback()
            finally:
                db.close()

    async def _detect_slot_changes(self, current_slots: dict[str, dict]):
        for slot_id, current in current_slots.items():
            prev = self._idle_cfs_slots.get(slot_id)
            if not prev:
                continue

            def _norm_hex(h: str) -> str:
                return h.replace('#', '').lower().lstrip('0') if h and h != "-1" else ""

            cur_color = _norm_hex(current.get("color_hex", ""))
            prev_color = _norm_hex(prev.get("color_hex", ""))
            color_changed = bool(cur_color and prev_color and cur_color != prev_color)
            rfid_changed = current.get("rfid_vendor") != prev.get("rfid_vendor")
            real_change = color_changed or rfid_changed

            if not real_change:
                remain_reset = current["remaining_pct"] > prev.get("remaining_pct", 0) + 10
                if remain_reset:
                    db: Session = SessionLocal()
                    try:
                        old_override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first()
                        if old_override:
                            old_override.remaining_pct = current["remaining_pct"]
                            db.commit()
                            logger.info(f"Slot {slot_id}: remain_pct updated to {current['remaining_pct']}% (no spool change)")
                    except Exception as e:
                        logger.error(f"Error updating remain_pct for {slot_id}: {e}")
                        db.rollback()
                    finally:
                        db.close()
                continue

            db: Session = SessionLocal()
            try:
                from app.models.filament_roll import FilamentRoll
                from app.models.cfs_override import CfsSlotOverride

                old_roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == slot_id).first()
                old_override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first()

                cfs_hex = current["color_hex"]
                if cfs_hex and cfs_hex != "-1":
                    h = cfs_hex.replace('#', '')
                    if len(h) == 7 and h.startswith('0'):
                        h = h[1:]
                    cfs_hex = f"#{h}" if len(h) == 6 else cfs_hex

                auto_ok = old_override and old_override.auto_approve
                matched_roll = await self._smart_match_cfs_to_stock(
                    current["material_name"], cfs_hex, current.get("rfid_vendor"), db
                )

                from app.models.cfs_match_vote import CfsMatchVote
                existing_pending = db.query(CfsMatchVote).filter(
                    CfsMatchVote.slot_id == slot_id,
                    CfsMatchVote.correct.is_(None),
                    CfsMatchVote.auto_accepted == False,
                ).first()

                if existing_pending:
                    logger.info(f"Slot {slot_id}: pending vote {existing_pending.id} already exists, skipping")
                elif auto_ok and matched_roll:
                    if old_roll:
                        old_roll.spool_id = None
                        old_roll.location = "Storage box" if (old_roll.remaining_weight_g or 0) > 0 else "Shelf A"
                        logger.info(f"Slot {slot_id}: spool change — old roll '{old_roll.brand} {old_roll.material}' returned to stock")
                    matched_roll.spool_id = slot_id
                    matched_roll.total_weight_g = old_override.spool_weight_g if old_override and old_override.spool_weight_g else 1000.0
                    matched_roll.remaining_weight_g = round(current["remaining_pct"] / 100.0 * (old_override.spool_weight_g if old_override and old_override.spool_weight_g else 1000.0), 1)
                    matched_roll.cost_per_kg = old_override.cost_per_kg if old_override and old_override.cost_per_kg else None
                    matched_roll.location = f"CFS {slot_id}"
                    matched_roll.rfid_vendor = current.get("rfid_vendor")
                    vote = CfsMatchVote(
                        slot_id=slot_id, material_code=current["mat_code"],
                        color_hex=cfs_hex, rfid_vendor=current.get("rfid_vendor"),
                        suggested_roll_id=matched_roll.id, confirmed_roll_id=matched_roll.id,
                        auto_accepted=True, correct=True, responded_at=datetime.now(timezone.utc),
                    )
                    db.add(vote)
                    logger.info(f"Slot {slot_id}: auto-approved match to roll '{matched_roll.brand} {matched_roll.material}'")
                else:
                    if old_roll:
                        old_roll.spool_id = None
                        old_roll.location = "Storage box" if (old_roll.remaining_weight_g or 0) > 0 else "Shelf A"
                        logger.info(f"Slot {slot_id}: spool change — old roll '{old_roll.brand} {old_roll.material}' returned to stock")
                    vote = CfsMatchVote(
                        slot_id=slot_id, material_code=current["mat_code"],
                        color_hex=cfs_hex, rfid_vendor=current.get("rfid_vendor"),
                        suggested_roll_id=matched_roll.id if matched_roll else None,
                    )
                    db.add(vote)
                    db.flush()
                    await self._send_match_suggestion_webhook(
                        vote.id, slot_id, matched_roll,
                        current["material_name"], cfs_hex, current["remaining_pct"],
                    )
                    logger.info(f"Slot {slot_id}: pending vote {vote.id} created" +
                                (f" (suggested roll {matched_roll.id})" if matched_roll else " (no match)"))

                if old_override:
                    old_override.remaining_pct = current["remaining_pct"]
                    old_override.calibrated = False
                    old_override.material_name = None
                    old_override.color_hex = None

                db.commit()
                logger.info(f"Slot {slot_id}: spool change — {current['material_name']} color={cfs_hex} remain={current['remaining_pct']}%")
            except Exception as e:
                logger.error(f"Error detecting slot change for {slot_id}: {e}")
                db.rollback()
            finally:
                db.close()

    async def _check_low_stock(self):
        from app.models.cfs_override import CfsSlotOverride
        from app.models.app_config import AppConfig
        db: Session = SessionLocal()
        try:
            webhook_url = None
            row = db.query(AppConfig).filter(AppConfig.key == "notify_webhook_url").first()
            if row and row.value:
                webhook_url = row.value.strip()
            if not webhook_url:
                return

            overrides = {o.slot_id: o for o in db.query(CfsSlotOverride).all()}
            for slot_id, override in overrides.items():
                if override.remaining_pct is None:
                    continue
                pct = override.remaining_pct
                if pct < 5 and slot_id not in self._notified_critical_stock:
                    self._notified_critical_stock.add(slot_id)
                    self._notified_low_stock.discard(slot_id)
                    await self._send_stock_notification(webhook_url, slot_id, pct, "critical_stock")
                elif pct < 20 and slot_id not in self._notified_low_stock and slot_id not in self._notified_critical_stock:
                    self._notified_low_stock.add(slot_id)
                    await self._send_stock_notification(webhook_url, slot_id, pct, "low_stock")

            for slot_id in list(self._notified_low_stock):
                override = overrides.get(slot_id)
                if override and override.remaining_pct is not None and override.remaining_pct >= 20:
                    self._notified_low_stock.discard(slot_id)
            for slot_id in list(self._notified_critical_stock):
                override = overrides.get(slot_id)
                if override and override.remaining_pct is not None and override.remaining_pct >= 5:
                    self._notified_critical_stock.discard(slot_id)
        except Exception as e:
            logger.error(f"Error checking low stock: {e}")
        finally:
            db.close()

    async def _send_stock_notification(self, webhook_url: str, slot_id: str, pct: float, event_type: str):
        label = "CRITICAL" if event_type == "critical_stock" else "LOW"
        payload = {
            "event": event_type,
            "slot_id": slot_id,
            "remaining_pct": round(pct, 1),
            "message": f"{label}: CFS slot {slot_id} has {pct:.0f}% filament remaining",
        }
        try:
            async with httpx.AsyncClient() as client:
                await client.post(webhook_url, json=payload, timeout=10)
                logger.info(f"Stock notification sent: {slot_id} at {pct:.0f}%")
        except Exception as e:
            logger.warning(f"Failed to send stock notification: {e}")

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
        except Exception as e:
            logger.error(f"Error closing CFS slot record: {e}")
            db.rollback()
        finally:
            db.close()

    async def _close_all_open_slot_records(self, job_id: int, final_mw: Optional[float] = None, final_tray: Optional[str] = None, moonraker_total_g: Optional[float] = None):
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
                    if delta_mm > 10000:
                        logger.warning(f"MW wraparound for slot {record.slot_id} ({delta_mm:.0f}mm), skipping MW delta")
                        record.measuring_wheel_end = final_mw
                        record.ended_at = datetime.now(timezone.utc)
                        continue
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

            if moonraker_total_g and moonraker_total_g > 0:
                null_records = [r for r in open_records if r.filament_used_g is None and r.started_at and r.ended_at]
                tracked_total = sum(r.filament_used_g for r in open_records if r.filament_used_g)
                untracked_g = max(0, moonraker_total_g - tracked_total)
                if null_records and untracked_g > 0:
                    total_duration = sum((r.ended_at - r.started_at).total_seconds() for r in null_records)
                    if total_duration > 0:
                        for r in null_records:
                            dur = (r.ended_at - r.started_at).total_seconds()
                            proportion = dur / total_duration
                            r.filament_used_g = round(untracked_g * proportion, 2)
                            logger.info(f"Proportional attribution: slot {r.slot_id} = {r.filament_used_g:.1f}g ({proportion:.0%} of {untracked_g:.1f}g untracked)")
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

        filament_mm = print_stats.get("filament_used")
        moonraker_total_g = None
        if filament_mm and filament_mm > 0:
            db_temp = SessionLocal()
            try:
                diameter = float(self._get_setting(db_temp, "filament_diameter_mm", "1.75"))
                area = 3.14159 * (diameter / 2) ** 2
                material = self._parse_material(self.active_filename or "")
                density_key = {"PLA": "filament_density_pla", "ABS": "filament_density_abs", "PETG": "filament_density_petg", "TPU": "filament_density_tpu"}.get(material or "PLA", "filament_density_pla")
                density = float(self._get_setting(db_temp, density_key, "1.24"))
                moonraker_total_g = round(filament_mm * area * density / 1000, 2)
            finally:
                db_temp.close()

        if final_mw is not None and self._measuring_wheel_at_slot_start is not None:
            await self._close_cfs_slot_record(final_mw)

        await self._close_all_open_slot_records(job_id, final_mw, self._active_cfs_tray, moonraker_total_g)

        db: Session = SessionLocal()
        try:
            from app.models.filament_roll import FilamentRoll
            service = PrintJobService(db)
            state = print_stats.get("state", "complete")
            status_map = {
                "complete": PrintStatus.COMPLETE,
                "error": PrintStatus.FAILED,
                "cancelled": PrintStatus.CANCELLED,
            }
            filament_g = moonraker_total_g

            update = {
                "status": status_map.get(state, PrintStatus.COMPLETE).value,
                "end_time": datetime.now(timezone.utc),
                "actual_duration_seconds": int(print_stats.get("print_duration", 0)),
                "filament_length_mm": filament_mm,
                "filament_used_g": filament_g,
            }

            job_obj = service.get_print_job_by_id(job_id)
            if job_obj and not job_obj.filament_type:
                cfs_material = None
                if self._active_cfs_slot:
                    cfs_roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == self._active_cfs_slot).first()
                    if cfs_roll:
                        cfs_material = cfs_roll.material
                if not cfs_material and self._cfs_material_name:
                    cfs_material = self._cfs_material_name
                if cfs_material:
                    update["filament_type"] = cfs_material
                    material = cfs_material.upper()
            result = service.update_print_job(job_id, update)
            if result:
                logger.info(f"Finalized print job {job_id}: {state}")

            await self._calculate_costs(db, job_id)

            await self._decrement_filament_rolls(db, job_id)

            await self._mark_calibrated(db, job_id)

            await self._send_notification(db, job_id, state, result)

            self.active_filename = None
            self._active_cfs_slot = None
            self._active_cfs_tray = None
            self._measuring_wheel_at_slot_start = None
            self._cfs_material_name = None
            self._cfs_color_hex = None
            self._last_checkpoint = None
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
        idle_counter = 0
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
                    idle_counter = 0
                    if filename != self.active_filename:
                        if self.active_job_id:
                            await self._finalize_active_job()
                        await self._on_print_start(stats, vsd)
                    elif self.active_job_id:
                        db2 = SessionLocal()
                        try:
                            service2 = PrintJobService(db2)
                            service2.update_print_job(self.active_job_id, {
                                "filament_length_mm": stats.get("filament_used"),
                                "actual_duration_seconds": int(stats.get("print_duration", 0)),
                            })
                        finally:
                            db2.close()
                elif state in ("complete", "error", "cancelled") and self.active_job_id:
                    await self._on_print_end(stats)

                if self.active_job_id and state == "printing":
                    await self._log_power()
                    await self._poll_cfs_state()
                    await self._checkpoint_save()
                    await self._check_runout_during_print()
                elif not self.active_job_id:
                    idle_counter += 1
                    if idle_counter >= 12:
                        await self._idle_cfs_poll()
                        idle_counter = 0
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

    async def _checkpoint_save(self):
        import time
        now = time.monotonic()
        if self._last_checkpoint and (now - self._last_checkpoint) < 60:
            return
        self._last_checkpoint = now

        db: Session = SessionLocal()
        try:
            from app.models.cfs_slot_usage import CfsSlotUsage
            from app.models.cfs_override import CfsSlotOverride
            from app.models.filament_roll import FilamentRoll
            from app.services.moonraker import _get_moonraker_config

            open_records = db.query(CfsSlotUsage).filter(
                CfsSlotUsage.print_job_id == self.active_job_id,
                CfsSlotUsage.ended_at.is_(None),
            ).all()

            host, port = _get_moonraker_config()
            url = f"http://{host}:{port}/printer/objects/query?box"
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(url, timeout=10)
                    if resp.status_code != 200:
                        return
                    data = resp.json()
            except Exception:
                return

            box = data.get("result", {}).get("status", {}).get("box", {})
            for record in open_records:
                tray = box.get(record.tray_id, {})
                mw_val = tray.get("measuring_wheel")
                if mw_val is None or str(mw_val) == "None":
                    continue
                current_mw = float(mw_val)
                record_id = record.id
                last_mw = self._last_checkpoint_mw.get(record_id, record.measuring_wheel_start)
                if last_mw is not None and record.tray_id == self._active_cfs_tray:
                    delta_mm = abs(current_mw - last_mw)
                    if delta_mm > 10000:
                        logger.warning(f"MW wraparound detected for slot {record.slot_id}: {last_mw} -> {current_mw}, skipping")
                        self._last_checkpoint_mw[record_id] = current_mw
                        continue
                    self._last_checkpoint_mw[record_id] = current_mw
                    diameter = float(self._get_setting(db, "filament_diameter_mm", "1.75"))
                    area = 3.14159 * (diameter / 2) ** 2
                    material = (record.material_name or "PLA").upper().split("+")[0].split(" ")[0]
                    density_key = {"PLA": "filament_density_pla", "ABS": "filament_density_abs", "PETG": "filament_density_petg", "TPU": "filament_density_tpu"}.get(material, "filament_density_pla")
                    density = float(self._get_setting(db, density_key, "1.24"))
                    incremental_g = round(delta_mm * area * density / 1000, 2)
                    record.checkpoint_g = (record.checkpoint_g or 0) + incremental_g

                    override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == record.slot_id).first()
                    if override and override.remaining_pct is not None and override.remaining_pct > 0:
                        spool_weight = override.spool_weight_g if override.spool_weight_g else 1000.0
                        roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == record.slot_id).first()
                        if roll:
                            roll.remaining_weight_g = max(0, roll.remaining_weight_g - incremental_g)
                            logger.debug(f"Checkpoint: slot {record.slot_id} roll {roll.brand} -{incremental_g:.1f}g ~{roll.remaining_weight_g:.0f}g")

            db.commit()
            logger.debug(f"Checkpoint saved for job {self.active_job_id}")
        except Exception as e:
            logger.error(f"Checkpoint save error: {e}")
            db.rollback()
        finally:
            db.close()

    async def _check_runout_during_print(self):
        sensor_enabled = getattr(self, '_filament_sensor_enabled', False)
        filament_detected = getattr(self, '_filament_detected', None)

        if not sensor_enabled or filament_detected is None:
            return

        if filament_detected is False and self._active_cfs_slot:
            db: Session = SessionLocal()
            try:
                from app.models.filament_roll import FilamentRoll
                from app.models.cfs_override import CfsSlotOverride
                override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == self._active_cfs_slot).first()
                if override and override.remaining_pct is not None and override.remaining_pct < 5:
                    roll = db.query(FilamentRoll).filter(
                        FilamentRoll.spool_id == self._active_cfs_slot,
                        FilamentRoll.remaining_weight_g > 0,
                    ).first()
                    if roll and not roll.runout_detected:
                        roll.runout_detected = True
                        roll.remaining_weight_g = 0
                        override.remaining_pct = 0
                        roll.notes = (roll.notes or "") + "Runout confirmed by filament sensor\n"
                        db.commit()
                        logger.info(f"Runout confirmed: slot {self._active_cfs_slot} (sensor=false, remaining<5%)")
            except Exception as e:
                logger.error(f"Error checking runout: {e}")
                db.rollback()
            finally:
                db.close()

    async def _mark_calibrated(self, db: Session, job_id: int):
        from app.models.cfs_slot_usage import CfsSlotUsage
        from app.models.cfs_override import CfsSlotOverride
        slot_usages = db.query(CfsSlotUsage).filter(CfsSlotUsage.print_job_id == job_id).all()
        for su in slot_usages:
            if su.filament_used_g and su.filament_used_g > 0:
                override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == su.slot_id).first()
                if override and not override.calibrated:
                    override.calibrated = True
                    logger.info(f"Slot {su.slot_id} marked as calibrated (first print with measured data)")
        db.commit()

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
                new_pct = max(0, min(100, current_pct - (su.filament_used_g / spool_weight * 100)))
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
                new_pct = max(0, min(100, current_pct - (job.filament_used_g / spool_weight * 100)))
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
    def _hex_distance(a: str, b: str) -> float:
        a = (a or "").lstrip("#")
        b = (b or "").lstrip("#")
        if len(a) != 6 or len(b) != 6:
            return 999.0
        ra, ga, ba = int(a[0:2], 16), int(a[2:4], 16), int(a[4:6], 16)
        rb, gb, bb = int(b[0:2], 16), int(b[2:4], 16), int(b[4:6], 16)
        return ((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) ** 0.5

    async def _smart_match_cfs_to_stock(
        self, cfs_material_name: str, cfs_color_hex: str,
        cfs_rfid_vendor: str | None, db: Session
    ):
        from app.models.filament_roll import FilamentRoll
        try:
            if cfs_rfid_vendor:
                exact = db.query(FilamentRoll).filter(
                    FilamentRoll.rfid_vendor == cfs_rfid_vendor,
                    FilamentRoll.spool_id.is_(None),
                    FilamentRoll.remaining_weight_g > 0,
                ).first()
                if exact:
                    logger.info(f"RFID vendor match: {exact.brand} {exact.material}")
                    return exact

            if cfs_material_name:
                base_mat = cfs_material_name.upper().split("+")[0].split(" ")[0]
                candidates = db.query(FilamentRoll).filter(
                    FilamentRoll.material.ilike(f"%{base_mat}%"),
                    FilamentRoll.spool_id.is_(None),
                    FilamentRoll.remaining_weight_g > 0,
                ).all()
                if candidates:
                    candidates.sort(key=lambda r: (
                        self._hex_distance(cfs_color_hex, r.color_hex or ""),
                        -r.remaining_weight_g,
                    ))
                    best = candidates[0]
                    logger.info(f"Material+color match: {best.brand} {best.material} "
                                f"(dist={self._hex_distance(cfs_color_hex, best.color_hex or ''):.0f}, "
                                f"{best.remaining_weight_g:.0f}g)")
                    return best
            return None
        except Exception as e:
            logger.error(f"Smart matching error: {e}")
            return None

    async def _send_match_suggestion_webhook(self, vote_id: int, slot_id: str,
                                              roll, cfs_material: str, cfs_color: str,
                                              remaining_pct: float):
        from app.models.app_config import AppConfig
        db: Session = SessionLocal()
        try:
            webhook_url = None
            row = db.query(AppConfig).filter(AppConfig.key == "notify_webhook_url").first()
            if row and row.value:
                webhook_url = row.value.strip()
            if not webhook_url:
                return
            payload = {
                "event": "spool_match_suggestion",
                "slot_id": slot_id,
                "vote_id": vote_id,
                "suggested_roll_id": roll.id if roll else None,
                "suggested_name": f"{roll.brand} {roll.material}" if roll else "No match found",
                "material": cfs_material,
                "color_hex": cfs_color,
                "remaining_pct": round(remaining_pct, 1),
                "confirm_url": f"/api/v1/cfs/match-vote/{vote_id}/confirm",
                "deny_url": f"/api/v1/cfs/match-vote/{vote_id}/deny",
                "correct_with_url": f"/api/v1/cfs/match-vote/{vote_id}/correct?roll_id=",
            }
            async with httpx.AsyncClient() as client:
                await client.post(webhook_url, json=payload, timeout=10)
                logger.info(f"Match suggestion webhook sent for slot {slot_id} vote {vote_id}")
        except Exception as e:
            logger.warning(f"Failed to send match suggestion webhook: {e}")
        finally:
            db.close()

    @staticmethod
    def _update_confidence(db: Session, slot_id: str):
        from app.models.cfs_match_vote import CfsMatchVote
        from app.models.cfs_override import CfsSlotOverride
        override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first()
        if not override:
            return
        total = db.query(CfsMatchVote).filter(
            CfsMatchVote.slot_id == slot_id,
            CfsMatchVote.correct.isnot(None),
        ).count()
        hits = db.query(CfsMatchVote).filter(
            CfsMatchVote.slot_id == slot_id,
            CfsMatchVote.correct == True,
        ).count()
        override.match_attempts = total
        override.match_hits = hits
        override.match_confidence = round(hits / max(total, 1), 4)
        override.auto_approve = (override.match_confidence >= 0.9 and total >= 20)
        db.commit()
        logger.info(f"Slot {slot_id} confidence: {override.match_confidence:.1%} ({hits}/{total}), "
                    f"auto_approve={override.auto_approve}")

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
            from app.core.cfs_constants import MATERIAL_MAP, build_name_map as _build_name_map, color_name_from_hex
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
                    vendors = tray.get("vender", ["unknown"] * 4)
                    for i, label in enumerate(["A", "B", "C", "D"]):
                        slot_id = f"{tray_id}{label}"
                        mat_code = materials[i] if i < len(materials) else "-1"
                        color_hex = colors[i] if i < len(colors) else "-1"
                        vendor = vendors[i] if i < len(vendors) else "unknown"
                        rfid_vendor = vendor if vendor != "unknown" else None
                        if mat_code == "-1" or color_hex == "-1":
                            continue
                        override = overrides.get(slot_id)
                        mat_name = override.material_name if override and override.material_name else name_map.get(slot_id, "") or MATERIAL_MAP.get(mat_code, "Unknown")
                        spool_weight = override.spool_weight_g if override and override.spool_weight_g else 1000.0
                        cost_per_kg = override.cost_per_kg if override and override.cost_per_kg else None
                        if override and override.calibrated and override.remaining_pct is not None:
                            remaining_pct = override.remaining_pct
                        elif override and override.remaining_pct is not None:
                            remaining_pct = override.remaining_pct
                        else:
                            remaining_pct = int(remain_lens[i]) if i < len(remain_lens) else 100
                        remaining_g = round(remaining_pct / 100.0 * spool_weight, 1)
                        cfs_hex = color_hex
                        if cfs_hex and cfs_hex != "-1":
                            h = cfs_hex.replace('#', '')
                            if len(h) == 7 and h.startswith('0'):
                                h = h[1:]
                            cfs_hex = f"#{h}" if len(h) == 6 else cfs_hex
                        roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == slot_id).first()
                        if roll:
                            roll_color = (roll.color_hex or "").replace('#', '').lower()
                            cfs_color = cfs_hex.replace('#', '').lower() if cfs_hex else ""
                            roll_rfid = roll.rfid_vendor or ""
                            cfs_rfid = rfid_vendor or ""
                            spool_changed = (roll_color and cfs_color and roll_color != cfs_color) or (roll_rfid and cfs_rfid and roll_rfid != cfs_rfid)

                            if spool_changed:
                                old_brand = roll.brand
                                old_material = roll.material
                                roll.spool_id = None
                                roll.location = "Storage box" if (roll.remaining_weight_g or 0) > 0 else "Shelf A"
                                logger.info(f"Slot {slot_id}: spool change detected on sync — old roll '{old_brand} {old_material}' returned to stock")

                                from app.models.cfs_match_vote import CfsMatchVote
                                stale_votes = db.query(CfsMatchVote).filter(
                                    CfsMatchVote.slot_id == slot_id,
                                    CfsMatchVote.correct.is_(None),
                                ).all()
                                for sv in stale_votes:
                                    sv.correct = False
                                    sv.responded_at = datetime.now(timezone.utc)
                                    logger.info(f"Invalidated stale pending vote {sv.id} for slot {slot_id}")

                                auto_ok = override and override.auto_approve
                                matched_roll = await self._smart_match_cfs_to_stock(
                                    mat_name, cfs_hex, rfid_vendor, db
                                )
                                if auto_ok and matched_roll:
                                    matched_roll.spool_id = slot_id
                                    matched_roll.total_weight_g = spool_weight
                                    matched_roll.remaining_weight_g = remaining_g
                                    matched_roll.cost_per_kg = cost_per_kg
                                    matched_roll.location = f"CFS {slot_id}"
                                    matched_roll.rfid_vendor = rfid_vendor
                                    vote = CfsMatchVote(
                                        slot_id=slot_id, material_code=mat_code,
                                        color_hex=cfs_hex, rfid_vendor=rfid_vendor,
                                        suggested_roll_id=matched_roll.id, confirmed_roll_id=matched_roll.id,
                                        auto_accepted=True, correct=True, responded_at=datetime.now(timezone.utc),
                                    )
                                    db.add(vote)
                                    logger.info(f"Slot {slot_id}: sync auto-approved match to roll '{matched_roll.brand} {matched_roll.material}'")
                                else:
                                    c_name = color_name_from_hex(cfs_hex)
                                    roll = FilamentRoll(
                                        brand="Creality" if rfid_vendor else "", material=mat_name, color_hex=cfs_hex, color_name=c_name,
                                        total_weight_g=spool_weight, remaining_weight_g=remaining_g,
                                        spool_weight_g=0, cost_per_kg=cost_per_kg, spool_id=slot_id,
                                        location=f"CFS {slot_id}", rfid_vendor=rfid_vendor,
                                    )
                                    db.add(roll)
                                if override:
                                    override.remaining_pct = remaining_pct
                                    override.calibrated = False
                                    override.color_hex = None
                                    override.material_name = None
                            else:
                                roll.total_weight_g = spool_weight
                                roll.remaining_weight_g = remaining_g
                                if cost_per_kg:
                                    roll.cost_per_kg = cost_per_kg
                                roll.location = f"CFS {slot_id}"
                                if rfid_vendor:
                                    roll.rfid_vendor = rfid_vendor
                        else:
                            c_name = color_name_from_hex(cfs_hex)
                            roll = FilamentRoll(
                                brand="Creality" if rfid_vendor else "", material=mat_name, color_hex=cfs_hex, color_name=c_name,
                                total_weight_g=spool_weight, remaining_weight_g=remaining_g,
                                spool_weight_g=0, cost_per_kg=cost_per_kg, spool_id=slot_id,
                                location=f"CFS {slot_id}", rfid_vendor=rfid_vendor,
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
