from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from deps import require_dev
from models.models import User
from schemas.provider import (
    SetupStatusResponse,
    SetupProviderItem,
    ProviderStatusSchema,
    ProviderConfigureRequest,
    ProviderConfigureResponse,
)
from services.provider_manager import provider_manager, PROVIDER_REGISTRY

router = APIRouter(tags=["setup"])


@router.get("/setup/status", response_model=SetupStatusResponse)
def get_setup_status():
    """Public — called before auth to detect whether initial setup is needed."""
    providers = provider_manager.list()
    required_missing = any(p["required"] and not p["configured"] for p in providers)
    return SetupStatusResponse(
        configured=not required_missing,
        providers=[
            SetupProviderItem(id=p["id"], configured=p["configured"], required=p["required"])
            for p in providers
        ],
    )


@router.get("/providers", response_model=list[ProviderStatusSchema])
def list_providers(current_user: User = Depends(require_dev)):
    """List all registered providers with status. Never exposes raw secrets."""
    return provider_manager.list()


@router.post("/providers/configure", response_model=ProviderConfigureResponse)
async def configure_provider(
    body: ProviderConfigureRequest,
    current_user: User = Depends(require_dev),
):
    """Save credentials (AES-256 encrypted) then immediately run validation."""
    known = {p["id"] for p in PROVIDER_REGISTRY}
    if body.provider not in known:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {body.provider}")
    provider_manager.set(body.provider, body.values)
    health = await provider_manager.validate(body.provider)
    return ProviderConfigureResponse(provider=body.provider, health=health)


@router.post("/providers/{provider_id}/validate")
async def validate_provider(
    provider_id: str,
    current_user: User = Depends(require_dev),
):
    """Re-run validation for a configured provider."""
    known = {p["id"] for p in PROVIDER_REGISTRY}
    if provider_id not in known:
        raise HTTPException(status_code=404, detail="Provider not found")
    return await provider_manager.validate(provider_id)


@router.post("/providers/{provider_id}/rotate", response_model=ProviderConfigureResponse)
async def rotate_provider(
    provider_id: str,
    body: ProviderConfigureRequest,
    current_user: User = Depends(require_dev),
):
    """Replace credentials and re-validate."""
    known = {p["id"] for p in PROVIDER_REGISTRY}
    if provider_id not in known:
        raise HTTPException(status_code=404, detail="Provider not found")
    provider_manager.set(provider_id, body.values)
    health = await provider_manager.validate(provider_id)
    return ProviderConfigureResponse(provider=provider_id, health=health)


@router.delete("/providers/{provider_id}")
def disable_provider(
    provider_id: str,
    current_user: User = Depends(require_dev),
):
    """Clear credentials (preserves audit trail row)."""
    known = {p["id"] for p in PROVIDER_REGISTRY}
    if provider_id not in known:
        raise HTTPException(status_code=404, detail="Provider not found")
    provider_manager.disable(provider_id)
    return {"success": True, "provider": provider_id}
