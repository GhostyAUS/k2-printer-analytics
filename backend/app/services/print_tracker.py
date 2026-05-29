import asyncio
import json
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
        self.ws = None
        self.active_job_id: Optional[int] = None
        self.active_filename: Optional[str] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def connect(self):
        from app.services.moonraker import _get_moonraker_config
        host, port = _get_moonraker_config()
        uri = f"ws://{host}:{port}/websocket"
        try:
            import websockets
            self.ws = await websockets.connect(uri)
            await self._subscribe()
            logger.info(f"Connected to Moonraker WebSocket (active: {self.active_filename})")
        except Exception as e:
            logger.warning(f"Moonraker WebSocket connection failed: {e}")
            self.ws = None

    async def _fetch_vsd(self) -> dict:
        """Fetch virtual_sdcard data."""
        from app.services.moonraker import _get_moonraker_config
        host, port = _get_moonraker_config()
        url = f"http://{host}:{port}/printer/objects/query?virtual_sdcard"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=10)
            if resp.status_code == 200:
                return resp.json().get("result", {}).get("status", {}).get("virtual_sdcard", {})
        return {}

    async def _check_running_print(self):
        """Query REST API to bootstrap tracker state if a print is already active."""
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

    async def _subscribe(self):
        # Subscribe to status updates
        sub = json.dumps({
            "jsonrpc": "2.0",
            "method": "printer.objects.subscribe",
            "params": {
                "objects": {
                    "print_stats": None,
                    "display_status": None,
                }
            },
        })
        await self.ws.send(sub)

        # Drain any messages that arrive within 100ms (notifications only)
        while True:
            try:
                resp = await asyncio.wait_for(self.ws.recv(), timeout=0.1)
                data = json.loads(resp)
                if data.get("method") == "notify_proc_stat_update":
                    continue
                if data.get("method") == "notify_status_update":
                    continue
                # If we get here it's a JSON-RPC response — keep it
                break
            except asyncio.TimeoutError:
                break

        # Use REST API to check current state (WebSocket query unreliable on this firmware)
        try:
            await self._check_running_print()
        except Exception as e:
            logger.warning(f"Failed to check running print via REST: {e}")

    async def _handle_notification(self, params):
        status = params[0] if isinstance(params, list) else params
        print_stats = status.get("print_stats")
        if not print_stats:
            return

        state = print_stats.get("state")
        filename = print_stats.get("filename", "")

        if state == "printing" and filename and filename != self.active_filename:
            vsd = await self._fetch_vsd()
            await self._on_print_start(print_stats, vsd)
        elif state in ("complete", "error", "cancelled") and self.active_job_id:
            await self._on_print_end(print_stats)

    async def _on_print_start(self, print_stats: dict, vsd: Optional[dict] = None):
        db: Session = SessionLocal()
        try:
            service = PrintJobService(db)

            # Check for existing printing job for this filename to avoid duplicates
            existing = db.query(PrintJob).filter(
                PrintJob.filename == print_stats["filename"],
                PrintJob.status == PrintStatus.PRINTING,
            ).order_by(PrintJob.id.desc()).first()
            if existing:
                self.active_job_id = existing.id
                self.active_filename = print_stats["filename"]
                logger.info(f"Reusing existing print job {existing.id}: {existing.filename}")
                return

            # Extract estimated duration: metadata > print_stats > parse filename
            meta = (vsd or {}).get("cur_print_data", {}).get("metadata", {})
            estimated_duration = meta.get("estimated_time")
            if not estimated_duration:
                estimated_duration = print_stats.get("estimated_duration_seconds")
            if not estimated_duration:
                import re
                m = re.search(r'_(\d+)h(\d+)m(\d+)s\.gcode$', print_stats["filename"])
                if m:
                    estimated_duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))

            # Estimated filament grams from metadata
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
            self.active_job_id = job.id
            self.active_filename = print_stats["filename"]
            logger.info(f"Started tracking print job {job.id}: {job.filename} (est {estimated_duration}s, {estimated_filament_g}g)")
        except Exception as e:
            logger.error(f"Error creating print job: {e}")
        finally:
            db.close()

    async def _calculate_costs(self, db: Session, job_id: int):
        """Calculate electricity + filament costs for a completed job."""
        from app.models.power_log import PowerLog
        from app.models.cfs_override import CfsSlotOverride
        from app.models.print_job import PrintJob

        job = db.query(PrintJob).filter(PrintJob.id == job_id).first()
        if not job:
            return

        # --- electricity cost ---
        logs = db.query(PowerLog).filter(PowerLog.print_job_id == job_id).order_by(PowerLog.timestamp).all()
        total_kwh = 0.0
        prev: Optional[PowerLog] = None
        for log in logs:
            if prev and prev.wattage:
                delta_h = (log.timestamp - prev.timestamp).total_seconds() / 3600
                total_kwh += prev.wattage * delta_h / 1000
            prev = log

        # If no power logs, estimate from average draw
        if total_kwh == 0 and job.actual_duration_seconds and job.actual_duration_seconds > 0:
            total_kwh = round(151.0 * job.actual_duration_seconds / 3600.0 / 1000.0, 4)

        total_kwh = round(total_kwh, 4)
        rate = float(self._get_setting(db, "electricity_rate_kwh", str(settings.electricity_rate_kwh)))
        electricity_cost = round(total_kwh * rate, 4)

        # --- filament cost ---
        filament_cost = 0.0
        if job.filament_used_g:
            slot_id = (self.active_filename or "")[:3]
            override = db.query(CfsSlotOverride).filter(
                CfsSlotOverride.slot_id == slot_id
            ).first() if slot_id else None
            cost_per_kg = None
            if override and override.cost_per_kg:
                cost_per_kg = override.cost_per_kg
            elif job.spool and job.spool.cost_per_kg:
                cost_per_kg = job.spool.cost_per_kg

            if not cost_per_kg:
                default_cost = self._get_setting(db, "default_filament_cost_per_kg", "24.0")
                cost_per_kg = float(default_cost)

            if cost_per_kg:
                filament_cost = round((job.filament_used_g / 1000) * cost_per_kg, 4)

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
            result = service.update_print_job(self.active_job_id, update)
            if result:
                logger.info(f"Finalized print job {self.active_job_id}: {state}")

            # Calculate costs
            await self._calculate_costs(db, self.active_job_id)

            # Auto-decrement filament roll
            await self._decrement_filament_roll(db, self.active_job_id, filament_g)

            # Send notification webhook
            await self._send_notification(db, self.active_job_id, state, result)

            self.active_job_id = None
            self.active_filename = None
        except Exception as e:
            logger.error(f"Error finalizing print job: {e}")
        finally:
            db.close()

    async def poll_updates(self):
        while self._running:
            if self.active_job_id and self.ws:
                try:
                    msg = json.dumps({
                        "jsonrpc": "2.0",
                        "method": "printer.objects.query",
                        "params": {"objects": {"print_stats": None}},
                    })
                    await self.ws.send(msg)
                    resp = await asyncio.wait_for(self.ws.recv(), timeout=5)
                    data = json.loads(resp)
                    if "result" in data:
                        stats = data["result"].get("status", {}).get("print_stats", {})
                        if stats.get("state") in ("printing", "complete", "error", "cancelled"):
                            print_stats = stats
                            db: Session = SessionLocal()
                            try:
                                service = PrintJobService(db)
                                service.update_print_job(self.active_job_id, {
                                    "filament_length_mm": print_stats.get("filament_used"),
                                    "actual_duration_seconds": int(print_stats.get("print_duration", 0)),
                                })
                            finally:
                                db.close()

                    # Log power reading every poll cycle if printing
                    if stats.get("state") == "printing":
                        await self._log_power()
                except asyncio.TimeoutError:
                    pass
                except Exception as e:
                    logger.warning(f"Poll error: {e}")
            await asyncio.sleep(5)

    async def _log_power(self):
        """Log current power reading from Meross plug to power_logs table."""
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

    async def _decrement_filament_roll(self, db: Session, job_id: int, filament_used_g: Optional[float]):
        """Auto-decrement the matching filament roll in the library."""
        if not filament_used_g or filament_used_g <= 0:
            return
        from app.models.print_job import PrintJob as PJ
        from app.models.filament_roll import FilamentRoll

        job = db.query(PJ).filter(PJ.id == job_id).first()
        if not job or not job.filament_type:
            return

        material = job.filament_type.upper()
        roll = db.query(FilamentRoll).filter(
            FilamentRoll.material.ilike(f"%{material}%"),
            FilamentRoll.remaining_weight_g > 0,
        ).order_by(FilamentRoll.remaining_weight_g.desc()).first()

        if roll:
            roll.remaining_weight_g = max(0, roll.remaining_weight_g - filament_used_g)
            db.commit()
            logger.info(f"Decremented filament roll '{roll.brand} {roll.material}' by {filament_used_g:.1f}g (now {roll.remaining_weight_g:.1f}g)")

    async def _send_notification(self, db: Session, job_id: int, state: str, job):
        """Send webhook notification for print events."""
        from app.models.app_config import AppConfig
        import httpx

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

    async def listen(self):
        self._running = True
        poll_task = asyncio.create_task(self.poll_updates())

        while self._running:
            if not self.ws:
                await asyncio.sleep(10)
                await self.connect()
                continue
            try:
                message = await asyncio.wait_for(self.ws.recv(), timeout=30)
                data = json.loads(message)
                method = data.get("method")
                if method == "notify_status_update":
                    await self._handle_notification(data.get("params", []))
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.warning(f"Moonraker WS error: {e}")
                self.ws = None

        if poll_task:
            poll_task.cancel()

    def start(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.listen())

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None


print_tracker = MoonrakerPrintTracker()
