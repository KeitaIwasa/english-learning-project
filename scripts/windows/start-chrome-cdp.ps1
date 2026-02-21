$chromePath = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$profileDir = "$env:LOCALAPPDATA\ChromePWProfile"
$port = 9222

if (!(Test-Path $chromePath)) {
  Write-Error "Chrome not found: $chromePath"
  exit 1
}

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-address=0.0.0.0",
  "--remote-debugging-port=$port",
  "--user-data-dir=$profileDir"
)

Write-Host "Started Chrome with CDP on port $port"
Write-Host "Profile: $profileDir"

Start-Sleep -Seconds 1
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Host "Listening: $($listener.LocalAddress):$port"
  if ($listener.LocalAddress -eq "127.0.0.1") {
    Write-Warning "CDP is bound to 127.0.0.1. WSL may not be able to connect."
    Write-Warning "If WSL setup fails, close all Chrome processes and run this script again."
  }
}
