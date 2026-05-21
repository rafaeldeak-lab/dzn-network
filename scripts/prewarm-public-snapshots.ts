import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_URL = "https://dzn-network.pages.dev/api/sync/public-snapshots/run";

async function main() {
  const endpoint = process.env.DZN_PUBLIC_SNAPSHOT_PREWARM_URL || DEFAULT_URL;
  const secret = await getCronSecret();
  if (!secret) {
    throw new Error("DZN_CRON_SECRET or SYNC_CRON_SECRET is required to prewarm public snapshots.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dzn-cron-secret": secret,
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ source: "manual", cron: "npm-prewarm-public" }),
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    throw new Error(`Public snapshot prewarm failed: HTTP ${response.status} ${safeMessage(payload)}`);
  }

  console.log("DZN PUBLIC SNAPSHOTS PREWARMED");
  console.log(JSON.stringify(payload, null, 2));
}

async function getCronSecret() {
  const fromEnv = process.env.DZN_CRON_SECRET || process.env.SYNC_CRON_SECRET;
  if (fromEnv?.trim()) return fromEnv.trim();

  if (!input.isTTY) return "";
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Cron secret: ");
    return answer.trim();
  } finally {
    rl.close();
  }
}

function parseJson(value: string) {
  try {
    return value ? JSON.parse(value) as unknown : null;
  } catch {
    return value;
  }
}

function safeMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const message = record.message ?? record.error ?? record.error_code;
  return typeof message === "string" ? message : "";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
