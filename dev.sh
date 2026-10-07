#!/usr/bin/env bash
# Starts backend (:8000) and frontend (:5173) together. Ctrl+C stops both.
cd "$(dirname "$0")"
source backend/.venv/bin/activate 2>/dev/null || source backend/.venv/Scripts/activate
(cd backend && uvicorn app.main:app --reload --port 8000) &
(cd frontend && npm run dev) &
trap 'kill 0' EXIT
wait
