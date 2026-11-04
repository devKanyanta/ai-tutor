# Socratic: an AI tutor for every course

Instructors upload their course notes and get a dedicated AI tutor. Students sign in, pick a tutor, and are taught the whole course, one lesson at a time, by voice or text. The tutor teaches only from the instructor's material, remembers where each student stopped, and shows exactly how far through the course they are.

> **One tutor per course.** Each tutor has its own materials, persona and curriculum. Nothing is shared between tutors, so a Chemistry tutor never answers from the History notes.

---

## Contents

- [Screenshots](#screenshots)
- [What it does](#what-it-does)
- [How a lesson works](#how-a-lesson-works)
- [Quick start](#quick-start)
- [Using the app](#using-the-app)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [API overview](#api-overview)
- [Tests](#tests)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/lesson-progress.png" alt="A lesson in progress: the tutor explains why an answer was wrong, with the course outline open showing a percentage per lesson" width="900">
</p>

*A lesson in progress. The tutor has just explained why "the core" was the wrong answer. The header shows "Lesson 6 of 8 · 72%", and the outline lists every lesson with its own percentage plus an overall course bar.*

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/tutor-picker.png" alt="Student tutor picker with a progress bar on each course"></td>
    <td width="50%"><img src="docs/screenshots/upload-order.png" alt="Put these in teaching order: reorder files before they are processed"></td>
  </tr>
  <tr>
    <td><em>Students choose a tutor; each course shows how far they are through it.</em></td>
    <td><em>Instructors put several files in teaching order before anything is processed.</em></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/studio.png" alt="Instructor studio for one tutor: metrics, course outline editor, uploads and materials" width="700">
</p>

*The instructor studio for one tutor: usage metrics, the course outline (rename and reorder lessons), uploads and the list of materials.*

The people, courses and numbers in the screenshots are made up.

---


## What it does

### For students
- **Accounts and saved progress.** Sign up or sign in before reaching any tutor. Progress is stored on the account, so it follows you across devices.
- **Pick a tutor, then just learn.** The tutor opens every session itself: it starts lesson 1, or resumes exactly where you stopped, and moves to the next lesson when one is done. It never asks "what topic do you want?".
- **Percentage progress.** Every lesson has its own percentage that updates as you go, not only when the lesson ends. The header shows "Lesson 3 of 8 · 45%", the outline shows each lesson's percentage plus an overall bar, and the tutor picker shows each course's completion.
- **Detailed, unhurried teaching.** Each lesson is planned to cover everything in its notes, one point at a time, with a check question after each. A point is explained at length (terms, reasoning, every step and example) rather than summarised.
- **Honest feedback.** When an answer is wrong, the tutor says so, explains why, gives the correct answer with its reasoning, and offers to go over it again.
- **Breaks and ending early.** Say "let's take a break" or "I want to end the lesson" at any time (or press the buttons). Your place is saved; say "I'm back" to continue.
- **Voice or text.** Hands-free voice lessons (Gemini Live) with interruption, a slide board that follows the audio, and Normal / Relaxed / Slow pacing. Text chat streams token by token with Markdown, code and LaTeX math.

### For instructors
- **Many specialised tutors.** Create as many as you like, each with a name, subject, description and optional teaching guidance.
- **Upload in teaching order.** Add PDF, Word, text, Markdown or CSV files. When you add several at once you first put them in order (up and down buttons), and nothing is processed until you confirm, so lessons come out in the order you teach.
- **Course outline editor.** Every document becomes a lesson (long documents are split into parts). Rename and reorder lessons whenever you like.
- **Metrics.** Thumbs up/down feedback and usage numbers, per tutor or overall.

### Guardrails
- **Grounded in your material.** Retrieval is filtered to the current tutor's documents. Out-of-scope questions are detected and redirected back to the course.
- **Subject matter only.** Title pages, university and course names, instructor names, page headers and numbers are ignored: the tutor never teaches or quizzes on them.
- **Safe by default.** Prompt-injection attempts ("ignore previous instructions") are refused and personal data (emails, phone numbers, SSNs) is anonymised before anything is stored.

---

## How a lesson works

```
documents ──► chunks + embeddings (per tutor) ──► course outline (one lesson per document or part)
                                                          │
student opens tutor ──► next unfinished lesson ──► planner reads that lesson's notes
                                                          │
        Warm-up ──► Learn (one point at a time) ──► Practice ──► Recap ──► next lesson
```

1. **Ingest.** Uploaded files are parsed, split into overlapping chunks and embedded with Gemini. Vectors are stored with the tutor's id.
2. **Outline.** A tutor's READY documents become its lessons: one per document, or several parts of about six chunks for long documents. Instructors can rename and reorder them.
3. **Plan.** For each lesson, a planner reads the lesson's notes and produces a plan: hook and roadmap, a list of points (each tied to the exact excerpts it must teach), check questions, practice tasks and takeaways. Every excerpt of subject matter is assigned to a point, so nothing is skipped.
4. **Teach.** The lesson engine moves through the plan one step per student turn, giving the model a directive for each step plus the exact notes for that point. It holds and re-teaches if the student is stuck, answers side questions without losing its place, and pauses for breaks. Text and voice use the same engine.
5. **Track.** After each step the lesson's percentage is saved (steps done out of total steps; completed lessons are 100%). Overall course progress is the average across lessons.

---

## Quick start

**Requirements:** Python 3.12+ (the Docker image uses 3.12), Node 22+ (the Docker image uses 22), and a [Google Gemini API key](https://aistudio.google.com/apikey).

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp ../.env.example .env        # then set GEMINI_API_KEY and the admin values
uvicorn app.main:app --host 0.0.0.0 --port 8006 --reload
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` (including the voice WebSocket) to the backend on port 8006.

Voice lessons need microphone permission and a secure origin. `localhost` works locally; deployed sites must use HTTPS.

---

## Using the app

1. **Instructor:** open **Instructors** (`/studio`) and sign in with `ADMIN_PASSWORD`. Create a tutor, upload its materials, put them in order, and check each document shows **READY**. Adjust lesson titles and order in the course outline if needed.
2. **Student:** open the app, **sign up**, choose a tutor, and the lesson starts by itself. Use the header to see the outline, take a break, end the lesson or restart it.

Routes: `/` home, `/learn` tutor picker (and lessons via `?tutor=<id>`), `/studio` instructor portal.

---

## Configuration

All settings are environment variables, or entries in `backend/.env`.

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Gemini key for answers, planning, embeddings and voice. Without it the app runs in offline mode (no AI replies, no voice). |
| `ADMIN_PASSWORD` | **Yes in production** | Instructor portal password. The default `admin123` is for local use only. |
| `ADMIN_TOKEN` | **Yes in production** | Secret bearer token issued after instructor login. Use a long random string: `openssl rand -hex 32`. |
| `CORS_ORIGINS` | No | Comma-separated allowed origins. Only needed if the frontend is on a different domain than the backend. Default `*`. |
| `GEMINI_MODEL` / `GEMINI_LIVE_MODEL` / `EMBEDDING_MODEL` | No | Override the default models. |
| `FRONTEND_DIST` | No | Path to the built frontend. Defaults to `frontend/dist`. |

The server logs a warning at startup if the default admin credentials are still in use.

Retrieval and chunking defaults (chunk size, overlap, top-k, similarity threshold) are in `backend/app/core/config.py`.

---

## Project layout

```
backend/
  app/
    main.py              FastAPI app, startup migrations, serves the built frontend
    api/                 auth.py (accounts) · chat.py (student chat, SSE, voice WebSocket)
                         admin.py (tutors, documents, outline, metrics) · health.py
    core/                config.py · auth.py (passwords, tokens) · security.py (guardrails, PII)
    db/                  database.py (SQLite schema + migrations) · models.py (request/response models)
    ingestion/           parsers.py · chunker.py · pipeline.py
    rag/                 vector_store.py (NumPy cosine search, per-tutor filter) · retriever.py
    tutor/
      lesson.py          planner, lesson state machine, directives, breaks/end, progress hooks
      course.py          course outline and per-student progress
      engine.py          streaming responses
      memory.py          sessions and messages
      prompts.py         tutor persona and spoken-style rules
  tests/                 API, ingestion/security, lesson flow, accounts and progress
frontend/src/
  components/            auth/ · tutors/ (picker) · lesson/ (page, voice, board, progress)
                         admin/ (tutor manager, documents, outline editor)
  services/api.ts        all HTTP calls (student calls add the bearer token)
  router.tsx             small query-string router
```

**Stack:** FastAPI, Uvicorn, SQLite, NumPy, Google Gemini (`google-genai`), PyPDF, python-docx on the backend; React 19, TypeScript, Vite, Tailwind CSS v4, KaTeX, React Markdown on the frontend.

---

## API overview

Student endpoints require `Authorization: Bearer <token>` from sign-in; instructor endpoints require the admin token.

| Area | Endpoints |
|---|---|
| Accounts | `POST /api/auth/signup`, `/login`, `/logout`, `GET /api/auth/me` |
| Tutors and course | `GET /api/chat/tutors`, `/tutors/{id}`, `/tutors/{id}/course` |
| Sessions | `POST /api/chat/session/new`, `POST /api/chat/open` (tutor speaks first), `POST /api/chat/stream`, `GET /api/chat/session/{id}/state`, `POST /api/chat/session/{id}/lesson/reset`, `GET /api/chat/history/{id}`, `POST /api/chat/feedback` |
| Voice | WebSocket `/api/chat/voice/{session_id}?token=…` |
| Instructor | `POST /api/admin/login`, `/api/admin/tutors` (CRUD), `/tutors/{id}/lessons` (order and titles), `/documents` (upload, batch upload, update, delete), `/metrics` |
| Health | `GET /api/health` |

FastAPI's interactive docs are at `/docs` when the server is running.

---

## Tests

```bash
cd backend
source venv/bin/activate
python -m pytest -q
```

The suite uses your real Gemini key from `.env` (embeddings and planning are called live), so it needs network access and can hit free-tier quotas. Test data is cleaned up afterwards. A full run takes a few minutes.

Frontend type-check, lint and production build:

```bash
cd frontend
npm run lint
npm run build
```

---

## Deployment

The backend serves the built frontend itself, so the whole app is **one service on one port (8006)** under one domain. All persistent data (SQLite database, uploaded files, vector index) lives in `backend/data/`, so **that folder must be on persistent storage and backed up.**

### Option A: Docker (recommended)

```bash
cp .env.example .env     # set GEMINI_API_KEY, ADMIN_PASSWORD, ADMIN_TOKEN
docker compose up -d --build
```

The app is now on `http://localhost:8006`. Data persists in the `tutor-data` volume. Update with `git pull && docker compose up -d --build`.

### Option B: A Linux server without Docker

```bash
# Build the frontend once
cd frontend && npm ci && npm run build && cd ..

# Install and run the backend
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env   # edit values
uvicorn app.main:app --host 127.0.0.1 --port 8006 --proxy-headers
```

Run it under systemd so it restarts automatically (`/etc/systemd/system/ai-tutor.service`):

```ini
[Unit]
Description=AI Tutor
After=network.target

[Service]
WorkingDirectory=/opt/ai-tutor/backend
EnvironmentFile=/opt/ai-tutor/backend/.env
ExecStart=/opt/ai-tutor/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8006 --proxy-headers
Restart=always
User=aitutor

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now ai-tutor`

### HTTPS and a domain (required for voice lessons)

Browsers only allow the microphone on HTTPS. Put a reverse proxy in front of port 8006. The simplest is **Caddy**, which gets and renews certificates automatically:

```
tutor.example.com {
    reverse_proxy 127.0.0.1:8006
}
```

For **nginx**, make sure WebSocket upgrades and streaming are enabled (chat uses Server-Sent Events and voice uses WebSockets):

```nginx
location / {
    proxy_pass http://127.0.0.1:8006;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;        # lets chat replies stream token by token
    proxy_read_timeout 3600s;   # keeps voice lessons connected
    client_max_body_size 50m;   # curriculum uploads
}
```

### Managed platforms (Render, Railway, Fly.io, etc.)

Deploy the repository using the included `Dockerfile`, expose port 8006, set the environment variables above, and **attach a persistent volume mounted at `/app/backend/data`**. Without a volume, uploaded curriculum and chat history are lost on every redeploy.

### Launch checklist

- [ ] `ADMIN_PASSWORD` and `ADMIN_TOKEN` changed from defaults
- [ ] `GEMINI_API_KEY` set (never commit it; `.env` is git-ignored)
- [ ] HTTPS enabled on your domain
- [ ] `backend/data/` on persistent storage with regular backups
- [ ] Curriculum uploaded in the Instructor Portal and each document shows **READY**
- [ ] Tried a text chat, an out-of-scope question, and a voice lesson on a phone
- [ ] `GET /api/health` returns `healthy` (use it for uptime monitoring)

> **Scaling note:** the vector index is held in memory and stored on local disk, so run a **single instance** (one container or process). That comfortably serves a classroom or a course; for many concurrent institutions you would move to a hosted vector database.

---

## Known limitations

- **One shared instructor login.** Instructors sign in with a single admin password; there are no per-instructor accounts yet, so every instructor can see and edit every tutor.
- **No answer grading gate.** The tutor moves on after each answer and explains mistakes, but it does not hold a lesson until the student has shown understanding (it re-teaches only when the student asks for help or seems stuck).
- **Voice after "end lesson".** The voice connection stays open after a lesson is ended or paused; the tutor simply stops teaching until the student resumes.
- **Existing lessons keep their old plan.** Lessons planned before an update keep that plan until the student chooses **Restart lesson**.
- **Single instance.** See the scaling note above.

---

## Requirements document

The original product requirements (referenced in code as `REQ-*`, `PERF-*`, `SEC-*` and `KPI-*` ids) are in [`ai_tutor_user_requirements_document.md`](ai_tutor_user_requirements_document.md).
