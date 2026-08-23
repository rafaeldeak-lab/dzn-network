import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSafePlatformIssue, REQUIRED_SAFE_LABELS } from "./autodev/pick-safe-issue";

function read(path: string) {
  return readFileSync(path, "utf8");
}

assert.deepEqual(REQUIRED_SAFE_LABELS, ["autodev", "autodev-safe-fix", "low-risk"]);
assert.equal(isSafePlatformIssue({ number: 1, title: "Fix Sync Health wording", body: "ADM sync health dashboard copy should mention automatic retry.", labels: ["autodev", "adm-tracking", "autodev-safe-fix", "low-risk", "system:adm"] }).ok, true);
assert.equal(isSafePlatformIssue({ number: 2, title: "Fix pricing docs typo", body: "Billing docs mention an old label but no billing code changes are needed.", labels: ["autodev", "autodev-safe-fix", "low-risk", "system:docs"] }).ok, true);
assert.equal(isSafePlatformIssue({ number: 3, title: "Event page empty state", body: "Update event UI copy only.", labels: ["autodev", "autodev-safe-fix", "low-risk", "system:events"] }).ok, true);

for (const blocked of [
  { title: "billing checkout failed", labels: ["autodev", "autodev-safe-fix", "low-risk", "system:billing"] },
  { title: "stripe invoice webhook", labels: ["autodev", "autodev-safe-fix", "low-risk", "system:stripe"] },
  { title: "discord oauth login issue", labels: ["autodev", "autodev-safe-fix", "low-risk", "system:auth"] },
  { title: "session cookie change", labels: ["autodev", "autodev-safe-fix", "low-risk", "auth"] },
  { title: "subscription plan mismatch", labels: ["autodev", "autodev-safe-fix", "low-risk", "billing"] },
  { title: "drop table player_profiles", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "create player_stats", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "remove same-category matchmaking", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "production Stripe mutation", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "add OpenAI API key for AutoDev", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "wire Anthropic API key", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "enable Codex credit auto top-up", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "change AI spend policy", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "add Claude paid action", labels: ["autodev", "autodev-safe-fix", "low-risk"] },
  { title: "update docs", labels: ["autodev", "autodev-safe-fix", "low-risk", "ai-spend"] },
]) {
  assert.equal(isSafePlatformIssue({ number: 4, title: blocked.title, body: blocked.title, labels: blocked.labels }).ok, false, `${blocked.title} must be blocked`);
}

assert.equal(isSafePlatformIssue({ number: 5, title: "ADM token decrypt failure", body: "Needs TOKEN_ENCRYPTION_KEY handling changes.", labels: ["autodev", "adm-tracking", "autodev-safe-fix", "low-risk"] }).ok, false);
assert.equal(isSafePlatformIssue({ number: 6, title: "Dashboard typo", body: "Fix wording", labels: ["autodev", "low-risk"] }).ok, false);
assert.equal(isSafePlatformIssue({ number: 7, title: "Dashboard typo", body: "Fix wording", labels: ["autodev", "autodev-safe-fix", "low-risk", "needs-human-review"] }).ok, false);

const workflow = read(".github/workflows/dzn-codex-safe-fix.yml");
assert.equal(workflow.includes("name: DZN Codex Safe Fix"), true);
assert.equal(workflow.includes("workflow_dispatch:"), true);
assert.equal(workflow.includes("contents: read"), true);
assert.equal(workflow.includes("issues: read"), true);
assert.equal(workflow.includes("pull-requests: write"), false);
assert.equal(workflow.includes("Pick safe platform issue"), true);
assert.equal(workflow.includes("platform-wide"), true);
assert.equal(workflow.includes("subscription-only AI work"), true);
assert.equal(workflow.includes("$0 extra monthly AI/API spend"), true);
assert.equal(workflow.includes("smallest coherent fix"), true);
assert.equal(workflow.includes("never push main"), true);
assert.equal(workflow.includes("never auto-merge"), true);
assert.equal(workflow.includes("never deploy or mutate production"), true);
assert.equal(workflow.includes("destructive migrations"), true);
assert.equal(workflow.includes("creating player_stats"), true);
assert.equal(workflow.includes("weakening authentication"), true);
assert.equal(workflow.includes("same-category matchmaking"), true);
assert.equal(workflow.includes("Cloudflare runtime secrets"), true);
assert.equal(workflow.includes("GitHub Actions the primary ADM auto-sync runner"), true);
assert.equal(workflow.includes("paid 24/7 Codex/OpenAI execution"), true);
assert.equal(workflow.includes("metered AI provider"), true);
assert.equal(workflow.includes("auto top-up"), true);
assert.equal(workflow.includes("uses: openai/codex-action"), false);
assert.equal(workflow.includes("secrets.STRIPE_SECRET_KEY"), false);
assert.equal(workflow.includes("secrets.DISCORD_CLIENT_SECRET"), false);
assert.equal(workflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);
assert.equal(workflow.includes("secrets.OPENAI_API_KEY"), false);
assert.equal(workflow.includes("OPENAI_API_KEY"), false);

console.log("AutoDev Codex platform pipeline tests passed.");
