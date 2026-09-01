import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const NEXT_PORT = Number(process.env.DZN_PLAYER_HUB_QA_PORT ?? 3093);
const CHROME_PORT = Number(process.env.DZN_PLAYER_HUB_QA_CHROME_PORT ?? 9229);
const BASE_URL = `http://127.0.0.1:${NEXT_PORT}`;
const OUT_DIR = path.join(ROOT, "docs", "qa", "player-hub-rendered-qa-20260901");
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const CHROME_USER_DATA = path.join(tmpdir(), `dzn-player-hub-rendered-qa-${Date.now()}`);

const chromePath = process.env.CHROME_PATH ?? findChromePath();
if (!chromePath) {
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to run rendered Player Hub QA.");
}
if (typeof WebSocket === "undefined") {
  throw new Error("Rendered Player Hub QA requires a Node.js runtime with built-in WebSocket support.");
}

const scenarios = {
  rich: {
    auth: authPayload(),
    hub: richHubPayload(),
    mustContain: [
      "Player Hub",
      "Rafael DZN",
      "Pandora Squad",
      "Followed Servers",
      "Matched Communities",
      "Suggested Events",
      "Survival Showdown",
      "Followed server",
      "Community Night Ops",
      "Matched community",
      "451/512 servers",
      "Public Network Briefing",
      "Public network",
      "These suggestions are private to your Player Hub and stay presentation-only.",
      "Profile & Progression",
      "Current Profile Signals",
      "421m",
      "future earned runtime",
      "This profile summary is private and read-only.",
    ],
    mustNotContain: [
      "200000000000000001",
      "discord_guild_id",
      "owner_user_id",
      "STRIPE",
      "checkout.session",
    ],
  },
  profilePrivacy: {
    auth: authPayload("Rafael DZN"),
    hub: richHubPayload(),
    privacy: profilePrivacyPayload(),
    mustContain: [
      "Personal Player Profile",
      "Profile & Progression",
      "Profile Privacy Preferences",
      "Public profile",
      "Gameplay summary",
      "Calling cards",
      "Private by default",
      "Last saved: not saved yet",
      "public profile viewer, handle generation, and profile attribution remain blocked",
      "These settings do not write public profile routes",
    ],
    mustNotContain: [
      "public_profile_href: /players",
      "STRIPE",
      "checkout.session",
      "DZN-SUP",
      "PrivatePlayerName",
    ],
  },
  empty: {
    auth: authPayload("Nova Rift"),
    hub: emptyHubPayload(),
    mustContain: [
      "No followed servers yet",
      "No public DZN matches yet",
      "No suggested events yet",
      "No Discord-linked public gameplay profile rows were found for this account yet.",
      "Presentation Only",
      "Owner Setup Stays Gated",
    ],
    mustNotContain: [
      "STRIPE",
      "checkout.session",
      "Nitrado token",
    ],
  },
  unavailable: {
    auth: authPayload("Signal Runner"),
    hubStatus: 503,
    hub: {
      ok: false,
      message: "Player Hub data is not available right now.",
    },
    mustContain: [
      "Player Hub Data Unavailable",
      "Player Hub data is not available right now.",
      "Owner Setup Stays Gated",
    ],
    mustNotContain: [
      "STRIPE",
      "checkout.session",
      "Supporter Card",
    ],
  },
  storageFallback: {
    auth: authPayload("Fallback Scout"),
    hub: storageFallbackHubPayload(),
    mustContain: [
      "Saved-server storage is not available in this environment yet.",
      "Discord community matching is not available in this environment yet.",
      "Event storage is not available in this environment yet.",
      "Profile/progression summary storage is unavailable in this environment",
      "No followed servers yet",
      "Community matching offline",
      "No suggested events yet",
    ],
    mustNotContain: [
      "STRIPE",
      "checkout.session",
      "public score",
    ],
  },
};

