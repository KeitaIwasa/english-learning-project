export function requireEnv(name: string): string {
  const value = normalizeEnv(process.env[name]);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return normalizeEnv(process.env[name]) || fallback;
}

function normalizeEnv(value: string | undefined): string {
  return String(value ?? "")
    .replace(/\\n/g, "\n")
    .trim();
}

export const appEnv = {
  geminiApiKey: () => requireEnv("GEMINI_API_KEY"),
  geminiFastModel: () => optionalEnv("GEMINI_FAST_MODEL", "gemini-flash-latest"),
  geminiReasoningModel: () => optionalEnv("GEMINI_REASONING_MODEL", "gemini-pro-latest"),
  geminiTtsModel: () => optionalEnv("GEMINI_TTS_MODEL", "gemini-2.5-pro-preview-tts"),
  geminiTtsSpeaker1Voice: () => optionalEnv("GEMINI_TTS_SPEAKER1_VOICE", "Alnilam"),
  geminiTtsSpeaker2Voice: () => optionalEnv("GEMINI_TTS_SPEAKER2_VOICE", "Leda"),
  googleApplicationCredentialsJson: () => requireEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
  googleSpeechV2Location: () => optionalEnv("GOOGLE_SPEECH_V2_LOCATION", "us"),
  googleSpeechModel: () => optionalEnv("GOOGLE_SPEECH_MODEL", "chirp_3"),
  supabaseUrl: () => requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  cloudTasksProjectId: () => requireEnv("CLOUD_TASKS_PROJECT_ID"),
  cloudTasksLocation: () => requireEnv("CLOUD_TASKS_LOCATION"),
  cloudTasksQueueReading: () => requireEnv("CLOUD_TASKS_QUEUE_READING"),
  cloudTasksQueueSpeechFixer: () => requireEnv("CLOUD_TASKS_QUEUE_SPEECH_FIXER"),
  cloudTasksQueueProfile: () => requireEnv("CLOUD_TASKS_QUEUE_PROFILE"),
  cloudRunReadingWorkerUrl: () => requireEnv("CLOUD_RUN_READING_WORKER_URL"),
  cloudRunSpeechFixerWorkerUrl: () => requireEnv("CLOUD_RUN_SPEECH_FIXER_WORKER_URL"),
  cloudRunProfileWorkerUrl: () => requireEnv("CLOUD_RUN_PROFILE_WORKER_URL"),
  workerSharedSecret: () => requireEnv("WORKER_SHARED_SECRET")
};
