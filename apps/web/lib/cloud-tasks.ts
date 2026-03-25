import { appEnv } from "@/lib/app-env";
import { getGoogleAccessToken, parseGoogleServiceAccount } from "@/lib/google-cloud";

type QueueKind = "reading" | "speech_fixer" | "profile";

function resolveQueueName(kind: QueueKind): string {
  if (kind === "reading") {
    return appEnv.cloudTasksQueueReading();
  }
  if (kind === "speech_fixer") {
    return appEnv.cloudTasksQueueSpeechFixer();
  }
  return appEnv.cloudTasksQueueProfile();
}

function resolveTargetUrl(kind: QueueKind): string {
  if (kind === "reading") {
    return appEnv.cloudRunReadingWorkerUrl();
  }
  if (kind === "speech_fixer") {
    return appEnv.cloudRunSpeechFixerWorkerUrl();
  }
  return appEnv.cloudRunProfileWorkerUrl();
}

export async function enqueueWorkerTask(params: {
  kind: QueueKind;
  payload: Record<string, unknown>;
  delaySeconds?: number;
}) {
  const projectId = appEnv.cloudTasksProjectId();
  const location = appEnv.cloudTasksLocation();
  const queueName = resolveQueueName(params.kind);
  const parent = `projects/${projectId}/locations/${location}/queues/${queueName}`;
  const url = resolveTargetUrl(params.kind);
  const serviceAccount = parseGoogleServiceAccount(appEnv.googleApplicationCredentialsJson());
  const accessToken = await getGoogleAccessToken({
    serviceAccount,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });

  const task: Record<string, unknown> = {
    httpRequest: {
      httpMethod: "POST",
      url,
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": appEnv.workerSharedSecret()
      },
      body: Buffer.from(JSON.stringify(params.payload)).toString("base64")
    }
  };

  if ((params.delaySeconds ?? 0) > 0) {
    task.scheduleTime = new Date(Date.now() + Number(params.delaySeconds) * 1000).toISOString();
  }

  const endpoint = `https://cloudtasks.googleapis.com/v2/${parent}/tasks`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ task })
  });

  if (!response.ok) {
    throw new Error(`Cloud Tasks createTask failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { name?: string };
  return json.name ?? "";
}

export function verifyWorkerToken(request: Request): boolean {
  const header = String(request.headers.get("x-worker-token") ?? "").trim();
  return header.length > 0 && header === appEnv.workerSharedSecret();
}
