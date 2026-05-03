"""
API Router for Authentication handling Google OAuth.
"""
import json
import urllib.parse
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from authlib.integrations.starlette_client import OAuth
from app.config import settings
from app.services.auth import create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

# Initialize OAuth using Authlib
oauth = OAuth()
oauth.register(
    name='google',
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid email profile'
    }
)

@router.get("/login")
async def login(request: Request):
    """Initiates the Google OAuth login flow."""
    redirect_uri = request.url_for('auth_callback')
    return await oauth.google.authorize_redirect(request, redirect_uri)

@router.get("/callback")
async def auth_callback(request: Request):
    """Handles the callback from Google, processes user info and returns JWT."""
    try:
        # Note: in production, you might want a session backend, 
        # but authlib starlette client requires Starlette SessionMiddleware by default.
        # Ensure we have required state handling.
        token = await oauth.google.authorize_access_token(request)
        user_info = token.get('userinfo')
        
        if not user_info:
            # Fallback if userinfo is not directly in token
            user_info = await oauth.google.userinfo(token=token)

        user_id = user_info.get("sub") or user_info.get("email")
        
        # Create application JWT token
        jwt_token = create_access_token(
            data={"sub": user_id, "email": user_info.get("email"), "name": user_info.get("name")}
        )
        
        user_data = {
            "id": user_id,
            "email": user_info.get("email"),
            "name": user_info.get("name"),
            "picture": user_info.get("picture"),
        }
        params = urllib.parse.urlencode({
            "token": jwt_token,
            "user": json.dumps(user_data),
        })
        return RedirectResponse(url=f"focusapp://auth?{params}")
    except Exception as e:
        print(f"[Auth Error] Callback failed: {e}")
        raise HTTPException(status_code=400, detail="Authentication failed")

@router.get("/me")
async def get_current_user_info():
    """Placeholder to be updated with `get_current_user` dependency."""
    pass
