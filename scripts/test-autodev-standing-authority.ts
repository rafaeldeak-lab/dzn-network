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
  recordTrustedMerge,
  transitionTask,
  type AuthorityTask,
  type StandingAuthority,
  type TrustedPullRequestTarget,
} from "./autodev/standing-authority";

const now = "2026-10-13T23:00:00.000Z";

const authority: StandingAuthority = {
  id: "authority-frontend-polish",
  approvedGoal: "Deliver bounded, reversible low-risk DZN interface polish.",
  state: "active",
  repositoryRemote: "https://github.com/rafaeldeak-lab/dzn-network.git",
  targetBranch: "main",
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
  approvedTasks: [
    {
      taskId: "task-ui-nav-spacing",
      title: "Tighten public navigation spacing",
      system: "ui",
      allowedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"],
    },
    {
      taskId: "parallel-task",
      title: "Tighten public navigation spacing",
      system: "ui",
      allowedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr"],
    },
  ],
  acceptanceCriteria: [
    { id: "accessibility", description: "Keyboard and contrast checks pass." },
  ],
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
assert.equal(assessTaskAuthority(authority, task({ title: "Replace every public screen" })).code, "authority_scope_denied");
assert.equal(assessTaskAuthority(authority, task({ id: "unapproved-task" })).code, "authority_scope_denied");
assert.equal(assessTaskAuthority({ ...authority, acceptanceCriteria: [{ id: "independent-review", description: "Try to weaken the mandatory review." }] }, task()).code, "authority_scope_denied");
assert.equal(assessTaskAuthority({ ...authority, state: "revoked", revokedAt: now }, task()).code, "authority_inactive");
assert.equal(assessTaskAuthority({ ...authority, maxExtraMonthlySpendUsd: 1 }, task()).code, "resource_limit_exceeded");
assert.equal(assessTaskAuthority(authority, task({ attempts: 3 })).code, "resource_limit_exceeded");

const authorised = transitionTask(authority, task(), "authorised", now, "runner-a");
assert.equal(authorised.ok, true);
const leased = acquireTaskLease(authority, authorised.task!, [], "runner-a", new Date(now));
assert.equal(leased.ok, true);
assert.equal(leased.task?.lease?.runnerId, "runner-a");
const implementing = transitionTask(authority, leased.task!, "implementing", now, "runner-a");
assert.equal(transitionTask(authority, leased.task!, "implementing", now, "runner-b").code, "task_locked", "Only the runner that holds the lease can advance the task.");
const validating = transitionTask(authority, implementing.task!, "validating", now, "runner-a");
const ready = transitionTask(authority, validating.task!, "ready-to-release", now, "runner-a");
assert.equal(ready.ok, true);
assert.equal(transitionTask(authority, task(), "released", now, "runner-a").code, "invalid_transition");
assert.equal(transitionTask(authority, task({ state: "authorised", requestedActions: ["investigate", "validate", "prepare-pr"], lease: leased.task!.lease }), "implementing", now, "runner-a").code, "action_denied");
assert.equal(transitionTask(authority, task({ state: "implementing", requestedActions: ["investigate", "implement-in-branch", "prepare-pr"], lease: leased.task!.lease }), "validating", now, "runner-a").code, "action_denied");
assert.equal(transitionTask(authority, task({ state: "authorised", lease: { runnerId: "runner-a", acquiredAt: "2026-10-13T22:00:00.000Z", expiresAt: "2026-10-13T22:30:00.000Z" } }), "implementing", now, "runner-a").code, "lease_inactive");
assert.equal(transitionTask(authority, task({ state: "blocked", requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr"] }), "authorised", now, "runner-a").code, "action_denied");
const retried = transitionTask(authority, task({ state: "blocked", requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"] }), "authorised", now, "runner-a");
assert.equal(retried.ok, true);
assert.equal(retried.task?.attempts, 1, "Reauthorising a blocked task must consume a retry attempt.");
assert.equal(transitionTask(authority, task({ state: "blocked", attempts: authority.maxAttemptsPerTask - 1, requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"] }), "authorised", now, "runner-a").code, "resource_limit_exceeded", "A retry must not enter an authorised state after exhausting its budget.");
assert.equal(acquireTaskLease(authority, ready.task!, [leased.task!], "runner-b", new Date(now)).code, "task_locked");
assert.equal(acquireTaskLease(authority, task({ id: "parallel-task", state: "authorised" }), [leased.task!], "runner-b", new Date(now)).code, "resource_limit_exceeded");

const fixture = makeGitFixture("components/games/games-hub.tsx", "export const status = 'ready';\n");
const verifiedRange = inspectGitRange(fixture.path, fixture.baseSha, fixture.headSha);

const candidateTask = task({
  state: "ready-to-release",
  lease: ready.task!.lease,
  candidate: {
    ...verifiedRange,
    evidence: [
      { kind: "scope", status: "pass", candidateHead: fixture.headSha, detail: "Classifier records UI-only low risk." },
      { kind: "tests", status: "pass", candidateHead: fixture.headSha, detail: "Targeted tests passed." },
      { kind: "preview", status: "pass", candidateHead: fixture.headSha, detail: "Preview deployment passed." },
      { kind: "browser-qa", status: "pass", candidateHead: fixture.headSha, detail: "Desktop and mobile QA passed." },
      { kind: "independent-review", status: "pass", candidateHead: fixture.headSha, independent: true, actorId: "release-reviewer-b", detail: "Independent review found no issues." },
      { kind: "accessibility", status: "pass", candidateHead: fixture.headSha, detail: "Keyboard and contrast checks passed." },
    ],
  },
});
const eligible = assessFixture(authority, candidateTask, fixture);
assert.equal(eligible.pullRequestEligible, true);
assert.equal(eligible.requiresSeparateHumanMerge, true, "Eligibility alone must never merge a PR.");
assert.equal(assessFixture(authority, candidateTask, fixture, "runner-b").pullRequestEligible, false, "Only the runner that holds the lease can prepare the pull request.");
assert.equal(transitionTask(authority, candidateTask, "released", now, "runner-a").code, "invalid_transition", "A trusted merged-pull-request receipt is required to record release.");
assert.equal(recordTrustedMerge(authority, candidateTask, {
  repositoryRemote: authority.repositoryRemote,
  branch: authority.targetBranch,
  candidateHeadSha: fixture.headSha,
  mergeCommitSha: fixture.headSha,
  pullRequestNumber: 330,
  mergedAt: now,
  source: "untrusted-source" as "pull-request-provider",
}).code, "release_denied");
const released = recordTrustedMerge(authority, candidateTask, {
  repositoryRemote: authority.repositoryRemote,
  branch: authority.targetBranch,
  candidateHeadSha: fixture.headSha,
  mergeCommitSha: fixture.headSha,
  pullRequestNumber: 330,
  mergedAt: now,
  source: "pull-request-provider",
});
assert.equal(released.ok, true);
assert.equal(released.task?.state, "released");

const expiredLeaseAssessment = assessFixture(authority, {
  ...candidateTask,
  lease: { ...candidateTask.lease!, expiresAt: "2026-10-13T22:30:00.000Z" },
}, fixture);
assert.equal(expiredLeaseAssessment.pullRequestEligible, false, "An expired lease must block pull-request eligibility.");

const staleChecks = assessFixture(authority, {
  ...candidateTask,
  candidate: { ...candidateTask.candidate!, evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: fixture.baseSha })) },
}, fixture);
assert.equal(staleChecks.pullRequestEligible, false);

const missingConfiguredAcceptance = assessFixture(authority, {
  ...candidateTask,
  candidate: { ...candidateTask.candidate!, evidence: candidateTask.candidate!.evidence.filter((item) => item.kind !== "accessibility") },
}, fixture);
assert.equal(missingConfiguredAcceptance.pullRequestEligible, false, "Every configured authority acceptance criterion must pass for the current candidate head.");

const mismatchedFiles = assessFixture(authority, {
  ...candidateTask,
  candidate: { ...candidateTask.candidate!, changedFiles: ["scripts/autodev/standing-authority.ts"] },
}, fixture);
assert.equal(mismatchedFiles.pullRequestEligible, false, "Candidate file lists must match the exact Git range.");

const protectedFixture = makeGitFixture("scripts/autodev/release-control.ts", "export const blocked = true;\n");
const protectedRange = inspectGitRange(protectedFixture.path, protectedFixture.baseSha, protectedFixture.headSha);
const protectedPath = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...protectedRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: protectedFixture.headSha })),
  },
}, protectedFixture);
assert.equal(protectedPath.pullRequestEligible, false, "Protected paths must be rejected from the verified Git range.");

const deletedProtectedFixture = makeDeletedProtectedFixture();
const deletedProtectedRange = inspectGitRange(deletedProtectedFixture.path, deletedProtectedFixture.baseSha, deletedProtectedFixture.headSha);
assert.ok(deletedProtectedRange.changedFiles.includes("scripts/autodev/release-control.ts"), "Deleted protected files must remain in the verified file set.");
const deletedProtected = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...deletedProtectedRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: deletedProtectedFixture.headSha })),
  },
}, deletedProtectedFixture);
assert.equal(deletedProtected.pullRequestEligible, false, "Deleting a protected path must prevent pull-request eligibility.");

