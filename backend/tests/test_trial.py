"""The student free trial: own tutors from one file, privacy between students, and usage limits."""
import io

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.tutor.memory import memory
from helpers import sign_up

NOTES = "Igneous rocks form when magma cools and hardens. Sedimentary rocks form from layers of compressed sediment."


def create(client, name="Rocks", filename="rocks.txt", content=NOTES, subject=""):
    return client.post(
        "/api/trial/tutors",
        data={"subject": subject or name},
        files={"file": (filename, io.BytesIO(content if isinstance(content, bytes) else content.encode()), "text/plain")},
    )


def test_trial_status_explains_limits_and_the_upcoming_release():
    with TestClient(app) as client:
        sign_up(client)
        body = client.get("/api/trial/status").json()
        assert body["limits"]["max_tutors"] == settings.TRIAL_MAX_TUTORS
        assert body["remaining"]["tutors"] == settings.TRIAL_MAX_TUTORS
        assert "final version" in body["notice"] and "email" in body["notice"]
        assert "one file" in body["rule"]


def test_student_creates_a_tutor_from_one_file_and_it_is_private():
    with TestClient(app) as client:
        sign_up(client, "Owner")
        res = create(client)
        assert res.status_code == 201, res.text
        tutor_id = res.json()["id"]
        try:
            assert res.json()["lesson_count"] >= 1 and res.json()["name"] == "Socratic" and res.json()["subject"] == "Rocks"
            mine = next(t for t in client.get("/api/chat/tutors").json()["tutors"] if t["id"] == tutor_id)
            assert mine["owned"] and mine["ready_documents"] == 1 and mine["document_count"] == 1
            assert client.post("/api/chat/session/new", json={"tutor_id": tutor_id}).status_code == 200

            sign_up(client, "Someone else")
            assert tutor_id not in [t["id"] for t in client.get("/api/chat/tutors").json()["tutors"]]
            assert client.get(f"/api/chat/tutors/{tutor_id}").status_code == 404
            assert client.post("/api/chat/session/new", json={"tutor_id": tutor_id}).status_code == 404
            assert client.delete(f"/api/trial/tutors/{tutor_id}").status_code == 404
        finally:
            # back to the owner to clean up: sign in again as them is not needed, the admin API can remove it
            client.delete(f"/api/admin/tutors/{tutor_id}", headers={"Authorization": f"Bearer {settings.ADMIN_TOKEN}"})


def test_tutor_limit_is_enforced_and_deleting_frees_a_slot(monkeypatch):
    monkeypatch.setattr(settings, "TRIAL_MAX_TUTORS", 1)
    with TestClient(app) as client:
        sign_up(client)
        first = create(client, "First")
        assert first.status_code == 201, first.text
        blocked = create(client, "Second")
        assert blocked.status_code == 403 and "1 tutors" in blocked.json()["detail"]
        assert client.get("/api/trial/status").json()["remaining"]["tutors"] == 0
        assert client.delete(f"/api/trial/tutors/{first.json()['id']}").status_code == 200
        again = create(client, "Second")
        assert again.status_code == 201, again.text
        client.delete(f"/api/trial/tutors/{again.json()['id']}")


def test_upload_rules(monkeypatch):
    with TestClient(app) as client:
        sign_up(client)
        assert client.post("/api/trial/tutors", data={"subject": "  "}, files={"file": ("a.txt", io.BytesIO(NOTES.encode()), "text/plain")}).status_code == 422
        assert client.post("/api/trial/tutors", files={"file": ("a.txt", io.BytesIO(NOTES.encode()), "text/plain")}).status_code == 422
        assert create(client, filename="notes.exe").status_code == 400
        assert create(client, content="").status_code == 400
        monkeypatch.setattr(settings, "TRIAL_MAX_UPLOAD_MB", 1)
        too_big = create(client, content=b"a" * (1024 * 1024 + 1))
        assert too_big.status_code == 413 and "1 MB" in too_big.json()["detail"]
        # A file that can't be turned into lessons must not use up one of the student's tutor slots.
        unreadable = create(client, content="   \n  ")
        assert unreadable.status_code == 422
        assert client.get("/api/trial/status").json()["usage"]["tutors"] == 0


def test_a_tutor_takes_exactly_one_file_from_students():
    """Students have no endpoint to add more material to a tutor; the instructor API stays admin-only."""
    with TestClient(app) as client:
        sign_up(client)
        tutor_id = create(client).json()["id"]
        try:
            extra = client.post("/api/admin/documents/upload", data={"tutor_id": tutor_id},
                                files={"file": ("more.txt", io.BytesIO(b"more"), "text/plain")})
            assert extra.status_code == 401
        finally:
            client.delete(f"/api/trial/tutors/{tutor_id}")


def test_daily_allowance_blocks_further_lessons(monkeypatch):
    monkeypatch.setattr(settings, "TRIAL_DAILY_TURNS", 2)
    with TestClient(app) as client:
        sign_up(client)
        tutor_id = create(client).json()["id"]
        try:
            sid = client.post("/api/chat/session/new", json={"tutor_id": tutor_id}).json()["session_id"]
            memory.add_message(sid, "assistant", "Hello")
            assert client.get("/api/trial/status").json()["remaining"]["turns"] == 1
            memory.add_message(sid, "assistant", "Again")
            status = client.get("/api/trial/status").json()
            assert status["remaining"]["turns"] == 0
            res = client.post("/api/chat/stream", json={"session_id": sid, "message": "hi"})
            assert res.status_code == 429 and "tomorrow" in res.json()["detail"]
            assert client.post("/api/chat/open", json={"session_id": sid}).status_code == 200  # existing conversation: nothing to spend
        finally:
            client.delete(f"/api/trial/tutors/{tutor_id}")


def test_voice_is_refused_when_the_allowance_is_used(monkeypatch):
    monkeypatch.setattr(settings, "TRIAL_DAILY_VOICE_MINUTES", 0)
    with TestClient(app) as client:
        token, _ = sign_up(client)
        tutor_id = create(client).json()["id"]
        try:
            sid = client.post("/api/chat/session/new", json={"tutor_id": tutor_id}).json()["session_id"]
            with client.websocket_connect(f"/api/chat/voice/{sid}?token={token}") as ws:
                message = ws.receive_json()
                assert message["type"] == "error" and "tomorrow" in message["message"]
        finally:
            client.delete(f"/api/trial/tutors/{tutor_id}")
