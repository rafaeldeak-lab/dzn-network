import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireTaskLease,
  assessLowRiskPullRequest,
  assessPostMergeHealth,
  assessTaskAuthority,
  inspectGitRange,
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
  repositoryRemote: "https://github.com/rafaeldeak-lab/dzn-network.git",
  allowedSystems: ["ui", "docs", "tests"],
  excludedSystems: ["auth", "billing", "stripe", "nitrado", "adm", "database", "cloudflare-worker", "github-actions", "autodev", "release"],
  allowedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"],
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
    requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr"],
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

const fixture = makeGitFixture("components/games/games-hub.tsx", "export const status = 'ready';\n");
const verifiedRange = inspectGitRange(fixture.path, fixture.baseSha, fixture.headSha);

const candidateTask = task({
  state: "ready-to-release",
  candidate: {
    ...verifiedRange,
    evidence: [
      { kind: "scope", status: "pass", candidateHead: fixture.headSha, detail: "Classifier records UI-only low risk." },
      { kind: "tests", status: "pass", candidateHead: fixture.headSha, detail: "Targeted tests passed." },
      { kind: "preview", status: "pass", candidateHead: fixture.headSha, detail: "Preview deployment passed." },
      { kind: "browser-qa", status: "pass", candidateHead: fixture.headSha, detail: "Desktop and mobile QA passed." },
      { kind: "independent-review", status: "pass", candidateHead: fixture.headSha, independent: true, actorId: "release-reviewer-b", detail: "Independent review found no issues." },
    ],
  },
});
const eligible = assessLowRiskPullRequest(authority, candidateTask, fixture.path);
assert.equal(eligible.pullRequestEligible, true);
assert.equal(eligible.requiresSeparateHumanMerge, true, "Eligibility alone must never merge a PR.");

const staleChecks = assessLowRiskPullRequest(authority, {
  ...candidateTask,
  candidate: { ...candidateTask.candidate!, evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: fixture.baseSha })) },
}, fixture.path);
assert.equal(staleChecks.pullRequestEligible, false);

const mismatchedFiles = assessLowRiskPullRequest(authority, {
  ...candidateTask,
  candidate: { ...candidateTask.candidate!, changedFiles: ["scripts/autodev/standing-authority.ts"] },
}, fixture.path);
assert.equal(mismatchedFiles.pullRequestEligible, false, "Candidate file lists must match the exact Git range.");

const protectedFixture = makeGitFixture("scripts/autodev/release-control.ts", "export const blocked = true;\n");
const protectedRange = inspectGitRange(protectedFixture.path, protectedFixture.baseSha, protectedFixture.headSha);
const protectedPath = assessLowRiskPullRequest(authority, {
  ...candidateTask,
  candidate: {
    ...protectedRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: protectedFixture.headSha })),
  },
}, protectedFixture.path);
assert.equal(protectedPath.pullRequestEligible, false, "Protected paths must be rejected from the verified Git range.");

const outOfScopeFixture = makeGitFixture("components/events/authority-note.tsx", "export const eventNote = 'scope';\n");
const outOfScopeRange = inspectGitRange(outOfScopeFixture.path, outOfScopeFixture.baseSha, outOfScopeFixture.headSha);
const outOfScope = assessLowRiskPullRequest(authority, {
  ...candidateTask,
  candidate: {
    ...outOfScopeRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: outOfScopeFixture.headSha })),
  },
}, outOfScopeFixture.path);
assert.equal(outOfScope.pullRequestEligible, false, "Every verified file must be within the authority scope.");

const selfReviewed = assessLowRiskPullRequest(authority, {
  ...candidateTask,
  candidate: {
    ...candidateTask.candidate!,
    evidence: candidateTask.candidate!.evidence.map((item) => item.kind === "independent-review" ? { ...item, actorId: "implementation-runner-a" } : item),
  },
}, fixture.path);
assert.equal(selfReviewed.pullRequestEligible, false, "An implementer cannot supply its own independent review.");

const missingImplementer = assessLowRiskPullRequest(authority, {
  ...candidateTask,
  implementerId: "",
}, fixture.path);
assert.equal(missingImplementer.pullRequestEligible, false, "Pull-request preparation requires a named implementation actor.");

const anonymousReview = assessLowRiskPullRequest(authority, {
  ...candidateTask,
  candidate: {
    ...candidateTask.candidate!,
    evidence: candidateTask.candidate!.evidence.map((item) => item.kind === "independent-review" ? { ...item, actorId: "" } : item),
  },
}, fixture.path);
assert.equal(anonymousReview.pullRequestEligible, false, "Pull-request preparation requires a named independent review actor.");

const missingPrAction = assessLowRiskPullRequest(authority, {
  ...candidateTask,
  requestedActions: ["investigate", "implement-in-branch", "validate"],
}, fixture.path);
assert.equal(missingPrAction.pullRequestEligible, false, "A task must explicitly request pull-request preparation.");

const wrongRemote = assessLowRiskPullRequest({ ...authority, repositoryRemote: "https://github.com/other/repository.git" }, candidateTask, fixture.path);
assert.equal(wrongRemote.pullRequestEligible, false, "The verified Git range must belong to the authority's approved repository.");

const regression = assessPostMergeHealth(authority, candidateTask, "fail", "Production health check regressed.");
assert.equal(regression.shouldPauseFurtherWork, true);
assert.equal(assessPostMergeHealth(authority, candidateTask, "pass", "Health check passed.").shouldPauseFurtherWork, false);

rmSync(fixture.path, { force: true, recursive: true });
rmSync(protectedFixture.path, { force: true, recursive: true });
rmSync(outOfScopeFixture.path, { force: true, recursive: true });

console.log("AutoDev standing-authority controller tests passed.");

function makeGitFixture(file: string, changedContent: string) {
  const path = mkdtempSync(join(tmpdir(), "dzn-standing-authority-"));
  mkdirSync(join(path, file, ".."), { recursive: true });
  runGit(path, ["init", "--quiet"]);
  runGit(path, ["config", "user.email", "dzn-tests@example.invalid"]);
  runGit(path, ["config", "user.name", "DZN Tests"]);
  runGit(path, ["remote", "add", "origin", "https://github.com/rafaeldeak-lab/dzn-network.git"]);
  writeFileSync(join(path, file), "export const baseline = true;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "baseline"]);
  const baseSha = runGit(path, ["rev-parse", "HEAD"]);
  writeFileSync(join(path, file), changedContent);
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "candidate"]);
  return { path, baseSha, headSha: runGit(path, ["rev-parse", "HEAD"]) };
}

function runGit(repositoryPath: string, args: string[]) {
  return execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8" }).trim();
}