const renamedProtectedFixture = makeRenamedProtectedFixture();
const renamedProtectedRange = inspectGitRange(renamedProtectedFixture.path, renamedProtectedFixture.baseSha, renamedProtectedFixture.headSha);
assert.ok(renamedProtectedRange.changedFiles.includes("scripts/autodev/release-control.ts"), "The source path of a protected rename must remain in the verified file set.");
const renamedProtected = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...renamedProtectedRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: renamedProtectedFixture.headSha })),
  },
}, renamedProtectedFixture);
assert.equal(renamedProtected.pullRequestEligible, false, "Renaming a protected path must prevent pull-request eligibility.");

const typeChangedProtectedFixture = makeTypeChangedProtectedFixture();
const typeChangedProtectedRange = inspectGitRange(typeChangedProtectedFixture.path, typeChangedProtectedFixture.baseSha, typeChangedProtectedFixture.headSha);
assert.ok(typeChangedProtectedRange.changedFiles.includes("scripts/autodev/release-control.ts"), "Type changes to protected files must remain in the verified file set.");
const typeChangedProtected = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...typeChangedProtectedRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: typeChangedProtectedFixture.headSha })),
  },
}, typeChangedProtectedFixture);
assert.equal(typeChangedProtected.pullRequestEligible, false, "Changing a protected path into a symlink must prevent pull-request eligibility.");

