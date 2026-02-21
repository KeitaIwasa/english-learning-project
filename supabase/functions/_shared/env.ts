export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const appEnv = {
  geminiApiKey: () => requireEnv("GEMINI_API_KEY"),
  geminiFastModel: () => Deno.env.get("GEMINI_FAST_MODEL") ?? "gemini-2.5-flash",
  geminiReasoningModel: () => Deno.env.get("GEMINI_REASONING_MODEL") ?? "gemini-2.5-pro",
  geminiTtsModel: () => Deno.env.get("GEMINI_TTS_MODEL") ?? "gemini-2.5-flash-preview-tts",
  geminiTtsVoice: () => Deno.env.get("GEMINI_TTS_VOICE") ?? "Kore",
  supabaseUrl: () => requireEnv("SUPABASE_URL"),
  supabaseAnonKey: () => requireEnv("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY")
};
