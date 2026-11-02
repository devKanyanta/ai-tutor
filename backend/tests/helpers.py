import io
import uuid

from app.core.config import settings

ADMIN = {"Authorization": f"Bearer {settings.ADMIN_TOKEN}"}


def sign_up(client, name="Test Student"):
    """Create a fresh student and make the client send their token by default. Returns (token, user)."""
    res = client.post("/api/auth/signup", json={
        "name": name, "email": f"{uuid.uuid4().hex[:10]}@example.com", "password": "correct horse battery",
    })
    assert res.status_code == 201, res.text
    body = res.json()
    client.headers["Authorization"] = f"Bearer {body['token']}"
    return body["token"], body["user"]


def make_tutor(client, name, **extra):
    res = client.post("/api/admin/tutors", headers=ADMIN, json={"name": name, "subject": name, **extra})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def upload_text(client, tutor_id, filename, text):
    res = client.post(
        "/api/admin/documents/upload",
        headers=ADMIN,
        data={"tutor_id": tutor_id},
        files={"file": (filename, io.BytesIO(text.encode()), "text/plain")},
    )
    assert res.status_code == 200, res.text
    return res.json()
