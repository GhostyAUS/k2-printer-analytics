from typing import List, Optional
from sqlalchemy.orm import Session
from app.repositories.spool_repo import SpoolRepository
from app.models.spool import Spool

class SpoolService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = SpoolRepository(db)

    def create_spool(self, spool_data: dict) -> Spool:
        spool = Spool(
            brand=spool_data["brand"],
            material=spool_data["material"],
            color=spool_data["color"],
            initial_weight_g=spool_data["initial_weight_g"],
            remaining_weight_g=spool_data.get("remaining_weight_g", spool_data["initial_weight_g"]),
            cost_per_kg=spool_data.get("cost_per_kg"),
        )
        return self.repository.create(spool)

    def get_spool_by_id(self, spool_id: int) -> Optional[Spool]:
        return self.repository.get_by_id(spool_id)

    def get_all_spools(self) -> List[Spool]:
        return self.repository.get_all()

    def update_spool(self, spool_id: int, update_data: dict) -> Optional[Spool]:
        return self.repository.update(spool_id, update_data)

    def delete_spool(self, spool_id: int) -> bool:
        return self.repository.delete(spool_id)

    def get_spools_with_material_details(self) -> List[Spool]:
        return self.repository.get_spools_with_material_details()