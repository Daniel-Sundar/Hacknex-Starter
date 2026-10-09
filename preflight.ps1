# Pre-flight check before a demo: keys, reading models, servers and saved demo pages. Uses no AI quota.
#   powershell -ExecutionPolicy Bypass -File .\preflight.ps1
#   Options: -- --frontend http://localhost:5174   --demo C:\path\to\pages
$py = Join-Path $PSScriptRoot "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "[FAIL] backend\.venv not found. Run .\setup.ps1 first."
    exit 1
}
& $py (Join-Path $PSScriptRoot "backend\preflight.py") @args
exit $LASTEXITCODE
