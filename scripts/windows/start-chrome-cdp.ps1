$chromePath = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$profileDir = "$env:LOCALAPPDATA\ChromePWProfile"
$port = 9222
$relayPort = 9223
$ncatDir = "${env:ProgramFiles(x86)}\Nmap"
$ncatPath = Join-Path $ncatDir "ncat.exe"

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

if (!(Test-Path $ncatPath)) {
  Write-Warning "ncat not found: $ncatPath"
  Write-Warning "Install Nmap and run: ncat.exe --listen --keep-open --sh-exec relay9222.bat 9223"
  exit 0
}

if (!(Test-Path (Join-Path $ncatDir "relay9222.bat"))) {
  Write-Warning "relay9222.bat not found in $ncatDir"
  Write-Warning "Create it once with: @echo off && \"%~dp0ncat.exe\" 127.0.0.1 9222"
  exit 0
}

Start-Process -FilePath "cmd.exe" -ArgumentList @(
  "/c",
  "cd /d `"$ncatDir`" && ncat.exe --listen --keep-open --sh-exec `"relay9222.bat`" $relayPort"
)

Write-Host "Started ncat relay on port $relayPort -> 127.0.0.1:$port"
