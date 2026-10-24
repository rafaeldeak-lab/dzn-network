import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateStrongholdAccess,
  STRONGHOLD_MEMBERSHIP_MAX_AGE_MS,
  type StrongholdAccessSnapshot,
} from "../functions/_lib/stronghold-access";

const now = Date.parse("2026-10-21T12:00:00.000Z");
const serverId = "11111111-1111-4111-8111-111111111111";
const otherServerId = "22222222-2222-4222-8222-222222222222";
const user = { id: "member-user", discord_id: "100000000000000002" };

function snapshot(): StrongholdAccessSnapshot {
  return {
    server_id: serverId, owner_user_id: "owner-user", owner_discord_id: "100000000000000001",
    guild_id: "200000000000000001", server_status: "live", lifecycle_status: "active_live", merged_into_server_id: null,
    billing_owner_discord_id: "100000000000000001", owner_plan_key: "pro", owner_plan_status: "active",
    owner_customer_id: "cus_test_owner", owner_subscription_id: "sub_test_owner",
    owner_period_start: "2026-10-01T00:00:00.000Z", owner_period_end: "2026-11-01T00:00:00.000Z",
    subscription_guild_id: "200000000000000001", subscription_owner_discord_id: "100000000000000001",
    server_plan_key: "pro", server_plan_status: "active", server_customer_id: "cus_test_owner", server_subscription_id: "sub_test_owner",
    server_period_start: "2026-10-01T00:00:00.000Z", server_period_end: "2026-11-01T00:00:00.000Z",
    membership_user_id: user.id, membership_guild_id: "200000000000000001", membership_source: "discord_oauth_guilds",
    membership_last_seen_at: "2026-10-21 11:59:00", membership_revoked_at: null,
  };
}

function evaluate(patch: Partial<StrongholdAccessSnapshot> = {}) {
  return evaluateStrongholdAccess({ enabled: "true", user, requestedServerId: serverId, snapshot: { ...snapshot(), ...patch }, now });
}

function denied(patch: Partial<StrongholdAccessSnapshot>, code: string) {
  const result = evaluate(patch);
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, code);
}

test("no session cannot receive access", () => {
  assert.deepEqual(evaluateStrongholdAccess({ enabled: "true", user: null, requestedServerId: serverId, snapshot: snapshot(), now }),
    { allowed: false, status: 401, code: "UNAUTHENTICATED" });
});

test("only the exact enabled string activates the new policy", () => {
  for (const enabled of [undefined, null, false, true, "false", "1", "TRUE", " true "])
    assert.deepEqual(evaluateStrongholdAccess({ enabled, user, requestedServerId: serverId, snapshot: snapshot(), now }),
      { allowed: false, status: 503, code: "UNAVAILABLE" });
});

test("canonical identity rejects slugs, guild IDs and a snapshot from another server", () => {
  for (const requestedServerId of ["public-slug", "200000000000000001", "", null, `${serverId}' OR 1=1`]) {
    const result = evaluateStrongholdAccess({ enabled: "true", user, requestedServerId, snapshot: snapshot(), now });
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.status, 400);
  }
  denied({ server_id: otherServerId }, "SERVER_NOT_FOUND");
});

test("a member's personal Free plan does not prevent entry to an owner's covered Pro server", () => {
  // Personal account plan is intentionally not an access-policy input.
  const freeMember = { ...user, plan_key: "free", plan_status: "free" };
  const result = evaluateStrongholdAccess({ enabled: "true", user: freeMember, requestedServerId: serverId, snapshot: snapshot(), now });
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.authority, "member");
});

test("both the actual owner's billing and this server's projection must confer Pro", () => {
  for (const plan of [null, "free", "starter", "unknown"]) {
    denied({ owner_plan_key: plan }, "COVERED_PRO_REQUIRED");
    denied({ server_plan_key: plan }, "COVERED_PRO_REQUIRED");
  }
  for (const status of [null, "past_due", "canceled", "unpaid", "incomplete", "trialing", "unknown"]) {
    denied({ owner_plan_status: status }, "COVERED_PRO_REQUIRED");
    denied({ server_plan_status: status }, "COVERED_PRO_REQUIRED");
  }
});

test("existing paid legacy plan mapping remains compatible", () => {
  for (const plan of ["pro", "premium", "network", "partner"]) {
    assert.equal(evaluate({ owner_plan_key: plan, server_plan_key: plan }).allowed, true);
  }
});

