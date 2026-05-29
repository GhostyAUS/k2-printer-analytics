from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
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
    remaining_weight_g: float = 1000.0
    cost_per_kg: Optional[float] = None
    purchase_date: Optional[datetime] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    spool_id: Optional[str] = None


class FilamentRollUpdate(BaseModel):
    brand: Optional[str] = None
    material: Optional[str] = None
    color_name: Optional[str] = None
    color_hex: Optional[str] = None
    total_weight_g: Optional[float] = None
    remaining_weight_g: Optional[float] = None
    cost_per_kg: Optional[float] = None
    purchase_date: Optional[datetime] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    spool_id: Optional[str] = None


class FilamentRollResponse(BaseModel):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    brand: str
    material: str
    color_name: Optional[str] = None
    color_hex: Optional[str] = None
    total_weight_g: float
    remaining_weight_g: float
    cost_per_kg: Optional[float] = None
    purchase_date: Optional[datetime] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    spool_id: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("/", response_model=List[FilamentRollResponse])
def list_rolls(db: Session = Depends(get_db)):
    return db.query(FilamentRoll).order_by(FilamentRoll.id.desc()).all()


@router.get("/{roll_id}", response_model=FilamentRollResponse)
def get_roll(roll_id: int, db: Session = Depends(get_db)):
    roll = db.query(FilamentRoll).filter(FilamentRoll.id == roll_id).first()
    if not roll:
        raise HTTPException(status_code=404, detail="Filament roll not found")
    return roll


@router.post("/", response_model=FilamentRollResponse)
def create_roll(data: FilamentRollCreate, db: Session = Depends(get_db)):
    roll = FilamentRoll(**data.model_dump())
    db.add(roll)
    db.commit()
    db.refresh(roll)
    return roll


@router.put("/{roll_id}", response_model=FilamentRollResponse)
def update_roll(roll_id: int, data: FilamentRollUpdate, db: Session = Depends(get_db)):
    roll = db.query(FilamentRoll).filter(FilamentRoll.id == roll_id).first()
    if not roll:
        raise HTTPException(status_code=404, detail="Filament roll not found")
    for key, val in data.model_dump(exclude_unset=True).items():
        setattr(roll, key, val)
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
