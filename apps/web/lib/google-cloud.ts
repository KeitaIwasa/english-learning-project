import { createHash, createSign } from "node:crypto";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GCS_HOST = "storage.googleapis.com";

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
    token_uri: tokenUri
  };
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
  const stringToSign = [
    "GOOG4-RSA-SHA256",
    iso,
    scope,
    sha256Hex(canonicalRequest)
  ].join("\n");

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