test("billing projection cannot be borrowed from another owner, guild or subscription", () => {
  for (const patch of [
    { billing_owner_discord_id: "someone-else" }, { subscription_owner_discord_id: "someone-else" },
    { subscription_guild_id: "another-guild" }, { server_subscription_id: "sub_other" },
    { server_customer_id: "cus_other" }, { owner_customer_id: null }, { owner_subscription_id: null },
    { owner_customer_id: "placeholder", server_customer_id: "placeholder" },
    { owner_subscription_id: "placeholder", server_subscription_id: "placeholder" },
  ]) denied(patch, "COVERED_PRO_REQUIRED");
});

test("expired, future or missing paid periods fail closed", () => {
  for (const patch of [
    { owner_period_end: new Date(now).toISOString() }, { server_period_end: "2026-10-20T00:00:00Z" },
    { owner_period_end: null }, { server_period_start: null },
    { owner_period_start: "2026-10-22T00:00:00Z" }, { server_period_end: "not-a-time" },
  ]) denied(patch, "COVERED_PRO_REQUIRED");
});

test("only the requesting user's non-revoked OAuth membership in the exact guild is evidence", () => {
  for (const patch of [
    { membership_user_id: null }, { membership_user_id: "another-user" }, { membership_guild_id: "another-guild" },
    { membership_source: "public_directory" }, { membership_source: null },
    { membership_revoked_at: "2026-10-21T11:59:30Z" }, { membership_revoked_at: "" },
  ]) denied(patch, "MEMBERSHIP_REQUIRED");
});

test("membership freshness has an exact boundary and rejects future observations", () => {
  denied({ membership_last_seen_at: new Date(now - STRONGHOLD_MEMBERSHIP_MAX_AGE_MS).toISOString() }, "MEMBERSHIP_REFRESH_REQUIRED");
  denied({ membership_last_seen_at: new Date(now + 1).toISOString() }, "MEMBERSHIP_REFRESH_REQUIRED");
  assert.equal(evaluate({ membership_last_seen_at: new Date(now - STRONGHOLD_MEMBERSHIP_MAX_AGE_MS + 1).toISOString() }).allowed, true);
});

test("invalid or timezone-ambiguous evidence is not interpreted as fresh", () => {
  for (const value of [null, "not-a-date", "2026-10-21T11:59:00", "2026-02-30T11:59:00Z", "2026-10-21", "Infinity"])
    denied({ membership_last_seen_at: value }, "MEMBERSHIP_REFRESH_REQUIRED");
  assert.equal(evaluate({ membership_last_seen_at: "2026-10-21 11:59:00" }).allowed, true);
});

test("only linked_servers.user_id can identify owner authority", () => {
  const decoratedRow = { ...snapshot(), role_label: "Owner", relationship: "administrator", is_admin: true };
  const result = evaluateStrongholdAccess({ enabled: "true", user, requestedServerId: serverId, snapshot: decoratedRow, now });
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.authority, "member");
  const owner = evaluateStrongholdAccess({ enabled: "true", user: { id: "owner-user", discord_id: "100000000000000001" },
    requestedServerId: serverId, snapshot: { ...snapshot(), membership_user_id: "owner-user" }, now });
  assert.equal(owner.allowed, true);
  if (owner.allowed) assert.equal(owner.authority, "owner");
  const noMembership = evaluateStrongholdAccess({ enabled: "true", user: { id: "owner-user", discord_id: "100000000000000001" },
    requestedServerId: serverId, snapshot: snapshot(), now });
  assert.equal(noMembership.allowed, false);
});

test("deleted, suspended, merged and unknown lifecycle state cannot bootstrap", () => {
  for (const status of [null, "pending", "deleted", "merged", "suspended"]) denied({ server_status: status }, "SERVER_UNAVAILABLE");
  for (const lifecycle of [null, "archived_hidden", "expired_detected", "unknown"]) denied({ lifecycle_status: lifecycle }, "SERVER_UNAVAILABLE");
  denied({ merged_into_server_id: otherServerId }, "SERVER_UNAVAILABLE");
});

test("the read-only observation expires at the earliest evidence boundary", () => {
  const end = now + 30_000;
  const result = evaluate({ owner_period_end: new Date(end).toISOString() });
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.validUntil, end);
});

test("an invalid server clock cannot produce an access decision", () => {
  for (const clock of [NaN, Infinity, -1, 1.5]) {
    const result = evaluateStrongholdAccess({ enabled: "true", user, requestedServerId: serverId, snapshot: snapshot(), now: clock });
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.status, 503);
  }
});
