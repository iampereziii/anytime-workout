# start.ps1 — One-command LAN start for Any Time Workout (Windows).
# Ensures the Windows Firewall allows the port (one-time UAC prompt), then
# builds the Next.js app and runs the production server bound to all
# interfaces. Open the printed Network URL on your phone (same Wi-Fi).
#
# Run with:  npm run start:lan      (or)      powershell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# --- Resolve the port (PORT in .env.local, else 3000) ---
$port = 3000
if (Test-Path .env.local) {
  $match = Select-String -Path .env.local -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($match) { $port = [int]$match.Matches[0].Groups[1].Value }
}

# --- Ensure an inbound firewall rule exists for this port ---
$ruleName = "Any Time Workout ($port)"
$exists = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $exists) {
  Write-Host "Adding Windows Firewall rule '$ruleName' (you may see a UAC prompt)..." -ForegroundColor Cyan
  $cmd = "New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private,Domain | Out-Null"
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $cmd
    Write-Host "Firewall rule in place." -ForegroundColor Green
  } catch {
    Write-Warning "Skipped firewall rule (UAC declined). Phone access may be blocked until you add it manually:"
    Write-Host "  New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private"
  }
} else {
  Write-Host "Firewall rule '$ruleName' already present." -ForegroundColor Green
}

# --- Build the app, then run the production server bound to 0.0.0.0 ---
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Write-Host ""
Write-Host "Starting Any Time Workout on port $port - open http://<this-PC's-LAN-IP>:$port on your phone." -ForegroundColor Cyan
Write-Host ""
npm start -- -H 0.0.0.0 -p $port
