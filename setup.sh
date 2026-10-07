#!/usr/bin/env bash
# One-shot setup (macOS/Linux/Git Bash). Pass --ml for YOLO/embeddings extras.
set -e
cd "$(dirname "$0")"
python3 -m venv backend/.venv
source backend/.venv/bin/activate 2>/dev/null || source backend/.venv/Scripts/activate
pip install -r backend/requirements.txt
if [ "$1" = "--ml" ]; then
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
  pip install -r backend/requirements-ml.txt
  (cd backend && python -m app.vision)
  python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
fi
[ -f backend/.env ] || cp backend/.env.example backend/.env
(cd frontend && npm install)
echo "Done. Put your keys in backend/.env, then run ./dev.sh"
