from pydantic import BaseModel, field_validator
from typing import Optional


class CloseJobRequest(BaseModel):
    shortlist_cutoff: Optional[int] = None

    @field_validator("shortlist_cutoff")
    @classmethod
    def cutoff_positive(cls, v):
        if v is not None and v < 1:
            raise ValueError("shortlist_cutoff must be a positive integer")
        return v
