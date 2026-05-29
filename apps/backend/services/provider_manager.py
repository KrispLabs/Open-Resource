"""
Provider credential management — AES-256-GCM encryption, registry-driven extensibility.

All services read credentials from provider_manager.get(), not from settings directly.
Adding a provider requires only register_provider() — no frontend changes.
"""
import os
import json
import base64
import hashlib
import logging
import httpx
from datetime import datetime, timezone
from typing import Callable

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from config import settings

logger = logging.getLogger(__name__)


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
    import json as _json
    ts = datetime.now(timezone.utc).isoformat()
    api_key = config.get("api_key", "")
    serp_zone = config.get("serp_zone", "serp_api2")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.brightdata.com/request",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"zone": serp_zone, "url": "https://www.google.com/search?q=test", "format": "json"},
            )
        resp.raise_for_status()
        outer = resp.json()
        # outer.status_code 407 means zone not found; 200 means OK
        inner_status = outer.get("status_code", 0)
        if inner_status == 407:
            msg = outer.get("headers", {}).get("x-brd-error", f"Zone '{serp_zone}' not found")
            return {"healthy": False, "last_checked": ts, "message": str(msg)}
        healthy = inner_status == 200
        return {"healthy": healthy, "last_checked": ts,
                "message": "OK" if healthy else f"Unexpected status {inner_status}"}
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
        except Exception as exc:
            logger.error(
                "Provider '%s' credential decrypt failed: %s. "
                "This usually means SERVER_SECRET_KEY was changed. "
                "Re-configure via /api/providers/configure.",
                provider_id, exc,
            )
            # Mark the row so the admin UI shows the real state
            try:
                from models.provider_config import ProviderConfig as _PC
                _row = db.query(_PC).filter_by(provider_id=provider_id).first()
                if _row and _row.status not in ("decrypt_failed", "unconfigured"):
                    _row.status = "decrypt_failed"
                    _row.health = {
                        "healthy": False,
                        "last_checked": datetime.now(timezone.utc).isoformat(),
                        "message": "Credential decryption failed — re-configure provider",
                    }
                    db.commit()
            except Exception:
                pass
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
        """
        Returns True only when the DB row exists AND all required secret fields
        are present in the decrypted config.  A row with only model/non-secret
        defaults (but no api_key) returns False so re-migration can fill the gap.
        """
        db = self._open_db()
        try:
            from models.provider_config import ProviderConfig
            row = db.query(ProviderConfig).filter_by(provider_id=provider_id).first()
            if not row or not row.encrypted_config or row.status in ("unconfigured", "decrypt_failed"):
                return False
        except Exception:
            return False
        finally:
            db.close()

        # Row exists — also verify every required secret field is present
        provider_def = next((p for p in PROVIDER_REGISTRY if p["id"] == provider_id), None)
        if not provider_def:
            return True  # Unknown provider — assume OK
        config = self.get(provider_id)
        for field in provider_def["fields"]:
            if field.get("required") and field["type"] == "secret":
                if not config.get(field["key"]):
                    return False
        return True

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

            # Row existing is not sufficient — required secret fields must be present
            row_exists = bool(row and row.encrypted_config and row.status not in ("unconfigured", "decrypt_failed"))
            if row_exists:
                config = self.get(pid)
                for field in p["fields"]:
                    if field.get("required") and field["type"] == "secret":
                        if not config.get(field["key"]):
                            row_exists = False
                            break

            result.append({
                "id": pid,
                "name": p["name"],
                "required": p["required"],
                "description": p.get("description", ""),
                "configured": row_exists,
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

def _missing_required_fields(provider_def: dict) -> list[str]:
    """Return list of required secret field keys that are absent from the stored config."""
    pid = provider_def["id"]
    try:
        config = provider_manager.get(pid)
    except Exception:
        config = {}
    return [
        f["key"]
        for f in provider_def["fields"]
        if f["type"] == "secret" and f.get("required") and not config.get(f["key"])
    ]


def migrate_env_to_db() -> None:
    """
    Called once at startup. Reads credentials from environment variables,
    encrypts them, and persists to DB.

    Re-migration triggers when:
    - Provider not yet in DB (first run)
    - Provider row exists but required secret fields are missing (e.g., api_key empty)
      AND the corresponding env vars are now set — so adding a key to .env after a
      prior empty-migration automatically takes effect on the next restart.
    """
    for p in PROVIDER_REGISTRY:
        pid = p["id"]
        missing = _missing_required_fields(p)

        if provider_manager.is_configured(pid) and not missing:
            logger.info(
                "Provider '%s' already configured in DB — skipping env migration. "
                "Use /api/providers/rotate to update credentials.", pid
            )
            continue

        # Build values from env vars
        values: dict[str, str] = {}
        for env_var, field_key in p.get("env_map", {}).items():
            val = os.environ.get(env_var, "").strip()
            if val:
                values[field_key] = val

        # Apply defaults for non-secret fields
        for field in p["fields"]:
            if field["type"] != "secret" and field.get("default") and field["key"] not in values:
                values[field["key"]] = field["default"]

        if not values:
            continue

        # Only re-migrate if env now supplies the missing required fields
        if missing:
            can_fill = all(
                any(values.get(f["key"]) for f in p["fields"] if f["key"] == mk)
                for mk in missing
            )
            if not can_fill:
                env_vars_needed = [k for k, fk in p.get("env_map", {}).items() if fk in missing]
                logger.warning(
                    "Provider '%s' requires field(s) %s but they are absent from the environment. "
                    "Set %s in your .env and restart to activate, "
                    "or configure via POST /api/providers/configure.",
                    pid, missing, env_vars_needed,
                )
                continue
            logger.info(
                "Provider '%s' has missing required fields %s — re-migrating from env.", pid, missing
            )
            provider_manager._cache_valid.discard(pid)  # invalidate stale cache

        provider_manager.set(pid, values)


def check_required_providers() -> None:
    """
    Log actionable errors for any required provider that is not fully configured.
    Call after migrate_env_to_db() at startup.
    Catches both 'never configured' and 'configured row exists but api_key absent'.
    """
    for p in PROVIDER_REGISTRY:
        if not p.get("required"):
            continue
        if provider_manager.is_configured(p["id"]):
            continue  # all required fields present — OK
        missing = _missing_required_fields(p)
        env_vars = [k for k, fk in p.get("env_map", {}).items() if fk in missing]
        if missing:
            logger.error(
                "REQUIRED provider '%s' is missing field(s) %s in stored credentials. "
                "AI features WILL FAIL. "
                "Set %s in your .env and restart (auto-migrates), "
                "or rotate via POST /api/providers/%s/rotate.",
                p["name"], missing, env_vars, p["id"],
            )
        else:
            logger.error(
                "REQUIRED provider '%s' is not configured. "
                "AI features WILL FAIL. Configure via POST /api/providers/configure.",
                p["name"],
            )
