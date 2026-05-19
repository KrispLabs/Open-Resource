from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from schemas.user import UserResponse
from services.auth_service import authenticate_user, create_access_token, get_user_by_email, create_user
from deps import get_current_user
from models.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    token = create_access_token(user.id, user.role)
    return TokenResponse(access_token=token, role=user.role)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if get_user_by_email(db, body.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = create_user(db, body.email, body.name, body.password, role="applicant")
    token = create_access_token(user.id, user.role)
    return TokenResponse(access_token=token, role=user.role)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user
