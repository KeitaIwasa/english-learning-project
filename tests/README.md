# Playwright Auth Setup (WSL + Windows Chrome)

## 1) Start Chrome on Windows with CDP

Run this in Windows PowerShell:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:LOCALAPPDATA\ChromePWProfile"
```

Run relay in Windows Command Prompt:

```cmd
cd /d "C:\Program Files (x86)\Nmap"
ncat.exe --listen --keep-open --sh-exec "relay9222.bat" 9223
```

## 2) Save auth state from WSL

```bash
npm run test:e2e:setup-auth
```

- The script first connects to `http://<WIN_HOST>:9223` (`WIN_HOST=$(ip route | awk '/default/ {print $3}')`).
- It opens `http://localhost:3000`.
- Complete Google login in the opened Windows Chrome window.
- Press Enter in the terminal to save `tests/.auth/user.json`.

## 3) Run authenticated tests

```bash
npm run test:e2e:auth
```

## Troubleshooting (WSL cannot connect to CDP)

If `npm run test:e2e:setup-auth` fails with `ECONNREFUSED`:

1. Check relay from WSL:
   ```bash
   WIN_HOST=$(ip route | awk '/default/ {print $3}')
   curl -v "http://$WIN_HOST:9223/json/version"
   ```
2. If it fails, restart both Chrome and ncat relay on Windows.
3. Retry from WSL:
   ```bash
   npm run test:e2e:setup-auth
   ```
