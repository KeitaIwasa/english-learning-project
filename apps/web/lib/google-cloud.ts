import { createHash, createSign } from "node:crypto";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GCS_HOST = "storage.googleapis.com";

export type SpeechDiarizedSpeaker = 1 | 2 | "unknown";
export type SpeechDiarizedTurn = {
  speaker: SpeechDiarizedSpeaker;
  text: string;
};

type SpeechWord = {
  word?: string;
  text?: string;
  speakerLabel?: string | number;
  speakerTag?: string | number;
};

type SpeechAlternative = {
  transcript?: string;
  words?: SpeechWord[];
};

type SpeechResultRow = {
  alternatives?: SpeechAlternative[];
};

export function parseGoogleServiceAccount(rawJson: string): ServiceAccount {
  let source = String(rawJson ?? "").trim();
  while (source.endsWith("\\n")) {
    source = source.slice(0, -2).trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
  } catch {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON");
  }

  const obj = parsed as Partial<ServiceAccount>;
  const clientEmail = String(obj.client_email ?? "").trim();
  const privateKey = String(obj.private_key ?? "").replace(/\\n/g, "\n").trim();
  const tokenUri = String(obj.token_uri ?? GOOGLE_TOKEN_URI).trim() || GOOGLE_TOKEN_URI;
  if (!clientEmail || !privateKey) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON is missing client_email/private_key");
  }

  return {
    client_email: clientEmail,
    private_key: privateKey,
    project_id: obj.project_id,
    token_uri: tokenUri
  };
}

export function getGoogleProjectIdFromServiceAccountJson(rawJson: string): string {
  const account = parseGoogleServiceAccount(rawJson);
  const projectId = String(account.project_id ?? "").trim();
  if (!projectId) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON missing project_id");
  }
  return projectId;
}

export function buildGcsV4SignedPutUrl(params: {
  serviceAccount: ServiceAccount;
  bucket: string;
  objectName: string;
  contentType: string;
  expiresSeconds: number;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const iso = toIsoBasicUtc(now);
  const yyyymmdd = iso.slice(0, 8);
  const scope = `${yyyymmdd}/auto/storage/goog4_request`;
  const credential = `${params.serviceAccount.client_email}/${scope}`;
  const canonicalUri = `/${encodePath(params.bucket)}/${encodePath(params.objectName)}`;

  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": iso,
    "X-Goog-Expires": String(params.expiresSeconds),
    "X-Goog-SignedHeaders": "content-type;host"
  });
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pctEncode(k)}=${pctEncode(v)}`)
    .join("&");

  const canonicalHeaders = `content-type:${params.contentType}\nhost:${GCS_HOST}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "content-type;host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = ["GOOG4-RSA-SHA256", iso, scope, sha256Hex(canonicalRequest)].join("\n");

  const signer = createSign("RSA-SHA256");
  signer.update(stringToSign);
  signer.end();
  const signature = signer.sign(params.serviceAccount.private_key).toString("hex");

  return `https://${GCS_HOST}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

export async function getGoogleAccessToken(params: {
  serviceAccount: ServiceAccount;
  scopes: string[];
}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: params.serviceAccount.client_email,
    scope: params.scopes.join(" "),
    aud: params.serviceAccount.token_uri || GOOGLE_TOKEN_URI,
    iat: now,
    exp: now + 3600
  };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(params.serviceAccount.private_key).toString("base64url");
  const assertion = `${unsigned}.${sig}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const response = await fetch(params.serviceAccount.token_uri || GOOGLE_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) {
    throw new Error(`Google OAuth error: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Google OAuth response missing access_token");
  }
  return json.access_token;
}

export async function checkGcsObjectExists(params: {
  accessToken: string;
  bucket: string;
  objectName: string;
}) {
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(params.bucket)}/o/${encodeURIComponent(params.objectName)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${params.accessToken}` }
    }
  );

  if (response.status === 404) {
    return { exists: false as const };
  }
  if (!response.ok) {
    throw new Error(`GCS metadata check failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { size?: string; contentType?: string };
  return {
    exists: true as const,
    size: Number(json.size ?? 0),
    contentType: json.contentType ?? ""
  };
}

export async function deleteFromGcs(params: {
  accessToken: string;
  bucket: string;
  objectName: string;
}) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(params.bucket)}/o/${encodeURIComponent(params.objectName)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${params.accessToken}`
    }
  });
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    throw new Error(`GCS delete failed: ${response.status} ${await response.text()}`);
  }
}