const targetBypassFixture = makeTargetBypassFixture();
const targetBypassRange = inspectGitRange(targetBypassFixture.path, targetBypassFixture.untrustedBaseSha, targetBypassFixture.headSha);
const targetBypass = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...targetBypassRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: targetBypassFixture.headSha })),
  },
}, targetBypassFixture);
assert.equal(targetBypass.pullRequestEligible, false, "The candidate base must match the trusted pull-request target tip.");

const outOfScopeFixture = makeGitFixture("components/events/authority-note.tsx", "export const eventNote = 'scope';\n");
const outOfScopeRange = inspectGitRange(outOfScopeFixture.path, outOfScopeFixture.baseSha, outOfScopeFixture.headSha);
const outOfScope = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...outOfScopeRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: outOfScopeFixture.headSha })),
  },
}, outOfScopeFixture);
assert.equal(outOfScope.pullRequestEligible, false, "Every verified file must be within the authority scope.");

const removedAuthGuardFixture = makeAuthGuardRemovalFixture();
const removedAuthGuardRange = inspectGitRange(removedAuthGuardFixture.path, removedAuthGuardFixture.baseSha, removedAuthGuardFixture.headSha);
const removedAuthGuard = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...removedAuthGuardRange,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: removedAuthGuardFixture.headSha })),
  },
}, removedAuthGuardFixture);
assert.equal(removedAuthGuard.pullRequestEligible, false, "Removing protected behavior must retain the stricter base-content classification.");

const selfReviewed = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...candidateTask.candidate!,
    evidence: candidateTask.candidate!.evidence.map((item) => item.kind === "independent-review" ? { ...item, actorId: "implementation-runner-a" } : item),
  },
}, fixture);
assert.equal(selfReviewed.pullRequestEligible, false, "An implementer cannot supply its own independent review.");

const missingImplementer = assessFixture(authority, {
  ...candidateTask,
  implementerId: "",
}, fixture);
assert.equal(missingImplementer.pullRequestEligible, false, "Pull-request preparation requires a named implementation actor.");

