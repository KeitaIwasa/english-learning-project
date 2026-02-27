import fs from "node:fs/promises";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const AUTH_FILE = path.resolve("tests/.auth/user.json");
const ENV_FILE = path.resolve("apps/web/.env.local");

export default async function globalSetup(config: FullConfig) {
  const runsAuthProject = config.projects.some((project) => project.name === "chromium-auth");
  if (!runsAuthProject) {
    return;
  }

  await loadEnvFromFile(ENV_FILE);

  const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseAnonKey = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const baseURL = resolveBaseUrl(config);
  const redirectTo = new URL("/auth/callback", baseURL).toString();
  const host = new URL(baseURL).hostname;

  const emailBase = process.env.PLAYWRIGHT_AUTH_EMAIL_BASE ?? "e2e-user";
  const emailDomain = process.env.PLAYWRIGHT_AUTH_EMAIL_DOMAIN ?? "example.com";
  const uniqueTag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${emailBase}+${uniqueTag}@${emailDomain}`;
  const password = process.env.PLAYWRIGHT_AUTH_PASSWORD ?? `P4ss-${Math.random().toString(36).slice(2)}-Aa1!`;

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { redirectTo }
  });

  if (linkError || !linkData?.properties?.action_link) {
    throw new Error(`Failed to generate auth link for E2E: ${linkError?.message ?? "unknown error"}`);
  }

  const cookieStore: Array<{
    name: string;
    value: string;
    options?: {
      path?: string;
      maxAge?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "lax" | "strict" | "none";
    };
  }> = [];

  const serverClient = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.map((cookie) => ({ name: cookie.name, value: cookie.value }));
      },
      setAll(cookiesToSet) {
        for (const nextCookie of cookiesToSet) {
          const idx = cookieStore.findIndex((current) => current.name === nextCookie.name);
          if (idx >= 0) {
            cookieStore[idx] = { ...cookieStore[idx], ...nextCookie };
          } else {
            cookieStore.push(nextCookie);
          }
        }
      }
    }
  });

  const { error: verifyError } = await serverClient.auth.verifyOtp({
    type: linkData.properties.verification_type,
    token_hash: linkData.properties.hashed_token
  });
  if (verifyError) {
    throw new Error(`Failed to verify E2E auth token: ${verifyError.message}`);
  }

  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  const state = {
    cookies: cookieStore.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: host,
      path: cookie.options?.path ?? "/",
      expires: cookie.options?.maxAge ? Math.floor(Date.now() / 1000) + cookie.options.maxAge : -1,
      httpOnly: cookie.options?.httpOnly ?? false,
      secure: cookie.options?.secure ?? false,
      sameSite: mapSameSite(cookie.options?.sameSite)
    })),
    origins: []
  };
  await fs.writeFile(AUTH_FILE, JSON.stringify(state, null, 2));
}

async function loadEnvFromFile(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const idx = trimmed.indexOf("=");
      if (idx <= 0) {
        continue;
      }
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore missing env file; process env may already be configured.
  }
}

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for playwright auth setup`);
  }
  return value;
}

function resolveBaseUrl(config: FullConfig) {
  const fromProject = config.projects.find((project) => project.name === "chromium-auth")?.use.baseURL;
  if (typeof fromProject === "string" && fromProject.length > 0) {
    return fromProject;
  }
  return "http://localhost:3000";
}

function mapSameSite(value?: "lax" | "strict" | "none"): "Lax" | "Strict" | "None" {
  if (value === "strict") {
    return "Strict";
  }
  if (value === "none") {
    return "None";
  }
  return "Lax";
}
