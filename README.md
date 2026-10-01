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
* **Rich Markdown & LaTeX Math (`REQ-UI-02`):** Full rendering of code blocks, tables, bold formatting, and mathematical equations via KaTeX ($formula$ and $$formula$$).
* **Engagement & Feedback Metrics (`KPI-1..4`):** Thumbs up/down feedback widget with admin KPI dashboard.

---

## 🛠️ Tech Stack

* **Backend:** Python FastAPI, Uvicorn, SQLite, Google Gemini API (`google-genai`), PyPDF, Python-docx, NumPy.
* **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React, KaTeX, React Markdown.

---

## 🏃 Quickstart Guide

### 1. Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Optional: set Gemini API key (system uses semantic simulator if unset)
export GEMINI_API_KEY="your-gemini-api-key"
export ADMIN_PASSWORD="admin123"

# Run FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## 🧪 Running Tests

To run the backend test suite:
```bash
cd backend
PYTHONPATH=. venv/bin/pytest -v
```

To run frontend production build verification:
```bash
cd frontend
npm run build
```