const anonymousReview = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...candidateTask.candidate!,
    evidence: candidateTask.candidate!.evidence.map((item) => item.kind === "independent-review" ? { ...item, actorId: "" } : item),
  },
}, fixture);
assert.equal(anonymousReview.pullRequestEligible, false, "Pull-request preparation requires a named independent review actor.");

const missingPrAction = assessFixture(authority, {
  ...candidateTask,
  requestedActions: ["investigate", "implement-in-branch", "validate"],
}, fixture);
assert.equal(missingPrAction.pullRequestEligible, false, "A task must explicitly request pull-request preparation.");

const wrongRemote = assessFixture({ ...authority, repositoryRemote: "https://github.com/other/repository.git" }, candidateTask, fixture);
assert.equal(wrongRemote.pullRequestEligible, false, "The verified Git range must belong to the authority's approved repository.");

const credentialedRemote = "https://x-access-token:do-not-expose-this-token@github.com/rafaeldeak-lab/dzn-network.git";
runGit(fixture.path, ["remote", "set-url", "origin", credentialedRemote]);
const sanitizedRange = inspectGitRange(fixture.path, fixture.baseSha, fixture.headSha);
assert.equal(sanitizedRange.repositoryRemote, authority.repositoryRemote, "Credential-bearing HTTPS remotes must be normalized before they enter candidate metadata.");
const credentialedRemoteMismatch = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...sanitizedRange,
    repositoryRemote: credentialedRemote,
    evidence: candidateTask.candidate!.evidence.map((item) => ({ ...item, candidateHead: fixture.headSha })),
  },
}, fixture);
assert.equal(credentialedRemoteMismatch.pullRequestEligible, false);
assert.equal(JSON.stringify(credentialedRemoteMismatch.details).includes("do-not-expose-this-token"), false, "Denial details must not reflect credential-bearing remote URLs.");

const failedEvidence = assessFixture(authority, {
  ...candidateTask,
  candidate: {
    ...candidateTask.candidate!,
    evidence: [...candidateTask.candidate!.evidence, { kind: "tests", status: "fail", candidateHead: fixture.headSha, detail: "A later verification failed." }],
  },
}, fixture);
assert.equal(failedEvidence.pullRequestEligible, false, "A current-head failed verification must block pull-request eligibility.");

const regression = assessPostMergeHealth(authority, candidateTask, "fail", "Production health check regressed.");
assert.equal(regression.shouldPauseFurtherWork, true);
assert.equal(assessPostMergeHealth(authority, candidateTask, "pass", "Health check passed.").shouldPauseFurtherWork, false);

rmSync(fixture.path, { force: true, recursive: true });
rmSync(protectedFixture.path, { force: true, recursive: true });
rmSync(outOfScopeFixture.path, { force: true, recursive: true });
rmSync(deletedProtectedFixture.path, { force: true, recursive: true });
rmSync(renamedProtectedFixture.path, { force: true, recursive: true });
rmSync(typeChangedProtectedFixture.path, { force: true, recursive: true });
rmSync(targetBypassFixture.path, { force: true, recursive: true });
rmSync(removedAuthGuardFixture.path, { force: true, recursive: true });

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
  runGit(path, ["update-ref", "refs/remotes/origin/main", baseSha]);
  writeFileSync(join(path, file), changedContent);
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "candidate"]);
  return { path, baseSha, headSha: runGit(path, ["rev-parse", "HEAD"]) };
}

function makeDeletedProtectedFixture() {
  const path = makeFixtureRepository();
  writeFileSync(join(path, "components/games/games-hub.tsx"), "export const baseline = true;\n");
  writeFileSync(join(path, "scripts/autodev/release-control.ts"), "export const release = true;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "baseline"]);
  const baseSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["update-ref", "refs/remotes/origin/main", baseSha]);
  writeFileSync(join(path, "components/games/games-hub.tsx"), "export const status = 'ready';\n");
  rmSync(join(path, "scripts/autodev/release-control.ts"));
  runGit(path, ["add", "-A"]);
  runGit(path, ["commit", "--quiet", "-m", "delete protected control"]);
  return { path, baseSha, headSha: runGit(path, ["rev-parse", "HEAD"]) };
}

