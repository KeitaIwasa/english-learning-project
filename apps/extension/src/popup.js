import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

const enInput = document.getElementById("enInput");
const jaInput = document.getElementById("jaInput");
const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");
const saveBtn = document.getElementById("saveBtn");

init();

loginBtn.addEventListener("click", loginWithGoogle);
saveBtn.addEventListener("click", addFlashcard);

async function init() {
  const { selectedEnglish } = await chrome.storage.local.get("selectedEnglish");
  if (selectedEnglish) {
    enInput.value = selectedEnglish;
  }

  const { accessToken } = await chrome.storage.local.get("accessToken");
  statusEl.textContent = accessToken ? "ログイン済み" : "未ログイン";
}

async function loginWithGoogle() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  authUrl.searchParams.set("provider", "google");
  authUrl.searchParams.set("redirect_to", redirectUrl);
  authUrl.searchParams.set("scopes", "openid email profile");

  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true
  });

  if (!callbackUrl) {
    statusEl.textContent = "ログインに失敗しました";
    return;
  }

  const fragment = new URL(callbackUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(fragment);
  const accessToken = params.get("access_token");

  if (!accessToken) {
    statusEl.textContent = "トークン取得に失敗しました";
    return;
  }

  await chrome.storage.local.set({ accessToken });
  statusEl.textContent = "ログイン完了";
}

async function addFlashcard() {
  const en = enInput.value.trim();
  const ja = jaInput.value.trim();

  if (!en) {
    statusEl.textContent = "English は必須です";
    return;
  }

  const { accessToken } = await chrome.storage.local.get("accessToken");
  if (!accessToken) {
    statusEl.textContent = "先にGoogleログインしてください";
    return;
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/flashcards-add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY
    },
    body: JSON.stringify({
      en,
      ja: ja || undefined,
      source: "extension"
    })
  });

  if (!response.ok) {
    const text = await response.text();
    statusEl.textContent = `追加失敗: ${text}`;
    return;
  }

  statusEl.textContent = "追加しました";
  jaInput.value = "";
}
