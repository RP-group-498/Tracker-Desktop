"""
Authentication Service managing JWT and Google OAuth Flow.
"""
import time
from typing import Dict, Any, Optional
import jwt
from app.config import settings

def create_access_token(data: dict) -> str:
    """Creates a JWT access token valid for the configured expiry time."""
    to_encode = data.copy()
    expire_timestamp = time.time() + (settings.access_token_expire_minutes * 60)
    to_encode.update({"exp": expire_timestamp})
    
    encoded_jwt = jwt.encode(
        to_encode, 
        settings.jwt_secret_key, 
        algorithm=settings.jwt_algorithm
    )
    return encoded_jwt

def verify_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Verifies a JWT access token and returns payload if valid."""
    try:
        decoded_data = jwt.decode(
            token, 
            settings.jwt_secret_key, 
            algorithms=[settings.jwt_algorithm]
        )
        return decoded_data
    except jwt.ExpiredSignatureError:
        print("[Auth] Token expired")
        return None
    except jwt.InvalidTokenError as e:
        print(f"[Auth] Invalid token: {e}")
        return None
