import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MOCK_USER_ID } from "../functions/_lib/db";
import { PULSE_REVIEW_NOTIFICATION_TYPES } from "../functions/_lib/dzn-pulse";
import { onRequest as reviewNotificationReadHandler } from "../functions/api/reviews/moderation/notifications/read";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

type FakeOperation = {
  kind: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type FakeNotification = {
  id: string;
  user_id: string;
  type: string;
  action_url: string | null;
  read_at: string | null;
  expires_at: string | null;
};

type FakeDbOptions = {
  sessionUser?: SessionUser;
  ownerPlan?: { plan_key: string | null; plan_status: string | null } | null;
  notifications?: FakeNotification[];
};

const OWNER_USER_ID = MOCK_USER_ID;
const ADMIN_USER_ID = "admin-review-moderator";
const OTHER_OWNER_USER_ID = "other-owner";
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2001-01-01T00:00:00.000Z";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assertSourceContracts();

  const ownerDb = createFakeReviewNotificationDb();
  const ownerResponse = await callRead("POST", {
    MOCK_AUTH: "true",
    DZN_PULSE_ENABLED: "true",
    DB: ownerDb.db,
  } as Env);
  assert.equal(ownerResponse.status, 200);
  const ownerPayload = await ownerResponse.json() as ReadPayload;
  assert.equal(ownerPayload.ok, true);
  assert.equal(ownerPayload.marked, 2, "Owner read action should mark only current unread review alerts.");
  assert.equal(ownerPayload.reviewUnreadCount, 0, "Owner review unread count should clear after the targeted read.");
  assert.equal(ownerPayload.unreadCount, 1, "General Pulse alerts must remain unread.");
  assert.equal(notification(ownerDb.notifications, "owner-review-type").read_at !== null, true);
  assert.equal(notification(ownerDb.notifications, "owner-review-legacy-action").read_at !== null, true);
  assert.equal(notification(ownerDb.notifications, "owner-general-pulse").read_at, null, "General Pulse alert must not be cleared.");
  assert.equal(notification(ownerDb.notifications, "other-owner-review").read_at, null, "Other owner review alerts must stay private.");
  assert.equal(notification(ownerDb.notifications, "owner-expired-review").read_at, null, "Expired review alerts must not be resurrected or marked.");
  assert.equal(notification(ownerDb.notifications, "owner-read-review").read_at, "2026-08-25T08:00:00.000Z", "Already-read alerts must keep their original read timestamp.");
  assertMutationOperationsStayReadStateOnly(ownerDb.operations);

  const adminDb = createFakeReviewNotificationDb({
    sessionUser: {
      id: ADMIN_USER_ID,
      discord_id: "admin-discord-user",
      username: "DZN Admin",
      avatar: null,
    },
    notifications: [
      row("admin-review-type", ADMIN_USER_ID, "review_bulk_triage", "/dashboard/reviews?pattern=repeat", null, FUTURE),
      row("admin-general-pulse", ADMIN_USER_ID, "dzn_announcement", "/dzn-pulse", null, FUTURE),
      row("owner-review-type", OWNER_USER_ID, "review_needs_moderation", "/dashboard/reviews?review=owner", null, FUTURE),
    ],
  });
  const adminResponse = await callRead("POST", {
    DZN_PULSE_ENABLED: "true",
    DZN_ADMIN_DISCORD_IDS: "admin-discord-user",
    SESSION_SECRET: "test-session-secret",
    DB: adminDb.db,
  } as Env, "admin-session");
  assert.equal(adminResponse.status, 200);
  const adminPayload = await adminResponse.json() as ReadPayload;
  assert.equal(adminPayload.ok, true);
  assert.equal(adminPayload.marked, 1, "Admin read action should mark only the admin user's review alert rows.");
  assert.equal(adminPayload.reviewUnreadCount, 0);
  assert.equal(adminPayload.unreadCount, 1, "Admin general Pulse alert must remain unread.");
  assert.equal(notification(adminDb.notifications, "admin-review-type").read_at !== null, true);
  assert.equal(notification(adminDb.notifications, "owner-review-type").read_at, null, "Admin read state must not clear an owner's private alert rows.");
  assert.equal(adminDb.operations.some((operation) => /FROM\s+owner_billing_accounts/i.test(operation.sql)), false, "DZN admins should not need owner billing checks for moderation alert read state.");
  assertMutationOperationsStayReadStateOnly(adminDb.operations);

  const playerDb = createFakeReviewNotificationDb({
    sessionUser: {
      id: "free-player",
      discord_id: "free-player-discord",
      username: "Free Player",
      avatar: null,
    },
    ownerPlan: { plan_key: "free", plan_status: "free" },
    notifications: [
      row("free-player-review", "free-player", "review_needs_moderation", "/dashboard/reviews?review=free", null, FUTURE),
    ],
  });
  const playerResponse = await callRead("POST", {
    DZN_PULSE_ENABLED: "true",
    SESSION_SECRET: "test-session-secret",
    DB: playerDb.db,
  } as Env, "free-player-session");
  assert.equal(playerResponse.status, 402, "Free logged-in players must not clear owner moderation alerts.");
  assert.equal(notification(playerDb.notifications, "free-player-review").read_at, null);
  assert.equal(playerDb.operations.some((operation) => operation.kind === "run" && /UPDATE\s+user_notifications/i.test(operation.sql)), false, "Rejected free-player calls must not mutate notifications.");

  const unauthenticatedDb = createFakeReviewNotificationDb();
  const unauthenticatedResponse = await callRead("POST", {
    DZN_PULSE_ENABLED: "true",
    DB: unauthenticatedDb.db,
  } as Env);
  assert.equal(unauthenticatedResponse.status, 401);
  assert.equal(unauthenticatedDb.operations.length, 0, "Unauthenticated requests must be rejected before private DB reads or writes.");

  const methodDb = createFakeReviewNotificationDb();
  const getResponse = await callRead("GET", {
    MOCK_AUTH: "true",
    DZN_PULSE_ENABLED: "true",
    DB: methodDb.db,
  } as Env);
  assert.equal(getResponse.status, 405);
  assert.equal(methodDb.operations.length, 0, "Unsupported methods must not touch notification state.");

  const disabledDb = createFakeReviewNotificationDb();
  const disabledResponse = await callRead("POST", {
    MOCK_AUTH: "true",
    DZN_PULSE_ENABLED: "false",
    DB: disabledDb.db,
  } as Env);
  assert.equal(disabledResponse.status, 404);
  assert.equal(disabledDb.operations.length, 0, "Feature-disabled review reads must not write notifications.");

  console.log("Review notification read-state tests passed.");
}

