export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const appEnv = {
  geminiApiKey: () => requireEnv("GEMINI_API_KEY"),
  geminiFastModel: () => Deno.env.get("GEMINI_FAST_MODEL") ?? "gemini-flash-latest",
  geminiReasoningModel: () => Deno.env.get("GEMINI_REASONING_MODEL") ?? "gemini-pro-latest",
  geminiTtsModel: () => Deno.env.get("GEMINI_TTS_MODEL") ?? "gemini-2.5-pro-preview-tts",
  geminiTtsVoice: () => Deno.env.get("GEMINI_TTS_VOICE") ?? "Kore",
  geminiTtsSpeaker1Name: () => Deno.env.get("GEMINI_TTS_SPEAKER1_NAME") ?? "Keita",
  geminiTtsSpeaker1Voice: () => Deno.env.get("GEMINI_TTS_SPEAKER1_VOICE") ?? "Alnilam",
  geminiTtsSpeaker2Name: () => Deno.env.get("GEMINI_TTS_SPEAKER2_NAME") ?? "May",
  geminiTtsSpeaker2Voice: () => Deno.env.get("GEMINI_TTS_SPEAKER2_VOICE") ?? "Leda",
  googleApplicationCredentialsJson: () => requireEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
  googleSpeechV2Location: () => Deno.env.get("GOOGLE_SPEECH_V2_LOCATION") ?? "us",
  googleSpeechModel: () => Deno.env.get("GOOGLE_SPEECH_MODEL") ?? "chirp_3",
  googleCloudTempBucket: () => requireEnv("GCS_TEMP_BUCKET").replace(/\\n/g, "").replace(/\n/g, "").trim(),
  supabaseUrl: () => requireEnv("SUPABASE_URL"),
  supabaseAnonKey: () => requireEnv("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY")
};
