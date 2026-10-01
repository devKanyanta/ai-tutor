import re
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

security_scheme = HTTPBearer(auto_error=False)

def verify_admin_token(credentials: HTTPAuthorizationCredentials = Security(security_scheme)) -> bool:
    """Validate Bearer token for protected Admin endpoints (SEC-02)."""
    if not credentials or credentials.credentials != settings.ADMIN_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True

# PII Scrubbing patterns (SEC-01)
EMAIL_PATTERN = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b')
PHONE_PATTERN = re.compile(r'(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b')
SSN_PATTERN = re.compile(r'\b\d{3}-\d{2}-\d{4}\b')

def anonymize_text(text: str) -> str:
    """Anonymize PII such as emails, phone numbers, and SSNs from logs and stored chats (SEC-01)."""
    if not text:
        return text
    text = EMAIL_PATTERN.sub('[EMAIL_REDACTED]', text)
    text = PHONE_PATTERN.sub('[PHONE_REDACTED]', text)
    text = SSN_PATTERN.sub('[SSN_REDACTED]', text)
    return text
