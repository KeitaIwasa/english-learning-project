$chromePath = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$profileDir = "$env:LOCALAPPDATA\ChromePWProfile"
$port = 9222

if (!(Test-Path $chromePath)) {
  Write-Error "Chrome not found: $chromePath"
  exit 1
}

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-port=$port",
  "--user-data-dir=$profileDir"
)

Write-Host "Started Chrome with CDP on port $port"
Write-Host "Profile: $profileDir"
