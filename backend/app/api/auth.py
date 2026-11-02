from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.core import auth

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=200)


def _session(user: Dict[str, Any]) -> Dict[str, Any]:
    return {"token": auth.issue_token(user["id"]), "user": user}


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest):
    if not auth.EMAIL_RE.match(payload.email.strip()):
        raise HTTPException(status_code=422, detail="Please enter a valid email address.")
    try:
        user = auth.create_user(payload.email, payload.name, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return _session(user)


@router.post("/login")
async def login(payload: LoginRequest):
    user = auth.authenticate(payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password.")
    return _session(user)


@router.get("/me")
async def me(user: Dict[str, Any] = Depends(auth.current_user)):
    return {"user": user}


@router.post("/logout")
async def logout(credentials: HTTPAuthorizationCredentials = Security(_bearer)):
    if credentials:
        auth.revoke_token(credentials.credentials)
    return {"status": "success"}
