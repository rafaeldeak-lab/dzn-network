import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const NEXT_PORT = Number(process.env.DZN_PUBLIC_PROFILE_QA_PORT ?? 3097);
const CHROME_PORT = Number(process.env.DZN_PUBLIC_PROFILE_QA_CHROME_PORT ?? 9231);
const BASE_URL = `http://127.0.0.1:${NEXT_PORT}`;
const OUT_DIR = path.join(ROOT, "docs", "qa", "public-player-profile-viewer-qa-20260901");
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const CHROME_USER_DATA = path.join(tmpdir(), `dzn-public-player-profile-qa-${Date.now()}`);

const chromePath = process.env.CHROME_PATH ?? findChromePath();
if (!chromePath) {
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to run rendered public player profile QA.");
}
if (typeof WebSocket === "undefined") {
  throw new Error("Rendered public player profile QA requires a Node.js runtime with built-in WebSocket support.");
}

const scenarios = {
  published: {
    apiStatus: 200,
    apiPayload: publishedProfilePayload(),
    readyText: "Rafael DZN",
    mustContain: [
      "Public Safe Profile",
      "Rafael DZN",
      "Gameplay Summary",
      "Pandora Network",
      "Published Sections",
      "Earned Progression",
      "Fair Boundary",
      "Profile visibility cannot alter billing",
      "Manage My Profile",
    ],
    mustNotContain: [
      "discord-1",
      "user-1",
      "player_id",
      "raw_evidence",
      "checkout.session",
      "DZN-SUP",
    ],
  },
  hidden: {
    apiStatus: 404,
    apiPayload: {
      ok: false,
      error: "PROFILE_NOT_FOUND",
      message: "This public player profile is not available.",
    },
    readyText: "Profile Hidden",
    mustContain: [
      "Profile Hidden",
      "This public player profile is not available.",
      "Manage My Profile",
    ],
    mustNotContain: [
      "Rafael DZN",
      "discord-1",
      "user-1",
      "Pandora Network",
      "checkout.session",
    ],
  },
  unavailable: {
    apiStatus: 503,
    apiPayload: {
      ok: false,
      error: "PROFILE_UNAVAILABLE",
      message: "Public player profiles are unavailable right now.",
    },
    readyText: "Profile Unavailable",
    mustContain: [
      "Profile Unavailable",
      "Public player profiles are unavailable right now.",
      "Manage My Profile",
    ],
    mustNotContain: [
      "discord-1",
      "user-1",
      "checkout.session",
    ],
  },
  invalidHandle: {
    apiStatus: 200,
    apiPayload: publishedProfilePayload(),
    readyText: "Profile Link Needed",
    mustContain: [
      "Profile Link Needed",
      "Public player profiles open from a generated handle",
      "Manage My Profile",
    ],
    mustNotContain: [
      "Rafael DZN",
      "Pandora Network",
      "discord-1",
      "checkout.session",
    ],
  },
};

const captures = [
  { scenario: "published", viewport: "desktop", width: 1440, height: 1100, path: "/players/preview" },
  { scenario: "published", viewport: "mobile", width: 390, height: 1280, mobile: true, path: "/players/preview" },
  { scenario: "hidden", viewport: "desktop", width: 1440, height: 900, path: "/players/preview" },
  { scenario: "unavailable", viewport: "desktop", width: 1440, height: 900, path: "/players/preview" },
  { scenario: "invalidHandle", viewport: "desktop", width: 1440, height: 900, path: "/players" },
];

