type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";

function base64UrlEncode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function textToBase64Url(value: string) {
  return base64UrlEncode(new TextEncoder().encode(value));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function parseServiceAccount(raw: string): ServiceAccount {
  let source = String(raw ?? "").trim();
  while (source.endsWith("\\n")) {
    source = source.slice(0, -2).trim();
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(source);
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
  } catch {
    throw new Error("Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON");
  }
  const obj = parsed as Partial<ServiceAccount>;
  if (!obj.client_email || !obj.private_key) {
    throw new Error("Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON");
  }
  return {
    client_email: obj.client_email,
    private_key: obj.private_key.replace(/\\n/g, "\n"),
    project_id: obj.project_id,
    token_uri: obj.token_uri || TOKEN_AUDIENCE
  };
}

async function createJwtAssertion(params: {
  serviceAccount: ServiceAccount;
  scope: string;
}) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: params.serviceAccount.client_email,
    scope: params.scope,
    aud: params.serviceAccount.token_uri || TOKEN_AUDIENCE,
    iat,
    exp
  };

  const unsignedToken = `${textToBase64Url(JSON.stringify(header))}.${textToBase64Url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(params.serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsignedToken));
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${unsignedToken}.${signatureB64}`;
}

export async function getGoogleAccessToken(params: {
  serviceAccountJson: string;
  scopes: string[];
}) {
  const serviceAccount = parseServiceAccount(params.serviceAccountJson);
  const assertion = await createJwtAssertion({
    serviceAccount,
    scope: params.scopes.join(" ")
  });
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });

  const response = await fetch(serviceAccount.token_uri || TOKEN_AUDIENCE, {
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

export async function uploadToGcs(params: {
  accessToken: string;
  bucket: string;
  objectName: string;
  contentType: string;
  bytes: Uint8Array;
}) {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(params.bucket)}/o?uploadType=media&name=${encodeURIComponent(params.objectName)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": params.contentType
    },
    body: params.bytes
  });
  if (!response.ok) {
    throw new Error(`GCS upload failed: ${response.status} ${await response.text()}`);
  }
  return `gs://${params.bucket}/${params.objectName}`;
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

export function getGoogleProjectIdFromServiceAccountJson(serviceAccountJson: string) {
  const serviceAccount = parseServiceAccount(serviceAccountJson);
  const projectId = String(serviceAccount.project_id ?? "").trim();
  if (!projectId) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON missing project_id");
  }
  return projectId;
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
          enableAutomaticPunctuation: true,
          diarizationConfig: {}
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

export type SpeechDiarizedSpeaker = 1 | 2 | "unknown";
export type SpeechDiarizedTurn = {
  speaker: SpeechDiarizedSpeaker;
  text: string;
};

export function extractTranscriptFromSpeechBatchResponse(params: {
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
  gcsUri?: string;
}) {
  const response = params.response ?? {};
  const files = response.results ?? {};
  const target = findSpeechFileResult(files, params.gcsUri);
  const transcriptResults = target?.transcript?.results ?? target?.inlineResult?.transcript?.results ?? [];

  let emptyResultCount = 0;
  const lines: string[] = [];
  const turns: SpeechDiarizedTurn[] = [];
  for (const row of transcriptResults) {
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
    totalResultCount: transcriptResults.length,
    nonEmptyResultCount: lines.length,
    emptyResultCount,
    turns,
    detectedSpeakerCount: detectedSpeakerSet.size
  };
}

function findSpeechFileResult(
  files: Record<
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
  words?: Array<{
    word?: string;
    text?: string;
    speakerLabel?: string | number;
    speakerTag?: string | number;
  }>;
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
