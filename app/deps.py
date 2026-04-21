from fastapi import Header, HTTPException, status
from app.config import settings

async def require_admin(x_admin_token: str = Header(default="")):
    if x_admin_token != settings.admin_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin token"
        )
