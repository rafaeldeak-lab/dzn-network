import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  ownerAccessErrorPayload,
  pricingUrlForOwnerAccess,
  requireActiveOwnerEntitlement,
  requireOwnerRequestAccess,
} from "../functions/_lib/owner-access";
import type { Env, SessionUser } from "../functions/_lib/types";

type BillingRow = {
  plan_key: string | null;
  plan_status: string | null;
} | null;

const user: SessionUser = {
  id: "user-1",
  discord_id: "discord-1",
  username: "PlayerOne",
  avatar: null,
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
const missing = await requireActiveOwnerEntitlement(envWithBillingRow(null), user);
assert.equal(missing.allowed, false);
assert.equal(missing.status, 402);
assert.equal(missing.errorCode, "OWNER_PLAN_REQUIRED");
assert.equal(missing.effectivePlanKey, "free");
assert.equal(missing.linkedServerLimit, 0);
assert.equal(ownerAccessErrorPayload(missing).owner_plan_required, true);

const free = await requireActiveOwnerEntitlement(envWithBillingRow({ plan_key: "free", plan_status: "active" }), user);
assert.equal(free.allowed, false);
assert.equal(free.status, 402);
assert.equal(free.effectivePlanKey, "free");

const inactivePro = await requireActiveOwnerEntitlement(envWithBillingRow({ plan_key: "pro", plan_status: "past_due" }), user);
assert.equal(inactivePro.allowed, false);
assert.equal(inactivePro.status, 402);
assert.equal(inactivePro.effectivePlanKey, "free");

const trialingStarter = await requireActiveOwnerEntitlement(envWithBillingRow({ plan_key: "starter", plan_status: "trialing" }), user);
assert.equal(trialingStarter.allowed, true);
assert.equal(trialingStarter.status, 200);
assert.equal(trialingStarter.effectivePlanKey, "starter");
assert.equal(trialingStarter.linkedServerLimit, 1);

const activePro = await requireActiveOwnerEntitlement(envWithBillingRow({ plan_key: "pro", plan_status: "active" }), user);
assert.equal(activePro.allowed, true);
assert.equal(activePro.status, 200);
assert.equal(activePro.effectivePlanKey, "pro");
assert.equal(activePro.linkedServerLimit, 3);

const legacyNetwork = await requireActiveOwnerEntitlement(envWithBillingRow({ plan_key: "network", plan_status: "active" }), user);
assert.equal(legacyNetwork.allowed, true);
assert.equal(legacyNetwork.effectivePlanKey, "premium");
assert.equal(legacyNetwork.linkedServerLimit, 3);

const unavailable = await requireActiveOwnerEntitlement({} as Env, user);
assert.equal(unavailable.allowed, false);
assert.equal(unavailable.status, 503);
assert.equal(unavailable.errorCode, "OWNER_ACCESS_UNAVAILABLE");

const mock = await requireActiveOwnerEntitlement({ MOCK_AUTH: "true" } as Env, user);
assert.equal(mock.allowed, true);
assert.equal(mock.source, "mock");
assert.equal(mock.effectivePlanKey, "starter");
assert.equal(mock.planStatus, "trialing");

const unauthenticated = await requireOwnerRequestAccess(
  envWithBillingRow({ plan_key: "starter", plan_status: "active" }),
  new Request("https://dzn.example/api/onboarding/save"),
);
assert.equal(unauthenticated.allowed, false);
assert.equal(unauthenticated.status, 401);
assert.equal(unauthenticated.errorCode, "NOT_AUTHENTICATED");

assert.equal(
  pricingUrlForOwnerAccess("/dashboard?tab=sync"),
  "/pricing?intent=owner_setup&returnTo=%2Fdashboard%3Ftab%3Dsync",
);

const ownerAccessSource = read("functions/_lib/owner-access.ts");
assert.equal(ownerAccessSource.includes("effectiveEntitlementPlan(storedPlanKey, planStatus)"), true);
assert.equal(ownerAccessSource.includes("owner_billing_accounts"), true);
assert.equal(ownerAccessSource.includes("ensureBillingSchema"), false, "Owner access gate must not create billing schema.");
assert.equal(ownerAccessSource.includes("upsertOwnerEntitlements"), false, "Owner access gate must remain read-only.");

const pageMiddlewareSource = read("functions/_middleware.ts");
assert.equal(pageMiddlewareSource.includes("const ownerBillingPagePrefixes"), true);
assert.equal(pageMiddlewareSource.includes("\"/dashboard\""), true);
assert.equal(pageMiddlewareSource.includes("\"/setup\""), true);
assert.equal(pageMiddlewareSource.includes("requireActiveOwnerEntitlement(env, user"), true);

for (const middlewarePath of [
  "functions/api/onboarding/_middleware.ts",
  "functions/api/nitrado/_middleware.ts",
  "functions/api/server/_middleware.ts",
  "functions/api/servers/[serverId]/_middleware.ts",
  "functions/api/sync/_middleware.ts",
]) {
  assert.equal(existsSync(middlewarePath), true, `${middlewarePath} must exist.`);
  const source = read(middlewarePath);
  assert.equal(source.includes("requireOwnerRequestAccess"), true, `${middlewarePath} must require owner request access.`);
  assert.equal(source.includes("ownerAccessErrorResponse"), true, `${middlewarePath} must return owner access errors.`);
}

assert.equal(read("functions/api/sync/_middleware.ts").includes("isCronSecretAuthorized(request, env)"), true);
assert.equal(read("functions/api/discord/bot-status.ts").includes("requireOwnerRequestAccess(env, request)"), true);

for (const ownerEventMutationPath of [
  "functions/api/events/[slug]/join.ts",
  "functions/api/events/matchmaking.ts",
]) {
  const source = read(ownerEventMutationPath);
  assert.equal(source.includes("requireOwnerRequestAccess(env, request)"), true, `${ownerEventMutationPath} must require owner request access before server-event writes.`);
  assert.equal(source.includes("ownerAccessErrorResponse"), true, `${ownerEventMutationPath} must return canonical owner access errors.`);
}

const playerCommunitiesSource = read("functions/api/player/communities.ts");
assert.equal(playerCommunitiesSource.includes("fetchDiscordGuilds(token)"), true);
assert.equal(playerCommunitiesSource.includes("linked_servers.guild_id IN"), true);
assert.equal(playerCommunitiesSource.includes("discord_guilds.guild_id IN"), true);
assert.equal(playerCommunitiesSource.includes("storeGuilds"), false, "Player matching must not overwrite owner guild rows.");
assert.equal(playerCommunitiesSource.includes("canManageDiscordGuild"), false, "Player community matching must not require owner/admin guild permissions.");

const discordCallbackSource = read("functions/api/auth/discord/callback.ts");
assert.equal(discordCallbackSource.includes("storeGuilds(env, userId, filterAdminGuilds(guilds))"), true);

const platformSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");
for (const snippet of [
  "Public DZN -> free player ecosystem -> paid server-owner ecosystem -> competitive stats remain independent",
  "Starter: 2-day free trial, then £2/month.",
  "Pro: £10/month.",
  "Issue #49 is reserved for the final live checkout activation",
  "Discord guild matching supports player community recommendations without granting owner permissions",
]) {
  assert.equal(platformSpec.includes(snippet), true, `Master platform spec must include: ${snippet}`);
}

console.log("Player vs owner access foundation tests passed.");
}

function envWithBillingRow(row: BillingRow): Env {
  const statement = {
    bind() {
      return statement;
    },
    async first<T>() {
      return row as T;
    },
    async run() {
      return { success: true, meta: {} };
    },
    async all<T>() {
      return { success: true, meta: {}, results: [] as T[] };
    },
    async raw<T>() {
      return [] as T[];
    },
  };

  return {
    DB: {
      prepare(query: string) {
        assert.equal(query.includes("SELECT plan_key, plan_status"), true);
        return statement;
      },
      async batch() {
        return [];
      },
      async exec() {
        return { success: true, meta: {} };
      },
    },
  } as Env;
}

function read(path: string) {
  return readFileSync(path, "utf8");
}
