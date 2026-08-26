import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const siteHeaderSource = readFileSync("components/site-header.tsx", "utf8");
const homepageSource = readFileSync("components/dzn/dzn-landing-page.tsx", "utf8");
const authMeSource = readFileSync("functions/api/auth/me.ts", "utf8");
const authTypesSource = readFileSync("components/onboarding/types.ts", "utf8");
const globalsSource = readFileSync("app/globals.css", "utf8");
const publicAccessPolicyDoc = readFileSync("docs/PUBLIC_ACCESS_POLICY.md", "utf8");

const loggedOutHeaderBlock = sourceBlock(siteHeaderSource, "const loggedOutHeaderLinks", "const starterHeaderLinks");
const starterHeaderBlock = sourceBlock(siteHeaderSource, "const starterHeaderLinks", "const proHeaderLinks");
const proHeaderBlock = sourceBlock(siteHeaderSource, "const proHeaderLinks", "let pageHeaderAuthState");
const headerActionBlock = sourceBlock(siteHeaderSource, "<div className=\"dzn-header-actions\">", "{resolvedAuthenticated && showLogout");

assert.equal(loggedOutHeaderBlock.includes("Features"), true);
assert.equal(loggedOutHeaderBlock.includes("Pricing"), true);
for (const privateLabel of ["Leaderboards", "Servers", "Stats", "Events", "Community", "Dashboard", "Add Your Server", "Start Setup", "Upgrade to Pro", "Owner Dashboard"]) {
  assert.equal(loggedOutHeaderBlock.includes(privateLabel), false, `Logged-out header links must not include ${privateLabel}.`);
}

assert.equal(starterHeaderBlock.includes("Leaderboards"), true);
assert.equal(starterHeaderBlock.includes("Servers"), true);
assert.equal(starterHeaderBlock.includes("Events"), true);
assert.equal(starterHeaderBlock.includes("Community"), true);
assert.equal(starterHeaderBlock.includes("Stats"), false, "Starter/trial header should not advertise Pro stats as a normal nav item.");
assert.equal(starterHeaderBlock.includes("Pricing"), false, "Starter/trial header should use the upgrade action instead of a generic pricing nav link.");

assert.equal(proHeaderBlock.includes("Leaderboards"), true);
assert.equal(proHeaderBlock.includes("Servers"), true);
assert.equal(proHeaderBlock.includes("Stats"), true);
assert.equal(proHeaderBlock.includes("Events"), true);
assert.equal(proHeaderBlock.includes("Community"), true);
assert.equal(proHeaderBlock.includes("Pricing"), false, "Pro header should focus on product tools instead of pricing.");

assert.equal(siteHeaderSource.includes("type HeaderPlanTier = AuthNavigationSummary[\"plan_tier\"]"), true);
assert.equal(siteHeaderSource.includes("function authenticatedHeaderLinksForTier"), true);
assert.equal(siteHeaderSource.includes("if (tier === \"pro\") return proHeaderLinks;"), true);
assert.equal(siteHeaderSource.includes("return starterHeaderLinks;"), true);
assert.equal(siteHeaderSource.includes("normalizeHeaderNavigation(payload?.navigation)"), true);
assert.equal(siteHeaderSource.includes("navigation={authState?.navigation}"), true);
assert.equal(siteHeaderSource.includes("data-auth-state={resolvedAuthenticated ? \"authenticated\" : authProbePending ? \"checking-public\" : \"anonymous\"}"), true);
assert.equal(siteHeaderSource.includes(">Checking<"), false, "The header must not show a visible Checking auth button/label.");
assert.equal(siteHeaderSource.includes("Checking account"), false, "The header must not show checking copy in visible controls.");
assert.equal(globalsSource.includes("@media (max-width: 560px)"), true, "Small mobile headers must collapse action buttons before they can clip the viewport.");
assert.equal(globalsSource.includes("grid-template-columns: 1fr;"), true, "Small mobile header actions must use one full-width column.");

assert.equal(headerActionBlock.includes("DznPulseBell"), true);
assert.equal(headerActionBlock.includes("dzn-header-plan--${planTier}"), true);
assert.equal(siteHeaderSource.includes("const canUseOwnerTools = Boolean(resolvedNavigation?.can_use_owner_tools)"), true);
assert.equal(siteHeaderSource.includes("const showOwnerDashboard = resolvedAuthenticated && canUseOwnerTools"), true);
assert.equal(siteHeaderSource.includes("const showAddServer = resolvedAuthenticated && canUseOwnerTools"), true);
assert.equal(headerActionBlock.includes("showOwnerDashboard ? ("), true);
assert.equal(headerActionBlock.includes("planTier === \"free\" ? \"Start Setup\" : \"Add Your Server\""), false);
assert.equal(headerActionBlock.includes("dzn-header-action--package-${primaryAction.tone}"), true);

