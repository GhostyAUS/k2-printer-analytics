from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.models.cfs_override import CfsSlotOverride
from app.models.filament_roll import FilamentRoll
from app.schemas.cfs import (
    CfsSlotOverrideCreate,
    CfsSlotOverrideUpdate,
    CfsSlotOverrideResponse,
)

router = APIRouter(prefix="/cfs/overrides", tags=["cfs"])


def _sync_roll_weight(override: CfsSlotOverride, db: Session):
    roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == override.slot_id).first()
    if not roll or override.remaining_pct is None:
        return
    spool_weight = override.spool_weight_g if override.spool_weight_g else (roll.spool_weight_g or roll.total_weight_g or 1000)
    roll.remaining_weight_g = round(min(100, max(0, override.remaining_pct)) / 100.0 * spool_weight, 1)


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
    _sync_roll_weight(override, db)
    db.commit()
    return override


@router.delete("/{slot_id}")
async def reset_override(slot_id: str, db: Session = Depends(get_db)):
    override = db.query(CfsSlotOverride).filter(CfsSlotOverride.slot_id == slot_id).first()
    if override:
        db.delete(override)
        db.commit()
    roll = db.query(FilamentRoll).filter(FilamentRoll.spool_id == slot_id).first()
    if roll and roll.total_weight_g:
        pct_from_weight = min(100, round((roll.remaining_weight_g / roll.total_weight_g) * 100))
        roll.remaining_weight_g = round(pct_from_weight / 100.0 * roll.total_weight_g, 1)
        db.commit()
    return {"status": "ok", "slot_id": slot_id}
