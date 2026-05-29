from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.spool import Spool

class SpoolRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, spool: Spool) -> Spool:
        self.db.add(spool)
        self.db.commit()
        self.db.refresh(spool)
        return spool

    def get_by_id(self, spool_id: int) -> Optional[Spool]:
        return self.db.query(Spool).filter(Spool.id == spool_id).first()

    def get_all(self) -> List[Spool]:
        return self.db.query(Spool).all()

    def update(self, spool_id: int, update_data: dict) -> Optional[Spool]:
        spool = self.get_by_id(spool_id)
        if spool:
            for key, value in update_data.items():
                setattr(spool, key, value)
            self.db.commit()
            self.db.refresh(spool)
        return spool

    def delete(self, spool_id: int) -> bool:
        spool = self.get_by_id(spool_id)
        if spool:
            self.db.delete(spool)
            self.db.commit()
            return True
        return False

    def get_spools_with_material_details(self) -> List[Spool]:
        return self.db.query(Spool).all()