type ReadPayload = {
  ok?: boolean;
  marked?: number;
  unreadCount?: number;
  reviewUnreadCount?: number;
};

async function callRead(method: string, env: Env, sessionToken?: string) {
  const headers = new Headers({ accept: "application/json" });
  if (sessionToken) headers.set("cookie", `dzn_session=${sessionToken}`);
  return reviewNotificationReadHandler({
    request: new Request("https://dzn.example/api/reviews/moderation/notifications/read", {
      method,
      headers,
    }),
    env,
    params: {},
    data: {},
    waitUntil() {},
    async next() {
      return new Response(null, { status: 404 });
    },
  } satisfies PagesContext) as Promise<Response>;
}

function createFakeReviewNotificationDb(options: FakeDbOptions = {}) {
  const operations: FakeOperation[] = [];
  const notifications = options.notifications ?? defaultNotifications();
  const state = {
    operations,
    notifications,
    sessionUser: options.sessionUser ?? null,
    ownerPlan: options.ownerPlan === undefined ? { plan_key: "starter", plan_status: "trialing" } : options.ownerPlan,
  };
  const db = {
    prepare(sql: string) {
      return statement(sql, [], state);
    },
  };
  return { db: db as unknown as Env["DB"], operations, notifications };
}

function statement(
  sql: string,
  bindings: unknown[],
  state: {
    operations: FakeOperation[];
    notifications: FakeNotification[];
    sessionUser: SessionUser | null;
    ownerPlan: { plan_key: string | null; plan_status: string | null } | null;
  },
) {
  return {
    bind(...nextBindings: unknown[]) {
      return statement(sql, nextBindings, state);
    },
    async all<T>() {
      state.operations.push({ kind: "all", sql, bindings });
      return { results: [] as T[] };
    },
    async first<T>() {
      state.operations.push({ kind: "first", sql, bindings });
      if (/FROM\s+sessions\s+JOIN\s+users/i.test(sql)) {
        return state.sessionUser as T | null;
      }
      if (/FROM\s+owner_billing_accounts/i.test(sql)) {
        return state.ownerPlan as T | null;
      }
      if (/FROM\s+user_notifications/i.test(sql) && /COUNT\(\*\)\s+AS\s+count/i.test(sql)) {
        const userId = String(bindings[0] ?? "");
        const reviewOnly = isReviewNotificationSql(sql);
        const count = state.notifications
          .filter((item) => item.user_id === userId)
          .filter((item) => item.read_at === null)
          .filter((item) => !item.expires_at || Date.parse(item.expires_at) > Date.now())
          .filter((item) => !reviewOnly || isReviewNotification(item))
          .length;
        return { count } as T;
      }
      return null;
    },
    async run() {
      state.operations.push({ kind: "run", sql, bindings });
      let changes = 0;
      if (/UPDATE\s+user_notifications/i.test(sql) && isReviewNotificationSql(sql)) {
        const readAt = String(bindings[0] ?? "");
        const userId = String(bindings[1] ?? "");
        for (const item of state.notifications) {
          if (item.user_id !== userId) continue;
          if (item.read_at !== null) continue;
          if (item.expires_at && Date.parse(item.expires_at) <= Date.now()) continue;
          if (!isReviewNotification(item)) continue;
          item.read_at = readAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    },
  };
}

function defaultNotifications() {
  return [
    row("owner-review-type", OWNER_USER_ID, "review_needs_moderation", "/dashboard/reviews?review=type", null, FUTURE),
    row("owner-review-legacy-action", OWNER_USER_ID, "dzn_announcement", "/dashboard/reviews?review=legacy", null, FUTURE),
    row("owner-general-pulse", OWNER_USER_ID, "dzn_announcement", "/dzn-pulse", null, FUTURE),
    row("other-owner-review", OTHER_OWNER_USER_ID, "review_moderation_alert", "/dashboard/reviews?review=other", null, FUTURE),
    row("owner-expired-review", OWNER_USER_ID, "review_needs_moderation", "/dashboard/reviews?review=expired", null, PAST),
    row("owner-read-review", OWNER_USER_ID, "review_needs_moderation", "/dashboard/reviews?review=read", "2026-08-25T08:00:00.000Z", FUTURE),
  ];
}

function row(id: string, userId: string, type: string, actionUrl: string | null, readAt: string | null, expiresAt: string | null): FakeNotification {
  return {
    id,
    user_id: userId,
    type,
    action_url: actionUrl,
    read_at: readAt,
    expires_at: expiresAt,
  };
}

function notification(rows: FakeNotification[], id: string) {
  const match = rows.find((item) => item.id === id);
  assert.ok(match, `Missing notification fixture ${id}`);
  return match;
}

function isReviewNotificationSql(sql: string) {
  return /type\s+IN/i.test(sql) && /action_url\s+LIKE\s+'\/dashboard\/reviews%'/i.test(sql);
}

function isReviewNotification(item: FakeNotification) {
  return (PULSE_REVIEW_NOTIFICATION_TYPES as readonly string[]).includes(item.type) ||
    String(item.action_url ?? "").startsWith("/dashboard/reviews");
}

function assertSourceContracts() {
  const service = read("functions/_lib/dzn-pulse.ts");
  for (const snippet of [
    "PULSE_REVIEW_NOTIFICATION_TYPES",
    "review_needs_moderation",
    "review_moderation_alert",
    "review_bulk_triage",
    "countUnreadReviewNotifications",
    "markReviewNotificationsRead",
    "reviewNotificationConditionSql",
    "\"reviews\"",
  ]) {
    assert.equal(service.includes(snippet), true, `DZN Pulse service must include ${snippet}.`);
  }
  const markReviewBlock = sourceBetween(service, "export async function markReviewNotificationsRead", "export async function clearReadNotifications");
  assert.match(markReviewBlock, /UPDATE\s+user_notifications/i);
  assert.match(markReviewBlock, /read_at\s+=\s+COALESCE\(read_at,\s+\?\)/i);
  assert.match(markReviewBlock, /WHERE\s+user_id\s+=\s+\?/i);
  assert.match(markReviewBlock, /read_at\s+IS\s+NULL/i);
  assert.match(markReviewBlock, /reviewNotificationConditionSql\(\)/);
  assert.doesNotMatch(markReviewBlock, /\bmarkAllNotificationsRead\b|\bserver_reviews\b|\bserver_review_reports\b|\bdispatchPulseDiscordNotification\b/i);
  assert.doesNotMatch(markReviewBlock, protectedSurfacePattern());

  const route = read("functions/api/reviews/moderation/notifications/read.ts");
  for (const snippet of [
    "authorizeReviewModerationRequest",
    "markReviewNotificationsRead",
    "privateNoStoreHeaders",
  ]) {
    assert.equal(route.includes(snippet), true, `Review notification read route must include ${snippet}.`);
  }
  assert.doesNotMatch(route, /\bresolvePulseUser\b|\bmarkAllNotificationsRead\b|\bcreateCheckoutSession\b|\bstripe\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b/i);

  const moderationHelper = read("functions/_lib/review-moderation-dashboard.ts");
  for (const snippet of [
    "countUnreadReviewNotifications",
    "reviewPulseNotificationType",
    "review_needs_moderation",
    "review_bulk_triage",
  ]) {
    assert.equal(moderationHelper.includes(snippet), true, `Moderation helper must include ${snippet}.`);
  }
  assert.doesNotMatch(moderationHelper, /\bDZN_LIVE_CHECKOUT_ENABLED\b|\bcreateCheckoutSession\b|\bstripe\b|\bNITRADO_TOKEN\b|\bDISCORD_BOT_TOKEN\b|\bdispatchPulseDiscordNotification\b/i);

  const queueUi = read("components/reviews/review-moderation-dashboard.tsx");
  for (const snippet of [
    "Unread review alerts",
    "Mark review alerts read",
    "/api/reviews/moderation/notifications/read",
  ]) {
    assert.equal(queueUi.includes(snippet), true, `Review queue UI must include ${snippet}.`);
  }
  assert.equal(queueUi.includes("dangerouslySetInnerHTML"), false);

  const dashboardUi = read("components/onboarding/dashboard.tsx");
  for (const snippet of [
    "Mark review alerts read",
    "/api/reviews/moderation/notifications/read",
    "General DZN Pulse alerts were left alone.",
    "Clearing them does not clear general alerts.",
    "They do not change rank, discovery score, badges, seasons, events, or billing.",
  ]) {
    assert.equal(dashboardUi.includes(snippet), true, `Owner dashboard UI must include ${snippet}.`);
  }
  assert.equal(dashboardUi.includes("dangerouslySetInnerHTML"), false);

  const provider = read("components/dzn-pulse/dzn-pulse-provider.tsx");
  for (const snippet of [
    "{ key: \"reviews\", label: \"Reviews\" }",
    "Owner review alert",
    "MessageSquareReply",
    "isReviewPulseNotification",
  ]) {
    assert.equal(provider.includes(snippet), true, `DZN Pulse drawer must include ${snippet}.`);
  }

  const packageJson = read("package.json");
  assert.equal(packageJson.includes("\"test:review-notification-read-state\""), true, "Package scripts must include this focused test.");
  assert.equal(packageJson.includes("npm run test:review-notification-read-state"), true, "Main test chain must run this focused test.");

  const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
  assert.equal(platformSpec.includes("Review Notification Read State And Delivery Audit Slice"), true, "Master spec must document the read-state slice.");
  assert.equal(platformSpec.includes("review-alert read state remains private per owner/admin"), true, "Master spec must document private review read state.");
  assert.equal(platformSpec.includes("issue #49 remains reserved"), true, "Master spec must keep live checkout activation reserved.");

  const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
  assert.equal(publicAccessPolicy.includes("`/api/reviews/moderation/notifications/read`"), true, "Public access policy must include the review-alert read endpoint.");
  assert.equal(publicAccessPolicy.includes("private per owner/admin"), true, "Public access policy must document notification read-state privacy.");
}

function assertMutationOperationsStayReadStateOnly(operations: FakeOperation[]) {
  const mutationOperations = operations.filter((operation) =>
    operation.kind === "run" &&
    /\b(?:INSERT\s+(?:OR\s+IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE)\b/i.test(operation.sql)
  );
  assert.equal(mutationOperations.length, 1, "Review alert read flow should perform exactly one write.");
  assert.match(mutationOperations[0].sql, /\bUPDATE\s+user_notifications\b/i);
  assert.match(mutationOperations[0].sql, /\bread_at\b/i);
  for (const operation of mutationOperations) {
    assert.doesNotMatch(operation.sql, protectedSurfacePattern(), `Unexpected protected mutation target: ${operation.sql}`);
  }
}

function protectedSurfacePattern() {
  return /\bserver_reviews\b|\bserver_review_reports\b|\bserver_review_moderation_actions\b|\bowner_billing_accounts\b|\bserver_subscriptions\b|\bowner_plan_entitlements\b|\bplayer_saved_servers\b|\bserver_owners\b|\bserver_rankings\b|\bleaderboards\b|\bdiscovery_score\b|\breview_score\b|\brating_score\b|\bplayer_profiles\b|\bkill_events\b|\bplayer_events\b|\bevents\b|\bcompetitive_events\b|\bserver_war_events\b|\bserver_war_score_snapshots\b|\bdzn_seasons\b|\bserver_badge_awards\b|\bbadges\b|\bchallenge\b|\bXP\b|\bstripe\b|\bDZN_LIVE_CHECKOUT_ENABLED\b/i;
}

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source marker ${end}`);
  return source.slice(startIndex, endIndex);
}

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}
