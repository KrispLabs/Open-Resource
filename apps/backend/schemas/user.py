from pydantic import BaseModel
from datetime import datetime


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    email: str
    name: str
    role: str
    created_at: datetime
