from __future__ import annotations

"""
Authentication dependency for DevCoach.

Pattern: extract `Authorization: Bearer <github_pat>` from the request header,
call the GitHub /user API to resolve the authenticated user's login, then upsert
that user in the local database.

The PAT is encrypted at rest using Fernet symmetric encryption derived from
SECRET_KEY. We never log tokens or PII.
"""

import base64
import uuid
from typing import Annotated

from cryptography.fernet import Fernet
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models.user import User
from services.github_service import get_authenticated_user


def _fernet_key() -> bytes:
    """
    Derive a 32-byte URL-safe base64 Fernet key from settings.secret_key.
    Fernet requires exactly 32 bytes encoded as URL-safe base64 (44 chars).
    """
    raw = settings.secret_key[:32].encode().ljust(32)[:32]
    return base64.urlsafe_b64encode(raw)


def _fernet() -> Fernet:
    return Fernet(_fernet_key())


def encrypt_pat(pat: str) -> str:
    """Encrypt a GitHub PAT for storage. Returns a base64-encoded ciphertext string."""
    return _fernet().encrypt(pat.encode()).decode()


def decrypt_pat(encrypted: str) -> str:
    """Decrypt a stored encrypted PAT back to plaintext."""
    return _fernet().decrypt(encrypted.encode()).decode()


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    FastAPI dependency that:
    1. Extracts the Bearer PAT from the Authorization header.
    2. Calls the GitHub API to verify it and get the username.
    3. Upserts the user record in the database (PAT stored encrypted).
    4. Returns the User ORM object with the raw PAT attached in-memory.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header with Bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    pat = authorization[len("Bearer "):]
    if not pat:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token is empty.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        gh_user = await get_authenticated_user(pat)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not authenticate with GitHub. Verify your PAT.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    github_username: str = gh_user.get("login", "")
    if not github_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="GitHub user login could not be determined.",
        )

    # Upsert user — store the PAT encrypted at rest, never log the token
    stmt = select(User).where(User.github_username == github_username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    encrypted_pat = encrypt_pat(pat)

    if user is None:
        user = User(
            id=uuid.uuid4(),
            github_username=github_username,
            github_token_enc=encrypted_pat,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        # Update the stored encrypted token on every auth (PAT may have rotated)
        user.github_token_enc = encrypted_pat
        await db.commit()
        await db.refresh(user)

    # Attach the raw PAT to the user object in memory (not persisted here) so
    # downstream services can use it without having to re-parse the header.
    user._pat = pat  # type: ignore[attr-defined]

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
