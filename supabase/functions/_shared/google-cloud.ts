type ServiceAccount = {
  client_email: string;
  private_key: string;
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
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON");
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
    token_uri: parsed.token_uri || TOKEN_AUDIENCE
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

export async function startSpeechLongRunningRecognize(params: {
  accessToken: string;
  languageCode: string;
  gcsUri: string;
}) {
  const response = await fetch("https://speech.googleapis.com/v1/speech:longrunningrecognize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      config: {
        languageCode: params.languageCode,
        enableAutomaticPunctuation: true,
        model: "latest_long"
      },
      audio: {
        uri: params.gcsUri
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Speech longrunningrecognize failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { name?: string };
  if (!json.name) {
    throw new Error("Speech response missing operation name");
  }
  return json.name;
}

export async function getSpeechOperation(params: {
  accessToken: string;
  operationName: string;
}) {
  const response = await fetch(`https://speech.googleapis.com/v1/operations/${params.operationName}`, {
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
      results?: Array<{
        alternatives?: Array<{ transcript?: string }>;
      }>;
    };
  };
}

export function extractTranscriptFromSpeechResponse(response: {
  results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
}) {
  const lines = (response.results ?? [])
    .map((item) => item.alternatives?.[0]?.transcript?.trim() ?? "")
    .filter((line) => line.length > 0);
  return lines.join("\n").trim();
}
