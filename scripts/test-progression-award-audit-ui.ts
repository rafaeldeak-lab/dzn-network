import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { listProgressionAwardAudit } from "../functions/_lib/player-progression-awards-audit";
import type { Env, SessionUser } from "../functions/_lib/types";

type CapturedOperation = {
  kind: "all" | "run" | "first";
  sql: string;
  bindings: unknown[];
};

const OWNER_USER: SessionUser = {
  id: "owner-user",
  discord_id: "owner-discord",
  username: "DZN Owner",
  avatar: null,
};

const ADMIN_USER: SessionUser = {
  id: "admin-user",
  discord_id: "admin-discord",
  username: "DZN Admin",
  avatar: null,
};

async function main() {
  assertStaticContracts();
  await assertAuditFiltersUseBoundScope();
  console.log("Progression award audit UI tests passed.");
}

function assertStaticContracts() {
  assert.equal(existsSync("components/progression/progression-award-audit-dashboard.tsx"), true, "Progression award audit UI component should exist.");
  assert.equal(existsSync("app/dashboard/progression-awards/page.tsx"), true, "Dashboard progression award audit page should exist.");
  assert.equal(existsSync("app/owner/progression-awards/page.tsx"), true, "Owner progression award audit page should exist.");
  assert.equal(existsSync("docs/PROGRESSION_AWARD_AUDIT_UI_HANDOFF.md"), true, "Progression award audit UI handoff should exist.");

  const uiSource = read("components/progression/progression-award-audit-dashboard.tsx");
  for (const snippet of [
    "ProgressionAwardAuditDashboard",
    "/api/owner/progression/award-audit",
    "status: statusFilter",
    "adapter_key",
    "linked_server_id",
    "retry",
    "retry_available",
    "attempt_count",
    "retry_count",
    "last_retried_at",
    "/dashboard/progression-awards",
    "status, adapter, linked-server, and retry-state filters",
    "Retry stays cron-secret-only",
    "Progression remains player-side only",
  ]) {
    assert.equal(uiSource.includes(snippet), true, `Progression audit UI must include ${snippet}.`);
  }
  assert.doesNotMatch(uiSource, /method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)["']/i, "Progression audit UI must not perform browser mutations.");
  assert.doesNotMatch(uiSource, /\/api\/cron\/player-progression\/awards|retry_failed|runPlayerProgressionAwardJob|collectVerifiedProgressionAwardSources/i, "Progression audit UI must not call or configure the cron award job.");
  assert.doesNotMatch(uiSource, /dangerouslySetInnerHTML|DZN_LIVE_CHECKOUT_ENABLED|createCheckoutSession|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i, "Progression audit UI must not touch checkout, raw secrets, or unsafe rendering.");

  const dashboardSource = read("components/onboarding/dashboard.tsx");
  for (const snippet of [
    "ProgressionAwardAuditDashboard",
    "\"progression-audit\"",
    "Progression Audit",
    "linkedServers={servers}",
    "selectedLinkedServerId={server.id}",
  ]) {
    assert.equal(dashboardSource.includes(snippet), true, `Owner dashboard must include ${snippet}.`);
  }

  const ownerConsoleSource = read("components/owner/owner-console.tsx");
  for (const snippet of [
    "Progression Audit",
    "Open Progression Audit",
    "/owner/progression-awards",
    "Cron-secret only",
    "never grants XP",
  ]) {
    assert.equal(ownerConsoleSource.includes(snippet), true, `Owner console must include ${snippet}.`);
  }

  const dashboardPage = read("app/dashboard/progression-awards/page.tsx");
  assert.equal(dashboardPage.includes("ProgressionAwardAuditDashboard"), true);
  assert.equal(dashboardPage.includes("homeHref=\"/dashboard\""), true);

  const ownerPage = read("app/owner/progression-awards/page.tsx");
  assert.equal(ownerPage.includes("ProgressionAwardAuditDashboard"), true);
  assert.equal(ownerPage.includes("homeHref=\"/owner\""), true);

  const auditRoute = read("functions/api/owner/progression/award-audit.ts");
  for (const snippet of [
    "adapterKey: url.searchParams.get(\"adapter_key\")",
    "linkedServerId: url.searchParams.get(\"linked_server_id\")",
    "retry: url.searchParams.get(\"retry\")",
    "privateNoStoreHeaders",
    "methodNotAllowed",
  ]) {
    assert.equal(auditRoute.includes(snippet), true, `Audit route must include ${snippet}.`);
  }
  assert.doesNotMatch(auditRoute, /\breadBoundedJson\b|\bfetch\s*\(|createCheckoutSession|DZN_LIVE_CHECKOUT_ENABLED|stripe/i, "Audit route must stay read-only and checkout-free.");

  const auditHelper = read("functions/_lib/player-progression-awards-audit.ts");
  for (const snippet of [
    "requireActiveOwnerEntitlement",
    "isDznAdminDiscordId",
    "ProgressionAwardAuditRetryFilter",
    "adapter_key: string | null",
    "linked_server_id: string | null",
    "applyAdapterFilter",
    "applyLinkedServerFilter",
    "applyRetryFilter",
    "player_progression_award_sources.adapter_key = ?",
    "player_progression_award_sources.linked_server_id = ?",
    "player_progression_award_sources.linked_server_id IS NULL",
    "player_progression_award_sources.result_status = 'failed'",
    "player_progression_award_sources.result_status != 'failed'",
  ]) {
    assert.equal(auditHelper.includes(snippet), true, `Audit helper must include ${snippet}.`);
  }
  assert.doesNotMatch(auditHelper, /\bevidence_json\b/, "Audit helper must not expose raw evidence blobs.");
  assert.doesNotMatch(auditHelper, /runPlayerProgressionAwardJob|collectVerifiedProgressionAwardSources|retryFailedProgressionAwardSources/i, "Audit helper must not trigger award processing or retries.");
  assert.doesNotMatch(auditHelper, /\b(?:INSERT|UPDATE|DELETE)\b/i, "Audit helper must stay read-only.");
  assert.doesNotMatch(auditHelper, /DZN_LIVE_CHECKOUT_ENABLED|createCheckoutSession|stripe|NITRADO_TOKEN|DISCORD_BOT_TOKEN/i, "Audit helper must not touch checkout or raw external-service secrets.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  for (const snippet of [
    "Progression Award Audit UI Slice",
    "`Progression Audit` tab",
    "`/dashboard/progression-awards`",
    "`/owner/progression-awards`",
    "status, adapter, linked-server, and retry-state filters",
    "retry execution remains cron-secret-only",
  ]) {
    assert.equal(platformSpec.includes(snippet), true, `Master spec must include ${snippet}.`);
  }

  const accessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  for (const snippet of [
    "`/dashboard/progression-awards`",
    "`/owner/progression-awards`",
    "filter by status, adapter key, linked server, and retry availability",
    "retry execution must remain cron-secret-only",
  ]) {
    assert.equal(accessPolicy.includes(snippet), true, `Public access policy must include ${snippet}.`);
  }

  const handoff = read("docs/PROGRESSION_AWARD_AUDIT_UI_HANDOFF.md");
  assert.equal(handoff.includes("Progression Award Audit UI Handoff"), true);
  assert.equal(handoff.includes("No Stripe products/prices were created or changed."), true);
  assert.equal(handoff.includes("Issue #49 remains reserved for final live checkout activation."), true);

  assertProgressionAuditIsNotACompetitiveDependency();

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("test:progression-award-audit-ui"), true, "Focused audit UI test must be wired into package scripts.");
}

