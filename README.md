# Interactive Data-Driven AI Tutor

An interactive AI Tutor application that simulates human one-on-one tutoring through Socratic dialogue, strictly grounded in instructor-uploaded curriculum materials via Retrieval-Augmented Generation (RAG).

Built to satisfy all specifications from the **User Requirements Document (URD)**.

---

## 🚀 Features

* **Socratic Persona & Guiding Questions (`REQ-AI-02`, `USE-02`):** Rather than giving answers away, the tutor leads students to deeper understanding through probing questions, step-by-step hints, and positive reinforcement.
* **Strict Curriculum Grounding (`REQ-AI-01`):** Ingested documents form the sole knowledge base. Responses cite the specific course materials referenced.
* **Out-of-Bounds Handling (`REQ-AI-03`):** Automatically detects queries outside curriculum scope and redirects focus back to the course concepts.
* **Safety & Guardrails (`REQ-AI-04`, `SEC-01`):** Immune to prompt injections ("DAN mode", "ignore previous instructions") and anonymizes PII (emails, phone numbers, SSNs) before persistence.
* **Multi-Format Document Ingestion (`REQ-IN-01..04`):** Support for PDF, TXT, DOCX, Markdown, and CSV with real-time indexing status indicators.
* **Sub-500ms Vector Retrieval (`PERF-02`):** Embedded local vector engine with normalized cosine similarity search.
* **Sub-1.5s Streaming TTFT (`PERF-01`):** Server-Sent Events (SSE) streaming with Google Gemini integration.
* **Hands-Free Voice Lessons:** Gemini Live API streams microphone audio, speaks tutor responses, supports interruption, and saves readable transcripts in the existing session. The tutor's words appear as slides on a lesson board, revealed in step with the audio, and students can choose a Normal, Relaxed or Slow voice pace. Curriculum retrieval remains on the backend; the Gemini API key is never exposed to the browser.
* **Rich Markdown & LaTeX Math (`REQ-UI-02`):** Full rendering of code blocks, tables, bold formatting, and mathematical equations via KaTeX ($formula$ and $$formula$$).
* **Engagement & Feedback Metrics (`KPI-1..4`):** Thumbs up/down feedback widget with admin KPI dashboard.

---

## 🛠️ Tech Stack

* **Backend:** Python FastAPI, Uvicorn, SQLite, Google Gemini API (`google-genai`), PyPDF, Python-docx, NumPy.
* **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React, KaTeX, React Markdown.

---

## 🏃 Local Development

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp ../.env.example .env        # then edit the values
uvicorn app.main:app --host 0.0.0.0 --port 8006 --reload
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`. The Vite dev server proxies `/api` (including WebSockets for voice) to the backend on port 8006.

Voice lessons need microphone permission and a secure origin (`localhost` is fine locally; deployed sites must use HTTPS).

---

## ⚙️ Configuration

All settings are environment variables (or entries in `backend/.env`).

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini key for answers, embeddings and voice. Without it the app runs in offline mode (no AI replies, no voice). |
| `ADMIN_PASSWORD` | **Yes in production** | Instructor portal password. Default `admin123` is for local use only. |
| `ADMIN_TOKEN` | **Yes in production** | Secret bearer token issued after login. Use a long random string: `openssl rand -hex 32`. |
| `CORS_ORIGINS` | No | Comma-separated allowed origins. Only needed if the frontend is hosted on a different domain than the backend. Default `*`. |
| `GEMINI_MODEL` / `GEMINI_LIVE_MODEL` / `EMBEDDING_MODEL` | No | Override the default models. |
| `FRONTEND_DIST` | No | Path to the built frontend. Defaults to `frontend/dist`. |

The server logs a warning at startup if the default admin credentials are still in use.

---

## 🌍 Hosting / Deployment

The backend can serve the built frontend itself, so the whole app is **one service on one port (8006)** with one domain. All persistent data (SQLite database, uploaded files, vector index) lives in `backend/data/`, so **that folder must be on persistent storage and backed up.**

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

For **nginx**, make sure WebSocket upgrades and streaming are enabled (the chat uses Server-Sent Events and voice uses WebSockets):

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

> **Scaling note:** the vector index is held in memory and stored on local disk, so run a **single instance** (one container or process). That comfortably serves a classroom or course; for many concurrent institutions you would move to a hosted vector database.

---

## 🧪 Running Tests

```bash
cd backend
PYTHONPATH=. venv/bin/pytest -v
```

Frontend type-check, lint and production build:

```bash
cd frontend
npm run lint
npm run build
```