function makeRenamedProtectedFixture() {
  const path = makeFixtureRepository();
  writeFileSync(join(path, "scripts/autodev/release-control.ts"), "export const release = true;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "baseline"]);
  const baseSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["update-ref", "refs/remotes/origin/main", baseSha]);
  mkdirSync(join(path, "components/games"), { recursive: true });
  runGit(path, ["mv", "scripts/autodev/release-control.ts", "components/games/release-control.ts"]);
  runGit(path, ["commit", "--quiet", "-m", "rename protected control"]);
  return { path, baseSha, headSha: runGit(path, ["rev-parse", "HEAD"]) };
}

function makeTypeChangedProtectedFixture() {
  const path = makeFixtureRepository();
  writeFileSync(join(path, "scripts/autodev/release-control.ts"), "export const release = true;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "baseline"]);
  const baseSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["update-ref", "refs/remotes/origin/main", baseSha]);
  writeFileSync(join(path, "symlink-target"), "scripts/autodev/unsafe-target.ts\n");
  const symlinkBlob = runGit(path, ["hash-object", "-w", "symlink-target"]);
  runGit(path, ["update-index", "--add", "--cacheinfo", `120000,${symlinkBlob},scripts/autodev/release-control.ts`]);
  runGit(path, ["commit", "--quiet", "-m", "type change protected control"]);
  return { path, baseSha, headSha: runGit(path, ["rev-parse", "HEAD"]) };
}

function makeTargetBypassFixture() {
  const path = makeFixtureRepository();
  writeFileSync(join(path, "components/games/games-hub.tsx"), "export const baseline = true;\n");
  writeFileSync(join(path, "scripts/autodev/release-control.ts"), "export const release = true;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "target baseline"]);
  const trustedBaseSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["update-ref", "refs/remotes/origin/main", trustedBaseSha]);
  writeFileSync(join(path, "scripts/autodev/release-control.ts"), "export const release = false;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "protected intermediate change"]);
  const untrustedBaseSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["update-ref", "refs/remotes/origin/main", untrustedBaseSha]);
  writeFileSync(join(path, "components/games/games-hub.tsx"), "export const status = 'ready';\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "allowed-looking change"]);
  return { path, baseSha: trustedBaseSha, untrustedBaseSha, headSha: runGit(path, ["rev-parse", "HEAD"]) };
}

function makeAuthGuardRemovalFixture() {
  const path = makeFixtureRepository();
  mkdirSync(join(path, "components/profile"), { recursive: true });
  writeFileSync(join(path, "components/profile/card.tsx"), "export function Card() { return useAuth().user.name; }\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "auth-protected baseline"]);
  const baseSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["update-ref", "refs/remotes/origin/main", baseSha]);
  writeFileSync(join(path, "components/profile/card.tsx"), "export function Card() { return 'public'; }\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "remove auth guard"]);
  return { path, baseSha, headSha: runGit(path, ["rev-parse", "HEAD"]) };
}

function assessFixture(authorityArg: StandingAuthority, taskArg: AuthorityTask, fixtureArg: { path: string; baseSha: string }, actingRunnerId = "runner-a") {
  return assessLowRiskPullRequest(authorityArg, taskArg, fixtureArg.path, trustedTargetFor(fixtureArg.baseSha), actingRunnerId, new Date(now));
}

function trustedTargetFor(headSha: string): TrustedPullRequestTarget {
  return {
    repositoryRemote: authority.repositoryRemote,
    branch: authority.targetBranch,
    headSha,
    source: "pull-request-provider",
  };
}

function makeFixtureRepository() {
  const path = mkdtempSync(join(tmpdir(), "dzn-standing-authority-"));
  mkdirSync(join(path, "components/games"), { recursive: true });
  mkdirSync(join(path, "scripts/autodev"), { recursive: true });
  runGit(path, ["init", "--quiet"]);
  runGit(path, ["config", "user.email", "dzn-tests@example.invalid"]);
  runGit(path, ["config", "user.name", "DZN Tests"]);
  runGit(path, ["remote", "add", "origin", "https://github.com/rafaeldeak-lab/dzn-network.git"]);
  return path;
}

function runGit(repositoryPath: string, args: string[]) {
  return execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8" }).trim();
}
