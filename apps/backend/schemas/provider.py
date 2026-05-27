from typing import Any, Optional
from pydantic import BaseModel


class ProviderFieldSchema(BaseModel):
    key: str
    label: str
    type: str  # "secret" | "text"
    required: bool = False
    default: Optional[str] = None


class ProviderStatusSchema(BaseModel):
    id: str
    name: str
    required: bool
    description: str
    configured: bool
    status: str  # unconfigured | configured | healthy | unhealthy
    health: Optional[dict[str, Any]] = None
    fields: list[ProviderFieldSchema]


class SetupProviderItem(BaseModel):
    id: str
    configured: bool
    required: bool


class SetupStatusResponse(BaseModel):
    configured: bool
    providers: list[SetupProviderItem]


class ProviderConfigureRequest(BaseModel):
    provider: str
    values: dict[str, str]  # field_key → value; encrypted immediately, never stored raw


class ProviderConfigureResponse(BaseModel):
    provider: str
    health: dict[str, Any]
