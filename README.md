# Interactive Data-Driven AI Tutor

An interactive AI tutor that simulates one-on-one Socratic tutoring, grounded strictly in instructor-uploaded curriculum materials via Retrieval-Augmented Generation (RAG).

Students chat with a tutor that never gives answers away directly — it leads with probing questions, hints, and reinforcement, citing only the ingested course materials. Instructors log in to manage the curriculum document set and review engagement metrics.

## Tech Stack

- **Backend:** Python, FastAPI, Uvicorn, SQLite, Google Gemini API (`google-genai`), NumPy, PyPDF / python-docx, pytest
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, KaTeX (math rendering), react-markdown, Lucide icons

## Features

- **Socratic tutoring (`REQ-AI-02`)** — guiding questions, step-by-step hints, positive reinforcement instead of direct answers
- **Strict curriculum grounding (`REQ-AI-01`)** — responses are retrieved from (and cite) instructor-uploaded documents only; RAG pipeline with chunking, embeddings, and local cosine-similarity vector store
- **Out-of-bounds handling (`REQ-AI-03`)** — detects queries outside curriculum scope and redirects to course concepts
- **Safety guardrails (`REQ-AI-04`, `SEC-01`)** — prompt-injection resistance and PII anonymization before persistence
- **Multi-format ingestion (`REQ-IN-01..04`)** — PDF, TXT, DOCX, Markdown, CSV; single or batch upload with indexing status
- **Streaming responses (`PERF-01`)** — Server-Sent Events with low time-to-first-token; Markdown, code blocks, and LaTeX math in chat
- **Admin console** — instructor login (password → bearer token), curriculum document management, thumbs up/down feedback and engagement KPIs

## Prerequisites

- Python 3.10+
- Node.js (LTS) and npm
- Google Gemini API key (optional — a semantic simulator fallback runs if unset)

## Setup

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

export GEMINI_API_KEY="your-gemini-api-key"   # optional; simulator used if unset
export ADMIN_PASSWORD="your-admin-password"   # defaults to 'admin123' in dev
export ADMIN_TOKEN="your-admin-token"         # defaults to a dev token

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`.

### Tests

```bash
cd backend
PYTHONPATH=. venv/bin/pytest -v
```

## Screenshots

> Placeholders — add actual captures to `docs/screenshots/`.

![Chat Interface](docs/screenshots/chat.png)
*Chat — Socratic tutoring conversation with streaming responses*

![Admin Modal](docs/screenshots/admin-login.png)
*Admin Login — instructor password prompt*

![Document Manager](docs/screenshots/document-manager.png)
*Curriculum Manager — upload and manage source documents*

![Metrics Overview](docs/screenshots/metrics.png)
*Engagement Metrics — KPI dashboard with feedback stats*
