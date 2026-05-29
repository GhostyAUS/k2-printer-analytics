from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any

from app.services.moonraker import get_moonraker_service

router = APIRouter(prefix="/printer", tags=["printer"])

@router.get("/status")
async def get_printer_status(moonraker = Depends(get_moonraker_service)):
    """Get printer status"""
    try:
        status = await moonraker.get_status()
        return status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/info")
async def get_printer_info(moonraker = Depends(get_moonraker_service)):
    """Get printer information"""
    try:
        info = await moonraker.get_printer_info()
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_print_stats(moonraker = Depends(get_moonraker_service)):
    """Get print statistics (raw stats + enriched progress/ETA)"""
    try:
        stats = await moonraker.get_enriched_stats()
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/print/start")
async def start_print(filename: str, moonraker = Depends(get_moonraker_service)):
    """Start a print job"""
    try:
        result = await moonraker.start_print(filename)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/print/cancel")
async def cancel_print(moonraker = Depends(get_moonraker_service)):
    """Cancel current print job"""
    try:
        result = await moonraker.cancel_print()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))