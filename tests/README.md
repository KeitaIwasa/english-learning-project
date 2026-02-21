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
