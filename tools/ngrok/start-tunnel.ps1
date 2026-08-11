# Tunnel to local shop (Flask on port 3000)
$ngrok = Join-Path $PSScriptRoot 'ngrok.exe'
if (-not (Test-Path $ngrok)) {
    Write-Error "ngrok.exe not found"
    exit 1
}

$config = Join-Path $env:LOCALAPPDATA 'ngrok\ngrok.yml'
if (-not (Test-Path $config)) {
    Write-Host "Add token first:"
    Write-Host '  .\setup-token.ps1 -Token "YOUR_TOKEN"'
    Write-Host "Token: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
}

Write-Host "Tunnel to http://localhost:3000"
Write-Host "Copy the Forwarding https://... line and open it on another device."
Write-Host "Stop with Ctrl+C`n"
& $ngrok http 3000
