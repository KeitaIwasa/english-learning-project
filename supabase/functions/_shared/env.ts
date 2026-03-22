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
  geminiTtsSpeaker1Name: () => Deno.env.get("GEMINI_TTS_SPEAKER1_NAME") ?? "Zephyr",
  geminiTtsSpeaker1Voice: () => Deno.env.get("GEMINI_TTS_SPEAKER1_VOICE") ?? "Kore",
  geminiTtsSpeaker2Name: () => Deno.env.get("GEMINI_TTS_SPEAKER2_NAME") ?? "Orus",
  geminiTtsSpeaker2Voice: () => Deno.env.get("GEMINI_TTS_SPEAKER2_VOICE") ?? "Puck",
  googleApplicationCredentialsJson: () => requireEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
  googleSpeechV2Location: () => Deno.env.get("GOOGLE_SPEECH_V2_LOCATION") ?? "us",
  googleSpeechModel: () => Deno.env.get("GOOGLE_SPEECH_MODEL") ?? "chirp_3",
  googleCloudTempBucket: () => requireEnv("GCS_TEMP_BUCKET").replace(/\\n/g, "").replace(/\n/g, "").trim(),
  supabaseUrl: () => requireEnv("SUPABASE_URL"),
  supabaseAnonKey: () => requireEnv("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY")
};
