# One-shot setup for Windows. In PowerShell, from the repo folder:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1          (light)
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -ML      (adds YOLO + embeddings)
param([switch]$ML)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

python -m venv backend\.venv
& backend\.venv\Scripts\python.exe -m pip install --upgrade pip
& backend\.venv\Scripts\pip.exe install -r backend\requirements.txt

if ($ML) {
    & backend\.venv\Scripts\pip.exe install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    & backend\.venv\Scripts\pip.exe install -r backend\requirements-ml.txt
    Push-Location backend
    & .venv\Scripts\python.exe -m app.vision
    & .venv\Scripts\python.exe -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
    Pop-Location
}

if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }

Push-Location frontend
npm install
Pop-Location

Write-Host "`nDone. Put your keys in backend\.env, then run .\dev.ps1" -ForegroundColor Green
