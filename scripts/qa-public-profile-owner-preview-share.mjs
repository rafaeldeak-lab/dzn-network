import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const NEXT_PORT = Number(process.env.DZN_OWNER_PROFILE_QA_PORT ?? 3099);
const CHROME_PORT = Number(process.env.DZN_OWNER_PROFILE_QA_CHROME_PORT ?? 9233);
const BASE_URL = `http://127.0.0.1:${NEXT_PORT}`;
const OUT_DIR = path.join(ROOT, "docs", "qa", "public-profile-owner-preview-share-qa-20260901");
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const CHROME_USER_DATA = path.join(tmpdir(), `dzn-owner-profile-share-qa-${Date.now()}`);

const chromePath = process.env.CHROME_PATH ?? findChromePath();
if (!chromePath) {
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to run rendered public profile owner preview/share QA.");
}
if (typeof WebSocket === "undefined") {
  throw new Error("Rendered public profile owner preview/share QA requires a Node.js runtime with built-in WebSocket support.");
}

const scenarios = {
  published: {
    privacy: publishedPrivacyPayload(),
    publicProfileStatus: 200,
    publicProfile: publishedPublicProfilePayload(),
    readyText: "Visitor Preview Ready",
    interactions: true,
    mustContain: [
      "Personal Player Profile",
      "Profile Privacy Preferences",
      "How My Public Profile Looks",
      "Visitor Preview Ready",
      "Visitor View Mirror",
      "Rafael DZN",
      "@rafael-dzn-a1b2c3",
      "Pandora Network",
      "Owner Share Controls",
      "Public URL",
      "Open Public Page",
      "Copy Link",
      "Copy Handle",
      "Share",
      "stores no share history",
      "Profile sharing cannot affect billing",
    ],
    mustNotContain: [
      "redacted-discord-user",
      "discord_user_id",
      "discord_guild_id",
      "player_id",
      "raw_evidence",
      "checkout.session",
      "DZN-SUP",
      "store_orders",
      "owner_user_id",
    ],
  },
  disabled: {
    privacy: disabledPrivacyPayload(),
    publicProfileStatus: 404,
    publicProfile: hiddenPublicProfilePayload(),
    readyText: "Hidden From Visitors",
    mustContain: [
      "Personal Player Profile",
      "How My Public Profile Looks",
      "Hidden From Visitors",
      "Public Profile Hidden",
      "Share link locked",
      "Publish your profile and save preferences before sharing the visitor page.",
      "No copy, open, or share action in this page session.",
    ],
    mustNotContain: [
      "Visitor Preview Ready",
      "Pandora Network",
      "redacted-discord-user",
      "checkout.session",
      "DZN-SUP",
    ],
  },
  hiddenResponse: {
    privacy: publishedPrivacyPayload(),
    publicProfileStatus: 404,
    publicProfile: hiddenPublicProfilePayload(),
    readyText: "Hidden From Visitors",
    mustContain: [
      "Personal Player Profile",
      "How My Public Profile Looks",
      "Hidden From Visitors",
      "The public profile is currently hidden or unavailable to visitors.",
      "Share link locked",
      "visitor response is hidden right now",
    ],
    mustNotContain: [
      "Visitor Preview Ready",
      "Pandora Network",
      "redacted-discord-user",
      "checkout.session",
      "DZN-SUP",
    ],
  },
  unavailable: {
    privacy: publishedPrivacyPayload(),
    publicProfileStatus: 503,
    publicProfile: {
      ok: false,
      error: "PROFILE_UNAVAILABLE",
      message: "Public player profiles are unavailable right now.",
    },
    readyText: "Preview Unavailable",
    mustContain: [
      "Personal Player Profile",
      "How My Public Profile Looks",
      "Preview Unavailable",
      "Public player profiles are unavailable right now.",
      "Share link locked",
      "could not be checked",
    ],
    mustNotContain: [
      "Visitor Preview Ready",
      "Pandora Network",
      "redacted-discord-user",
      "checkout.session",
      "DZN-SUP",
    ],
  },
};

