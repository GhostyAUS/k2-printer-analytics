import asyncio
import logging
from typing import Optional
from datetime import datetime, timedelta, timezone

from app.core.config import settings

logger = logging.getLogger(__name__)


class MerossService:
    def __init__(self):
        self._client = None
        self._manager = None
        self._device = None
        self._plug_name = settings.meross_device_name or "Printer"
        self._last_read: Optional[tuple] = None
        self._ready = False

    async def _ensure_connected(self):
        if self._ready and self._device is not None:
            return

        email = settings.meross_email
        password = settings.meross_password
        if not email or not password:
            logger.warning("Meross credentials not configured")
            return

        try:
            from meross_iot.http_api import MerossHttpClient
            from meross_iot.manager import MerossManager

            self._client = await MerossHttpClient.async_from_user_password(
                api_base_url="https://iotx-ap.meross.com",
                email=email,
                password=password,
            )

            self._manager = MerossManager(http_client=self._client)
            try:
                await asyncio.wait_for(self._manager.async_init(), timeout=8)
            except asyncio.TimeoutError:
                logger.warning("Meross manager init timed out, continuing")

            try:
                await asyncio.wait_for(self._manager.async_device_discovery(), timeout=8)
            except asyncio.TimeoutError:
                logger.warning("Meross device discovery timed out, continuing")

            devices = self._manager.find_devices()
            for d in devices:
                name = getattr(d, "name", "") or getattr(d, "description", "")
                if self._plug_name.lower() in name.lower():
                    self._device = d
                    logger.info(f"Found Meross device: {name}")
                    break

            if self._device is None:
                names = [getattr(d, "name", "?") for d in devices]
                logger.warning(f"No device named '{self._plug_name}'. Available: {names}")
            else:
                self._ready = True

        except Exception as e:
            self._client = None
            self._manager = None
            self._device = None
            logger.error(f"Meross connection failed: {e}")

    async def async_get_power(self) -> Optional[float]:
        if self._last_read:
            watts, ts = self._last_read
            if datetime.now(timezone.utc) - ts < timedelta(seconds=5):
                return watts

        await self._ensure_connected()
        if self._device is None:
            return None

        try:
            metrics = await asyncio.wait_for(
                self._device.async_get_instant_metrics(channel=0), timeout=8
            )
            if metrics is not None:
                watts = float(metrics.power)
                self._last_read = (watts, datetime.now(timezone.utc))
                logger.debug(f"Meross power: {watts} W")
                return watts
            logger.warning("Meross returned no metrics")
            return None
        except asyncio.TimeoutError:
            logger.warning("Meross power poll timed out")
            return None
        except Exception as e:
            logger.error(f"Meross power reading failed: {e}")
            return None

    def get_current_power_reading(self) -> Optional[float]:
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        return loop.run_until_complete(self.async_get_power())


meross_service = MerossService()
