from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.models.cfs_override import CfsSlotOverride
from app.schemas.cfs import (
    CfsSlotOverrideCreate,
    CfsSlotOverrideUpdate,
    CfsSlotOverrideResponse,
)

router = APIRouter(prefix="/cfs/overrides", tags=["cfs"])


@router.get("/", response_model=List[CfsSlotOverrideResponse])
async def list_overrides(db: Session = Depends(get_db)):
    return db.query(CfsSlotOverride).all()


@router.get("/{slot_id}", response_model=CfsSlotOverrideResponse)
async def get_override(slot_id: str, db: Session = Depends(get_db)):
    override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first()
    if not override:
        raise HTTPException(status_code=404, detail="Override not found")
    return override


@router.put("/{slot_id}", response_model=CfsSlotOverrideResponse)
async def upsert_override(slot_id: str, data: CfsSlotOverrideUpdate, db: Session = Depends(get_db)):
    override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first()
    if override:
        for key, val in data.model_dump(exclude_unset=True).items():
            setattr(override, key, val)
    else:
        override = CfsSlotOverride(slot_id=slot_id, **data.model_dump(exclude_unset=True))
        db.add(override)
    db.commit()
    db.refresh(override)
    return override


@router.delete("/{slot_id}")
async def reset_override(slot_id: str, db: Session = Depends(get_db)):
    override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first()
    if override:
        db.delete(override)
        db.commit()
    return {"status": "ok", "slot_id": slot_id}
