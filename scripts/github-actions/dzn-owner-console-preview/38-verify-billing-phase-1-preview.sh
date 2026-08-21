set -euo pipefail

if [ "${MODE}" != "billing-phase-1-preview" ]; then
  echo "::error::38-verify-billing-phase-1-preview.sh may only run in billing-phase-1-preview mode."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" != "${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "dzn-network" ]; then
  echo "::error::Refusing Billing preview verification for a non-dedicated or production Pages project."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-}" ]; then
  echo "::error::Refusing Billing preview verification for production D1 database name."
  exit 1
fi
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ]; then
  echo "::error::Refusing Billing preview verification because preview D1 id equals production D1 id."
  exit 1
fi

BILLING_ARTIFACT_DIR="${BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR:-dzn-billing-phase-1-preview}"
mkdir -p "${BILLING_ARTIFACT_DIR}"

node <<'NODE'
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const artifact = process.env.BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR || "dzn-billing-phase-1-preview";
const prefix = "billing-phase1-preview-";
const expectedProject = "dzn-network-owner-console-preview-billing-phase-1";
const stableUrl = assertDedicatedUrl(process.env.BILLING_PHASE_1_STABLE_PREVIEW_URL || process.env.PREVIEW_BASE_URL, "stable");
const immutableUrl = assertDedicatedUrl(process.env.BILLING_PHASE_1_IMMUTABLE_PREVIEW_URL || readImmutableFromArtifact(), "immutable");
const ownerACookie = process.env.BILLING_OWNER_A_COOKIE;
const ownerBCookie = process.env.BILLING_OWNER_B_COOKIE;
const forbiddenRuntimeText = [
  "Request failed: 503",
  "SERVER UNAVAILABLE",
  "Error 1102",
  "Worker exceeded resource limits",
  "Minified React error #",
];
const forbiddenLeakMarkers = [
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
  "STRIPE_SECRET",
  "encrypted_token",
  "token_iv",
  "token_auth_tag",
  "session_token_hash",
  process.env.TOKEN_ENCRYPTION_KEY,
  process.env.BILLING_OWNER_A_SESSION_TOKEN,
  process.env.BILLING_OWNER_B_SESSION_TOKEN,
].filter(Boolean);
const endpointSummary = {
  ok: false,
  groups: [],
  statuses: {},
  candidateSha: process.env.CANDIDATE_SHA,
  branch: process.env.CANDIDATE_BRANCH,
  projectName: process.env.PREVIEW_PROJECT_NAME,
  d1Name: process.env.PREVIEW_DB_NAME,
  d1Id: maskId(process.env.PREVIEW_D1_DATABASE_ID || ""),
  stableUrl,
  immutableUrl,
};
const ownershipSummary = { ok: false, fixturePrefix: prefix, checks: {} };
const allowanceSummary = { ok: false, fixturePrefix: prefix, counts: {} };
const compareSummary = { ok: false, stableUrl, immutableUrl, comparedPaths: [] };
const endpointBodies = [];

