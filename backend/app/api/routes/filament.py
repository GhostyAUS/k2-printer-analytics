from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import distinct
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from app.core.database import get_db
from app.models.filament_roll import FilamentRoll

router = APIRouter(prefix="/filament", tags=["filament"])


class FilamentRollCreate(BaseModel):
    brand: str = ""
    material: str = "PLA"
    color_name: Optional[str] = None
    color_hex: Optional[str] = None
    total_weight_g: float = 1000.0
    spool_weight_g: float = 0.0
    remaining_weight_g: float = 1000.0
    cost_per_kg: Optional[float] = None
    purchase_date: Optional[datetime] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    spool_id: Optional[str] = None
    rfid_vendor: Optional[str] = None


class BulkCreateRequest(BaseModel):
    roll: FilamentRollCreate
    quantity: int = 1


class FilamentRollUpdate(BaseModel):
    brand: Optional[str] = None
    material: Optional[str] = None
    color_name: Optional[str] = None
    color_hex: Optional[str] = None
    total_weight_g: Optional[float] = None
    spool_weight_g: Optional[float] = None
    remaining_weight_g: Optional[float] = None
    cost_per_kg: Optional[float] = None
    purchase_date: Optional[datetime] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    spool_id: Optional[str] = None
    rfid_vendor: Optional[str] = None


class FilamentRollResponse(BaseModel):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    brand: str
    material: str
    color_name: Optional[str] = None
    color_hex: Optional[str] = None
    total_weight_g: float
    spool_weight_g: float
    remaining_weight_g: float
    cost_per_kg: Optional[float] = None
    purchase_date: Optional[datetime] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    spool_id: Optional[str] = None
    rfid_vendor: Optional[str] = None
    runout_detected: Optional[bool] = None

    class Config:
        from_attributes = True


class LocationsResponse(BaseModel):
    existing_locations: List[str]
    cfs_units: dict[str, List[str]]


class WeighRequest(BaseModel):
    measured_weight_g: float


@router.get("/", response_model=List[FilamentRollResponse])
def list_rolls(db: Session = Depends(get_db)):
    return db.query(FilamentRoll).order_by(FilamentRoll.id.desc()).all()


@router.post("/", response_model=FilamentRollResponse)
def create_roll(data: FilamentRollCreate, db: Session = Depends(get_db)):
    roll = FilamentRoll(**data.model_dump())
    db.add(roll)
    db.commit()
    db.refresh(roll)
    return roll


@router.post("/bulk", response_model=List[FilamentRollResponse])
def create_bulk(data: BulkCreateRequest, db: Session = Depends(get_db)):
    qty = max(1, min(data.quantity, 100))
    rolls = []
    for _ in range(qty):
        roll = FilamentRoll(**data.roll.model_dump())
        db.add(roll)
        rolls.append(roll)
    db.commit()
    for r in rolls:
        db.refresh(r)
    return rolls


@router.get("/locations", response_model=LocationsResponse)
def list_locations(db: Session = Depends(get_db)):
    rows = db.query(distinct(FilamentRoll.location)).filter(
        FilamentRoll.location.isnot(None), FilamentRoll.location != ""
    ).all()
    existing = sorted(r[0] for r in rows if r[0])
    cfs_units = {
        "CFS 1": ["T1A", "T1B", "T1C", "T1D"],
        "CFS 2": ["T2A", "T2B", "T2C", "T2D"],
        "CFS 3": ["T3A", "T3B", "T3C", "T3D"],
        "CFS 4": ["T4A", "T4B", "T4C", "T4D"],
    }
    return LocationsResponse(existing_locations=existing, cfs_units=cfs_units)


@router.get("/{roll_id}", response_model=FilamentRollResponse)
def get_roll(roll_id: int, db: Session = Depends(get_db)):
    roll = db.query(FilamentRoll).filter(FilamentRoll.id == roll_id).first()
    if not roll:
        raise HTTPException(status_code=404, detail="Filament roll not found")
    return roll


@router.put("/{roll_id}", response_model=FilamentRollResponse)
def update_roll(roll_id: int, data: FilamentRollUpdate, db: Session = Depends(get_db)):
    roll = db.query(FilamentRoll).filter(FilamentRoll.id == roll_id).first()
    if not roll:
        raise HTTPException(status_code=404, detail="Filament roll not found")
    updates = data.model_dump(exclude_unset=True)
    if "spool_id" in updates and updates["spool_id"]:
        old = db.query(FilamentRoll).filter(
            FilamentRoll.spool_id == updates["spool_id"],
            FilamentRoll.id != roll_id
        ).first()
        if old:
            old.spool_id = None
            old.location = "Storage box" if (old.remaining_weight_g or 0) > 0 else "Shelf A"
    for key, val in updates.items():
        setattr(roll, key, val)
    db.commit()
    db.refresh(roll)
    return roll


@router.post("/{roll_id}/weigh", response_model=FilamentRollResponse)
def weigh_roll(roll_id: int, data: WeighRequest, db: Session = Depends(get_db)):
    roll = db.query(FilamentRoll).filter(FilamentRoll.id == roll_id).first()
    if not roll:
        raise HTTPException(status_code=404, detail="Filament roll not found")
    remaining = data.measured_weight_g - roll.spool_weight_g
    if remaining < 0:
        remaining = 0
    roll.remaining_weight_g = round(remaining, 1)
    db.commit()
    db.refresh(roll)
    return roll


@router.delete("/{roll_id}")
def delete_roll(roll_id: int, db: Session = Depends(get_db)):
    roll = db.query(FilamentRoll).filter(FilamentRoll.id == roll_id).first()
    if not roll:
        raise HTTPException(status_code=404, detail="Filament roll not found")
    db.delete(roll)
    db.commit()
    return {"status": "ok", "id": roll_id}
