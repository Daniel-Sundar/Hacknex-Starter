#!/usr/bin/env bash
# One-shot setup (macOS/Linux/Git Bash).
set -e
cd "$(dirname "$0")"
python3 -m venv backend/.venv
source backend/.venv/bin/activate 2>/dev/null || source backend/.venv/Scripts/activate
pip install -r backend/requirements.txt
[ -f backend/.env ] || cp backend/.env.example backend/.env
(cd frontend && npm install)
echo "Done. Put your keys in backend/.env, then run ./dev.sh"
