# Playwright Auth Setup

`chromium-auth` プロジェクトは、実行前に `tests/global-setup-auth.ts` で毎回認証状態を再生成します。  
Google ログイン状態や既存 `tests/.auth/user.json` の有効期限には依存しません。

## 必要な環境変数

通常は `apps/web/.env.local` が使われます。

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 実行方法

認証が不要なテスト:

```bash
npm run test:e2e
```

認証が必要なテスト:

```bash
npm run test:e2e:auth
```

## 任意の上書き設定

- `PLAYWRIGHT_AUTH_EMAIL_BASE` (default: `e2e-user`)
- `PLAYWRIGHT_AUTH_EMAIL_DOMAIN` (default: `example.com`)
- `PLAYWRIGHT_AUTH_PASSWORD` (default: ランダム)

例:

```bash
PLAYWRIGHT_AUTH_EMAIL_DOMAIN=example.org npm run test:e2e:auth
```
