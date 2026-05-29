from sqlalchemy import Column, String, Text
from .base import BaseModel


class AppConfig(BaseModel):
    __tablename__ = "app_config"

    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)

    def __repr__(self):
        return f"<AppConfig(key={self.key})>"
