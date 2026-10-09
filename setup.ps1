# One-shot setup for Windows. In PowerShell, from the repo folder:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

python -m venv backend\.venv
& backend\.venv\Scripts\python.exe -m pip install --upgrade pip
& backend\.venv\Scripts\pip.exe install -r backend\requirements.txt

if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }

Push-Location frontend
npm install
Pop-Location

Write-Host "`nDone. Put your keys in backend\.env, then run .\dev.ps1" -ForegroundColor Green
