import { appEnv } from "@/lib/app-env";
import { getGoogleAccessToken, parseGoogleServiceAccount } from "@/lib/google-cloud";

type QueueKind = "reading" | "speech_fixer" | "profile" | "line_delivery";
const QUEUE_KINDS: QueueKind[] = ["reading", "speech_fixer", "profile", "line_delivery"];
let startupQueueHealthCheckPromise: Promise<void> | null = null;

function resolveQueueName(kind: QueueKind): string {
  if (kind === "reading") {
    return appEnv.cloudTasksQueueReading();
  }
  if (kind === "speech_fixer") {
    return appEnv.cloudTasksQueueSpeechFixer();
  }
  if (kind === "line_delivery") {
    return appEnv.cloudTasksQueueLineDelivery();
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
  if (kind === "line_delivery") {
    return appEnv.cloudRunLineDeliveryWorkerUrl();
  }
  return appEnv.cloudRunProfileWorkerUrl();
}

function buildQueueParent(kind: QueueKind): string {
  const projectId = appEnv.cloudTasksProjectId();
  const location = appEnv.cloudTasksLocation();
  const queueName = resolveQueueName(kind);
  return `projects/${projectId}/locations/${location}/queues/${queueName}`;
}

async function getCloudTasksAccessToken(): Promise<string> {
  const serviceAccount = parseGoogleServiceAccount(appEnv.googleApplicationCredentialsJson());
  return await getGoogleAccessToken({
    serviceAccount,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
}

async function runStartupQueueHealthCheck(): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  try {
    const accessToken = await getCloudTasksAccessToken();
    for (const kind of QUEUE_KINDS) {
      const parent = buildQueueParent(kind);
      const endpoint = `https://cloudtasks.googleapis.com/v2/${parent}`;
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`[cloud-tasks] queue health check failed for ${kind}: ${response.status} ${body}`);
      }
    }
  } catch (error) {
    console.error("[cloud-tasks] startup queue health check failed", error);
  }
}

function triggerStartupQueueHealthCheck(): void {
  if (startupQueueHealthCheckPromise) {
    return;
  }
  startupQueueHealthCheckPromise = runStartupQueueHealthCheck();
}

export async function enqueueWorkerTask(params: {
  kind: QueueKind;
  payload: Record<string, unknown>;
  delaySeconds?: number;
}) {
  const parent = buildQueueParent(params.kind);
  const url = resolveTargetUrl(params.kind);
  const accessToken = await getCloudTasksAccessToken();

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

triggerStartupQueueHealthCheck();
