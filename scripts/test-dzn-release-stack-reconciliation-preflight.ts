import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const preflightPath = "docs/DZN_RELEASE_STACK_RECONCILIATION_PREFLIGHT.md";
const handoffPath = "docs/DZN_RELEASE_STACK_RECONCILIATION_HANDOFF.md";

assert.equal(existsSync(preflightPath), true, "Release stack preflight doc must exist.");
assert.equal(existsSync(handoffPath), true, "Release stack handoff doc must exist.");

const preflight = read(preflightPath);
const handoff = read(handoffPath);
const inventory = read("docs/DZN_RELEASE_BACKLOG_2026-09-12.md");
assert.match(preflight, /## Current Reconciliation: 2026-09-12/);
assert.match(preflight, /## Archived Snapshot: 2026-08-31/);
assert.ok(preflight.indexOf("## Current Reconciliation: 2026-09-12") < preflight.indexOf("## Archived Snapshot: 2026-08-31"));
assert.match(preflight, /DZN Trivia is next/);
assert.match(preflight, /Preserve the exact-server complimentary Pro access and existing bot reset schedule/);
assert.match(preflight, /FED & FERAL setup, genuine identity linking and customer billing proof/);
assert.match(preflight, /Main merges trigger the configured Pages deployment/);
assert.match(handoff, /## Current Handoff: 2026-09-12/);
const inventoriedPrs = [...inventory.matchAll(/^\| #(\d+) \|/gm)].map(match => Number(match[1]));
assert.equal(inventoriedPrs.length, 76, "Retain the complete initial snapshot, not only Games/Comms.");
assert.equal(new Set(inventoriedPrs).size, 76, "Inventory rows must be unique.");
assert.deepEqual([...inventoriedPrs].sort((a, b) => a - b), [...Array.from({ length: 74 }, (_, i) => 50 + i), 141, 149]);
assert.match(inventory, /File equality is not semantic feature equivalence or production activation proof/);
const dispositions = JSON.parse(read("docs/dzn-legacy-request-dispositions-2026-09-13.json")) as {
  original_count: number; closed_superseded: number; open_legacy: number;
  requests: Array<{ number: number; original_head: string; original_branch: string; status: string; disposition: string }>;
};
assert.equal(dispositions.original_count, 73);
assert.equal(dispositions.requests.length, 73);
assert.deepEqual(dispositions.requests.map(row => row.number), Array.from({ length: 73 }, (_, i) => i + 50));
const closed = dispositions.requests.filter(row => row.status === "closed_superseded").map(row => row.number);
assert.deepEqual(closed, [52, 63, 64, 83, 84, 85, 115]);
assert.equal(dispositions.closed_superseded, closed.length);
assert.equal(dispositions.open_legacy, 73 - closed.length);
for (const row of dispositions.requests) {
  assert.match(row.original_head, /^[a-f0-9]{40}$/);
  assert.ok(row.original_branch && row.disposition.length >= 20);
  assert.ok(["closed_superseded", "port_required", "partial", "design_reconcile", "in_progress"].includes(row.status));
}
const currentBacklog = read("docs/DZN_RELEASE_BACKLOG_2026-09-13.md");
assert.match(currentBacklog, /remaining 66 older requests are still open/);
for (const subject of ["NukeTown", "FED & FERAL", "Nitrado", "Discord", "Customer billing", "Spin/reward", "DZN Games Hub"]) {
  assert.ok(currentBacklog.includes(subject), `Retain wider user priority: ${subject}`);
}
const autodevConfig = JSON.parse(read(".autodev/config.json"));
const autodevDoc = read("docs/CODEX_AUTODEV.md");
const publicAccessPolicy = read("docs/PUBLIC_ACCESS_POLICY.md");
const billingPlans = read("docs/BILLING_PLANS.md");
const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

for (const snippet of [
  "non-mutating handoff",
  "Base commit: `7f00d2eb6b68bae112eb02d771036c5b97f8e9ea`",
  "Open PR snapshot from GitHub on 2026-08-31: #50 through #122, 73 open PRs.",
  "Draft blockers in the open stack: #63, #64, #65, #100, and #101.",
  "issue/PR #49",
  "Issue #46",
  "Do not merge or deploy the latest stacked head directly.",
  "Path A: stack unwind and sequential release.",
  "Path B: narrow main-based release candidate.",
  "personal player navigation/access polish",
  "No PR from this stack should be merged unless all of the following are true:",
  "No production deployment should happen unless all of the following are true:",
  "enable `DZN_LIVE_CHECKOUT_ENABLED`",
  "Durable Object/WebSocket runtime",
  "metered model calls",
  "competitive systems",
]) {
  assert.equal(preflight.includes(snippet), true, `Preflight doc must include: ${snippet}`);
}

for (const snippet of [
  "Do not merge/deploy the latest stacked head directly.",
  "draft blockers #63, #64, #65, #100, and #101",
  "main-based personal player navigation/access audit",
  "No production deployment or live-site mutation is included in this slice.",
]) {
  assert.equal(handoff.includes(snippet), true, `Handoff doc must include: ${snippet}`);
}

assert.equal(autodevConfig.mode, "pr_only", "AutoDev must remain PR-only.");
assert.equal(autodevConfig.allowDirectMainPush, false, "Direct main pushes must remain disabled.");
assert.equal(autodevConfig.allowAutoMergeLowRisk, false, "Auto-merge must remain disabled.");
assert.equal(autodevConfig.allowAutomaticProductionDeploy, false, "Automatic production deploy must remain disabled.");
assert.equal(autodevConfig.allowProductionMutations, false, "Production mutation must remain disabled.");
assert.equal(autodevConfig.aiSpendPolicy?.mode, "subscription_only", "Routine AI spend must remain subscription-only.");
assert.equal(autodevConfig.aiSpendPolicy?.maxExtraMonthlySpendUsd, 0, "Extra AI spend cap must remain zero.");

for (const snippet of [
  "branch -> PR -> tests/review -> approved merge -> intentional deployment path -> production verification",
  "Production migrations, Pages deployments, Worker deployments, Stripe live changes, Nitrado live changes, Discord production messages, and production secret updates are explicit release operations.",
]) {
  assert.equal(autodevDoc.includes(snippet), true, `AutoDev doc must preserve release policy: ${snippet}`);
}

for (const snippet of [
  "Starter trial and Pro behavior must continue to come from the billing/entitlement helpers and API responses.",
  "Package copy must not imply a competitive advantage.",
  "No production D1, Stripe, Nitrado, Discord, or secrets mutation is required for this policy.",
]) {
  assert.equal(publicAccessPolicy.includes(snippet), true, `Public access policy must preserve boundary: ${snippet}`);
}

for (const snippet of [
  "Live Stripe checkout is paused by default unless `DZN_LIVE_CHECKOUT_ENABLED=true`",
  "Live Stripe product/price creation, webhook endpoint changes, Cloudflare secret changes, D1 migration application, customer import, checkout enablement, and payment enablement remain separate high-risk human-approved operations.",
]) {
  assert.equal(billingPlans.includes(snippet), true, `Billing plan doc must preserve live checkout boundary: ${snippet}`);
}

assert.equal(typeof packageJson.scripts?.["test:dzn-release-stack-reconciliation-preflight"], "string");
assert.equal(packageJson.scripts?.test?.includes("test:dzn-release-stack-reconciliation-preflight"), true);

for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (name === "db:migrate:remote") continue;
  assert.doesNotMatch(`${name} ${command}`, /\bDZN_LIVE_CHECKOUT_ENABLED\s*=\s*(?:true|1|yes|on)\b/i);
  assert.doesNotMatch(`${name} ${command}`, /\bstripe\s+(?:products?|prices?|webhook_endpoints?)\s+(?:create|update|delete)\b/i);
}

console.log("DZN release stack reconciliation preflight checks passed.");
