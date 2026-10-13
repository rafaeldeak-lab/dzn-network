import assert from "node:assert/strict";

import {
  acquireTaskLease,
  assessLowRiskRelease,
  assessPostReleaseHealth,
  assessTaskAuthority,
  makeTaskDeduplicationKey,
  transitionTask,
  type AuthorityTask,
  type StandingAuthority,
} from "./autodev/standing-authority";

const now = "2026-10-13T23:00:00.000Z";

const authority: StandingAuthority = {
  id: "authority-frontend-polish",
  approvedGoal: "Deliver bounded, reversible low-risk DZN interface polish.",
  state: "active",
  allowedSystems: ["ui", "docs", "tests"],
  excludedSystems: ["auth", "billing", "stripe", "nitrado", "adm", "database", "cloudflare-worker", "github-actions", "autodev", "release"],
  allowedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure", "auto-release-low-risk"],
  policyVersion: "dzn-standing-authority-v1",
  maxConcurrentTasks: 1,
  maxAttemptsPerTask: 3,
  maxRuntimeMinutes: 45,
  maxChangedFiles: 5,
  subscriptionOnly: true,
  maxExtraMonthlySpendUsd: 0,
  acceptanceCriteria: ["Targeted tests pass", "Preview passes", "Independent review is green"],
  approvedAt: now,
};

function task(overrides: Partial<AuthorityTask> = {}): AuthorityTask {
  return {
    id: "task-ui-nav-spacing",
    authorityId: authority.id,
    title: "Tighten public navigation spacing",
    system: "ui",
    requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "auto-release-low-risk"],
    state: "proposed",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    implementerId: "implementation-runner-a",
    ...overrides,
  };
}

const dedupeA = makeTaskDeduplicationKey(authority.id, "Tighten  public navigation spacing", "ui");
const dedupeB = makeTaskDeduplicationKey(authority.id, "tighten public navigation spacing", "ui");
assert.equal(dedupeA, dedupeB, "Equivalent tasks must deduplicate deterministically.");

assert.equal(assessTaskAuthority(authority, task()).ok, true);
assert.equal(assessTaskAuthority(authority, task({ system: "billing" })).code, "authority_scope_denied");
assert.equal(assessTaskAuthority({ ...authority, state: "revoked", revokedAt: now }, task()).code, "authority_inactive");
assert.equal(assessTaskAuthority({ ...authority, maxExtraMonthlySpendUsd: 1 }, task()).code, "resource_limit_exceeded");
assert.equal(assessTaskAuthority(authority, task({ attempts: 3 })).code, "resource_limit_exceeded");

const authorised = transitionTask(authority, task(), "authorised", now);
assert.equal(authorised.ok, true);
const implementing = transitionTask(authority, authorised.task!, "implementing", now);
const validating = transitionTask(authority, implementing.task!, "validating", now);
const ready = transitionTask(authority, validating.task!, "ready-to-release", now);
assert.equal(ready.ok, true);
assert.equal(transitionTask(authority, task(), "released", now).code, "invalid_transition");

const leased = acquireTaskLease(authority, ready.task!, [], "runner-a", new Date(now));
assert.equal(leased.ok, true);
assert.equal(leased.task?.lease?.runnerId, "runner-a");
assert.equal(acquireTaskLease(authority, ready.task!, [leased.task!], "runner-b", new Date(now)).code, "task_locked");
assert.equal(acquireTaskLease(authority, task({ id: "parallel-task", state: "authorised" }), [leased.task!], "runner-b", new Date(now)).code, "resource_limit_exceeded");

const candidateTask = task({
  state: "ready-to-release",
  candidate: {
    baseSha: "base-commit",
    headSha: "candidate-commit",
    changedFiles: ["components/games/games-hub.tsx", "components/games/games-hub.module.css"],
    classifications: [
      { file: "components/games/games-hub.tsx", system: "ui", risk: "low" },
      { file: "components/games/games-hub.module.css", system: "ui", risk: "low" },
    ],
    evidence: [
      { kind: "scope", status: "pass", candidateHead: "candidate-commit", detail: "Classifier records UI-only low risk." },
      { kind: "tests", status: "pass", candidateHead: "candidate-commit", detail: "Targeted tests passed." },
      { kind: "preview", status: "pass", candidateHead: "candidate-commit", detail: "Preview deployment passed." },
      { kind: "browser-qa", status: "pass", candidateHead: "candidate-commit", detail: "Desktop and mobile QA passed." },
      { kind: "independent-review", status: "pass", candidateHead: "candidate-commit", independent: true, actorId: "release-reviewer-b", detail: "Independent review found no issues." },
    ],
  },
});
const eligible = assessLowRiskRelease(authority, candidateTask);
assert.equal(eligible.releaseEligible, true);
assert.equal(eligible.requiresTrustedController, true, "Eligibility alone must not merge a PR.");

const staleChecks = assessLowRiskRelease(authority, {
  ...candidateTask,
  candidate: { ...candidateTask.candidate!, evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: "old-commit" })) },
});
assert.equal(staleChecks.releaseEligible, false);

const protectedPath = assessLowRiskRelease(authority, {
  ...candidateTask,
  candidate: { ...candidateTask.candidate!, changedFiles: ["scripts/autodev/standing-authority.ts"] },
});
assert.equal(protectedPath.releaseEligible, false);

const unknownRisk = assessLowRiskRelease(authority, {
  ...candidateTask,
  candidate: {
    ...candidateTask.candidate!,
    changedFiles: ["functions/api/billing/checkout.ts"],
    classifications: [{ file: "functions/api/billing/checkout.ts", system: "ui", risk: "low" }],
  },
});
assert.equal(unknownRisk.releaseEligible, false, "Caller-provided classifications cannot downgrade a protected path.");

const selfReviewed = assessLowRiskRelease(authority, {
  ...candidateTask,
  candidate: {
    ...candidateTask.candidate!,
    evidence: candidateTask.candidate!.evidence.map((item) => item.kind === "independent-review" ? { ...item, actorId: "implementation-runner-a" } : item),
  },
});
assert.equal(selfReviewed.releaseEligible, false, "An implementer cannot supply its own independent release review.");

const missingImplementer = assessLowRiskRelease(authority, {
  ...candidateTask,
  implementerId: "",
});
assert.equal(missingImplementer.releaseEligible, false, "Automatic release requires a named implementation actor.");

const anonymousReview = assessLowRiskRelease(authority, {
  ...candidateTask,
  candidate: {
    ...candidateTask.candidate!,
    evidence: candidateTask.candidate!.evidence.map((item) => item.kind === "independent-review" ? { ...item, actorId: "" } : item),
  },
});
assert.equal(anonymousReview.releaseEligible, false, "Automatic release requires a named independent review actor.");

const regression = assessPostReleaseHealth(authority, candidateTask, "fail", "Production health check regressed.");
assert.equal(regression.shouldPauseFurtherReleases, true);
assert.equal(assessPostReleaseHealth(authority, candidateTask, "pass", "Health check passed.").shouldPauseFurtherReleases, false);

console.log("AutoDev standing-authority controller tests passed.");