const captures = [
  { scenario: "rich", viewport: "desktop", width: 1440, height: 1180 },
  { scenario: "rich", viewport: "mobile", width: 390, height: 1280, mobile: true },
  { scenario: "profilePrivacy", viewport: "desktop", width: 1440, height: 1380, path: "/player/profile" },
  { scenario: "empty", viewport: "desktop", width: 1440, height: 1050 },
  { scenario: "unavailable", viewport: "desktop", width: 1440, height: 900 },
  { scenario: "storageFallback", viewport: "desktop", width: 1440, height: 1050 },
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
      const page = await openPage(browser, capture);
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
          { urlPattern: `${BASE_URL}/api/player/hub*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/player/profile/privacy*`, requestStage: "Request" },
          { urlPattern: `${BASE_URL}/api/player/community-memberships/refresh*`, requestStage: "Request" },
        ],
      });
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: capture.width,
        height: capture.height,
        deviceScaleFactor: 1,
        mobile: Boolean(capture.mobile),
      });

      await page.send("Page.navigate", { url: `${BASE_URL}${capture.path ?? "/player"}?qa=${capture.scenario}-${capture.viewport}` });
      await waitForText(page, scenario.mustContain[0]);
      await waitForText(page, scenario.mustContain.at(-1));

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
      const filePath = path.join(SCREENSHOT_DIR, fileName);
      await writeFile(filePath, Buffer.from(screenshot.data, "base64"));

      results.push({
        scenario: capture.scenario,
        viewport: capture.viewport,
        screenshot: `screenshots/${fileName}`,
        assertions: scenario.mustContain.length + scenario.mustNotContain.length + 1,
        consoleMessages,
        failedRequests,
        textChecks: scenario.mustContain,
      });

      await page.close();
    }

    await browser.close();
    await writeReport(results);
    console.log(`Player Hub rendered QA passed. Report: ${path.relative(ROOT, path.join(OUT_DIR, "README.md"))}`);
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
  await waitForHttp(`${BASE_URL}/player`, 90_000, child);
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

async function openPage(browser, capture) {
  const page = await browser.newPage();
  page.capture = capture;
  return page;
}

async function fulfillOrContinue(page, event, scenario) {
  const url = event.request.url;
  if (url.startsWith(`${BASE_URL}/api/auth/me`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, 200, scenario.auth));
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
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, scenario.hubStatus ?? 200, scenario.hub));
    return;
  }
  if (url.startsWith(`${BASE_URL}/api/player/profile/privacy`)) {
    await page.send("Fetch.fulfillRequest", jsonResponse(event.requestId, scenario.privacyStatus ?? 200, scenario.privacy ?? profilePrivacyPayload()));
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
  await page.send("Fetch.continueRequest", { requestId: event.requestId });
}

function jsonResponse(requestId, statusCode, payload) {
  return {
    requestId,
    responseCode: statusCode,
    responseHeaders: [
      { name: "content-type", value: "application/json; charset=utf-8" },
      { name: "cache-control", value: "private, no-store, no-cache, must-revalidate" },
      { name: "vary", value: "Cookie" },
    ],
    body: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  };
}

function authPayload(username = "Rafael DZN") {
  return {
    authenticated: true,
    user: {
      id: "qa-user",
      discord_id: "redacted-discord-user",
      username,
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
        href: "/#pricing",
        tone: "trial",
      },
    },
  };
}