async function main() {
  const next = await startNext();
  let chrome;

  try {
    chrome = await startChrome();
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const browser = await connectToChrome();
    const results = [];

    for (const capture of captures) {
      const scenario = scenarios[capture.scenario];
      const page = await browser.newPage();
      const consoleMessages = [];
      const failedRequests = [];

      page.on("Runtime.consoleAPICalled", (event) => {
        const text = event.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ?? "";
        if (event.type === "error" || event.type === "warning") {
          consoleMessages.push(`${event.type}: ${text}`);
        }
      });
      page.on("Network.loadingFailed", (event) => {
        if (!String(event.errorText ?? "").includes("net::ERR_ABORTED")) {
          failedRequests.push(event.errorText ?? "unknown network failure");
        }
      });
      page.on("Fetch.requestPaused", async (event) => {
        await fulfillOrContinue(page, event, scenario);
      });

      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Network.enable");
      await page.send("Fetch.enable", {
        patterns: [
          { urlPattern: `${BASE_URL}/api/auth/me*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/dzn-pulse/config*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/public/players/*`, requestStage: "Request" },
        ],
      });
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: capture.width,
        height: capture.height,
        deviceScaleFactor: 1,
        mobile: Boolean(capture.mobile),
      });

      await page.send("Page.navigate", { url: `${BASE_URL}${capture.path}?qa=${capture.scenario}-${capture.viewport}` });
      await waitForText(page, scenario.readyText);

      const text = await pageText(page);
      const normalizedText = text.toLowerCase();
      const missing = scenario.mustContain.filter((needle) => !normalizedText.includes(needle.toLowerCase()));
      const leaked = scenario.mustNotContain.filter((needle) => normalizedText.includes(needle.toLowerCase()));
      if (missing.length || leaked.length) {
        throw new Error(`${capture.scenario}/${capture.viewport} text assertion failed. Missing: ${missing.join(", ")}. Leaked: ${leaked.join(", ")}. Text: ${text.slice(0, 1600)}`);
      }

      const overlaps = await visibleOverlaps(page);
      if (overlaps.length > 0) {
        throw new Error(`${capture.scenario}/${capture.viewport} has ${overlaps.length} obvious visible element overlaps: ${JSON.stringify(overlaps.slice(0, 3))}`);
      }

      const screenshot = await page.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        fromSurface: true,
      });
      const fileName = `${capture.scenario}-${capture.viewport}.png`;
      await writeFile(path.join(SCREENSHOT_DIR, fileName), Buffer.from(screenshot.data, "base64"));

      results.push({
        scenario: capture.scenario,
        viewport: capture.viewport,
        screenshot: `screenshots/${fileName}`,
        assertions: scenario.mustContain.length + scenario.mustNotContain.length + 1,
        consoleMessages,
        failedRequests,
      });

      await page.close();
    }

    await browser.close();
    await writeReport(results);
    console.log(`Public player profile rendered QA passed. Report: ${path.relative(ROOT, path.join(OUT_DIR, "README.md"))}`);
  } finally {
    await killProcessTree(next);
    await killProcessTree(chrome);
    await rm(CHROME_USER_DATA, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function startNext() {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run dev -- --hostname 127.0.0.1 --port ${NEXT_PORT}`]
    : ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(NEXT_PORT)];
  const child = spawn(command, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForHttp(`${BASE_URL}/players/preview`, 90_000, child);
  return child;
}

async function startChrome() {
  const child = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${CHROME_PORT}`,
    `--user-data-dir=${CHROME_USER_DATA}`,
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHttp(`http://127.0.0.1:${CHROME_PORT}/json/version`, 30_000);
  return child;
}

async function connectToChrome() {
  const targets = await fetchJson(`http://127.0.0.1:${CHROME_PORT}/json/list`);
  const target = targets.find((item) => item.type === "page") ?? targets[0];
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("Chrome did not expose a debuggable page target.");
  }
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  return {
    async newPage() {
      const response = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?about:blank`, { method: "PUT" });
      if (!response.ok) throw new Error(`Unable to create Chrome page: ${response.status}`);
      const pageTarget = await response.json();
      return CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    },
    async close() {
      await client.close();
    },
  };
}

async function fulfillOrContinue(page, event, scenario) {
  const url = event.request.url;
  if (url.startsWith(`${BASE_URL}/api/auth/me`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, 200, {
      authenticated: false,
      user: null,
      linkedServers: [],
      linkedServer: null,
      navigation: null,
    }));
    return;
  }
  if (url.startsWith(`${BASE_URL}/api/dzn-pulse/config`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, 200, {
      ok: true,
      dznPulseEnabled: false,
      discordNotificationsEnabled: false,
    }));
    return;
  }
  if (url.startsWith(`${BASE_URL}/api/public/players/`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, scenario.apiStatus, scenario.apiPayload, "public, max-age=15, stale-while-revalidate=45"));
    return;
  }
  await page.send("Fetch.continueRequest", { requestId: event.requestId });
}

function publishedProfilePayload() {
  return {
    ok: true,
    handle: "rafael-dzn-a1b2c3",
    href: "/players/rafael-dzn-a1b2c3",
    display_name: "Rafael DZN",
    published_at: "2026-09-01T12:00:00.000Z",
    updated_at: "2026-09-01T12:15:00.000Z",
    sections: {
      display_name: {
        visible: true,
        value: "Rafael DZN",
      },
      gameplay_summary: {
        visible: true,
        totals: {
          kills: 44,
          deaths: 12,
          suicides: 1,
          longest_kill_distance: 760,
          linked_public_servers: 2,
        },
        last_seen_at: "2026-09-01T12:00:00.000Z",
      },
      featured_server: {
        visible: true,
        server: {
          public_slug: "pandora-network",
          href: "/servers/profile?slug=pandora-network",
          server_name: "Pandora Network",
          server_type: "PVP Survival",
          platform: "Xbox",
          map_name: "Chernarus",
          kills: 32,
          deaths: 8,
          longest_kill_distance: 760,
          last_seen_at: "2026-09-01T12:00:00.000Z",
        },
      },
      xp_progress: {
        visible: true,
        status: "not_available_yet",
        message: "XP progress is not published until trusted award sources exist.",
      },
      challenge_progress: {
        visible: true,
        status: "not_available_yet",
        message: "Challenge progress is not published until challenge participation exists.",
      },
      calling_cards: {
        visible: true,
        status: "not_available_yet",
        message: "Calling cards are not published until account-bound earned cards exist.",
      },
      award_dates: {
        visible: false,
        status: "hidden",
        message: "This section is hidden by the player's saved profile preferences.",
      },
    },
    privacy: {
      public_profile_enabled: true,
      visible_sections: [
        "display_name",
        "gameplay_summary",
        "featured_server",
        "xp_progress",
        "challenge_progress",
        "calling_cards",
      ],
    },
    safety: {
      public_safe: true,
      read_only: true,
      presentation_only: true,
      private_identifiers_exposed: false,
      raw_award_evidence_exposed: false,
    },
    fairness_boundary: [
      "Public player profiles are opt-in display surfaces only.",
      "Hidden profile sections are omitted from this response.",
      "No Discord IDs, DZN user IDs, raw player IDs, raw award evidence, payment state, or owner state is returned.",
      "Profile visibility cannot alter billing, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF, XP awards, calling-card awards, or competitive eligibility.",
    ],
  };
}

function jsonResponse(requestId, statusCode, payload, cacheControl = "private, no-store, no-cache, must-revalidate") {
  return {
    requestId,
    responseCode: statusCode,
    responseHeaders: [
      { name: "content-type", value: "application/json; charset=utf-8" },
      { name: "cache-control", value: cacheControl },
    ],
    body: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  };
}

async function waitForHttp(url, timeoutMs, child = null) {
  const started = Date.now();
  let lastError;
  let exited = false;
  let exitDetails = "";
  child?.once("exit", (code, signal) => {
    exited = true;
    exitDetails = `child exited with code ${code ?? "null"} signal ${signal ?? "null"}`;
  });
  while (Date.now() - started < timeoutMs) {
    if (exited) {
      throw new Error(`Timed out waiting for ${url}: ${exitDetails}`);
    }
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "unknown error"}`);
}

async function waitForText(page, text, timeoutMs = 20_000) {
  const started = Date.now();
  const expected = text.toLowerCase();
  while (Date.now() - started < timeoutMs) {
    const bodyText = (await pageText(page)).toLowerCase();
    if (bodyText.includes(expected)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function pageText(page) {
  const result = await page.send("Runtime.evaluate", {
    expression: "document.body?.innerText ?? ''",
    returnByValue: true,
  });
  return String(result.result?.value ?? "");
}

async function visibleOverlaps(page) {
  const result = await page.send("Runtime.evaluate", {
    expression: `(() => {
      const selectors = ['a', 'button', '[role="button"]'];
      const elements = [...document.querySelectorAll(selectors.join(','))]
        .filter((el) => {
          if (el.closest('.dzn-beta-ticker')) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 8 && rect.height > 8;
        })
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            text: el.textContent.trim(),
            rect: {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            },
          };
        });
      const overlaps = [];
      for (let i = 0; i < elements.length; i += 1) {
        for (let j = i + 1; j < elements.length; j += 1) {
          const a = elements[i].rect;
          const b = elements[j].rect;
          const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          const area = x * y;
          if (area > 32 && area > Math.min(a.width * a.height, b.width * b.height) * 0.08) {
            overlaps.push({ left: elements[i].text, right: elements[j].text, area: Math.round(area) });
          }
        }
      }
      return overlaps;
    })()`,
    returnByValue: true,
  });
  return Array.isArray(result.result?.value) ? result.result.value : [];
}

async function writeReport(results) {
  const report = [
    "# Public Player Profile Viewer Rendered QA - 2026-09-01",
    "",
    "This local artifact proves the rendered public profile shell for published, hidden, unavailable, no-handle, desktop, and mobile states. Because this repo uses `output: export`, local Next dev renders the prebuilt `/players/preview` shell; the production `/players/*` Pages function rewrite is covered by build output and guardrail tests. The harness intercepts only `/api/auth/me`, `/api/dzn-pulse/config`, and `/api/public/players/*` with sanitized JSON.",
    "",
    "No production D1, Stripe, Cloudflare secret/config, Nitrado, Discord runtime, Store/payment, live checkout, retained export, analytics, DZN Assist AI, chat route, message persistence, scoring, ranking, discovery, review, progression, or competitive-system mutation is used by this QA harness.",
    "",
    "## Captures",
    "",
    "| Scenario | Viewport | Screenshot | Proof |",
    "| --- | --- | --- | --- |",
    ...results.map((result) => `| ${result.scenario} | ${result.viewport} | [${result.screenshot}](${result.screenshot}) | ${result.assertions} text/boundary/overlap checks |`),
    "",
    "## Verified States",
    "",
    "- Published profile renders public-safe display name, aggregate gameplay totals, featured server, visible-section badges, future earned-progression copy, and the fair boundary.",
    "- Mobile profile renders the same public-safe contract without obvious interactive-element overlaps.",
    "- Hidden profiles return a generic hidden/not-found state without revealing whether the handle exists.",
    "- Unavailable API responses render the public-safe unavailable fallback.",
    "- Invalid handles show the local profile-link-needed fallback without calling private data.",
    "- The harness asserts no raw Discord IDs, user IDs, player IDs, raw evidence fields, checkout events, or Supporter Card serials appear in rendered text.",
    "",
    "## Console And Network Notes",
    "",
    ...results.flatMap((result) => [
      `### ${result.scenario} / ${result.viewport}`,
      "",
      result.consoleMessages.length ? `Console warnings/errors: ${result.consoleMessages.join("; ")}` : "Console warnings/errors: none captured.",
      "",
      result.failedRequests.length ? `Network failures: ${result.failedRequests.join("; ")}` : "Network failures: none captured.",
      "",
    ]),
  ].join("\n");
  await writeFile(path.join(OUT_DIR, "README.md"), report, "utf8");
  await writeFile(path.join(OUT_DIR, "qa-results.json"), `${JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2)}\n`, "utf8");
}

async function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
        .once("exit", resolve)
        .once("error", resolve);
    });
    return;
  }
  child.kill("SIGTERM");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function findChromePath() {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/microsoft-edge",
      ];
  return candidates.find((candidate) => existsSync(candidate));
}

class CdpClient {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new CdpClient(ws);
      ws.addEventListener("open", () => resolve(client), { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws.addEventListener("message", (message) => this.handleMessage(message));
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  on(method, callback) {
    const callbacks = this.listeners.get(method) ?? [];
    callbacks.push(callback);
    this.listeners.set(method, callbacks);
  }

  async close() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  handleMessage(message) {
    const payload = JSON.parse(String(message.data));
    if (payload.id) {
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        pending.reject(new Error(payload.error.message ?? JSON.stringify(payload.error)));
      } else {
        pending.resolve(payload.result ?? {});
      }
      return;
    }
    if (payload.method) {
      for (const callback of this.listeners.get(payload.method) ?? []) {
        Promise.resolve(callback(payload.params ?? {})).catch((error) => {
          console.error(`CDP event handler failed for ${payload.method}:`, error);
        });
      }
    }
  }
}

await main();