const captures = [
  { scenario: "published", viewport: "desktop", width: 1440, height: 1500 },
  { scenario: "published", viewport: "mobile", width: 390, height: 1600, mobile: true },
  { scenario: "disabled", viewport: "desktop", width: 1440, height: 1250 },
  { scenario: "hiddenResponse", viewport: "desktop", width: 1440, height: 1250 },
  { scenario: "unavailable", viewport: "desktop", width: 1440, height: 1250 },
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
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
          try {
            Object.defineProperty(Navigator.prototype, 'share', { configurable: true, get: () => undefined });
          } catch {}
        })();`,
      });
      await page.send("Runtime.enable");
      await page.send("Network.enable");
      await page.send("Fetch.enable", {
        patterns: [
          { urlPattern: `${BASE_URL}/api/auth/me*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/dzn-pulse/config*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/player/hub*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/player/profile/privacy*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/player/community-memberships/refresh*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/public/players/*`, requestStage: "Request" },
        ],
      });
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: capture.width,
        height: capture.height,
        deviceScaleFactor: 1,
        mobile: Boolean(capture.mobile),
      });

      await page.send("Page.navigate", { url: `${BASE_URL}/player/profile?qa=${capture.scenario}-${capture.viewport}` });
      await waitForText(page, scenario.readyText);

      let interactionProof = null;
      if (scenario.interactions && capture.viewport === "desktop") {
        interactionProof = await runInteractionProof(page);
      }

      const text = await pageText(page);
      const normalizedText = text.toLowerCase();
      const missing = scenario.mustContain.filter((needle) => !normalizedText.includes(needle.toLowerCase()));
      const leaked = scenario.mustNotContain.filter((needle) => normalizedText.includes(needle.toLowerCase()));
      if (missing.length || leaked.length) {
        throw new Error(`${capture.scenario}/${capture.viewport} text assertion failed. Missing: ${missing.join(", ")}. Leaked: ${leaked.join(", ")}. Text: ${text.slice(0, 1800)}`);
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
        assertions: scenario.mustContain.length + scenario.mustNotContain.length + 1 + (interactionProof ? 3 : 0),
        interactionProof,
        consoleMessages,
        failedRequests,
      });

      await page.close();
    }

    await browser.close();
    await writeReport(results);
    console.log(`Public profile owner preview/share rendered QA passed. Report: ${path.relative(ROOT, path.join(OUT_DIR, "README.md"))}`);
  } finally {
    await killProcessTree(next);
    await killProcessTree(chrome);
    await rm(CHROME_USER_DATA, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runInteractionProof(page) {
  await page.send("Runtime.evaluate", {
    expression: `(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      try {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      } catch {}
    })()`,
    returnByValue: true,
  });

  await clickControl(page, "Copy Link");
  await waitForAnyText(page, [
    "Public profile link copied for this page session.",
    "Clipboard is unavailable in this browser.",
    "Clipboard access was blocked.",
  ]);

  await clickControl(page, "Copy Handle");
  await waitForAnyText(page, [
    "Public profile handle copied for this page session.",
    "Clipboard is unavailable in this browser.",
    "Clipboard access was blocked.",
  ]);

  const shareEnabled = await controlEnabled(page, "Share");
  if (!shareEnabled) {
    throw new Error("Share control should be present and enabled after the public visitor preview is ready.");
  }

  const storage = await page.send("Runtime.evaluate", {
    expression: "({ localStorage: window.localStorage.length, sessionStorage: window.sessionStorage.length })",
    returnByValue: true,
  });
  const storageValue = storage.result?.value ?? {};
  if (storageValue.localStorage !== 0 || storageValue.sessionStorage !== 0) {
    throw new Error(`Share controls must not write browser storage. Saw ${JSON.stringify(storageValue)}.`);
  }

  return {
    copyFeedback: true,
    handleCopyFeedback: true,
    shareControlEnabled: true,
    browserStorageWrites: 0,
  };
}

async function clickControl(page, label) {
  const result = await page.send("Runtime.evaluate", {
    expression: `(() => {
      const controls = [...document.querySelectorAll('button, a')];
      const control = controls.find((item) => (item.textContent || '').toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
      if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return false;
      control.click();
      return true;
    })()`,
    returnByValue: true,
  });
  if (!result.result?.value) {
    throw new Error(`Unable to click enabled control: ${label}`);
  }
}

async function controlEnabled(page, label) {
  const result = await page.send("Runtime.evaluate", {
    expression: `(() => {
      const controls = [...document.querySelectorAll('button, a')];
      const control = controls.find((item) => (item.textContent || '').toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
      return Boolean(control && !control.disabled && control.getAttribute('aria-disabled') !== 'true');
    })()`,
    returnByValue: true,
  });
  return Boolean(result.result?.value);
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
  await waitForHttp(`${BASE_URL}/player/profile`, 90_000, child);
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
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, 200, authPayload()));
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
  if (url.startsWith(`${BASE_URL}/api/player/hub`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, 200, hubPayload()));
    return;
  }
  if (url.startsWith(`${BASE_URL}/api/player/profile/privacy`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, 200, scenario.privacy));
    return;
  }
  if (url.startsWith(`${BASE_URL}/api/player/community-memberships/refresh`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, 200, {
      ok: true,
      message: "Discord community matching was refreshed for your private Player Hub.",
      refreshed_at: "2026-09-01T12:00:00.000Z",
      requires_relogin: false,
    }));
    return;
  }
  if (url.startsWith(`${BASE_URL}/api/public/players/`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, scenario.publicProfileStatus, scenario.publicProfile, "public, max-age=15, stale-while-revalidate=45"));
    return;
  }
  await page.send("Fetch.continueRequest", { requestId: event.requestId });
}

function authPayload() {
  return {
    authenticated: true,
    user: {
      id: "qa-user",
      discord_id: "redacted-discord-user",
      username: "Rafael DZN",
      avatar: null,
    },
    linkedServers: [],
    linkedServer: null,
    navigation: {
      effective_plan_key: "free",
      stored_plan_key: "free",
      plan_tier: "free",
      plan_label: "Free",
      plan_status: "player",
      linked_server_count: 0,
      linked_server_limit: 0,
      can_link_more_servers: true,
      can_use_pro_tools: false,
      primary_action: {
        label: "Start Trial",
        href: "/pricing?intent=owner_setup&returnTo=%2Fsetup",
        tone: "trial",
      },
    },
  };
}

function hubPayload() {
  return {
    ok: true,
    generated_at: "2026-09-01T12:00:00.000Z",
    account: {
      display_name: "Rafael DZN",
      avatar: null,
      player_home_href: "/player",
      private_profile_href: "/player/profile",
    },
    saved_servers: [],
    saved_server_ids: [],
    matched_communities: [],
    discord_membership_status: {
      source: "player_discord_community_memberships",
      last_checked_at: "2026-09-01T10:45:00.000Z",
      refresh_href: "/api/player/community-memberships/refresh",
      refresh_method: "POST",
      requires_relogin: false,
      private: true,
      presentation_only: true,
      message: "Discord community matching is private to your Player Hub.",
    },
    suggested_events: [],
    suggested_event_relevance: {
      private: true,
      presentation_only: true,
      uses_followed_servers: false,
      uses_matched_communities: false,
      message: "Suggested events are privately ordered for this Player Hub only.",
    },
    profile_entries: [
      {
        key: "private_profile",
        label: "Personal profile",
        href: "/player/profile",
        status: "available",
        description: "Open the private player profile entry point for account-specific profile tools.",
      },
      {
        key: "public_profile",
        label: "Public profile controls",
        href: "/player/profile",
        status: "published",
        description: "Preview and share only the public-safe profile response.",
      },
    ],
    profile_summary: {
      display_name: "Rafael DZN",
      private_profile_href: "/player/profile",
      public_profile_href: "/players/rafael-dzn-a1b2c3",
      public_profile_status: "not_configured",
      public_profile_message: "Public profile publishing and visibility controls stay in the dedicated profile privacy slices.",
      linked_game_profiles: 1,
      linked_public_servers: 1,
      last_seen_at: "2026-09-01T10:30:00.000Z",
      source: "player_profiles",
      private: true,
      presentation_only: true,
    },
    progression_summary: {
      status: "stats_available",
      source: "player_profiles",
      gameplay_totals: {
        kills: 25,
        deaths: 7,
        suicides: 1,
        longest_kill_distance: 421.4,
      },
      featured_server: null,
      tracks: [
        {
          key: "xp",
          label: "XP",
          status: "future_earned_runtime",
          description: "XP stays blocked until trusted server-side award sources are connected.",
        },
        {
          key: "challenges",
          label: "Challenges",
          status: "future_earned_runtime",
          description: "Challenge progress will be earned player-side and cannot be paid into.",
        },
        {
          key: "calling_cards",
          label: "Calling cards",
          status: "future_earned_runtime",
          description: "Calling-card awards remain account-bound earned cosmetics when that runtime lands.",
        },
      ],
      message: "This private summary is read-only and presentation-only.",
      private: true,
      presentation_only: true,
    },
    owner_setup: {
      href: "/pricing?intent=owner_setup&returnTo=%2Fsetup",
      gated: true,
      requires_entitlement: true,
      label: "Owner Setup",
      description: "Server setup remains behind pricing and the canonical entitlement gate.",
    },
    sources: {
      saved_servers: "player_saved_servers",
      matched_communities: "player_discord_community_memberships",
      suggested_events: "public_competitive_events",
      profile_progression: "player_profiles",
    },
    fairness_boundary: [
      "Profile and progression summaries are private current-user read models only.",
      "Player Hub data cannot alter billing, ownership, ranking, discovery, reviews, awards, scoring, or competitive eligibility.",
    ],
  };
}

function publishedPrivacyPayload() {
  return {
    ...basePrivacyPayload(),
    settings: {
      public_profile_enabled: true,
      show_display_name: true,
      show_gameplay_summary: true,
      show_featured_server: true,
      show_xp_progress: true,
      show_challenge_progress: true,
      show_calling_cards: true,
      show_award_dates: false,
    },
    sections: privacySections(true),
    public_profile_status: "published",
    public_profile_handle: "rafael-dzn-a1b2c3",
    public_profile_href: "/players/rafael-dzn-a1b2c3",
    source: "player_profile_privacy_preferences",
    updated_at: "2026-09-01T12:00:00.000Z",
    message: "Your public profile is published with your saved visibility preferences.",
  };
}

function disabledPrivacyPayload() {
  return {
    ...basePrivacyPayload(),
    settings: {
      public_profile_enabled: false,
      show_display_name: true,
      show_gameplay_summary: true,
      show_featured_server: true,
      show_xp_progress: true,
      show_challenge_progress: true,
      show_calling_cards: true,
      show_award_dates: false,
    },
    sections: privacySections(false),
    public_profile_status: "private_by_default",
    public_profile_handle: null,
    public_profile_href: null,
    source: "defaults",
    updated_at: null,
    message: "Your profile is private by default.",
  };
}

function basePrivacyPayload() {
  return {
    ok: true,
    settings: {},
    sections: [],
    public_profile_status: "private_by_default",
    public_profile_handle: null,
    public_profile_href: null,
    source: "defaults",
    updated_at: null,
    private: true,
    presentation_only: true,
    message: "Your profile is private by default.",
    fairness_boundary: [
      "Profile privacy preferences are player-owned display settings only.",
      "Generated profile handles are presentation-only and do not bypass saved visibility controls.",
      "These settings and handles do not write awards, billing, rankings, discovery, reviews, events, Server Wars, CTF, or competitive eligibility.",
    ],
  };
}

function privacySections(publicEnabled) {
  return [
    {
      key: "public_profile_enabled",
      label: "Public profile",
      description: "Allow approved public-safe profile sections to appear on your generated profile link.",
      default_value: false,
      enabled: publicEnabled,
    },
    {
      key: "show_display_name",
      label: "Display name",
      description: "Show your chosen DZN display name on approved public profile surfaces.",
      default_value: true,
      enabled: true,
    },
    {
      key: "show_gameplay_summary",
      label: "Gameplay summary",
      description: "Show safe aggregate gameplay totals, never raw identifiers or raw evidence.",
      default_value: true,
      enabled: true,
    },
    {
      key: "show_featured_server",
      label: "Featured server",
      description: "Show a public-safe linked server highlight when one is available.",
      default_value: true,
      enabled: true,
    },
    {
      key: "show_xp_progress",
      label: "XP progress",
      description: "Show earned XP progress after trusted award rules exist.",
      default_value: true,
      enabled: true,
    },
    {
      key: "show_challenge_progress",
      label: "Challenge progress",
      description: "Show earned challenge progress after challenge participation exists.",
      default_value: true,
      enabled: true,
    },
    {
      key: "show_calling_cards",
      label: "Calling cards",
      description: "Show earned account-bound calling cards after that runtime exists.",
      default_value: true,
      enabled: true,
    },
    {
      key: "show_award_dates",
      label: "Award dates",
      description: "Show public-safe earned award dates. Raw award evidence stays private.",
      default_value: false,
      enabled: false,
    },
  ];
}

function publishedPublicProfilePayload() {
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

function hiddenPublicProfilePayload() {
  return {
    ok: false,
    error: "PROFILE_NOT_FOUND",
    message: "The public profile is currently hidden or unavailable to visitors.",
  };
}

function jsonResponse(requestId, statusCode, payload, cacheControl = "private, no-store, no-cache, must-revalidate") {
  return {
    requestId,
    responseCode: statusCode,
    responseHeaders: [
      { name: "content-type", value: "application/json; charset=utf-8" },
      { name: "cache-control", value: cacheControl },
      { name: "vary", value: "Cookie" },
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

async function waitForAnyText(page, options, timeoutMs = 20_000) {
  const started = Date.now();
  const expected = options.map((item) => item.toLowerCase());
  while (Date.now() - started < timeoutMs) {
    const bodyText = (await pageText(page)).toLowerCase();
    if (expected.some((item) => bodyText.includes(item))) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for one of: ${options.join(", ")}`);
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
    "# Public Profile Owner Preview Share Rendered QA - 2026-09-01",
    "",
    "This local artifact proves the private `/player/profile` owner preview/share panel renders published, disabled, hidden-response, unavailable, desktop, and mobile states. It uses a headless browser against the local Next app and intercepts only `/api/auth/me`, `/api/dzn-pulse/config`, `/api/player/hub`, `/api/player/profile/privacy`, `/api/player/community-memberships/refresh`, and `/api/public/players/*` with sanitized representative JSON.",
    "",
    "No production D1, Stripe, Cloudflare secret/config, Nitrado, Discord runtime, Store/payment, live checkout, retained export, analytics/tracking, DZN Comms runtime, DZN Assist AI, scoring, ranking, discovery, review, progression, award, event, Server Wars, CTF, or competitive-system mutation is used by this QA harness.",
    "",
    "## Captures",
    "",
    "| Scenario | Viewport | Screenshot | Proof |",
    "| --- | --- | --- | --- |",
    ...results.map((result) => `| ${result.scenario} | ${result.viewport} | [${result.screenshot}](${result.screenshot}) | ${result.assertions} text/boundary/overlap${result.interactionProof ? "/interaction" : ""} checks |`),
    "",
    "## Verified States",
    "",
    "- Published current-owner profile renders the same public-safe profile payload a visitor receives, including public handle, safe gameplay totals, and featured server.",
    "- Mobile published profile renders the owner preview/share panel without obvious interactive-element overlap.",
    "- Disabled public profile keeps sharing locked and does not call private identifiers or public visitor data into the rendered text.",
    "- Stale hidden public response keeps sharing locked until the public visitor response is visible again.",
    "- Unavailable public response keeps sharing locked until the public visitor response can be verified.",
    "- Copy controls report current-page-session feedback only, the share control is available for verified public previews, and the interaction proof checks browser storage remains empty.",
    "- The harness asserts no raw Discord IDs, DZN user IDs, player IDs, raw award evidence, checkout events, Store ledgers, or Supporter Card serials appear in rendered text.",
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
      result.interactionProof ? `Interaction proof: ${JSON.stringify(result.interactionProof)}.` : "Interaction proof: not required for this state.",
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
