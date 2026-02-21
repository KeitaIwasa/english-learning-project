import { execSync } from "node:child_process";

const winHost = findWindowsHostFromIpRoute();
const relayUrl = process.env.PW_CDP_URL ?? (winHost ? `http://${winHost}:9223` : null);

async function main() {
  if (!relayUrl) {
    throw new Error("Could not infer Windows host IP from `ip route`.");
  }

  console.log(`[preflight-cdp] checking=${relayUrl}/json/version`);
  const res = await fetch(`${relayUrl}/json/version`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${relayUrl}/json/version`);
  }

  const json = await res.json();
  console.log(`[preflight-cdp] browser=${json.Browser ?? "unknown"}`);
  console.log(`[preflight-cdp] websocket=${json.webSocketDebuggerUrl ?? "missing"}`);
  console.log("[preflight-cdp] OK");
}

function findWindowsHostFromIpRoute() {
  try {
    const output = execSync("ip route", { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    const line = output
      .split("\n")
      .map((v) => v.trim())
      .find((v) => v.startsWith("default "));
    const match = line?.match(/\bvia\s+([0-9.]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(`[preflight-cdp] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
