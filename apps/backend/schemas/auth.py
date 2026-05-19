from pydantic import BaseModel, field_validator


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    name: str
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