function richHubPayload() {
  return baseHubPayload({
    accountName: "Rafael DZN",
    saved_servers: [
      {
        linked_server_id: "server-public",
        public_slug: "pandora-squad",
        server_name: "Pandora Squad",
        server_type: "PvP Survival",
        guild_name: "Pandora Network",
        guild_icon_url: null,
        platform: "PC",
        map_name: "Chernarus",
        public_short_description: "Saved public server with active community events.",
        current_players: 42,
        max_players: 70,
        saved_at: "2026-09-01T09:40:00.000Z",
      },
      {
        linked_server_id: "server-second",
        public_slug: "signal-runner",
        server_name: "Signal Runner",
        server_type: "Adventure",
        guild_name: "Signal Crew",
        guild_icon_url: null,
        platform: "Xbox",
        map_name: "Livonia",
        public_short_description: "A quieter followed server for event discovery.",
        current_players: 18,
        max_players: 60,
        saved_at: "2026-09-01T08:10:00.000Z",
      },
    ],
    saved_server_ids: ["server-public", "server-second"],
    matched_communities: [
      {
        guild_id: "private-match-a",
        name: "Pandora Squad",
        icon_url: null,
        relationship: "member",
        relationship_label: "Member",
        public_server_count: 2,
        matched_servers: [
          {
            linked_server_id: "server-public",
            public_slug: "pandora-squad",
            server_name: "Pandora Squad",
            server_type: "PvP Survival",
            platform: "PC",
            map_name: "Chernarus",
            current_players: 42,
            max_players: 70,
          },
          {
            linked_server_id: "server-community",
            public_slug: "community-night-ops",
            server_name: "Community Night Ops",
            server_type: "Tournament",
            platform: "PlayStation",
            map_name: "Sakhal",
            current_players: 31,
            max_players: 64,
          },
        ],
      },
      {
        guild_id: "private-match-b",
        name: "DZN Admin Test Crew",
        icon_url: null,
        relationship: "administrator",
        relationship_label: "Admin",
        public_server_count: 1,
        matched_servers: [
          {
            linked_server_id: "server-admin",
            public_slug: "admin-safe-preview",
            server_name: "Admin Safe Preview",
            server_type: "Community",
            platform: "PC",
            map_name: "Namalsk",
            current_players: 9,
            max_players: 40,
          },
        ],
      },
    ],
    suggested_events: [
      {
        id: "event-public",
        name: "Survival Showdown",
        slug: "survival-showdown",
        href: "/events/survival-showdown",
        description: "A public event from a followed DZN server.",
        category: "pvp",
        category_label: "Pvp",
        event_type: "community_cup",
        event_type_label: "Community Cup",
        status: "registration_open",
        status_label: "Registration Open",
        starts_at: "2026-09-03T18:00:00.000Z",
        ends_at: null,
        registered_servers: 1,
        server_limit: 16,
        relevance: {
          level: "followed_server",
          label: "Followed server",
          reasons: [
            "A server you follow is entered.",
            "A public server from one of your private Discord matches is entered.",
          ],
          presentation_only: true,
        },
      },
      {
        id: "event-community",
        name: "Community Night Ops",
        slug: "community-night-ops",
        href: "/events/community-night-ops",
        description: "A public event from one of the player's private community matches.",
        category: "community",
        category_label: "Community",
        event_type: "tournament",
        event_type_label: "Tournament",
        status: "upcoming",
        status_label: "Upcoming",
        starts_at: "2026-09-04T20:00:00.000Z",
        ends_at: null,
        registered_servers: 451,
        server_limit: 512,
        relevance: {
          level: "matched_community",
          label: "Matched community",
          reasons: ["A public server from one of your private Discord matches is entered."],
          presentation_only: true,
        },
      },
      {
        id: "event-general",
        name: "Public Network Briefing",
        slug: "public-network-briefing",
        href: "/events/public-network-briefing",
        description: "A general public event with no private relevance input.",
        category: "community",
        category_label: "Community",
        event_type: "community_event",
        event_type_label: "Community Event",
        status: "live",
        status_label: "Live",
        starts_at: "2026-09-01T18:00:00.000Z",
        ends_at: null,
        registered_servers: 5,
        server_limit: null,
        relevance: {
          level: "public_network",
          label: "Public network",
          reasons: ["Open DZN event visible to all logged-in players."],
          presentation_only: true,
        },
      },
    ],
    sources: {
      saved_servers: "player_saved_servers",
      matched_communities: "player_discord_community_memberships",
      suggested_events: "public_competitive_events",
      profile_progression: "player_profiles",
    },
    profile_summary: defaultProfileSummary("Rafael DZN", {
      linked_game_profiles: 2,
      linked_public_servers: 2,
      last_seen_at: "2026-09-01T10:30:00.000Z",
    }),
    progression_summary: defaultProgressionSummary({
      status: "stats_available",
      gameplay_totals: {
        kills: 25,
        deaths: 7,
        suicides: 1,
        longest_kill_distance: 421.4,
      },
      featured_server: {
        linked_server_id: "server-public",
        public_slug: "pandora-squad",
        server_name: "Pandora Squad",
        server_type: "PvP Survival",
        platform: "PC",
        map_name: "Chernarus",
        kills: 18,
        deaths: 4,
        longest_kill_distance: 421.4,
        last_seen_at: "2026-09-01T10:30:00.000Z",
      },
      message: "This private summary is read from Discord-linked gameplay profile rows and is presentation-only.",
    }),
  });
}

