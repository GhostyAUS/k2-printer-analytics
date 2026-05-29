from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.services.spool_service import SpoolService
from app.models.spool import Spool
from app.core.database import get_db
from app.schemas.spool import SpoolCreate, SpoolResponse, SpoolUpdate

router = APIRouter(prefix="/spools", tags=["spools"])

@router.post("/", response_model=SpoolResponse)
def create_spool(spool_data: SpoolCreate, db: Session = Depends(get_db)):
    service = SpoolService(db)
    return service.create_spool(spool_data.model_dump(exclude_unset=True))

@router.get("/", response_model=List[SpoolResponse])
def get_spools(db: Session = Depends(get_db)):
    service = SpoolService(db)
    return service.get_all_spools()

@router.get("/{spool_id}", response_model=SpoolResponse)
def get_spool(spool_id: int, db: Session = Depends(get_db)):
    service = SpoolService(db)
    spool = service.get_spool_by_id(spool_id)
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    return spool

@router.put("/{spool_id}", response_model=SpoolResponse)
def update_spool(spool_id: int, update_data: SpoolUpdate, db: Session = Depends(get_db)):
    service = SpoolService(db)
    spool = service.update_spool(spool_id, update_data.model_dump(exclude_unset=True))
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    return spool

@router.delete("/{spool_id}")
def delete_spool(spool_id: int, db: Session = Depends(get_db)):
    service = SpoolService(db)
    if not service.delete_spool(spool_id):
        raise HTTPException(status_code=404, detail="Spool not found")
    return {"message": "Spool deleted successfully"}