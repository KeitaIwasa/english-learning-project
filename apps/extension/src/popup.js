import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

const enInput = document.getElementById("enInput");
const jaInput = document.getElementById("jaInput");
const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");
const saveBtn = document.getElementById("saveBtn");
const formArea = document.getElementById("formArea");

init();

loginBtn.addEventListener("click", loginWithGoogle);
saveBtn.addEventListener("click", addFlashcard);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.hasOwn(changes, "accessToken")) {
    applyAuthState(Boolean(changes.accessToken?.newValue));
  }
});

async function init() {
  const { selectedEnglish } = await chrome.storage.local.get("selectedEnglish");
  if (selectedEnglish) {
    enInput.value = selectedEnglish;
  }

  const { accessToken } = await chrome.storage.local.get("accessToken");
  applyAuthState(Boolean(accessToken));
}

async function loginWithGoogle() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  authUrl.searchParams.set("provider", "google");
  authUrl.searchParams.set("redirect_to", redirectUrl);
  authUrl.searchParams.set("scopes", "openid email profile");

  let callbackUrl;
  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    });
  } catch (error) {
    const message = typeof error?.message === "string" ? error.message : String(error);
    statusEl.textContent = `ログイン失敗: SupabaseのRedirect URLsに ${redirectUrl} を追加してください (${message})`;
    return;
  }

  if (!callbackUrl) {
    statusEl.textContent = "ログインに失敗しました";
    return;
  }

  if (!callbackUrl.startsWith(redirectUrl)) {
    statusEl.textContent = `ログイン失敗: 想定外のリダイレクト先です。Supabaseに ${redirectUrl} を許可してください`;
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
  applyAuthState(true);
  statusEl.textContent = "";
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
    applyAuthState(false);
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
    if (response.status === 401) {
      await chrome.storage.local.remove("accessToken");
      applyAuthState(false);
    }
    const text = await response.text();
    statusEl.textContent = `追加失敗: ${text}`;
    return;
  }

  statusEl.textContent = "追加しました";
  jaInput.value = "";
}

function applyAuthState(isLoggedIn) {
  if (isLoggedIn) {
    loginBtn.hidden = true;
    loginBtn.classList.add("force-hidden");
    loginBtn.style.display = "none";
    formArea.hidden = false;
    formArea.classList.remove("force-hidden");
    formArea.style.display = "block";
  } else {
    loginBtn.hidden = false;
    loginBtn.classList.remove("force-hidden");
    loginBtn.style.display = "block";
    formArea.hidden = true;
    formArea.classList.add("force-hidden");
    formArea.style.display = "none";
  }
  // Keep status area for actionable messages only (errors/success on add).
  statusEl.textContent = "";
}