function emptyHubPayload() {
  return baseHubPayload({
    accountName: "Nova Rift",
    saved_servers: [],
    saved_server_ids: [],
    matched_communities: [],
    suggested_events: [],
    sources: {
      saved_servers: "player_saved_servers",
      matched_communities: "player_discord_community_memberships",
      suggested_events: "public_competitive_events",
      profile_progression: "player_profiles",
    },
  });
}

function storageFallbackHubPayload() {
  return baseHubPayload({
    accountName: "Fallback Scout",
    saved_servers: [],
    saved_server_ids: [],
    matched_communities: [],
    suggested_events: [],
    sources: {
      saved_servers: "unavailable",
      matched_communities: "unavailable",
      suggested_events: "unavailable",
      profile_progression: "unavailable",
    },
    profile_summary: defaultProfileSummary("Fallback Scout", {
      source: "unavailable",
    }),
    progression_summary: defaultProgressionSummary({
      source: "unavailable",
      status: "unavailable",
      message: "Profile/progression summary storage is unavailable in this environment, so DZN shows safe private fallback copy only.",
    }),
    membershipStatus: {
      source: "unavailable",
      last_checked_at: null,
      refresh_href: "/api/player/community-memberships/refresh",
      refresh_method: "POST",
      requires_relogin: false,
      private: true,
      presentation_only: true,
      message: "Discord community matching is unavailable in this local QA state.",
    },
  });
}

function profilePrivacyPayload() {
  return {
    ok: true,
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
    sections: [
      {
        key: "public_profile_enabled",
        label: "Public profile",
        description: "Allow a future public-safe profile route to show approved sections after a handle exists.",
        default_value: false,
        enabled: false,
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
    ],
    public_profile_status: "private_by_default",
    public_profile_href: null,
    source: "defaults",
    updated_at: null,
    private: true,
    presentation_only: true,
    message: "Your profile is private by default. Public profile publishing remains blocked until the dedicated viewer slice.",
    fairness_boundary: [
      "Profile privacy preferences are player-owned display settings only.",
      "These settings do not write public profile routes, handles, awards, billing, rankings, discovery, reviews, events, Server Wars, CTF, or competitive eligibility.",
    ],
  };
}

function baseHubPayload({
  accountName,
  saved_servers,
  saved_server_ids,
  matched_communities,
  suggested_events,
  sources,
  membershipStatus,
  profile_summary,
  progression_summary,
}) {
  return {
    ok: true,
    generated_at: "2026-09-01T12:00:00.000Z",
    account: {
      display_name: accountName,
      avatar: null,
      player_home_href: "/player",
      private_profile_href: "/player/profile",
    },
    saved_servers,
    saved_server_ids,
    matched_communities,
    discord_membership_status: membershipStatus ?? {
      source: sources.matched_communities,
      last_checked_at: "2026-09-01T10:45:00.000Z",
      refresh_href: "/api/player/community-memberships/refresh",
      refresh_method: "POST",
      requires_relogin: false,
      private: true,
      presentation_only: true,
      message: "Discord community matching is private to your Player Hub and can be refreshed from this account.",
    },
    suggested_events,
    suggested_event_relevance: {
      private: true,
      presentation_only: true,
      uses_followed_servers: saved_server_ids.length > 0,
      uses_matched_communities: matched_communities.length > 0,
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
        status: "not_configured",
        description: "Public profile publishing still requires saved privacy preferences and never bypasses opt-in controls.",
      },
      {
        key: "progression",
        label: "Progression summary",
        href: "/player/profile",
        status: progression_summary?.status === "stats_available" ? "stats_ready" : progression_summary?.status ?? "empty",
        description: "Current-player gameplay summaries are read-only; XP and calling cards remain earned-only future runtimes.",
      },
    ],
    profile_summary: profile_summary ?? defaultProfileSummary(accountName),
    progression_summary: progression_summary ?? defaultProgressionSummary(),
    owner_setup: {
      href: "/pricing?intent=owner_setup&returnTo=%2Fsetup",
      gated: true,
      requires_entitlement: true,
      label: "Owner Setup",
      description: "Server setup remains behind pricing and the canonical entitlement gate.",
    },
    sources,
    fairness_boundary: [
      "Saved servers are private player preferences only.",
      "Matched communities are private player Discord membership context.",
      "Suggested event relevance is presentation-only.",
      "Profile and progression summaries are private current-user read models only.",
      "Player Hub data cannot alter billing, ownership, ranking, discovery, reviews, awards, scoring, or competitive eligibility.",
    ],
  };
}

