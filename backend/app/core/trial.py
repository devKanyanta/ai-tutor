"""Free-trial limits: how many tutors a student can have, how big a course file may be, and a daily allowance
of tutor replies and live voice time. Limits come from settings (TRIAL_*) so they can be tuned without code changes."""
from typing import Any, Dict

from fastapi import HTTPException, status

from app.core.config import settings
from app.db.database import get_db

TRIAL_NOTICE = (
    "You're using the free trial of Socratic. We're still building it: the final version will be released soon, "
    "and we'll email everyone who tried it, at the address on their account, when it is."
)
_TODAY = "CAST((now() AT TIME ZONE 'UTC') AS date)"


def limits() -> Dict[str, int]:
    return {
        "max_tutors": settings.TRIAL_MAX_TUTORS,
        "max_upload_mb": settings.TRIAL_MAX_UPLOAD_MB,
        "daily_turns": settings.TRIAL_DAILY_TURNS,
        "daily_voice_minutes": settings.TRIAL_DAILY_VOICE_MINUTES,
    }


def usage_today(user_id: str) -> Dict[str, int]:
    with get_db() as db:
        row = db.execute(
            f"SELECT turns, voice_seconds FROM usage_daily WHERE user_id = ? AND day = {_TODAY}", (user_id,)
        ).fetchone()
        tutors = db.execute("SELECT COUNT(*) AS n FROM tutors WHERE owner_id = ?", (user_id,)).fetchone()["n"]
    return {
        "tutors": int(tutors),
        "turns": int(row["turns"]) if row else 0,
        "voice_seconds": int(row["voice_seconds"]) if row else 0,
    }


def status_for(user_id: str) -> Dict[str, Any]:
    used, cap = usage_today(user_id), limits()
    return {
        "limits": cap,
        "usage": used,
        "remaining": {
            "tutors": max(0, cap["max_tutors"] - used["tutors"]),
            "turns": max(0, cap["daily_turns"] - used["turns"]),
            "voice_seconds": max(0, cap["daily_voice_minutes"] * 60 - used["voice_seconds"]),
        },
        "notice": TRIAL_NOTICE,
    }


def turns_left(user_id: str) -> int:
    return status_for(user_id)["remaining"]["turns"]


def voice_seconds_left(user_id: str) -> int:
    return status_for(user_id)["remaining"]["voice_seconds"]


DAILY_LIMIT_MESSAGE = (
    "You've used today's free trial allowance. It resets at midnight UTC, so come back tomorrow. "
    "We're still building Socratic and will let you know when the full version is out."
)


def ensure_turn_budget(user_id: str) -> None:
    """429 with a friendly message once the day's tutor replies are used up."""
    if turns_left(user_id) <= 0:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=DAILY_LIMIT_MESSAGE)


def record_voice_seconds(user_id: str, seconds: int) -> None:
    if seconds <= 0:
        return
    with get_db() as db:
        db.execute(
            f"INSERT INTO usage_daily (user_id, day, voice_seconds) VALUES (?, {_TODAY}, ?) "
            "ON CONFLICT (user_id, day) DO UPDATE SET voice_seconds = usage_daily.voice_seconds + excluded.voice_seconds",
            (user_id, seconds),
        )
        db.commit()
