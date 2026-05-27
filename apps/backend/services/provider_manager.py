"""
Provider credential management — AES-256-GCM encryption, registry-driven extensibility.

All services read credentials from provider_manager.get(), not from settings directly.
Adding a provider requires only register_provider() — no frontend changes.
"""
import os
import json
import base64
import hashlib
import httpx
from datetime import datetime, timezone
from typing import Callable

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from config import settings


# ── Provider Registry ─────────────────────────────────────────────────────────

PROVIDER_REGISTRY: list[dict] = [
    {
        "id": "featherless",
        "name": "Featherless AI",
        "required": True,
        "description": "LLM inference — JD analysis, candidate scoring, outreach generation",
        "fields": [
            {"key": "api_key", "label": "API Key", "type": "secret", "required": True, "default": None},
            {"key": "model", "label": "Model ID", "type": "text", "required": False,
             "default": "meta-llama/Meta-Llama-3.1-8B-Instruct"},
        ],
        "env_map": {"FEATHERLESSAI_API_KEY": "api_key"},
    },
    {
        "id": "brightdata",
        "name": "Bright Data",
        "required": False,
        "description": "Web intelligence — Google SERP, GitHub profile dataset, Web Unlocker",
        "fields": [
            {"key": "api_key", "label": "API Key", "type": "secret", "required": True, "default": None},
            {"key": "serp_zone", "label": "SERP Zone Name", "type": "text", "required": False,
             "default": "serp_api2"},
            {"key": "dataset_id", "label": "GitHub Dataset ID", "type": "text", "required": False,
             "default": "gd_m794s4jrlq1bvkfnt"},
        ],
        "env_map": {
            "BRIGHTDATA_API_KEY": "api_key",
            "BRIGHTDATA_SERP_ZONE": "serp_zone",
            "BRIGHTDATA_DATASET_ID": "dataset_id",
        },
    },
    {
        "id": "github",
        "name": "GitHub",
        "required": False,
        "description": "Developer search fallback — used when Bright Data is not configured",
        "fields": [
            {"key": "token", "label": "Personal Access Token", "type": "secret", "required": True, "default": None},
        ],
        "env_map": {"GITHUB_TOKEN": "token"},
    },
]


def register_provider(provider_def: dict) -> None:
    """Register a new provider. This is the only change needed to add a provider."""
    existing = {p["id"] for p in PROVIDER_REGISTRY}
    if provider_def["id"] in existing:
        raise ValueError(f"Provider '{provider_def['id']}' is already registered")
    PROVIDER_REGISTRY.append(provider_def)


# ── AES-256-GCM Encryption ────────────────────────────────────────────────────

def _derive_key(secret: str) -> bytes:
    """Derive a 32-byte AES-256 key from the server secret via SHA-256."""
    return hashlib.sha256(secret.encode()).digest()


def _encrypt(data: dict, secret: str) -> str:
    """AES-256-GCM encrypt a dict. Returns base64-encoded nonce+ciphertext."""
    key = _derive_key(secret)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)  # 96-bit nonce, GCM standard
    plaintext = json.dumps(data).encode()
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    return base64.b64encode(nonce + ciphertext).decode()


def _decrypt(encrypted: str, secret: str) -> dict:
    """Decrypt an AES-256-GCM encrypted config string."""
    key = _derive_key(secret)
    aesgcm = AESGCM(key)
    raw = base64.b64decode(encrypted)
    nonce, ciphertext = raw[:12], raw[12:]
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return json.loads(plaintext)


# ── Validators ────────────────────────────────────────────────────────────────

_VALIDATORS: dict[str, Callable] = {}


def register_validator(provider_id: str, fn: Callable) -> None:
    _VALIDATORS[provider_id] = fn


async def _validate_featherless(config: dict) -> dict:
    ts = datetime.now(timezone.utc).isoformat()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.featherless.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.get('api_key', '')}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.get("model", "meta-llama/Meta-Llama-3.1-8B-Instruct"),
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                },
            )
        healthy = resp.status_code == 200
        return {"healthy": healthy, "last_checked": ts,
                "message": "OK" if healthy else f"HTTP {resp.status_code}"}
    except Exception as exc:
        return {"healthy": False, "last_checked": ts, "message": str(exc)}


async def _validate_brightdata(config: dict) -> dict:
    ts = datetime.now(timezone.utc).isoformat()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.brightdata.com/datasets/v3",
                headers={"Authorization": f"Bearer {config.get('api_key', '')}"},
            )
        # 200 or 422 both confirm auth succeeded
        healthy = resp.status_code in (200, 422)
        return {"healthy": healthy, "last_checked": ts,
                "message": "OK" if healthy else f"HTTP {resp.status_code}"}
    except Exception as exc:
        return {"healthy": False, "last_checked": ts, "message": str(exc)}


async def _validate_github(config: dict) -> dict:
    ts = datetime.now(timezone.utc).isoformat()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"token {config.get('token', '')}",
                    "Accept": "application/vnd.github.v3+json",
                },
            )
        healthy = resp.status_code == 200
        return {"healthy": healthy, "last_checked": ts,
                "message": "OK" if healthy else f"HTTP {resp.status_code}"}
    except Exception as exc:
        return {"healthy": False, "last_checked": ts, "message": str(exc)}