function defaultProfileSummary(accountName, overrides = {}) {
  return {
    display_name: accountName,
    private_profile_href: "/player/profile",
    public_profile_href: null,
    public_profile_status: "not_configured",
    public_profile_message: "Public profile publishing and visibility controls stay in the dedicated profile privacy slices.",
    linked_game_profiles: 0,
    linked_public_servers: 0,
    last_seen_at: null,
    source: "player_profiles",
    private: true,
    presentation_only: true,
    ...overrides,
  };
}

function defaultProgressionSummary(overrides = {}) {
  return {
    status: "empty",
    source: "player_profiles",
    gameplay_totals: {
      kills: 0,
      deaths: 0,
      suicides: 0,
      longest_kill_distance: 0,
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
    message: "No Discord-linked public gameplay profile rows were found for this account yet.",
    private: true,
    presentation_only: true,
    ...overrides,
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
        .map((el) => ({ text: el.textContent.trim(), rect: el.getBoundingClientRect().toJSON?.() ?? {
          left: el.getBoundingClientRect().left,
          top: el.getBoundingClientRect().top,
          right: el.getBoundingClientRect().right,
          bottom: el.getBoundingClientRect().bottom,
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        }}));
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
    "# Player Hub Rendered QA - 2026-09-01",
    "",
    "This local artifact proves the rendered `/player` and `/player/profile` Player Hub states for the profile/privacy preferences slice. It uses a headless browser against the local Next app and intercepts only `/api/auth/me`, `/api/dzn-pulse/config`, `/api/player/hub`, `/api/player/profile/privacy`, and `/api/player/community-memberships/refresh` with sanitized representative JSON.",
    "",
    "No production D1, Stripe, Cloudflare secret/config, Nitrado, Discord runtime, Store/payment, live checkout, retained export, analytics, scoring, ranking, discovery, review, progression, or competitive-system mutation is used by this QA harness.",
    "",
    "## Captures",
    "",
    "| Scenario | Viewport | Screenshot | Proof |",
    "| --- | --- | --- | --- |",
    ...results.map((result) => `| ${result.scenario} | ${result.viewport} | [${result.screenshot}](${result.screenshot}) | ${result.assertions} text/boundary/overlap checks |`),
    "",
    "## Verified States",
    "",
    "- Rich current-player data: followed servers, matched Discord communities, suggested events, relevance badges, profile entry points, and private profile/progression summaries render from the private Player Hub payload.",
    "- Profile privacy proof: `/player/profile` renders saved public-profile display preferences from the private privacy API without publishing handles, public viewer routes, raw identifiers, or award evidence.",
    "- Profile/progression proof: safe current-user gameplay summary metrics render without raw player names, raw player ids, public profile handles, privacy-setting writes, or award runtime writes.",
    "- Crowded-event proof: the matched-community event renders as `451/512 servers` and still shows `Matched community`, proving irrelevant registered servers do not hide a relevant private match.",
    "- Empty state proof: followed servers, matched communities, and suggested events show useful empty states.",
    "- Unavailable state proof: a failed Player Hub API response renders the `Player Hub Data Unavailable` fallback.",
    "- Storage fallback proof: unavailable saved-server, community, and event sources render explicit local fallback notices.",
    "",
    "## Isolation",
    "",
    "- Current-user API responses are browser-intercepted local JSON only.",
    "- Suggested event relevance remains private and presentation-only.",
    "- The screenshots do not include raw Discord guild IDs or owner identifiers.",
    "- The harness asserts no obvious visible interactive-element overlaps in each capture.",
    "- The harness does not send messages, add reactions, report/moderate, call DZN Assist AI, use Durable Objects/WebSockets, or write data.",
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
