# Chrome Extension (MV3)

## Setup

1. Copy config:
   ```bash
   cp src/config.example.js src/config.js
   ```
2. Fill `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `src/config.js`.
3. Open `chrome://extensions`, enable Developer mode.
4. Click "Load unpacked" and select `apps/extension`.

## Notes

- Google OAuth redirect URL is `chrome.identity.getRedirectURL()`.
- Add that URL to Supabase Google provider redirect allow list.
