# Playwright Auth Setup (WSL + Windows Chrome)

## 1) Start Chrome on Windows with CDP

Run this in Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows/start-chrome-cdp.ps1
```

## 2) Save auth state from WSL

```bash
npm run test:e2e:setup-auth
```

- The script connects to `http://127.0.0.1:9222`.
- It opens `http://localhost:3000`.
- Complete Google login in the opened Windows Chrome window.
- Press Enter in the terminal to save `tests/.auth/user.json`.

## 3) Run authenticated tests

```bash
npm run test:e2e:auth
```

## Troubleshooting (WSL cannot connect to CDP)

If `npm run test:e2e:setup-auth` fails with `ECONNREFUSED`:

1. Check listener on Windows:
   ```powershell
   Get-NetTCPConnection -LocalPort 9222 -State Listen
   ```
2. If `LocalAddress` is `127.0.0.1`, WSL may not reach it. Close all Chrome processes and restart:
   ```powershell
   Get-Process chrome | Stop-Process -Force
   powershell -ExecutionPolicy Bypass -File scripts/windows/start-chrome-cdp.ps1
   ```
3. Retry from WSL:
   ```bash
   npm run test:e2e:setup-auth
   ```