register_validator("featherless", _validate_featherless)
register_validator("brightdata", _validate_brightdata)
register_validator("github", _validate_github)


# ── ProviderManager ───────────────────────────────────────────────────────────

class ProviderManager:
    """
    Singleton service for reading/writing encrypted provider credentials.
    Services call provider_manager.get(id) instead of reading settings directly.
    Credentials never leave this service in plaintext.
    """

    def __init__(self) -> None:
        self._cache: dict[str, dict] = {}
        self._cache_valid: set[str] = set()

    def _open_db(self):
        from database import SessionLocal
        return SessionLocal()

    def _secret(self) -> str:
        return settings.server_secret_key

    def get(self, provider_id: str) -> dict:
        """Return decrypted config dict. Returns {} if not configured."""
        if provider_id in self._cache_valid:
            return self._cache.get(provider_id, {})
        db = self._open_db()
        try:
            from models.provider_config import ProviderConfig
            row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
            if not row or not row.encrypted_config:
                return {}
            config = _decrypt(row.encrypted_config, self._secret())
            self._cache[provider_id] = config
            self._cache_valid.add(provider_id)
            return config
        except Exception:
            return {}
        finally:
            db.close()

    def set(self, provider_id: str, values: dict) -> None:
        """Encrypt and persist credentials. Immediately invalidates cache."""
        db = self._open_db()
        try:
            from models.provider_config import ProviderConfig
            encrypted = _encrypt(values, self._secret())
            row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
            if row:
                row.encrypted_config = encrypted
                row.status = "configured"
                row.updated_at = datetime.now(timezone.utc)
            else:
                row = ProviderConfig(
                    provider_id=provider_id,
                    encrypted_config=encrypted,
                    status="configured",
                )
                db.add(row)
            db.commit()
        finally:
            db.close()
        self._cache_valid.discard(provider_id)

    def is_configured(self, provider_id: str) -> bool:
        db = self._open_db()
        try:
            from models.provider_config import ProviderConfig
            row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
            return bool(row and row.encrypted_config and row.status != "unconfigured")
        except Exception:
            return False
        finally:
            db.close()

    def list(self) -> list[dict]:
        """Return all registered providers with their current status. Never returns secrets."""
        db = self._open_db()
        try:
            from models.provider_config import ProviderConfig
            rows = {r.provider_id: r for r in db.query(ProviderConfig).all()}
        except Exception:
            rows = {}
        finally:
            db.close()

        result = []
        for p in PROVIDER_REGISTRY:
            pid = p["id"]
            row = rows.get(pid)
            result.append({
                "id": pid,
                "name": p["name"],
                "required": p["required"],
                "description": p.get("description", ""),
                "configured": bool(row and row.encrypted_config and row.status != "unconfigured"),
                "status": row.status if row else "unconfigured",
                "health": row.health if row else None,
                "fields": p["fields"],
            })
        return result

    async def validate(self, provider_id: str) -> dict:
        """Run provider-specific validation and persist the health result."""
        config = self.get(provider_id)
        validator = _VALIDATORS.get(provider_id)
        if validator:
            health = await validator(config)
        else:
            health = {
                "healthy": True,
                "last_checked": datetime.now(timezone.utc).isoformat(),
                "message": "No validator registered",
            }

        db = self._open_db()
        try:
            from models.provider_config import ProviderConfig
            row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
            if row:
                row.health = health
                row.status = "healthy" if health.get("healthy") else "unhealthy"
                row.updated_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            pass
        finally:
            db.close()

        self._cache_valid.discard(provider_id)
        return health

    def disable(self, provider_id: str) -> None:
        """Clear credentials while preserving the audit trail row."""
        db = self._open_db()
        try:
            from models.provider_config import ProviderConfig
            row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
            if row:
                row.encrypted_config = None
                row.status = "unconfigured"
                row.health = None
                row.updated_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()
        self._cache_valid.discard(provider_id)
        self._cache.pop(provider_id, None)


# Module-level singleton — import this everywhere
provider_manager = ProviderManager()


# ── Env migration ─────────────────────────────────────────────────────────────

def migrate_env_to_db() -> None:
    """
    Called once at startup. Reads credentials from environment variables,
    encrypts them, and persists to DB. Skips any already-configured provider.
    After migration, services use provider_manager.get() exclusively.
    """
    for p in PROVIDER_REGISTRY:
        pid = p["id"]
        if provider_manager.is_configured(pid):
            continue

        values: dict[str, str] = {}
        for env_var, field_key in p.get("env_map", {}).items():
            val = os.environ.get(env_var, "").strip()
            if val:
                values[field_key] = val

        # Apply defaults for non-secret fields
        for field in p["fields"]:
            if field["type"] != "secret" and field.get("default") and field["key"] not in values:
                values[field["key"]] = field["default"]

        if values:
            provider_manager.set(pid, values)
