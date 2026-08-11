# Add ngrok authtoken (run once after signup at ngrok.com)
param(
    [Parameter(Mandatory = $true)]
    [string]$Token
)

$ngrok = Join-Path $PSScriptRoot 'ngrok.exe'
if (-not (Test-Path $ngrok)) {
    Write-Error "ngrok.exe not found in $PSScriptRoot"
    exit 1
}

$Token = $Token.Trim()
if ($Token.Length -lt 20) {
    Write-Error "Token too short. Copy the full token from https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
}

& $ngrok config add-authtoken $Token
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Config check:"
& $ngrok config check
Write-Host ""
Write-Host "Done. Start tunnel with:"
Write-Host "  .\start-tunnel.ps1"
