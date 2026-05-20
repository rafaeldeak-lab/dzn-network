import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Args = {
  server: string | null;
  file: string | null;
  appUrl: string;
  cookie: string | null;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.server || !args.file) {
    throw new Error("Usage: npm run import:adm-text -- --server <linked-server-id> --file ./path/to/file.ADM");
  }
  if (!args.cookie) {
    throw new Error("Set DZN_SESSION_COOKIE to an owner/admin session cookie before calling the production endpoint.");
  }

  const filePath = resolve(args.file);
  const admText = readFileSync(filePath, "utf8");
  const filename = filePath.split(/[\\/]/).pop() ?? "manual.ADM";
  const endpoint = `${args.appUrl.replace(/\/$/, "")}/api/servers/${encodeURIComponent(args.server)}/adm/manual-import`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: args.cookie,
    },
    body: JSON.stringify({
      filename,
      admText,
      source: "manual_upload",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Manual ADM import failed (${response.status}): ${JSON.stringify(data)}`);
  }
  console.log(JSON.stringify(data, null, 2));
}

function parseArgs(values: string[]): Args {
  const out: Args = {
    server: null,
    file: null,
    appUrl: process.env.DZN_APP_URL || "https://dzn-network.pages.dev",
    cookie: process.env.DZN_SESSION_COOKIE || null,
  };
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    const next = values[index + 1];
    if (arg === "--server" && next) {
      out.server = next;
      index += 1;
    } else if (arg === "--file" && next) {
      out.file = next;
      index += 1;
    } else if (arg === "--url" && next) {
      out.appUrl = next;
      index += 1;
    }
  }
  return out;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
