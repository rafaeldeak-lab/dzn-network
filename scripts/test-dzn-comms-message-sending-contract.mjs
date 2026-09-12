import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const contract = JSON.parse(read("docs/DZN_COMMS_MESSAGE_SENDING_CONTRACT.json"));
const document = read("docs/DZN_COMMS_MESSAGE_SENDING_CONTRACT.md");

// These check a design artifact and its inert integration, not future runtime behavior.
test("preflight does not grant runtime, release or migration approval", () => {
  assert.equal(contract.status, "preflight_only");
  assert.equal(contract.runtimeApproved, false);
  assert.equal(contract.productionApproved, false);
  assert.equal(contract.prerequisitePr, 144);
  assert.equal(contract.productionMigrationRequiresSeparateApproval, "0065_dzn_comms_read_history.sql");
  assert.equal(contract.proposedRoute.implemented, false);
  assert.equal(existsSync(new URL("functions/api/comms/messages.ts", root)), false);
  assert.deepEqual(Object.values(contract.flags), [false, false]);
  assert.equal(contract.pilot.scope, "local_test");
  assert.equal(contract.pilot.privateSending, false);
});

test("identity, payload bounds and browser-origin proof are server requirements", () => {
  assert.deepEqual(contract.request.requiredFields, ["channelSlug", "clientRequestId", "body"]);
  assert.equal(contract.request.additionalFields, false);
  assert.equal(contract.request.identitySource, "server_session");
  assert.equal(contract.request.originRequired, true);
  assert.equal(contract.request.sessionBoundCsrfRequired, true);
  assert.equal(contract.request.maxBodyCodePoints, 2000);
  assert.equal(contract.request.maxBodyBytes, 8000);
  assert.equal(contract.request.maxRequestBytes, 12288);
});

test("only allow can publish; other decisions have an unambiguous rejection", () => {
  assert.deepEqual(Object.keys(contract.decisions).filter((key) => contract.decisions[key].publish), ["allow"]);
  for (const [key, value] of Object.entries(contract.decisions)) {
    assert.equal(value.status, key === "allow" ? 201 : ["block", "warn"].includes(key) ? 422 : 423);
    assert.ok(document.includes(`\`${value.code}\``));
  }
  assert.equal(contract.safety.outage, "deny_503");
  assert.equal(contract.safety.unknownDecision, "deny_503");
  assert.deepEqual(contract.safety.mildDecisions, ["block", "warn", "timeout", "escalate"]);
  assert.equal(contract.safety.timeoutMinutes, 10);
  assert.equal(contract.safety.maxAutomaticStaffHoldHours, 24);
});

test("bounded retries cannot add messages or strikes and must recheck current access", () => {
  assert.deepEqual(contract.idempotency.key, ["actor_id", "channel_id", "client_request_id"]);
  assert.equal(contract.idempotency.atomicDecisionRequired, true);
  assert.equal(contract.idempotency.currentAccessRequiredForReplay, true);
  for (const key of ["replayExtendsExpiry", "replayAddsStrike", "replayAddsMessage"]) assert.equal(contract.idempotency[key], false);
  assert.equal(contract.idempotency.conflictStatus, 409);
  assert.equal(contract.idempotency.replayStatus, 200);
  assert.equal(contract.idempotency.rejectedReplay, "original_status_without_message");
  assert.equal(contract.idempotency.pendingStatus, 202);
  assert.ok(contract.idempotency.clientRetryHours < contract.idempotency.receiptRetentionDays * 24);
  assert.equal(contract.idempotency.receiptRetentionDays, contract.retention.receiptDays);
  assert.match(document, /In-memory mocks alone\s+cannot establish transaction or quota guarantees/);
});

test("safety limits and retention stay finite, private and plan-neutral", () => {
  assert.equal(contract.rateLimits.paidPlanBypass, false);
  assert.equal(contract.rateLimits.scope, "actor_all_channels");
  assert.equal(contract.rateLimits.actorAttemptsPerRollingMinute, 30);
  assert.equal(contract.rateLimits.actorAcceptedPerRollingMinute, 20);
  assert.equal(contract.rateLimits.minimumAcceptedIntervalSeconds, 5);
  assert.equal(contract.safety.rejectedTextRetention, "request_memory_only");
  assert.equal(contract.retention.messageDays, 30);
  assert.equal(contract.retention.safetyMetadataDays, 30);
  assert.equal(contract.retention.browserStorage, false);
  assert.equal(contract.retention.backupsRequireSeparateReview, true);
  assert.equal(contract.support.sources, "reviewed_public_dzn_help_only");
  for (const key of ["runtime", "privateContext", "meteredSpend"]) assert.equal(contract.support[key], false);
});

test("protected systems and unrelated runtimes stay explicitly outside the slice", () => {
  assert.deepEqual(contract.protectedSystems, [
    "billing", "owner_entitlement", "server_ownership", "scoring", "rankings",
    "discovery", "reviews", "badges", "seasons", "events", "server_wars", "ctf",
    "xp_awards", "calling_card_awards", "public_profile_visibility",
    "retained_exports", "competitive_eligibility",
  ]);
  for (const name of ["send_routes", "message_writes", "schema_changes", "reactions", "reports",
    "moderation_mutations", "private_sending", "websockets", "durable_objects", "analytics", "tracking",
    "ai_runtime", "vector_stores", "provider_credentials", "metered_calls", "live_checkout",
    "stripe_mutation", "cloudflare_mutation", "production_d1", "deployment", "issue_49"]) {
    assert.ok(contract.blockedInThisSlice.includes(name), name);
  }
});

test("existing read-only integration is still off and has no sending wiring", () => {
  const env = read(".env.example");
  assert.match(env, /^DZN_COMMS_MESSAGE_HISTORY_READ_ENABLED=false$/m);
  assert.match(env, /^NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=false$/m);
  const checkoutFlag = env.match(/^DZN_LIVE_CHECKOUT_ENABLED=(.*)$/m)?.[1]?.trim();
  assert.ok(checkoutFlag === undefined || checkoutFlag === "false");
  assert.match(read("functions/_lib/plans.ts"), /function isLiveCheckoutEnabled\(env: Env\)\s*\{\s*const value = cleanEnvString\(env\.DZN_LIVE_CHECKOUT_ENABLED\);\s*if \(!value\) return false;/);
  assert.doesNotMatch(env, /^DZN_COMMS_MESSAGE_SEND_ENABLED=/m);
  const shell = read("components/comms/dzn-comms-shell.tsx");
  assert.match(shell, /aria-label="Send is unavailable"/);
  assert.doesNotMatch(shell, /\/api\/comms\/messages|method:\s*["']POST["']/);
  assert.match(read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md"), /DZN_COMMS_MESSAGE_SENDING_CONTRACT\.md/);
});
