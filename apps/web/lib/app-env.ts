export function requireEnv(name: string): string {
  const value = normalizeEnv(process.env[name]);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function requireRawEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
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
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

export function normalizeQueueNameEnv(value: string | undefined): string {
  const normalized = normalizeEnv(value);
  if (!normalized) {
    return "";
  }
  // Keep only the first logical line to guard against accidental trailing newline payloads.
  return normalized.split(/\r?\n/)[0]?.trim() ?? "";
}

function requireQueueEnv(name: string): string {
  const value = normalizeQueueNameEnv(process.env[name]);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const appEnv = {
  geminiApiKey: () => requireEnv("GEMINI_API_KEY"),
  geminiFastModel: () => optionalEnv("GEMINI_FAST_MODEL", "gemini-flash-latest"),
  geminiReasoningModel: () => optionalEnv("GEMINI_REASONING_MODEL", "gemini-pro-latest"),
  geminiTtsModel: () => optionalEnv("GEMINI_TTS_MODEL", "gemini-2.5-pro-preview-tts"),
  geminiTtsSpeaker1Voice: () => optionalEnv("GEMINI_TTS_SPEAKER1_VOICE", "Alnilam"),
  geminiTtsSpeaker2Voice: () => optionalEnv("GEMINI_TTS_SPEAKER2_VOICE", "Leda"),
  googleApplicationCredentialsJson: () => requireRawEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
  googleSpeechV2Location: () => optionalEnv("GOOGLE_SPEECH_V2_LOCATION", "us"),
  googleSpeechModel: () => optionalEnv("GOOGLE_SPEECH_MODEL", "chirp_3"),
  supabaseUrl: () => requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  cloudTasksProjectId: () => requireEnv("CLOUD_TASKS_PROJECT_ID"),
  cloudTasksLocation: () => requireEnv("CLOUD_TASKS_LOCATION"),
  cloudTasksQueueReading: () => requireQueueEnv("CLOUD_TASKS_QUEUE_READING"),
  cloudTasksQueueSpeechFixer: () => requireQueueEnv("CLOUD_TASKS_QUEUE_SPEECH_FIXER"),
  cloudTasksQueueProfile: () => requireQueueEnv("CLOUD_TASKS_QUEUE_PROFILE"),
  cloudTasksQueueLineDelivery: () => requireQueueEnv("CLOUD_TASKS_QUEUE_LINE_DELIVERY"),
  cloudRunReadingWorkerUrl: () => requireEnv("CLOUD_RUN_READING_WORKER_URL"),
  cloudRunSpeechFixerWorkerUrl: () => requireEnv("CLOUD_RUN_SPEECH_FIXER_WORKER_URL"),
  cloudRunProfileWorkerUrl: () => requireEnv("CLOUD_RUN_PROFILE_WORKER_URL"),
  cloudRunLineDeliveryWorkerUrl: () => requireEnv("CLOUD_RUN_LINE_DELIVERY_WORKER_URL"),
  workerSharedSecret: () => requireEnv("WORKER_SHARED_SECRET"),
  lineChannelAccessToken: () => requireEnv("LINE_CHANNEL_ACCESS_TOKEN"),
  lineChannelSecret: () => requireEnv("LINE_CHANNEL_SECRET"),
  lineAudioGcsBucket: () => requireEnv("LINE_AUDIO_GCS_BUCKET")
};
