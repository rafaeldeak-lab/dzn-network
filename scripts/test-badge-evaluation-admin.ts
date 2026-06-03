import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildServerBadgeCollection } from "../lib/badges/rules";
import { getBillingPlanSummaries } from "../functions/_lib/plans";
import type { Env } from "../functions/_lib/types";

const evaluationSource = read("functions/_lib/badge-evaluation.ts");
const adminEvaluate = read("functions/api/admin/badges/evaluate.ts");
const adminAward = read("functions/api/admin/badges/award.ts");
const adminCrown = read("functions/api/admin/badges/crown.ts");
const cronEvaluate = read("functions/api/cron/badges/evaluate.ts");
const ownerStatus = read("functions/api/servers/[serverId]/badges/status.ts");
const dashboard = read("components/onboarding/dashboard.tsx");
const publicServers = read("functions/api/public/servers.ts");
const migration = read("migrations/0046_badge_audit_log.sql");
const docs = read("docs/BADGE_AWARDING_SYSTEM.md");

assert.equal(adminEvaluate.includes("requireBadgeAdminUser"), true, "Admin evaluation endpoint must require admin/support auth.");
assert.equal(adminAward.includes("requireBadgeAdminUser"), true, "Admin award endpoint must require admin/support auth.");
assert.equal(adminCrown.includes("requireBadgeAdminUser"), true, "Admin crown endpoint must require admin/support auth.");
assert.equal(evaluationSource.includes("status: 401"), true, "Badge admin helper must return 401 for unauthenticated users.");
assert.equal(evaluationSource.includes("status: 403"), true, "Badge admin helper must return 403 for authenticated non-admin users.");
assert.equal(evaluationSource.includes("Only DZN admin or support users can manage protected badges"), true, "Normal owners must not self-award protected badges.");

assert.equal(cronEvaluate.includes("requireCronSecret"), true, "Cron badge evaluation endpoint must require cron secret.");
assert.equal(ownerStatus.includes("ownerCanGrantProtectedBadges: false"), true, "Owner badge status must not allow protected grants.");
assert.equal(ownerStatus.includes("getLastEvaluationAt"), true, "Owner badge status should expose last evaluation timing.");
assert.equal(ownerStatus.includes("getEarnedServerBadges"), true, "Owner badge status should expose earned status.");
assert.equal(ownerStatus.includes("getLockedServerBadges"), true, "Owner badge status should expose locked status.");
assert.equal(evaluationSource.includes("SAFE_BATCH_LIMIT_MAX = 25"), true, "Badge batch evaluation must be capped.");
assert.equal(evaluationSource.includes("evaluateServerBadgesSafely"), true, "Safe single-server evaluation helper should exist.");
assert.equal(evaluationSource.includes("evaluateBadgeBatchForAllServers"), true, "Safe all-server batch helper should exist.");
assert.equal(evaluationSource.includes("refreshAllCrownHolders"), true, "Crown refresh helper should exist.");
assert.equal(evaluationSource.includes("rebuildBadgeProgressForServer"), true, "Badge progress rebuild helper should exist.");

for (const code of ["founder", "early_adopter", "beta_veteran", "pioneer", "dzn_legend", "exclusive", "top_pick", "helping_hand", "event_champion", "loot_master", "summer_champion"]) {
  assert.equal(evaluationSource.includes(`"${code}"`), true, `${code} should be manual-award eligible.`);
}

assert.equal(adminAward.includes("manualAwardProtectedBadge"), true, "Admin award endpoint should call protected award helper.");
assert.equal(adminCrown.includes("manualTransferCrown"), true, "Admin crown endpoint should call crown transfer helper.");
assert.equal(evaluationSource.includes("setCrownHolder"), true, "Crown transfer should use the existing crown holder helper.");
assert.equal(evaluationSource.includes("previousServerId"), true, "Crown transfer audit should record previous holder.");
assert.equal(evaluationSource.includes("badge_audit_log"), true, "Evaluation helper should write audit rows.");

for (const action of ["badge_awarded", "badge_revoked", "crown_transferred", "badge_progress_updated", "evaluation_ran", "evaluation_failed"]) {
  assert.equal(migration.includes(action) || evaluationSource.includes(action), true, `${action} should be a supported audit action.`);
}
assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS badge_audit_log"), true, "Badge audit migration should create audit table.");
assert.equal(/DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE\s+player_profiles|player_stats|DROP\s+COLUMN/i.test(migration), false, "Badge audit migration must be non-destructive.");

assert.equal(dashboard.includes("Last Badge Eval"), true, "Owner dashboard should show badge evaluation status.");
assert.equal(dashboard.includes("Owner Grants"), true, "Owner dashboard should communicate that owner grants are not allowed.");
assert.equal(publicServers.includes("earnedBadges"), true, "Public server profile API should include earned badges.");
assert.equal(publicServers.includes("lockedBadges"), true, "Public server profile API should include locked badge previews.");
assert.equal(publicServers.includes("showcaseBadges"), true, "Public server profile API should include showcase badges.");

const premium = buildServerBadgeCollection({ planKey: "premium", active: true });
const network = buildServerBadgeCollection({ planKey: "network", active: true });
const partner = buildServerBadgeCollection({ planKey: "partner", active: true });
assert.equal(premium.earnedBadges.some((badge) => badge.code === "premium_server"), true, "Premium should earn premium_server.");
assert.equal(network.earnedBadges.some((badge) => badge.code === "premium_server"), true, "Network legacy alias should map to Premium.");
assert.equal(partner.earnedBadges.some((badge) => badge.code === "premium_server"), true, "Partner legacy alias should map to Premium.");

const activePlans = getBillingPlanSummaries({
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_PREMIUM: "price_premium",
} as Env);
assert.deepEqual(activePlans.map((plan) => plan.plan_key), ["starter", "pro", "premium"], "Public billing plans should remain Starter, Pro, Premium.");
assert.equal(JSON.stringify(activePlans).includes("Network"), false, "Network should not appear as a public billing plan.");
assert.equal(JSON.stringify(activePlans).includes("Partner"), false, "Partner should not appear as a public billing plan.");

assert.equal(/from\s+["']\.\/adm|from\s+["'].*adm-sync|from\s+["'].*nitrado/i.test(evaluationSource), false, "Badge evaluation must not import ADM/Nitrado sync modules.");
assert.equal(docs.includes("must not rewrite the tracking pipeline"), true, "Awarding docs should preserve ADM/Nitrado boundary.");

console.log("Badge evaluation admin/control tests passed.");

function read(path: string) {
  return readFileSync(path, "utf8");
}