function readImmutableFromArtifact() {
  try {
    const parsed = JSON.parse(fs.readFileSync(`${artifact}/stable-vs-immutable-summary.json`, "utf8"));
    return String(parsed.immutableUrl || "");
  } catch {
    return "";
  }
}
function fail(code, message, details = {}) {
  endpointSummary.ok = false;
  endpointSummary.failure = { code, message: sanitize(message), details: sanitizeObject(details) };
  writeArtifacts(false);
  console.error(`${code}: ${message}`);
  process.exit(1);
}
function sanitize(value) {
  let text = String(value ?? "");
  for (const marker of forbiddenLeakMarkers) text = text.split(marker).join("[redacted]");
  return text
    .replace(/dzn_session=[^;\s"]+/gi, "dzn_session=[redacted]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .slice(0, 500);
}
function sanitizeObject(input) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, sanitize(value)]));
}
function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}
function assertDedicatedUrl(url, label) {
  if (!url) throw new Error(`Billing ${label} URL is missing.`);
  const parsed = new URL(url);
  if (parsed.hostname === "dzn-network.pages.dev" || parsed.hostname.endsWith(".dzn-network.pages.dev")) {
    throw new Error(`Billing ${label} URL points at production Pages.`);
  }
  if (parsed.hostname !== `${expectedProject}.pages.dev` && !parsed.hostname.endsWith(`.${expectedProject}.pages.dev`)) {
    throw new Error(`Billing ${label} URL is outside the dedicated project: ${parsed.hostname}`);
  }
  return url.replace(/\/+$/, "");
}
function recordGroup(name, result = "PASS") {
  endpointSummary.groups.push({ name, result });
}
function statusKey(base, path, method) {
  const label = base === stableUrl ? "stable" : base === immutableUrl ? "immutable" : "preview";
  return `${label} ${method || "GET"} ${path}`;
}
async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchWithRetry(base, path, init = {}, options = {}) {
  const attempts = options.attempts ?? 36;
  const waitMs = options.waitMs ?? 5000;
  const method = String(init.method || "GET").toUpperCase();
  const transientStatuses = new Set([522, 523, 524, 525, 526, 530]);
  if (!options.allowApi404) transientStatuses.add(404);
  let lastError = null;
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "cache-control": "no-cache",
          ...(init.headers || {}),
        },
      });
      const body = await response.text();
      lastStatus = response.status;
      lastBody = body;
      endpointSummary.statuses[statusKey(base, path, method)] = response.status;
      endpointBodies.push(body.slice(0, 2000));
      const shouldRetryTransient = transientStatuses.has(response.status) && attempt < attempts;
      if (!shouldRetryTransient) checkRuntimeFailure(path, response.status, body, options);
      if (!transientStatuses.has(response.status) || attempt === attempts) {
        return { status: response.status, body };
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < attempts) await wait(waitMs);
  }
  if (lastError) fail("BILLING_PREVIEW_FETCH_FAILED", `${path} failed after retries.`, { error: lastError instanceof Error ? lastError.message : String(lastError) });
  return { status: lastStatus, body: lastBody };
}
function checkRuntimeFailure(path, status, body, options = {}) {
  if (status === 404 && path.startsWith("/api/") && !options.allowApi404) {
    fail("BILLING_PREVIEW_PAGES_FUNCTIONS_WORKER_MISSING", `${path} returned 404, likely missing out/_worker.js.`);
  }
  if (status === 500) fail("BILLING_PREVIEW_HTTP_500", `${path} returned HTTP 500.`);
  if (status === 503) fail("BILLING_PREVIEW_HTTP_503", `${path} returned HTTP 503.`);
  for (const marker of forbiddenRuntimeText) {
    if (body.includes(marker)) fail("BILLING_PREVIEW_RUNTIME_TEXT_FAILURE", `${path} returned forbidden runtime marker.`, { marker });
  }
  for (const marker of forbiddenLeakMarkers) {
    if (marker && body.includes(marker)) fail("BILLING_PREVIEW_SECRET_LEAKAGE", `${path} leaked forbidden secret marker.`);
  }
}
async function expectStatus(base, path, expected, init = {}, label = path) {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const result = await fetchWithRetry(base, path, init, { allowApi404: expectedList.includes(404) });
  if (!expectedList.includes(result.status)) {
    fail("BILLING_PREVIEW_UNEXPECTED_STATUS", `${label} returned HTTP ${result.status}, expected ${expectedList.join("/")}.`, {
      path,
      status: result.status,
      bodyLength: result.body.length,
      bodyPreview: sanitize(result.body),
    });
  }
  return result;
}
async function jsonRequest(base, path, expected, init = {}, label = path) {
  const result = await expectStatus(base, path, expected, init, label);
  try {
    return { ...result, json: result.body ? JSON.parse(result.body) : null };
  } catch {
    fail("BILLING_PREVIEW_JSON_PARSE_FAILED", `${label} did not return JSON.`, { path, status: result.status });
  }
}
async function expectJsonErrorCode(base, path, expectedStatus, expectedCode, init, label) {
  const result = await jsonRequest(base, path, expectedStatus, init, label);
  if (result.json?.error_code !== expectedCode) {
    fail("BILLING_PREVIEW_ERROR_CODE_MISMATCH", `${label} returned the wrong safe error code.`, {
      expectedCode,
      actualCode: result.json?.error_code,
    });
  }
  return result;
}
function savePayload(sourceAlias, serviceId, guildAlias = "owner-a-draft") {
  return {
    linkedServerId: `${prefix}${sourceAlias}`,
    discordGuildId: `${prefix}${guildAlias}-guild`,
    serverType: "PVP",
    server_category: "pvp",
    tags: ["Events"],
    nitradoServiceId: serviceId,
    public_short_description: "Billing preview fixture",
  };
}
async function postJson(base, path, cookie, expected, payload, label) {
  return jsonRequest(base, path, expected, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
  }, label);
}
function rowsFromWranglerJson(raw) {
  const text = raw.replace(/^\uFEFF/, "").trim();
  const start = text.search(/[\[{]/);
  if (start < 0) fail("BILLING_PREVIEW_D1_JSON_MALFORMED", "D1 read returned no JSON.");
  const parsed = JSON.parse(text.slice(start));
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
function d1Read(label, command) {
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM)\b/i.test(command)) {
    fail("BILLING_PREVIEW_D1_READ_GUARD_FAILED", `Verifier query ${label} is not read-only.`);
  }
  const output = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--config",
    "wrangler.owner-console-preview.toml",
    "--remote",
    "--json",
    "--command",
    command,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return rowsFromWranglerJson(output);
}
function firstCount(label, command, key = "count") {
  const rows = d1Read(label, command);
  return Number(rows[0]?.[key] ?? 0);
}
function singleRow(label, command) {
  return d1Read(label, command)[0] || null;
}
function writeArtifacts(ok) {
  endpointSummary.ok = ok;
  fs.writeFileSync(`${artifact}/endpoint-status-summary.json`, JSON.stringify(endpointSummary, null, 2));
  fs.writeFileSync(`${artifact}/ownership-integrity-summary.json`, JSON.stringify(ownershipSummary, null, 2));
  fs.writeFileSync(`${artifact}/allowance-summary.json`, JSON.stringify(allowanceSummary, null, 2));
  fs.writeFileSync(`${artifact}/stable-vs-immutable-summary.json`, JSON.stringify(compareSummary, null, 2));
}

void (async () => {
  if (!ownerACookie || !ownerBCookie) fail("BILLING_PREVIEW_SESSION_COOKIE_MISSING", "Billing preview owner session cookies are missing from workflow env.");

  for (const base of [stableUrl, immutableUrl]) {
    await expectStatus(base, "/", 200, {}, "Public home health");
    await expectStatus(base, "/setup", 200, {}, "Setup page health");
    await expectStatus(base, "/dashboard", 200, {}, "Dashboard page health");
    await jsonRequest(base, "/api/dzn-pulse/config", 200, {}, "DZN Pulse config health");
  }
  recordGroup("1. Public/runtime health");

  await expectStatus(stableUrl, `/api/nitrado/services?linked_server_id=${prefix}owner-a-canonical-900001`, 401, { redirect: "manual" }, "Logged-out service discovery protection");
  await postJson(stableUrl, "/api/nitrado/validate-token", "", 401, { token: "preview", discordGuildId: `${prefix}owner-a-draft-guild`, serverType: "PVP" }, "Logged-out token validation protection");
  await postJson(stableUrl, "/api/onboarding/save", "", 401, savePayload("owner-a-source-new-900003", "900003"), "Logged-out onboarding save protection");
  recordGroup("2. Logged-out endpoint protection");

  await expectJsonErrorCode(stableUrl, "/api/nitrado/services", 400, "missing_linked_server_id", {
    headers: { Cookie: ownerACookie },
  }, "Service discovery requires linked_server_id");
  recordGroup("3. Service discovery requires linked_server_id");

  const services = await jsonRequest(stableUrl, `/api/nitrado/services?linked_server_id=${prefix}owner-a-canonical-900001`, 200, {
    headers: { Cookie: ownerACookie },
  }, "Owned linked-server service discovery");
  const serviceIds = new Set((services.json?.services || []).map((service) => String(service.id)));
  for (const serviceId of ["900001", "900002", "900003"]) {
    if (!serviceIds.has(serviceId)) fail("BILLING_PREVIEW_MOCK_SERVICE_ID_MISSING", "Mock Nitrado service ID missing.", { serviceId });
  }
  ownershipSummary.checks.ownedLinkedServerDiscovery = { status: 200, serviceIds: ["900001", "900002", "900003"] };
  recordGroup("4. Owned linked-server discovery succeeds");

  await expectJsonErrorCode(stableUrl, `/api/nitrado/services?linked_server_id=${prefix}owner-b-source-cross-900001`, 404, "linked_server_not_found", {
    headers: { Cookie: ownerACookie },
  }, "Foreign linked-server ID protection");
  ownershipSummary.checks.foreignLinkedServerProtection = { status: 404, errorCode: "linked_server_not_found" };
  recordGroup("5. Foreign linked-server ID returns safe 404");

  await expectJsonErrorCode(stableUrl, `/api/nitrado/services?linked_server_id=${prefix}missing-linked-server`, 404, "linked_server_not_found", {
    headers: { Cookie: ownerACookie },
  }, "Nonexistent linked-server ID protection");
  recordGroup("6. Nonexistent linked-server ID returns safe 404");

  await expectJsonErrorCode(stableUrl, "/api/onboarding/save", 400, "missing_nitrado_token", {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: ownerACookie },
    body: JSON.stringify(savePayload("owner-a-source-no-credential", "900002")),
  }, "No-token draft exact credential protection");
  recordGroup("7. No-token draft does not borrow another server's newer credential");

  await expectJsonErrorCode(stableUrl, "/api/onboarding/save", 500, "token_decrypt_failed", {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: ownerACookie },
    body: JSON.stringify(savePayload("owner-a-source-corrupted-credential", "900002")),
  }, "Corrupted credential classification");
  recordGroup("8. Corrupted exact credential returns safe classified decrypt failure");

  await expectJsonErrorCode(stableUrl, "/api/onboarding/save", 409, "nitrado_service_already_linked", {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: ownerBCookie },
    body: JSON.stringify(savePayload("owner-b-source-cross-900001", "900001", "owner-b-draft")),
  }, "Cross-owner service conflict");
  ownershipSummary.checks.crossOwnerConflict = { status: 409, errorCode: "nitrado_service_already_linked" };
  recordGroup("9. Cross-owner service attempt returns 409 nitrado_service_already_linked");

  const ownerBRow = singleRow("foreign-owner-row", `SELECT user_id, status, COALESCE(nitrado_service_id, '') AS service_id, COALESCE(merged_into_server_id, '') AS merged_into FROM linked_servers WHERE id = '${prefix}owner-b-source-cross-900001';`);
  if (ownerBRow?.user_id !== `${prefix}owner-b` || String(ownerBRow?.service_id || "") !== "" || String(ownerBRow?.merged_into || "") !== "") {
    fail("BILLING_PREVIEW_FOREIGN_OWNER_ROW_CHANGED", "Foreign owner source row changed after cross-owner conflict.");
  }
  recordGroup("10. Foreign owner row remains unchanged");

  const sameOwner = await postJson(stableUrl, "/api/onboarding/save", ownerACookie, 200, savePayload("owner-a-source-duplicate-900002", "900002"), "Same-owner canonical reuse");
  if (sameOwner.json?.linkedServerId !== `${prefix}owner-a-canonical-900002`) fail("BILLING_PREVIEW_SAME_OWNER_REUSE_FAILED", "Same-owner reuse did not return existing canonical 900002.");
  recordGroup("11. Same-owner 900002 reuse returns existing canonical ID");

  const mergedRow = singleRow("merged-source-row", `SELECT status, COALESCE(merged_into_server_id, '') AS merged_into FROM linked_servers WHERE id = '${prefix}owner-a-source-duplicate-900002';`);
  if (String(mergedRow?.status || "").toLowerCase() !== "merged") fail("BILLING_PREVIEW_SOURCE_DRAFT_MERGE_FAILED", "Temporary source draft was not marked merged.");
  ownershipSummary.checks.sourceDraftMerged = true;
  recordGroup("12. Temporary source draft becomes merged");

  if (mergedRow?.merged_into !== `${prefix}owner-a-canonical-900002`) fail("BILLING_PREVIEW_SOURCE_DRAFT_MERGE_TARGET_FAILED", "merged_into_server_id did not point at canonical 900002.");
  ownershipSummary.checks.mergedIntoCanonical = true;
  recordGroup("13. merged_into_server_id points at canonical");

  const movedCredentialCount = firstCount("credential-reassociation", `SELECT COUNT(*) AS count FROM nitrado_connections WHERE id = '${prefix}owner-a-source-duplicate-900002-connection' AND user_id = '${prefix}owner-a' AND linked_server_id = '${prefix}owner-a-canonical-900002';`);
  if (movedCredentialCount !== 1) fail("BILLING_PREVIEW_CREDENTIAL_REASSOCIATION_FAILED", "Same-owner credential was not moved to the canonical server.");
  ownershipSummary.checks.sameOwnerCredentialMoved = true;
  recordGroup("14. Same-owner credentials move safely");

  const duplicateReservationReleased = firstCount("duplicate-reservation-released", `SELECT COUNT(*) AS count FROM linked_server_allowance_reservations WHERE id = '${prefix}owner-a-source-duplicate-900002-reservation' AND status = 'released' AND release_reason = 'same_owner_canonical_reuse';`);
  if (duplicateReservationReleased !== 1) fail("BILLING_PREVIEW_DUPLICATE_RESERVATION_NOT_RELEASED", "Duplicate same-owner reservation was not released.");
  recordGroup("15. Duplicate reservation is released");

  const service900002Count = firstCount("service-900002-active-count", `SELECT COUNT(*) AS count FROM linked_servers WHERE nitrado_service_id = '900002' AND lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted') AND (merged_into_server_id IS NULL OR merged_into_server_id = '');`);
  if (service900002Count !== 1) fail("BILLING_PREVIEW_DUPLICATE_SERVER_CREATED", "Same-owner reuse created a duplicate active 900002 server.");
  recordGroup("16. No duplicate server");

  const announcementCountBeforeNew = firstCount("announcement-count-before-new", `SELECT COUNT(*) AS count FROM discord_announcement_posts WHERE server_id LIKE '${prefix}%';`);
  if (announcementCountBeforeNew !== 0) fail("BILLING_PREVIEW_UNEXPECTED_ANNOUNCEMENT_BEFORE_NEW", "Discord announcement row exists before new-server scenario.");
  recordGroup("17. No second announcement");

  const firstClaim = await postJson(stableUrl, "/api/onboarding/save", ownerACookie, 200, savePayload("owner-a-source-new-900003", "900003"), "First-time service claim");
  if (firstClaim.json?.linkedServerId !== `${prefix}owner-a-source-new-900003`) fail("BILLING_PREVIEW_FIRST_TIME_CLAIM_FAILED", "First-time service 900003 claim did not preserve the source linked-server ID.");
  recordGroup("18. First-time 900003 claim succeeds");

  const completedReservation = firstCount("new-service-reservation-completed", `SELECT COUNT(*) AS count FROM linked_server_allowance_reservations WHERE id = '${prefix}owner-a-source-new-900003-reservation' AND status = 'completed' AND linked_server_id = '${prefix}owner-a-source-new-900003';`);
  if (completedReservation !== 1) fail("BILLING_PREVIEW_RESERVATION_COMPLETION_MISSING", "Correct first-time reservation did not complete.");
  recordGroup("19. Correct reservation completes");

  const completedActiveHoldCount = firstCount("completed-hold-active-count", `SELECT COUNT(*) AS count FROM linked_server_allowance_reservations WHERE id = '${prefix}owner-a-source-new-900003-reservation' AND status = 'active';`);
  if (completedActiveHoldCount !== 0) fail("BILLING_PREVIEW_COMPLETED_HOLD_DOUBLE_COUNTS", "Completed reservation still counts as active.");
  recordGroup("20. Completed hold does not double-count");

  const repeatedClaim = await postJson(stableUrl, "/api/onboarding/save", ownerACookie, 200, savePayload("owner-a-source-new-900003", "900003"), "Repeated first-time save");
  if (repeatedClaim.json?.linkedServerId !== `${prefix}owner-a-source-new-900003`) fail("BILLING_PREVIEW_REPEATED_SAVE_IDEMPOTENCY_FAILED", "Repeated save did not remain idempotent.");
  const service900003Count = firstCount("service-900003-count", `SELECT COUNT(*) AS count FROM linked_servers WHERE nitrado_service_id = '900003' AND lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted') AND (merged_into_server_id IS NULL OR merged_into_server_id = '');`);
  if (service900003Count !== 1) fail("BILLING_PREVIEW_REPEATED_SAVE_DUPLICATED_SERVICE", "Repeated save created duplicate 900003 service rows.");
  recordGroup("21. Repeated first-time save is idempotent");

  await postJson(stableUrl, "/api/onboarding/test", ownerACookie, 200, {}, "Mock onboarding test");
  recordGroup("22. Mock onboarding test works");

  await postJson(stableUrl, "/api/nitrado/test-adm-path", ownerACookie, 200, {
    linkedServerId: `${prefix}owner-a-source-new-900003`,
    path: "/games/mock/noftp/adm/mock.ADM",
  }, "Mock ADM-path test");
  recordGroup("23. Mock ADM-path test works");

  if (![...serviceIds].every((serviceId) => ["900001", "900002", "900003"].includes(serviceId))) {
    fail("BILLING_PREVIEW_NON_MOCK_NITRADO_SERVICE_RETURNED", "Service discovery returned non-mock Nitrado service IDs.");
  }
  recordGroup("24. No real Nitrado request");

  const announcementCountAfterNew = firstCount("announcement-count-after-new", `SELECT COUNT(*) AS count FROM discord_announcement_posts WHERE server_id LIKE '${prefix}%';`);
  if (announcementCountAfterNew !== 0) fail("BILLING_PREVIEW_DISCORD_SEND_RECORDED", "Discord announcement rows were recorded while announcements are disabled.");
  recordGroup("25. No Discord send");

  const pulse = await jsonRequest(stableUrl, "/api/dzn-pulse/config", 200, {}, "Notifications disabled config");
  if (pulse.json?.discordNotificationsEnabled !== false) fail("BILLING_PREVIEW_NOTIFICATIONS_ENABLED", "DZN Discord notifications flag is not false.");
  if (process.env.DZN_DISCORD_NOTIFICATIONS_ENABLED !== "false" || process.env.DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED !== "false") {
    fail("BILLING_PREVIEW_DISCORD_FLAGS_ENABLED", "Workflow Discord notification flags are not both false.");
  }
  recordGroup("26. Notifications and server announcements remain false");

  for (const path of ["/", "/setup", "/dashboard", "/api/dzn-pulse/config", `/api/nitrado/services?linked_server_id=${prefix}owner-a-canonical-900001`]) {
    const init = path.startsWith("/api/nitrado") ? { headers: { Cookie: ownerACookie } } : {};
    const stableResult = await fetchWithRetry(stableUrl, path, init);
    const immutableResult = await fetchWithRetry(immutableUrl, path, init);
    compareSummary.comparedPaths.push({ path, stableStatus: stableResult.status, immutableStatus: immutableResult.status });
    if (stableResult.status !== immutableResult.status) fail("BILLING_PREVIEW_STABLE_IMMUTABLE_MISMATCH", "Stable and immutable preview status mismatch.", { path, stableStatus: stableResult.status, immutableStatus: immutableResult.status });
  }
  compareSummary.ok = true;
  recordGroup("27. Stable and immutable results are behaviourally consistent");

  const fkRows = d1Read("final-foreign-key-check", "PRAGMA foreign_key_check;");
  if (fkRows.length !== 0) fail("BILLING_PREVIEW_FINAL_FOREIGN_KEY_CHECK_FAILED", "Final foreign_key_check returned rows.", { count: fkRows.length });
  recordGroup("28. Final foreign-key check returns zero rows");

  const crossOwnerTransferCount = firstCount("cross-owner-transfer-count", `SELECT COUNT(*) AS count FROM linked_servers WHERE id = '${prefix}owner-a-canonical-900001' AND user_id != '${prefix}owner-a';`);
  const foreignConnectionMoveCount = firstCount("foreign-credential-transfer-count", `SELECT COUNT(*) AS count FROM nitrado_connections WHERE user_id = '${prefix}owner-b' AND linked_server_id = '${prefix}owner-a-canonical-900001';`);
  if (crossOwnerTransferCount !== 0 || foreignConnectionMoveCount !== 0) fail("BILLING_PREVIEW_CROSS_OWNER_TRANSFER", "Cross-owner ownership or credential transfer occurred.");
  ownershipSummary.checks.noCrossOwnerOwnershipTransfer = true;
  recordGroup("29. No cross-owner ownership transfer");

  const artifactText = [
    JSON.stringify(endpointSummary),
    JSON.stringify(ownershipSummary),
    JSON.stringify(allowanceSummary),
    JSON.stringify(compareSummary),
    ...endpointBodies,
  ].join("\n");
  for (const marker of forbiddenLeakMarkers) {
    if (marker && artifactText.includes(marker)) fail("BILLING_PREVIEW_ARTIFACT_SECRET_LEAKAGE", "Sanitized Billing artifact contained a forbidden marker.");
  }
  ownershipSummary.ok = true;
  allowanceSummary.ok = true;
  allowanceSummary.counts = {
    duplicateReservationReleased,
    completedReservation,
    completedActiveHoldCount,
    service900002Count,
    service900003Count,
    announcementCount: announcementCountAfterNew,
  };
  recordGroup("30. No credential or session secret leakage");

  writeArtifacts(true);
  console.log("Billing Phase 1 isolated preview verification passed.");
})().catch((error) => {
  fail("BILLING_PREVIEW_VERIFIER_EXCEPTION", error instanceof Error ? error.message : String(error));
});
NODE

{
  echo "## Billing Phase 1 Preview Verification"
  echo ""
  echo "- Stable URL: ${BILLING_PHASE_1_STABLE_PREVIEW_URL}"
  echo "- Immutable URL: ${BILLING_PHASE_1_IMMUTABLE_PREVIEW_URL}"
  echo "- Verification groups: 30"
  echo "- Secret values written to artifact: false"
  echo "- Foreign owner data leakage: blocked"
} >> "$GITHUB_STEP_SUMMARY"