async function assertAuditFiltersUseBoundScope() {
  const ownerDb = createCaptureDb();
  await listProgressionAwardAudit({ DB: ownerDb.db } as Env, {
    user: OWNER_USER,
    role: "owner",
  }, {
    status: "failed",
    adapterKey: "adm_kill_event",
    linkedServerId: "linked-server-1",
    retry: "available",
    limit: 25,
  });

  assert.equal(ownerDb.operations.every((operation) => operation.kind === "all"), true, "Audit helper should only run read operations.");
  const ownerList = ownerDb.operations[0];
  assert.match(ownerList.sql, /linked_servers\.user_id = \?/i, "Owner audit must keep owner scope.");
  assert.match(ownerList.sql, /player_progression_award_sources\.adapter_key = \?/i, "Adapter filter must be bound.");
  assert.match(ownerList.sql, /player_progression_award_sources\.linked_server_id = \?/i, "Linked-server filter must be bound.");
  assert.match(ownerList.sql, /player_progression_award_sources\.result_status = 'failed'/i, "Retry-available filter must resolve to failed rows.");
  assert.deepEqual(ownerList.bindings.slice(0, 3), [OWNER_USER.id, "adm_kill_event", "linked-server-1"]);
  assert.equal(ownerList.bindings.at(-1), 25);

  const ownerCount = ownerDb.operations[1];
  assert.deepEqual(ownerCount.bindings, [OWNER_USER.id, "adm_kill_event", "linked-server-1"]);

  const adminDb = createCaptureDb();
  await listProgressionAwardAudit({ DB: adminDb.db } as Env, {
    user: ADMIN_USER,
    role: "admin",
  }, {
    status: "all",
    adapterKey: "approved_review",
    linkedServerId: "__global__",
    retry: "not_available",
    limit: 15,
  });

  const adminList = adminDb.operations[0];
  assert.doesNotMatch(adminList.sql, /linked_servers\.user_id = \?/i, "Admin global audit should not add owner binding.");
  assert.match(adminList.sql, /player_progression_award_sources\.linked_server_id IS NULL/i, "Admin global filter must be explicit.");
  assert.match(adminList.sql, /player_progression_award_sources\.result_status != 'failed'/i, "Retry not-available filter must exclude failed rows.");
  assert.deepEqual(adminList.bindings, ["approved_review", 15]);
}

function createCaptureDb() {
  const operations: CapturedOperation[] = [];
  const statement = (sql: string, bindings: unknown[] = []) => ({
    bind: (...nextBindings: unknown[]) => statement(sql, nextBindings),
    async all<T>() {
      operations.push({ kind: "all", sql, bindings });
      return { results: [] as T[] };
    },
    async first<T>() {
      operations.push({ kind: "first", sql, bindings });
      return null as T | null;
    },
    async run() {
      operations.push({ kind: "run", sql, bindings });
      return { success: true };
    },
  });
  return {
    operations,
    db: {
      prepare(sql: string) {
        return statement(sql);
      },
    } as unknown as Env["DB"],
  };
}

function assertProgressionAuditIsNotACompetitiveDependency() {
  for (const file of [
    "functions/api/public/servers.ts",
    "functions/_lib/server-ranking.ts",
    "functions/api/public/leaderboards.ts",
    "functions/_lib/advanced-leaderboards.ts",
    "functions/_lib/server-reviews.ts",
    "functions/_lib/badge-awards.ts",
    "functions/_lib/badge-evaluation.ts",
    "functions/_lib/dzn-seasons.ts",
    "functions/_lib/events.ts",
    "functions/_lib/server-war-scoring.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/status.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\bplayer_progression_award_sources\b|ProgressionAwardAuditDashboard|award-audit|progression-awards/i,
      `${file} must not depend on award audit UI/history.`,
    );
  }
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
