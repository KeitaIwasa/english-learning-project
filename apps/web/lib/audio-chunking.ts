import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const DEFAULT_CHUNK_DURATION_SEC = 15 * 60;

export async function ensureFfmpegAvailable() {
  const { ffmpegPath, ffprobePath } = resolveFfmpegTools();
  if (!ffmpegPath || !ffprobePath) {
    throw new Error("ffmpeg-static or ffprobe-static binary path missing");
  }
  await execFile(ffmpegPath, ["-version"]);
  await execFile(ffprobePath, ["-version"]);
}

export async function getAudioDurationSeconds(inputPath: string) {
  const { ffprobePath } = resolveFfmpegTools();
  const { stdout } = await execFile(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath
  ]);
  const duration = Number.parseFloat(String(stdout ?? "").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Unable to detect audio duration: ${inputPath}`);
  }
  return duration;
}

export async function splitAudioBufferIntoChunks(params: {
  inputBuffer: Uint8Array;
  sourceFileName: string;
  chunkDurationSec?: number;
}) {
  const { ffmpegPath } = resolveFfmpegTools();
  const chunkDurationSec = Math.max(60, Math.floor(params.chunkDurationSec ?? DEFAULT_CHUNK_DURATION_SEC));
  const tempRoot = await mkdtemp(join(tmpdir(), "speech-fixer-"));
  const sourceExt = normalizeExtension(params.sourceFileName);
  const inputPath = join(tempRoot, `source${sourceExt}`);
  const outputPattern = join(tempRoot, `chunk-%03d${sourceExt}`);

  try {
    await writeFile(inputPath, params.inputBuffer);
    const durationSec = await getAudioDurationSeconds(inputPath);
    if (durationSec <= chunkDurationSec) {
      return {
        durationSec,
        chunkDurationSec,
        needsChunking: false,
        chunks: [
          {
            index: 0,
            fileName: `chunk-000${sourceExt}`,
            contentType: inferContentType(sourceExt),
            data: params.inputBuffer
          }
        ]
      };
    }

    await execFile(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-f",
      "segment",
      "-segment_time",
      String(chunkDurationSec),
      "-c:a",
      "libmp3lame",
      "-b:a",
      "160k",
      "-reset_timestamps",
      "1",
      "-write_xing",
      "0",
      outputPattern
    ]);

    const names = (await readdir(tempRoot))
      .filter((name) => /^chunk-\d{3}/.test(name))
      .sort((a, b) => a.localeCompare(b));

    if (names.length === 0) {
      throw new Error("ffmpeg did not produce any audio chunks");
    }

    const chunks = await Promise.all(
      names.map(async (name, index) => ({
        index,
        fileName: name,
        contentType: inferContentType(sourceExt),
        data: new Uint8Array(await readFile(join(tempRoot, name)))
      }))
    );

    return {
      durationSec,
      chunkDurationSec,
      needsChunking: true,
      chunks
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function resolveFfmpegTools() {
  const ffmpegPath = resolveBinaryPath([
    join("node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
  ]);
  const ffprobePath = resolveBinaryPath([
    join(
      "node_modules",
      "ffprobe-static",
      "bin",
      process.platform,
      process.arch,
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
    )
  ]);

  return {
    ffmpegPath,
    ffprobePath
  };
}

function resolveBinaryPath(relativePaths: string[]) {
  const cwd = process.cwd();
  const roots = [cwd, resolve(cwd, ".."), resolve(cwd, "..", "..")];

  for (const root of roots) {
    for (const relativePath of relativePaths) {
      const candidate = join(root, relativePath);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function normalizeExtension(fileName: string) {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".mp3" || ext === ".wav" || ext === ".m4a" || ext === ".aac") {
    return ext;
  }
  return ".mp3";
}

function inferContentType(extension: string) {
  if (extension === ".wav") {
    return "audio/wav";
  }
  if (extension === ".m4a") {
    return "audio/mp4";
  }
  if (extension === ".aac") {
    return "audio/aac";
  }
  return "audio/mpeg";
}
