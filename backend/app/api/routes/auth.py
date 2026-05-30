from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.core.database import get_db
from app.core.auth import create_access_token, hash_password, verify_password, get_current_user, get_optional_user
from app.models.user import User
from app.models.app_config import AppConfig

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    is_admin: bool


def has_any_user(db: Session) -> bool:
    return db.query(User).first() is not None


@router.get("/status")
def auth_status(
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_optional_user),
):
    return {
        "initialized": has_any_user(db),
        "authenticated": user is not None,
        "username": user.username if user else None,
        "is_admin": user.is_admin if user else False,
    }


@router.post("/register", response_model=TokenResponse)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    if has_any_user(db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Initial user already created. Use login instead.")
    if len(data.username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    user = User(
        username=data.username,
        hashed_password=hash_password(data.password),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.username, "is_admin": True})
    return TokenResponse(access_token=token, username=user.username, is_admin=True)


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if user is None or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    token = create_access_token({"sub": user.username, "is_admin": user.is_admin})
    return TokenResponse(access_token=token, username=user.username, is_admin=user.is_admin)


@router.get("/me", response_model=TokenResponse)
def get_me(user: User = Depends(get_current_user)):
    return TokenResponse(
        access_token="",
        username=user.username,
        is_admin=user.is_admin,
    )