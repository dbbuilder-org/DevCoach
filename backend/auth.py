from __future__ import annotations

"""
Authentication dependency for DevCoach.

Supports two token types in the Authorization: Bearer header:

  1. Clerk JWT (web app) — detected by JWT structure (three base64url segments).
     Verified against Clerk's JWKS endpoint. GitHub OAuth token fetched from
     Clerk backend API and attached as user._pat for downstream GitHub calls.

  2. GitHub PAT (VS Code extension) — any non-JWT token.
     Validated directly against the GitHub /user API (unchanged behaviour).

Neither token type is persisted in the database. The _pat attribute is
in-memory only, lives for the lifetime of the request, and is never logged.
"""

import time
import uuid
from typing import Annotated, Any

import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models.user import User
from services.github_service import get_authenticated_user

# ---------------------------------------------------------------------------
# JWKS cache — refreshed at most once per hour to avoid per-request latency
# ---------------------------------------------------------------------------

_jwks_cache: dict[str, Any] = {}
_jwks_cached_at: float = 0.0
_JWKS_TTL = 3600  # seconds

# Per-user GitHub OAuth token cache (clerk_user_id → (token, fetched_at))
_gh_token_cache: dict[str, tuple[str, float]] = {}
_GH_TOKEN_TTL = 3000  # 50 minutes — GitHub OAuth tokens typically last much longer


async def _get_jwks() -> dict[str, Any]:
    global _jwks_cache, _jwks_cached_at
    if time.monotonic() - _jwks_cached_at < _JWKS_TTL and _jwks_cache:
        return _jwks_cache
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.clerk.com/v1/jwks",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
        )
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_cached_at = time.monotonic()
    return _jwks_cache


async def _verify_clerk_jwt(token: str) -> dict[str, Any]:
    """Verify a Clerk-issued JWT and return its claims."""
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))

    kid = header.get("kid")
    jwks = await _get_jwks()

    rsa_key: dict[str, Any] = {}
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            rsa_key = {k: key[k] for k in ("kty", "kid", "n", "e") if k in key}
            if "use" in key:
                rsa_key["use"] = key["use"]
            break

    if not rsa_key:
        # Unknown kid — cache may be stale; force refresh once
        global _jwks_cached_at
        _jwks_cached_at = 0.0
        jwks = await _get_jwks()
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                rsa_key = {k: key[k] for k in ("kty", "kid", "n", "e") if k in key}
                if "use" in key:
                    rsa_key["use"] = key["use"]
                break

    if not rsa_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token signing key not found.",
        )

    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            rsa_key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {exc}",
        )
    return claims


async def _get_clerk_user(clerk_user_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
        )
        resp.raise_for_status()
        return resp.json()


async def _get_github_oauth_token(clerk_user_id: str) -> str:
    """Return the GitHub OAuth access token for this Clerk user, with caching."""
    cached = _gh_token_cache.get(clerk_user_id)
    if cached and time.monotonic() - cached[1] < _GH_TOKEN_TTL:
        return cached[0]

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}/oauth_access_tokens/oauth_github",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
        )
        if resp.status_code != 200 or not resp.json():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="GitHub OAuth token not found. Connect GitHub in your Clerk account.",
            )
        token: str = resp.json()[0]["token"]

    _gh_token_cache[clerk_user_id] = (token, time.monotonic())
    return token


def _is_jwt(token: str) -> bool:
    """Heuristic: JWTs have exactly three dot-separated base64url segments."""
    parts = token.split(".")
    return len(parts) == 3


async def _upsert_user(github_username: str, db: AsyncSession) -> User:
    stmt = select(User).where(User.github_username == github_username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        user = User(id=uuid.uuid4(), github_username=github_username)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return user


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header with Bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[len("Bearer "):]
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token is empty.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── Clerk JWT path (web app) ──────────────────────────────────────────────
    if _is_jwt(token):
        if not settings.clerk_secret_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Clerk is not configured on this server.",
            )
        claims = await _verify_clerk_jwt(token)
        clerk_user_id: str = claims.get("sub", "")
        if not clerk_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Clerk JWT missing sub claim.",
            )

        # Get GitHub username and OAuth token from Clerk
        try:
            clerk_user = await _get_clerk_user(clerk_user_id)
            github_account = next(
                (
                    acc
                    for acc in clerk_user.get("external_accounts", [])
                    if acc.get("provider") == "github"
                ),
                None,
            )
            if not github_account:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="GitHub account not connected. Sign in with GitHub via Clerk.",
                )
            github_username: str = github_account.get("username", "")
            github_token = await _get_github_oauth_token(clerk_user_id)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Could not retrieve GitHub identity from Clerk: {exc}",
            )

        user = await _upsert_user(github_username, db)
        user._pat = github_token  # type: ignore[attr-defined]
        return user

    # ── GitHub PAT path (VS Code extension) ──────────────────────────────────
    try:
        gh_user = await get_authenticated_user(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not authenticate with GitHub. Verify your PAT.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    github_username = gh_user.get("login", "")
    if not github_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="GitHub user login could not be determined.",
        )

    user = await _upsert_user(github_username, db)
    user._pat = token  # type: ignore[attr-defined]
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
