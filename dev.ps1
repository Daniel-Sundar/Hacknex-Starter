# Starts backend (:8000) and frontend (:5173) in two new windows.
#   powershell -ExecutionPolicy Bypass -File .\dev.ps1
Set-Location $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm install --no-audit --no-fund; npm run dev"
Start-Sleep -Seconds 5
Start-Process "http://localhost:5173"
