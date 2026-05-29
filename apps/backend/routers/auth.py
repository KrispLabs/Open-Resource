import logging
from collections import defaultdict
from time import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database import get_db
from schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from schemas.user import UserResponse
from services.auth_service import authenticate_user, create_access_token, get_user_by_email, create_user
from deps import get_current_user
from models.models import User

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

_login_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW = 60   # seconds
_RATE_MAX = 10      # attempts per window


def _check_rate_limit(ip: str) -> None:
    now = time()
    cutoff = now - _RATE_WINDOW
    _login_attempts[ip] = [t for t in _login_attempts[ip] if t > cutoff]
    if len(_login_attempts[ip]) >= _RATE_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Try again in a minute.",
        )
    _login_attempts[ip].append(now)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    _check_rate_limit(request.client.host if request.client else "unknown")
    user = authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    token = create_access_token(user.id, user.role)
    return TokenResponse(access_token=token, role=user.role, name=user.name, user_id=user.id)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    _check_rate_limit(request.client.host if request.client else "unknown")
    if get_user_by_email(db, body.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    try:
        user = create_user(db, body.email, body.name, body.password, role="applicant")
    except IntegrityError:
        # Race: a concurrent request inserted the same email between the check
        # above and our commit. The unique constraint is the source of truth.
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    token = create_access_token(user.id, user.role)
    return TokenResponse(access_token=token, role=user.role, name=user.name, user_id=user.id)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user
