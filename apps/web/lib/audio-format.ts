type AudioPayload = {
  audioBase64: string;
  mimeType: string;
};

export function normalizeAudioForPlayback(payload: AudioPayload): AudioPayload {
  const mimeType = String(payload.mimeType ?? "").trim();
  const audioBase64 = String(payload.audioBase64 ?? "").trim();
  if (!mimeType || !audioBase64) {
    return { audioBase64, mimeType };
  }

  if (!isPcmMimeType(mimeType)) {
    return { audioBase64, mimeType };
  }

  const pcmBytes = Buffer.from(audioBase64, "base64");
  if (pcmBytes.length === 0) {
    return { audioBase64, mimeType };
  }

  // Gemini TTS sometimes returns raw PCM (audio/L16). Wrap it as WAV for browser playback.
  const sampleRate = parseMimeIntParam(mimeType, "rate", 24000);
  const channels = parseMimeIntParam(mimeType, "channels", 1);
  const wavBytes = buildPcm16Wav({
    pcmBytes,
    sampleRate,
    channels
  });

  return {
    audioBase64: wavBytes.toString("base64"),
    mimeType: "audio/wav"
  };
}

function isPcmMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("audio/l16") || normalized.includes("codec=pcm") || normalized.includes("audio/pcm");
}

function parseMimeIntParam(mimeType: string, name: string, fallback: number): number {
  const matched = mimeType.match(new RegExp(`${name}=([0-9]+)`, "i"));
  if (!matched) {
    return fallback;
  }
  const value = Number(matched[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function buildPcm16Wav(params: {
  pcmBytes: Buffer;
  sampleRate: number;
  channels: number;
}) {
  const bitsPerSample = 16;
  const blockAlign = params.channels * (bitsPerSample / 8);
  const byteRate = params.sampleRate * blockAlign;
  const dataSize = params.pcmBytes.length;
  const wav = Buffer.alloc(44 + dataSize);

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16); // PCM format chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(params.channels, 22);
  wav.writeUInt32LE(params.sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  params.pcmBytes.copy(wav, 44);

  return wav;
}