for (const action of [
  "{ label: \"Owner Plans\", href: \"/pricing?intent=owner_setup&returnTo=%2Fsetup\", tone: \"trial\" }",
  "{ label: \"Upgrade to Pro\", href: \"/pricing?intent=pro&returnTo=%2Fdashboard\", tone: \"upgrade\" }",
  "{ label: \"Owner Dashboard\", href: \"/dashboard\", tone: \"pro\" }",
]) {
  assert.equal(siteHeaderSource.includes(action), true, `Header must define package action: ${action}`);
}

assert.equal(homepageSource.includes("navigation: AuthResponse[\"navigation\"] | null"), true);
assert.equal(homepageSource.includes("navigation: payload.navigation ?? null"), true);
assert.equal(homepageSource.includes("navigation={authState.navigation}"), true);

assert.equal(authTypesSource.includes("export type AuthNavigationSummary"), true);
assert.equal(authTypesSource.includes("navigation?: AuthNavigationSummary;"), true);
assert.equal(authTypesSource.includes("plan_tier: \"free\" | \"starter\" | \"pro\""), true);
assert.equal(authTypesSource.includes("role: \"player\" | \"owner\""), true);
assert.equal(authTypesSource.includes("can_use_player_surfaces: boolean"), true);
assert.equal(authTypesSource.includes("can_use_owner_tools: boolean"), true);
assert.equal(authTypesSource.includes("owner_action_required: \"choose_plan\" | null"), true);
assert.equal(authTypesSource.includes("owner_pricing_url: string"), true);
assert.equal(authTypesSource.includes("label: \"Owner Plans\" | \"Upgrade to Pro\" | \"Owner Dashboard\""), true);

assert.equal(authMeSource.includes("SELECT plan_key, plan_status FROM owner_billing_accounts"), true);
assert.equal(authMeSource.includes("effectiveEntitlementPlan(storedPlanKey, planStatus)"), true);
assert.equal(authMeSource.includes("getPlanConfig(effectivePlanKey)"), true);
assert.equal(authMeSource.includes("plan_tier: tier"), true);
assert.equal(authMeSource.includes("role: canUseOwnerTools ? \"owner\" : \"player\""), true);
assert.equal(authMeSource.includes("can_use_player_surfaces: true"), true);
assert.equal(authMeSource.includes("can_use_owner_tools: canUseOwnerTools"), true);
assert.equal(authMeSource.includes("owner_action_required: canUseOwnerTools ? null : \"choose_plan\""), true);
assert.equal(authMeSource.includes("can_use_pro_tools: tier === \"pro\""), true);
assert.equal(authMeSource.includes("primary_action: navigationPrimaryActionForTier(tier)"), true);
assert.equal(authMeSource.includes("getOwnerBillingStatus"), false, "Auth summary must not call the billing status helper because that upserts entitlements.");
assert.equal(authMeSource.includes("ensureBillingSchema"), false, "Auth summary must not create billing schema during header probes.");
assert.equal(authMeSource.includes("upsertOwnerEntitlements"), false, "Auth summary must remain read-only.");

for (const className of [
  ".dzn-header-plan",
  ".dzn-header-plan--starter",
  ".dzn-header-plan--pro",
  ".dzn-header-action--package-trial",
  ".dzn-header-action--package-upgrade",
  ".dzn-header-action--package-pro",
]) {
  assert.equal(globalsSource.includes(className), true, `Header package UI CSS must include ${className}.`);
}

for (const expectedPolicy of [
  "Logged-out navigation must only expose the public funnel",
  "Free player accounts should see player navigation plus a clear owner-plan action.",
  "Starter/trial accounts should see trial-safe owner navigation plus a clear Pro upgrade action.",
  "Pro-effective accounts should see Pro tools in the header.",
]) {
  assert.equal(publicAccessPolicyDoc.includes(expectedPolicy), true, `Public access policy must document: ${expectedPolicy}`);
}

console.log("Navigation access visibility tests passed.");

function sourceBlock(source: string, startNeedle: string, endNeedle: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}
