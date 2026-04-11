import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { normalizeAudioForPlayback } from "@/lib/audio-format";
import { getAudioDurationSeconds, resolveFfmpegTools } from "@/lib/audio-chunking";

const execFile = promisify(execFileCallback);

export async function buildLineAudioFile(params: {
  audioBase64: string;
  mimeType: string;
}) {
  const normalized = normalizeAudioForPlayback({
    audioBase64: params.audioBase64,
    mimeType: params.mimeType
  });
  if (!normalized.audioBase64) {
    throw new Error("Audio payload is empty");
  }

  const { ffmpegPath } = resolveFfmpegTools();
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary path missing");
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "line-audio-"));
  const inputPath = join(tempRoot, `source${resolveInputExtension(normalized.mimeType)}`);
  const outputPath = join(tempRoot, "reading.mp3");

  try {
    await writeFile(inputPath, Buffer.from(normalized.audioBase64, "base64"));
    await execFile(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-sn",
      "-dn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath
    ]);

    const [bytes, durationSec] = await Promise.all([readFile(outputPath), getAudioDurationSeconds(outputPath)]);
    return {
      bytes: new Uint8Array(bytes),
      contentType: "audio/mpeg",
      fileName: "reading.mp3",
      durationMs: Math.max(1, Math.round(durationSec * 1000))
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function resolveInputExtension(mimeType: string) {
  const normalized = String(mimeType ?? "").trim().toLowerCase();
  if (normalized.includes("wav")) {
    return ".wav";
  }
  if (normalized.includes("aac")) {
    return ".aac";
  }
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return ".m4a";
  }
  const ext = extname(normalized);
  if (ext) {
    return ext;
  }
  return ".mp3";
}
