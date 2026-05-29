from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.config import settings

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "moonraker_host": settings.moonraker_host,
        "moonraker_port": settings.moonraker_port
    }


@router.get("/health/detailed")
async def detailed_health_check():
    """Detailed health check with external service status"""
    return {
        "status": "healthy",
        "services": {
            "database": "checking...",
            "moonraker": "checking...",
            "meross": "checking..."
        },
        "settings": {
            "moonraker_host": settings.moonraker_host,
            "moonraker_port": settings.moonraker_port,
            "power_poll_interval": settings.power_poll_interval
        }
    }