export async function downloadFromGcs(params: {
  accessToken: string;
  bucket: string;
  objectName: string;
}) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(params.bucket)}/o/${encodeURIComponent(params.objectName)}?alt=media`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error(`GCS download failed: ${response.status} ${await response.text()}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function uploadToGcs(params: {
  accessToken: string;
  bucket: string;
  objectName: string;
  contentType: string;
  body: Uint8Array;
}) {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(params.bucket)}/o?uploadType=media&name=${encodeURIComponent(params.objectName)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": params.contentType
    },
    body: Buffer.from(params.body)
  });
  if (!response.ok) {
    throw new Error(`GCS upload failed: ${response.status} ${await response.text()}`);
  }
}

export async function startSpeechBatchRecognize(params: {
  accessToken: string;
  projectId: string;
  location: string;
  languageCode: string;
  model: string;
  gcsUri: string;
}) {
  const base = `https://${encodeURIComponent(params.location)}-speech.googleapis.com`;
  const path = `/v2/projects/${encodeURIComponent(params.projectId)}/locations/${encodeURIComponent(params.location)}/recognizers/_:batchRecognize`;
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      config: {
        autoDecodingConfig: {},
        languageCodes: [params.languageCode],
        model: params.model,
        features: {
          enableAutomaticPunctuation: true
        }
      },
      files: [{ uri: params.gcsUri }],
      recognitionOutputConfig: {
        inlineResponseConfig: {}
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Speech batchRecognize failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { name?: string };
  if (!json.name) {
    throw new Error("Speech response missing operation name");
  }
  return json.name;
}

export async function getSpeechBatchOperation(params: {
  accessToken: string;
  location: string;
  operationName: string;
}) {
  const operationName = String(params.operationName ?? "").replace(/^\/+/, "");
  const response = await fetch(`https://${encodeURIComponent(params.location)}-speech.googleapis.com/v2/${operationName}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error(`Speech get operation failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as {
    done?: boolean;
    error?: { message?: string };
    response?: {
      results?: Record<
        string,
        {
          transcript?: {
            results?: Array<{
              alternatives?: Array<{
                transcript?: string;
                words?: Array<{
                  word?: string;
                  text?: string;
                  speakerLabel?: string | number;
                  speakerTag?: string | number;
                }>;
              }>;
            }>;
          };
          inlineResult?: {
            transcript?: {
              results?: Array<{
                alternatives?: Array<{
                  transcript?: string;
                  words?: Array<{
                    word?: string;
                    text?: string;
                    speakerLabel?: string | number;
                    speakerTag?: string | number;
                  }>;
                }>;
              }>;
            };
          };
        }
      >;
    };
  };
}

export function extractTranscriptFromSpeechBatchResponse(params: {
  response?: {
    results?: Record<
      string,
      {
        error?: {
          code?: number;
          message?: string;
        };
        transcript?: {
          results?: SpeechResultRow[];
        };
        inlineResult?: {
          transcript?: {
            results?: SpeechResultRow[];
          };
        };
      }
    >;
  };
  gcsUri?: string;
}) {
  const response = params.response ?? {};
  const files = response.results ?? {};
  const target = findSpeechFileResult(files, params.gcsUri);
  const transcriptResults = target?.transcript?.results ?? target?.inlineResult?.transcript?.results ?? [];
  const transcriptData = collectTranscriptResult(transcriptResults);
  const fileErrors: string[] = [];
  for (const fileResult of Object.values(files)) {
    const message = String(fileResult?.error?.message ?? "").trim();
    if (message) {
      fileErrors.push(message);
    }
  }

  return {
    transcript: transcriptData.transcript,
    totalResultCount: transcriptData.totalResultCount,
    nonEmptyResultCount: transcriptData.nonEmptyResultCount,
    emptyResultCount: transcriptData.emptyResultCount,
    turns: transcriptData.turns,
    detectedSpeakerCount: transcriptData.detectedSpeakerCount,
    fileErrors
  };
}

function toIsoBasicUtc(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pctEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodePath(path: string) {
  return path
    .split("/")
    .map((part) => pctEncode(part))
    .join("/");
}

function findSpeechFileResult(
  files: Record<
    string,
    {
      error?: {
        code?: number;
        message?: string;
      };
      transcript?: {
        results?: SpeechResultRow[];
      };
      inlineResult?: {
        transcript?: {
          results?: SpeechResultRow[];
        };
      };
    }
  >,
  gcsUri?: string
) {
  if (gcsUri && files[gcsUri]) {
    return files[gcsUri];
  }
  const firstKey = Object.keys(files)[0];
  return firstKey ? files[firstKey] : undefined;
}

function buildTurnsFromWords(alternative: {
  words?: SpeechWord[];
} | null | undefined): SpeechDiarizedTurn[] {
  const words = Array.isArray(alternative?.words) ? alternative.words : [];
  if (words.length === 0) {
    return [];
  }

  const turns: SpeechDiarizedTurn[] = [];
  let currentSpeaker: SpeechDiarizedSpeaker | null = null;
  let currentText = "";

  const flush = () => {
    const text = currentText.trim();
    if (!text || !currentSpeaker) {
      return;
    }
    pushTurn(turns, { speaker: currentSpeaker, text });
    currentText = "";
  };

  for (const row of words) {
    const token = String(row?.word ?? row?.text ?? "").trim();
    if (!token) {
      continue;
    }
    const speaker = normalizeSpeakerId(row?.speakerLabel ?? row?.speakerTag);
    if (currentSpeaker === null) {
      currentSpeaker = speaker;
    } else if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    currentText = appendToken(currentText, token);
  }
  flush();
  return turns;
}

function collectTranscriptResult(results: SpeechResultRow[]) {
  let emptyResultCount = 0;
  const lines: string[] = [];
  const turns: SpeechDiarizedTurn[] = [];
  for (const row of results) {
    const firstAlt = row.alternatives?.[0];
    const transcript = firstAlt?.transcript?.trim() ?? "";
    if (!transcript) {
      emptyResultCount += 1;
      continue;
    }
    lines.push(transcript);
    const rowTurns = buildTurnsFromWords(firstAlt);
    if (rowTurns.length > 0) {
      for (const turn of rowTurns) {
        pushTurn(turns, turn);
      }
      continue;
    }
    pushTurn(turns, { speaker: "unknown", text: transcript });
  }

  const detectedSpeakerSet = new Set<SpeechDiarizedSpeaker>();
  for (const turn of turns) {
    detectedSpeakerSet.add(turn.speaker);
  }

  return {
    transcript: lines.join("\n").trim(),
    totalResultCount: results.length,
    nonEmptyResultCount: lines.length,
    emptyResultCount,
    turns,
    detectedSpeakerCount: detectedSpeakerSet.size
  };
}

function normalizeSpeakerId(value: unknown): SpeechDiarizedSpeaker {
  const text = String(value ?? "").trim();
  if (!text) {
    return "unknown";
  }
  const num = Number(text);
  if (!Number.isFinite(num)) {
    return "unknown";
  }
  if (num === 1) {
    return 1;
  }
  if (num === 2) {
    return 2;
  }
  return "unknown";
}

function pushTurn(turns: SpeechDiarizedTurn[], turn: SpeechDiarizedTurn) {
  const text = String(turn.text ?? "").trim();
  if (!text) {
    return;
  }
  const last = turns[turns.length - 1];
  if (last && last.speaker === turn.speaker) {
    last.text = `${last.text} ${text}`.replace(/\s+/g, " ").trim();
    return;
  }
  turns.push({ speaker: turn.speaker, text });
}

function appendToken(current: string, token: string) {
  if (!current) {
    return token;
  }
  if (/^[,.;:!?)]/.test(token)) {
    return `${current}${token}`;
  }
  if (/^['’]/.test(token)) {
    return `${current}${token}`;
  }
  return `${current} ${token}`;
}
