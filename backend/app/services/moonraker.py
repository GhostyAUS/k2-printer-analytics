import asyncio
import json
import logging
import re
from typing import Any, Dict, Optional
from urllib.parse import urljoin

from app.core.config import settings

import aiohttp
import websockets
from fastapi import HTTPException

logger = logging.getLogger(__name__)


def _get_db_session():
    from app.core.database import SessionLocal
    return SessionLocal()


def _get_moonraker_config():
    from app.models.app_config import AppConfig
    db = _get_db_session()
    try:
        rows = db.query(AppConfig).filter(AppConfig.key.in_(["moonraker_host", "moonraker_port"])).all()
        stored = {r.key: r.value for r in rows}
        host = stored.get("moonraker_host", settings.moonraker_host)
        port = int(stored.get("moonraker_port", settings.moonraker_port))
        return host, port
    finally:
        db.close()


class MoonrakerClient:
    def __init__(self, host: str = "192.168.1.146", port: int = 7125):
        self.host = host
        self.port = port
        self.base_url = f"http://{host}:{port}"
        self.websocket_url = f"ws://{host}:{port}/websocket"
        self._session: Optional[aiohttp.ClientSession] = None
        self._websocket: Optional[websockets.WebSocketClientProtocol] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def __aenter__(self):
        await self._get_session()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session and not self._session.closed:
            await self._session.close()
        if self._websocket:
            await self._websocket.close()

    async def connect_websocket(self) -> websockets.WebSocketClientProtocol:
        """Connect to Moonraker WebSocket server"""
        try:
            self._websocket = await websockets.connect(self.websocket_url)
            logger.info("Connected to Moonraker WebSocket")
            return self._websocket
        except Exception as e:
            logger.error(f"Failed to connect to Moonraker WebSocket: {e}")
            raise HTTPException(status_code=500, detail=f"WebSocket connection failed: {str(e)}")

    async def disconnect_websocket(self):
        """Close WebSocket connection"""
        if self._websocket:
            await self._websocket.close()
            self._websocket = None

    async def send_websocket_message(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """Send message through WebSocket"""
        if not self._websocket:
            await self.connect_websocket()
        
        try:
            await self._websocket.send(json.dumps(message))
            response = await self._websocket.recv()
            return json.loads(response)
        except Exception as e:
            logger.error(f"WebSocket message failed: {e}")
            raise HTTPException(status_code=500, detail=f"WebSocket message failed: {str(e)}")

    async def get_status(self) -> Dict[str, Any]:
        """Get printer status via REST API"""
        session = await self._get_session()
        try:
            async with session.get(f"{self.base_url}/printer/objects/query?toolhead&extruder&heater_bed") as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    text = await response.text()
                    raise HTTPException(status_code=response.status, detail=f"Status request failed: {text}")
        except Exception as e:
            logger.error(f"Status request failed: {e}")
            raise HTTPException(status_code=500, detail=f"Status request failed: {str(e)}")

    async def get_printer_info(self) -> Dict[str, Any]:
        """Get printer information via REST API"""
        session = await self._get_session()
        try:
            async with session.get(f"{self.base_url}/printer/info") as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    text = await response.text()
                    raise HTTPException(status_code=response.status, detail=f"Printer info request failed: {text}")
        except Exception as e:
            logger.error(f"Printer info request failed: {e}")
            raise HTTPException(status_code=500, detail=f"Printer info request failed: {str(e)}")

    async def get_print_stats(self) -> Dict[str, Any]:
        """Get print statistics via REST API (raw)"""
        session = await self._get_session()
        try:
            async with session.get(f"{self.base_url}/printer/objects/query?print_stats") as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    text = await response.text()
                    raise HTTPException(status_code=response.status, detail=f"Print stats request failed: {text}")
        except Exception as e:
            logger.error(f"Print stats request failed: {e}")
            raise HTTPException(status_code=500, detail=f"Print stats request failed: {str(e)}")

    async def get_enriched_stats(self) -> Dict[str, Any]:
        """Get printer stats with progress, ETA, layer info computed server-side"""
        session = await self._get_session()
        try:
            async with session.get(
                f"{self.base_url}/printer/objects/query?print_stats&display_status&virtual_sdcard&toolhead"
            ) as response:
                if response.status != 200:
                    text = await response.text()
                    raise HTTPException(status_code=response.status, detail=f"Stats request failed: {text}")
                raw = await response.json()
        except Exception as e:
            logger.error(f"Enriched stats request failed: {e}")
            raise HTTPException(status_code=500, detail=f"Enriched stats request failed: {str(e)}")

        status = raw.get("result", {}).get("status", {})
        ps = status.get("print_stats", {})
        ds = status.get("display_status", {})
        vsd = status.get("virtual_sdcard", {})
        th = status.get("toolhead", {})

        # --- progress ---
        progress = ds.get("progress")
        if progress is None or progress == 0:
            progress = vsd.get("progress", 0)
        # --- estimated duration from metadata ---
        meta = vsd.get("cur_print_data", {}).get("metadata", {})
        estimated_duration = meta.get("estimated_time")  # slicer estimate (seconds)
        if not estimated_duration:
            # fallback: parse from filename "..._19h10m43s.gcode"
            fn = ps.get("filename", "")
            import re
            m = re.search(r'_(\d+)h(\d+)m(\d+)s\.gcode$', fn)
            if m:
                estimated_duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))

        print_duration = ps.get("print_duration", 0)
        is_printing = ps.get("state") == "printing"

        # --- time remaining (prefer slicer estimate over file-progress based) ---
        time_remaining = None
        if is_printing and estimated_duration and print_duration:
            time_remaining = max(0, int(estimated_duration - print_duration))
        elif is_printing and progress and progress > 0:
            time_remaining = int(print_duration / progress - print_duration)

        # --- layer info ---
        layer = vsd.get("layer")
        layer_count = vsd.get("layer_count")

        # --- filament estimate ---
        filament_used_g_meta = meta.get("filament_used_g", [None])[0] if meta.get("filament_used_g") else None

        # --- key metadata ---
        cp = vsd.get("cur_print_data", {})
        start_time = cp.get("start_time")
        end_time = cp.get("end_time")
        filament_type = meta.get("filament_type")

        enriched = {
            "result": {
                "status": status,
                "meta": {
                    "progress": round(progress, 4) if progress else 0,
                    "estimated_duration_seconds": estimated_duration,
                    "print_duration_seconds": int(print_duration),
                    "time_remaining_seconds": time_remaining,
                    "layer": layer,
                    "layer_count": layer_count,
                    "estimated_filament_g": float(filament_used_g_meta) if filament_used_g_meta else None,
                    "start_timestamp": start_time,
                    "end_timestamp": end_time,
                    "filament_type": filament_type,
                }
            }
        }
        return enriched

    async def start_print(self, filename: str) -> Dict[str, Any]:
        """Start a print job via REST API"""
        session = await self._get_session()
        try:
            async with session.post(f"{self.base_url}/printer/print/start", json={"filename": filename}) as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    text = await response.text()
                    raise HTTPException(status_code=response.status, detail=f"Start print request failed: {text}")
        except Exception as e:
            logger.error(f"Start print request failed: {e}")
            raise HTTPException(status_code=500, detail=f"Start print request failed: {str(e)}")

    async def cancel_print(self) -> Dict[str, Any]:
        """Cancel current print job via REST API"""
        session = await self._get_session()
        try:
            async with session.post(f"{self.base_url}/printer/print/cancel") as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    text = await response.text()
                    raise HTTPException(status_code=response.status, detail=f"Cancel print request failed: {text}")
        except Exception as e:
            logger.error(f"Cancel print request failed: {e}")
            raise HTTPException(status_code=500, detail=f"Cancel print request failed: {str(e)}")

moonraker_service: Optional[MoonrakerClient] = None


def get_moonraker_service() -> MoonrakerClient:
    global moonraker_service
    if moonraker_service is None:
        host, port = _get_moonraker_config()
        moonraker_service = MoonrakerClient(host=host, port=port)
    return moonraker_service


def _update_moonraker_service(db=None):
    global moonraker_service
    host, port = _get_moonraker_config()
    moonraker_service = MoonrakerClient(host=host, port=port)
    logger.info(f"Moonraker service reconfigured: {host}:{port}")
    return moonraker_service