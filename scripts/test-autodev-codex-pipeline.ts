import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSafeAdmIssue, REQUIRED_SAFE_LABELS } from "./autodev/pick-safe-issue";

function read(path: string) {
  return readFileSync(path, "utf8");
}

assert.deepEqual(REQUIRED_SAFE_LABELS, ["autodev", "adm-tracking", "autodev-safe-fix", "low-risk"]);

assert.equal(isSafeAdmIssue({
  number: 1,
  title: "Fix ADM Sync Health wording",
  body: "ADM sync health dashboard copy should mention automatic retry.",
  labels: ["autodev", "adm-tracking", "autodev-safe-fix", "low-risk"],
}).ok, true);

for (const blocked of [
  "billing checkout failed",
  "stripe invoice webhook",
  "discord oauth login issue",
  "session cookie change",
  "subscription plan mismatch",
  "drop table player_profiles",
  "create player_stats",
  "event matchmaking rule",
  "ctf tournament bracket",
]) {
  assert.equal(isSafeAdmIssue({
    number: 2,
    title: blocked,
    body: blocked,
    labels: ["autodev", "adm-tracking", "autodev-safe-fix", "low-risk"],
  }).ok, false, `${blocked} must be blocked`);
}

assert.equal(isSafeAdmIssue({
  number: 3,
  title: "ADM token decrypt failure",
  body: "Needs TOKEN_ENCRYPTION_KEY handling changes.",
  labels: ["autodev", "adm-tracking", "autodev-safe-fix", "low-risk"],
}).ok, false);

assert.equal(isSafeAdmIssue({
  number: 4,
  title: "ADM dashboard typo",
  body: "Fix ADM wording",
  labels: ["autodev", "adm-tracking", "low-risk"],
}).ok, false);

assert.equal(isSafeAdmIssue({
  number: 5,
  title: "ADM dashboard typo",
  body: "Fix ADM wording",
  labels: ["autodev", "adm-tracking", "autodev-safe-fix", "low-risk", "needs-human-review"],
}).ok, false);

const workflow = read(".github/workflows/dzn-codex-safe-fix.yml");
assert.equal(workflow.includes("name: DZN ADM Codex Safe Fix"), true);
assert.equal(workflow.includes("workflow_dispatch:"), true);
assert.equal(workflow.includes("ADM discovery"), true);
assert.equal(workflow.includes("Forbidden systems:"), true);
assert.equal(workflow.includes("billing"), true);
assert.equal(workflow.includes("Stripe"), true);
assert.equal(workflow.includes("Discord OAuth"), true);
assert.equal(workflow.includes("never push main"), true);
assert.equal(workflow.includes("never auto-merge"), true);
assert.equal(workflow.includes("secrets.STRIPE_SECRET_KEY"), false);
assert.equal(workflow.includes("secrets.DISCORD_CLIENT_SECRET"), false);
assert.equal(workflow.includes("secrets.TOKEN_ENCRYPTION_KEY"), false);

console.log("AutoDev Codex ADM-only pipeline tests passed.");
