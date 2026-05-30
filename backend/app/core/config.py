from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    app_name: str = "K2 Analytics API"
    debug: bool = False
    secret_key: str = "change-me-in-production-use-a-long-random-string"
    database_url: str = "postgresql://k2user:k2pass@localhost:5432/k2_analytics"
    
    # Moonraker settings
    moonraker_host: str = "192.168.1.146"
    moonraker_port: int = 7125
    moonraker_api_key: Optional[str] = None
    
    # Meross settings
    meross_email: str = ""
    meross_password: str = ""
    meross_device_uuid: Optional[str] = None
    meross_device_name: str = "Printer"
    
    # Power monitoring settings
    power_poll_interval: int = 30  # seconds
    electricity_rate_kwh: float = 0.49  # AUD per kWh
    timezone: str = "Australia/Perth"  # AWST (UTC+8, no DST)
    
    class Config:
        env_file = ".env"


settings = Settings()