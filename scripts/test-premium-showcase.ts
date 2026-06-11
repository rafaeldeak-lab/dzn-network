import assert from "node:assert/strict";

import { getAdvancedShowcaseAccess } from "../functions/_lib/advanced-showcase-entitlements";

assert.equal(getAdvancedShowcaseAccess("free", "active").effectivePlan, "free");
assert.equal(getAdvancedShowcaseAccess("starter", "active").publicServerTop15, false);

const activePro = getAdvancedShowcaseAccess("pro", "active");
assert.equal(activePro.effectivePlan, "pro");
assert.equal(activePro.dashboardAnalytics, true);
assert.equal(activePro.publicServerTop15, true);
assert.equal(activePro.globalPremiumShowcase, false);

const trialingPremium = getAdvancedShowcaseAccess("premium", "trialing");
assert.equal(trialingPremium.effectivePlan, "premium");
assert.equal(trialingPremium.globalPremiumShowcase, true);
assert.equal(trialingPremium.publicMapOverlay, true);

assert.equal(getAdvancedShowcaseAccess("premium", "past_due").effectivePlan, "free");
assert.equal(getAdvancedShowcaseAccess("pro", "canceled").publicServerTop15, false);
assert.equal(getAdvancedShowcaseAccess("partner", "active").effectivePlan, "premium");
assert.equal(getAdvancedShowcaseAccess("network", "trialing").effectivePlan, "premium");
assert.equal(getAdvancedShowcaseAccess("partner", "unpaid").effectivePlan, "free");
assert.equal(getAdvancedShowcaseAccess(null, null).dashboardAnalytics, false);

console.log("Premium advanced showcase entitlement tests passed.");
