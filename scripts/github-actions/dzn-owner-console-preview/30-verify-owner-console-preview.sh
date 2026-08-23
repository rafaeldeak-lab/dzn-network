set -euo pipefail

node <<'NODE'
const fs = require("node:fs");
const base = process.env.PREVIEW_BASE_URL;
const deployedBase = fs.existsSync("owner-console-preview-immutable-url.txt")
  ? fs.readFileSync("owner-console-preview-immutable-url.txt", "utf8").trim()
  : "";
const verificationBase = deployedBase || base;
const ownerCookie = process.env.OWNER_CONSOLE_OWNER_COOKIE;
const creatorCookie = process.env.OWNER_CONSOLE_CREATOR_COOKIE;
const nonOwnerCookie = process.env.OWNER_CONSOLE_NON_OWNER_COOKIE;
const creatorEventName = process.env.OWNER_CONSOLE_CREATOR_EVENT_NAME;
const ownerDiscordId = process.env.OWNER_CONSOLE_PREVIEW_OWNER_ID;
const creatorDiscordId = process.env.OWNER_CONSOLE_PREVIEW_CREATOR_ID;
const expectedDiscordClientId = process.env.OWNER_PREVIEW_DISCORD_CLIENT_ID;
const expectedDiscordRedirectUri = process.env.OWNER_PREVIEW_DISCORD_REDIRECT_URI;
const retryablePreviewStatuses = new Set([522, 523, 524, 525, 526, 530]);
const forbiddenText = [
  "Request failed: 503",
  "SERVER UNAVAILABLE",
  "Error 1102",
  "Worker exceeded resource limits",
  "Minified React error #",
];
const forbiddenSecrets = [
  "encrypted_token",
  "token_iv",
  "token_auth_tag",
  "DISCORD_BOT_TOKEN",
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "DZN_PLATFORM_OWNER_DISCORD_IDS",
  "DZN_PLATFORM_CREATOR_DISCORD_ID",
  ownerDiscordId,
  creatorDiscordId,
].filter(Boolean);
function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}
assert(/^Creator Governance Preview Cup [a-f0-9]{7}$/.test(creatorEventName ?? ""), "Creator governance event name must be SHA-scoped.");
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchOnce(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    return await fetch(`${verificationBase}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
async function fetchWithTimeout(path, init = {}, options = {}) {
  const attempts = options.attempts ?? 12;
  const waitMs = options.waitMs ?? 7500;
  let lastError = null;
  let lastResponse = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchOnce(path, init);
      lastResponse = response;
      console.log(`Owner console preview route ${path} attempt ${attempt}/${attempts}: HTTP ${response.status}`);
      if (!retryablePreviewStatuses.has(response.status)) {
        return response;
      }
    } catch (error) {
      lastError = error;
      console.log(`Owner console preview route ${path} attempt ${attempt}/${attempts}: ${error instanceof Error ? error.name : "fetch_error"}`);
    }
    if (attempt < attempts) {
      await delay(waitMs);
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error(`Failed to fetch ${path}.`);
}
async function waitForPreviewReady() {
  console.log(`Waiting for owner console preview readiness at ${verificationBase}`);
  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchOnce("/", { redirect: "manual" });
      const body = await response.text();
      console.log(`Owner console preview readiness attempt ${attempt}/${maxAttempts}: HTTP ${response.status}`);
      if (response.status === 200 && !forbiddenText.some((snippet) => body.includes(snippet))) {
        return;
      }
      if (!retryablePreviewStatuses.has(response.status) && response.status !== 404) {
        assert(response.status !== 503, "Preview readiness returned HTTP 503.");
        assert(!body.includes("Error 1102"), "Preview readiness returned Error 1102.");
      }
    } catch (error) {
      console.log(`Owner console preview readiness attempt ${attempt}/${maxAttempts}: ${error instanceof Error ? error.name : "fetch_error"}`);
    }
    if (attempt < maxAttempts) {
      await delay(7500);
    }
  }
  console.error("Owner console preview did not become ready within 5 minutes.");
  process.exit(1);
}
function sanitizePreviewDiagnostic(value) {
  let text = String(value ?? "");
  for (const secret of forbiddenSecrets) {
    if (secret) text = text.split(secret).join("[redacted-secret]");
  }
  for (const secret of [ownerCookie, creatorCookie, nonOwnerCookie].filter(Boolean)) {
    text = text.split(secret).join("[redacted-cookie]");
  }
  return text
    .replace(/dzn_session=[^;\s"]+/gi, "dzn_session=[redacted-cookie]")
    .replace(/\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA)\b[\s\S]{0,240}/gi, "[redacted-sql]")
    .replace(/\b\d{16,24}\b/g, "[redacted-id]")
    .replace(/\b[a-f0-9]{32}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .slice(0, 240);
}
function safeJsonDiagnostic(body) {
  try {
    const parsed = JSON.parse(body || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { jsonKeys: [] };
    }
    const keys = Object.keys(parsed)
      .filter((key) => !/cookie|session|secret|token|authorization|discord|owner|channel|sql/i.test(key))
      .slice(0, 20);
    const diagnostic = { jsonKeys: keys };
    for (const key of ["error", "errorCode", "requestId", "message"]) {
      if (typeof parsed[key] === "string") {
        diagnostic[key] = sanitizePreviewDiagnostic(parsed[key]);
      }
    }
    return diagnostic;
  } catch {
    return { jsonKeys: [] };
  }
}
function printUnexpectedResponseDiagnostic(path, expected, response, body, init) {
  const diagnostic = {
    path,
    method: String(init.method ?? "GET").toUpperCase(),
    actualStatus: response.status,
    expectedStatus: expected,
    contentType: response.headers.get("content-type") ?? "",
    ...safeJsonDiagnostic(body),
    bodyLength: body.length,
    messagePreview: sanitizePreviewDiagnostic(body),
  };
  console.error(`Unexpected owner console preview response: ${JSON.stringify(diagnostic)}`);
}
async function expectStatus(path, expected, init = {}) {
  const response = await fetchWithTimeout(path, init);
  const body = await response.text();
  if (response.status !== expected) {
    printUnexpectedResponseDiagnostic(path, expected, response, body, init);
  }
  assert(response.status === expected, `${path} returned HTTP ${response.status}, expected ${expected}.`);
  for (const snippet of forbiddenText) {
    assert(!body.includes(snippet), `${path} contains forbidden runtime text: ${snippet}`);
  }
  return { response, body };
}
async function ownerJson(path, cookie, expected) {
  const { response, body } = await expectStatus(path, expected, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  for (const secret of forbiddenSecrets) {
    assert(!body.includes(secret), `${path} leaked forbidden owner/secret value.`);
  }
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  return { response, body, parsed };
}
async function postJson(path, cookie, expected, payload) {
  const { response, body } = await expectStatus(path, expected, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(payload),
    redirect: "manual",
  });
  for (const secret of forbiddenSecrets) {
    assert(!body.includes(secret), `${path} leaked forbidden owner/secret value.`);
  }
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  return { response, body, parsed };
}
void (async () => {
  await waitForPreviewReady();
  const discordStart = await fetchWithTimeout("/api/auth/discord/start?returnTo=%2Fowner", { redirect: "manual" });
  assert(discordStart.status === 302, `/api/auth/discord/start?returnTo=%2Fowner returned HTTP ${discordStart.status}, expected 302.`);
  const discordLocation = discordStart.headers.get("location") ?? "";
  assert(discordLocation.startsWith("https://discord.com/oauth2/authorize"), "Discord auth start did not redirect to Discord.");
  const discordAuthorize = new URL(discordLocation);
  assert(discordAuthorize.searchParams.get("client_id") === expectedDiscordClientId, "Discord auth start used the wrong preview client id.");
  assert(
    discordAuthorize.searchParams.get("redirect_uri") === expectedDiscordRedirectUri,
    "Discord auth start used the wrong preview callback URL.",
  );

  const loggedOutOwner = await fetchWithTimeout("/owner", { redirect: "manual" });
  assert([302, 401, 403].includes(loggedOutOwner.status), `/owner logged-out returned ${loggedOutOwner.status}.`);
  if (loggedOutOwner.status === 302) {
    assert((loggedOutOwner.headers.get("location") ?? "").includes("/login"), "/owner logged-out redirect should point to login.");
  }

  await expectStatus("/owner", 403, { headers: { cookie: nonOwnerCookie }, redirect: "manual" });
  await expectStatus("/owner", 200, { headers: { cookie: ownerCookie }, redirect: "manual" });
  await expectStatus("/owner", 200, { headers: { cookie: creatorCookie }, redirect: "manual" });

  for (const path of ["/api/owner/overview", "/api/owner/servers", "/api/owner/servers/owner-console-nuketown", "/api/owner/audit-log"]) {
    await ownerJson(path, "", 401);
    await ownerJson(path, nonOwnerCookie, 403);
    await ownerJson(path, ownerCookie, 200);
    await ownerJson(path, creatorCookie, 200);
  }

  const overview = await ownerJson("/api/owner/overview", ownerCookie, 200);
  assert(overview.parsed?.overview?.featureFlags?.discordNotificationsEnabled === false, "Owner overview should show Discord Pulse delivery disabled.");
  assert(overview.parsed?.overview?.featureFlags?.dznPulseEnabled === true, "Owner overview should show DZN Pulse enabled in preview config.");
  assert(overview.parsed?.overview?.knownServers?.nuketown?.lifecycleStatus === "active_live", "NukeTown should appear active_live.");
  assert(overview.parsed?.overview?.knownServers?.pandora?.lifecycleStatus === "legacy_offline", "PANDORA should appear as historical/legacy.");
  assert(overview.parsed?.overview?.knownServers?.warlords?.lifecycleStatus === "archived_hidden", "Warlords should appear archived_hidden internally.");

  const servers = await ownerJson("/api/owner/servers", ownerCookie, 200);
  const text = JSON.stringify(servers.parsed ?? {});
  assert(text.includes("owner-console-nuketown"), "Owner servers should include NukeTown preview row.");
  assert(text.includes("owner-console-pandora"), "Owner servers should include PANDORA preview row.");
  assert(text.includes("owner-console-warlords"), "Owner servers should include Warlords internal archived row.");
  assert(text.includes("Archived / hidden"), "Owner servers should include archived-hidden owner copy.");
  assert(text.includes("Legacy offline"), "Owner servers should include legacy/offline owner copy.");
  assert(!text.includes("encryptedToken"), "Owner servers should not expose encrypted token blobs.");

  const loggedOutOwnerEvents = await fetchWithTimeout("/owner/events", { redirect: "manual" });
  assert([302, 401, 403].includes(loggedOutOwnerEvents.status), `/owner/events logged-out returned ${loggedOutOwnerEvents.status}.`);
  await expectStatus("/owner/events", 403, { headers: { cookie: nonOwnerCookie }, redirect: "manual" });
  await expectStatus("/owner/events", 200, { headers: { cookie: ownerCookie }, redirect: "manual" });
  await expectStatus("/owner/events", 200, { headers: { cookie: creatorCookie }, redirect: "manual" });
  await expectStatus("/owner/events/create", 403, { headers: { cookie: nonOwnerCookie }, redirect: "manual" });
  await expectStatus("/owner/events/create", 200, { headers: { cookie: ownerCookie }, redirect: "manual" });
  await expectStatus("/owner/events/create", 200, { headers: { cookie: creatorCookie }, redirect: "manual" });

  await ownerJson("/api/owner/events", "", 401);
  await ownerJson("/api/owner/events", nonOwnerCookie, 403);
  const nonCreatorOwnerEvents = await ownerJson("/api/owner/events", ownerCookie, 200);
  assert(nonCreatorOwnerEvents.parsed?.creatorEventAdmin === false, "Non-creator owner must not receive creator event admin capability.");
  const creatorOwnerEvents = await ownerJson("/api/owner/events", creatorCookie, 200);
  assert(creatorOwnerEvents.parsed?.creatorEventAdmin === true, "Configured creator should receive creator event admin capability.");
  assert(creatorOwnerEvents.parsed?.creatorEventGovernanceConfigured === true, "Creator event governance should report configured without exposing ids.");

  const createPayload = {
    name: creatorEventName,
    description: "Preview-only official event created by the fake creator identity.",
    event_type: "community_cup",
    hosting_server_id: "owner-console-creator-host",
    starts_at: "2026-08-01T18:00:00.000Z",
    ends_at: "2026-08-01T20:00:00.000Z",
    server_limit: 8,
    team_limit: 8,
    status: "registration_open",
    visibility: "public",
  };
  await postJson("/api/owner/events", "", 401, createPayload);
  await postJson("/api/owner/events", nonOwnerCookie, 403, createPayload);
  await postJson("/api/owner/events", ownerCookie, 403, { ...createPayload, creator: true, role: "platform_creator_event_admin" });
  await postJson("/api/events/create?role=platform_creator_event_admin", ownerCookie, 403, { ...createPayload, creator: true });
  const existingCreatorEvent = Array.isArray(creatorOwnerEvents.parsed?.events)
    ? creatorOwnerEvents.parsed.events.find((event) => event?.name === creatorEventName)
    : null;
  const created = existingCreatorEvent
    ? { parsed: { ok: true, event_slug: existingCreatorEvent.slug } }
    : await postJson("/api/owner/events", creatorCookie, 200, createPayload);
  assert(created.parsed?.ok === true, "Creator event create API should succeed for the configured fake creator or reuse the preserved preview fixture.");
  assert(typeof created.parsed?.event_slug === "string" && created.parsed.event_slug.length > 0, "Creator event create response should include an event slug.");

  await expectStatus("/", 200);
  await expectStatus("/events", 200);
  const publicCreate = await expectStatus("/events/create", 200);
  assert(publicCreate.body.includes("Official DZN events are created and published by the DZN platform creator."), "/events/create should show creator-managed public copy.");
  assert(!publicCreate.body.includes("Create competitive event"), "/events/create must not expose the official event creation form.");
  await expectStatus("/events/suggest", 200);
  await expectStatus("/servers", 200);
  await expectStatus("/leaderboards", 200);
  await expectStatus("/events/challenges", 200);
  await expectStatus("/events/server-wars", 200);
  await expectStatus("/events/tournaments", 200);
  await expectStatus("/seasons", 200);
  await expectStatus("/dashboard", 200);
  await expectStatus("/dzn-pulse", 200);
  await expectStatus("/api/public/servers", 200);
  await expectStatus("/api/public/home-stats", 200);
  await expectStatus("/api/public/leaderboards", 200);
  await expectStatus("/api/public/server-rail", 200);
  const pulseConfig = await ownerJson("/api/dzn-pulse/config", "", 200);
  assert(pulseConfig.parsed?.dznPulseEnabled === true || pulseConfig.parsed?.config?.dznPulseEnabled === true, "DZN Pulse should remain enabled in preview config.");
  assert(
    pulseConfig.parsed?.discordNotificationsEnabled === false || pulseConfig.parsed?.config?.discordNotificationsEnabled === false,
    "Discord Pulse delivery must remain false.",
  );

  console.log("Owner console preview verification passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

{
  MASKED_PREVIEW_D1_ID="${PREVIEW_D1_DATABASE_ID:0:8}...${PREVIEW_D1_DATABASE_ID: -4}"
  echo "## DZN Owner Console Preview Result"
  echo ""
  echo "- Preview URL: ${PREVIEW_BASE_URL}"
  echo "- Preview D1 database name: ${PREVIEW_DB_NAME}"
  echo "- Preview D1 database id: ${MASKED_PREVIEW_D1_ID}"
  echo "- /owner logged-out protection: passed"
  echo "- Discord OAuth start route: passed"
  echo "- /owner non-owner 403: passed"
  echo "- /owner allowlisted owner access: passed"
  echo "- Owner API auth protection: passed"
  echo "- Owner API secret redaction: passed"
  echo "- Creator-only Event Control preview: passed"
  echo "- Public routes/dashboard/dzn-pulse: passed"
  echo "- DZN_DISCORD_NOTIFICATIONS_ENABLED: false"
  echo "- DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: false"
  echo "- Production D1 writes: none"
  echo "- Production Pages deploy: none"
} >> "$GITHUB_STEP_SUMMARY"
