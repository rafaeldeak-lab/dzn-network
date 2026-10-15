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
  createAuthorityController,
  inspectGitRange,
  makeTaskDeduplicationKey,
  recordTrustedMerge,
  transitionTask,
  type AuthorityController,
  type AuthorityTask,
  type AuthorityControllerRecords,
  type StandingAuthority,
  type TrustedEvidenceReceipt,
  type TrustedMergedPullRequestReceipt,
  type TrustedPullRequestTarget,
} from "./autodev/standing-authority";

const now = new Date().toISOString();

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
    implementerId: "",
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

const authorised = transitionTask(authority, task(), "authorised", "runner-a");
assert.equal(authorised.ok, true);
const forgedController = controllerRecords(authority, authorised.task!, []) as unknown as AuthorityController;
assert.equal(acquireTaskLease(authority, authorised.task!.id, "runner-a", forgedController).code, "lease_inactive", "Raw controller-like objects must not gain a lease capability.");
const leaseController = controller(authority, authorised.task!, []);
const leased = acquireTaskLease(authority, authorised.task!.id, "runner-a", leaseController);
assert.equal(leased.ok, true);
assert.equal(leased.task?.lease?.runnerId, "runner-a");
assert.equal(leased.task?.implementerId, "runner-a", "The implementation actor must be fixed when its runner acquires the lease.");
assert.ok(leased.task?.lease?.runtimeDeadline, "A new lease must record its non-extendable runtime deadline.");
const renewedLease = acquireTaskLease(authority, leased.task!.id, "runner-a", leaseController);
assert.equal(renewedLease.ok, true);
assert.equal(renewedLease.task?.lease?.acquiredAt, leased.task?.lease?.acquiredAt, "Renewing a lease must preserve its original acquisition time.");
assert.equal(renewedLease.task?.lease?.runtimeDeadline, leased.task?.lease?.runtimeDeadline, "Renewing a lease must preserve its original runtime deadline.");
assert.equal(renewedLease.task?.lease?.expiresAt, leased.task?.lease?.expiresAt, "Renewing a lease must not extend the runtime deadline.");
const implementing = transitionTask(authority, leased.task!, "implementing", "runner-a");
assert.equal(transitionTask(authority, leased.task!, "implementing", "runner-b").code, "task_locked", "Only the runner that holds the lease can advance the task.");
const validating = transitionTask(authority, implementing.task!, "validating", "runner-a");
const ready = transitionTask(authority, validating.task!, "ready-to-release", "runner-a");
assert.equal(ready.ok, true);
assert.equal(transitionTask(authority, task(), "released", "runner-a").code, "invalid_transition");
assert.equal(transitionTask(authority, task({ state: "authorised", implementerId: "runner-a", requestedActions: ["investigate", "validate", "prepare-pr"], lease: leased.task!.lease }), "implementing", "runner-a").code, "action_denied");
assert.equal(transitionTask(authority, task({ state: "implementing", implementerId: "runner-a", requestedActions: ["investigate", "implement-in-branch", "prepare-pr"], lease: leased.task!.lease }), "validating", "runner-a").code, "action_denied");
assert.equal(transitionTask(authority, task({ state: "authorised", implementerId: "runner-a", lease: { runnerId: "runner-a", acquiredAt: "2026-10-13T22:00:00.000Z", expiresAt: "2026-10-13T22:30:00.000Z" } }), "implementing", "runner-a").code, "lease_inactive");
assert.equal(transitionTask(authority, task({ state: "blocked", requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr"] }), "authorised", "runner-a").code, "action_denied");
const retried = transitionTask(authority, task({ state: "blocked", requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"] }), "authorised", "runner-a");
assert.equal(retried.ok, true);
assert.equal(retried.task?.attempts, 1, "Reauthorising a blocked task must consume a retry attempt.");
assert.equal(transitionTask(authority, task({ state: "blocked", attempts: authority.maxAttemptsPerTask - 1, requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"] }), "authorised", "runner-a").code, "resource_limit_exceeded", "A retry must not enter an authorised state after exhausting its budget.");
assert.equal(acquireTaskLease(authority, ready.task!.id, "runner-b", leaseController).code, "task_locked");

const parallelController = controller(authority, [
  task({ id: "task-ui-nav-spacing", state: "authorised" }),
  task({ id: "parallel-task", state: "authorised" }),
], []);
const firstParallelLease = acquireTaskLease(authority, "task-ui-nav-spacing", "runner-a", parallelController);
const secondParallelLease = acquireTaskLease(authority, "parallel-task", "runner-b", parallelController);
assert.equal(firstParallelLease.ok, true, "The first atomic lease claim may take the only authority slot.");
assert.equal(secondParallelLease.code, "resource_limit_exceeded", "A second independent lease claim must observe the controller-owned capacity claim.");

const persistedBlockedTask = task({
  state: "blocked",
  attempts: authority.maxAttemptsPerTask - 1,
  requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"],
  implementerId: "runner-a",
  lease: leased.task!.lease,
});
const persistedLeaseController = controller(authority, persistedBlockedTask, []);
const renewedPersistedLease = acquireTaskLease(authority, persistedBlockedTask.id, "runner-a", persistedLeaseController);
assert.equal(renewedPersistedLease.task?.state, "blocked", "Lease renewal must retain the persisted task state.");
assert.equal(renewedPersistedLease.task?.attempts, authority.maxAttemptsPerTask - 1, "Lease renewal must retain persisted attempt usage.");
assert.equal(acquireTaskLease(authority, persistedBlockedTask.id, "runner-a", createAuthorityController({
  ...controllerRecords(authority, persistedBlockedTask, []),
  tryClaimTaskLease: () => {
    throw new Error("controller write unavailable");
  },
})).code, "lease_inactive", "Lease acquisition must fail closed when the atomic controller operation is unavailable.");

const fixture = makeGitFixture("components/games/games-hub.tsx", "export const status = 'ready';\n");
const verifiedRange = inspectGitRange(fixture.path, fixture.baseSha, fixture.headSha);

const candidateTask = task({
  state: "ready-to-release",
  implementerId: ready.task!.implementerId,
  lease: ready.task!.lease,
  candidate: verifiedRange,
});
const eligible = assessFixture(authority, candidateTask, fixture);
assert.equal(eligible.pullRequestEligible, true);
assert.equal(eligible.requiresSeparateHumanMerge, true, "Eligibility alone must never merge a PR.");
assert.equal(assessFixture(authority, candidateTask, fixture, "runner-b").pullRequestEligible, false, "Only the runner that holds the lease can prepare the pull request.");
assert.equal(transitionTask(authority, candidateTask, "released", "runner-a").code, "invalid_transition", "A trusted merged-pull-request receipt is required to record release.");
const invalidMergeReceipt = {
  repositoryRemote: authority.repositoryRemote,
  branch: authority.targetBranch,
  candidateHeadSha: fixture.headSha,
  mergeCommitSha: fixture.headSha,
  pullRequestNumber: 330,
  mergedAt: now,
  source: "untrusted-source" as "pull-request-provider",
};
assert.equal(recordTrustedMerge(authority, candidateTask.id, controller(authority, candidateTask, [], { mergeReceipt: invalidMergeReceipt })).code, "release_denied");
const validMergeReceipt = {
  repositoryRemote: authority.repositoryRemote,
  branch: authority.targetBranch,
  candidateHeadSha: fixture.headSha,
  mergeCommitSha: fixture.headSha,
  pullRequestNumber: 330,
  mergedAt: now,
  source: "pull-request-provider",
} as const;
assert.equal(recordTrustedMerge(
  authority,
  candidateTask.id,
  controllerRecords(authority, candidateTask, [], { mergeReceipt: validMergeReceipt }) as unknown as AuthorityController,
).code, "release_denied", "A raw controller-like object must not record a provider merge.");
const mergeController = controller(authority, candidateTask, [], { mergeReceipt: validMergeReceipt });
const released = recordTrustedMerge(authority, candidateTask.id, mergeController);
assert.equal(released.ok, true);
assert.equal(released.task?.state, "released");
assert.equal(recordTrustedMerge(authority, candidateTask.id, mergeController).code, "invalid_transition", "A controller-owned merge record may only release the current ready task once.");

const expiredLeaseAssessment = assessFixture(authority, {
  ...candidateTask,
  lease: { ...candidateTask.lease!, expiresAt: "2026-10-13T22:30:00.000Z" },
}, fixture);
assert.equal(expiredLeaseAssessment.pullRequestEligible, false, "An expired lease must block pull-request eligibility.");

const staleChecks = assessFixture(authority, candidateTask, fixture, "runner-a", trustedEvidenceFor(candidateTask, fixture.baseSha));
assert.equal(staleChecks.pullRequestEligible, false);

const missingConfiguredAcceptance = assessFixture(authority, candidateTask, fixture, "runner-a", trustedEvidenceFor(candidateTask, fixture.headSha).filter((item) => item.kind !== "accessibility"));
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
  candidate: protectedRange,
}, protectedFixture);
assert.equal(protectedPath.pullRequestEligible, false, "Protected paths must be rejected from the verified Git range.");

const deletedProtectedFixture = makeDeletedProtectedFixture();
const deletedProtectedRange = inspectGitRange(deletedProtectedFixture.path, deletedProtectedFixture.baseSha, deletedProtectedFixture.headSha);
assert.ok(deletedProtectedRange.changedFiles.includes("scripts/autodev/release-control.ts"), "Deleted protected files must remain in the verified file set.");
const deletedProtected = assessFixture(authority, {
  ...candidateTask,
  candidate: deletedProtectedRange,
}, deletedProtectedFixture);
assert.equal(deletedProtected.pullRequestEligible, false, "Deleting a protected path must prevent pull-request eligibility.");

const renamedProtectedFixture = makeRenamedProtectedFixture();
const renamedProtectedRange = inspectGitRange(renamedProtectedFixture.path, renamedProtectedFixture.baseSha, renamedProtectedFixture.headSha);
assert.ok(renamedProtectedRange.changedFiles.includes("scripts/autodev/release-control.ts"), "The source path of a protected rename must remain in the verified file set.");
const renamedProtected = assessFixture(authority, {
  ...candidateTask,
  candidate: renamedProtectedRange,
}, renamedProtectedFixture);
assert.equal(renamedProtected.pullRequestEligible, false, "Renaming a protected path must prevent pull-request eligibility.");

const typeChangedProtectedFixture = makeTypeChangedProtectedFixture();
const typeChangedProtectedRange = inspectGitRange(typeChangedProtectedFixture.path, typeChangedProtectedFixture.baseSha, typeChangedProtectedFixture.headSha);
assert.ok(typeChangedProtectedRange.changedFiles.includes("scripts/autodev/release-control.ts"), "Type changes to protected files must remain in the verified file set.");
const typeChangedProtected = assessFixture(authority, {
  ...candidateTask,
  candidate: typeChangedProtectedRange,
}, typeChangedProtectedFixture);
assert.equal(typeChangedProtected.pullRequestEligible, false, "Changing a protected path into a symlink must prevent pull-request eligibility.");

const typeChangedUiFixture = makeTypeChangedUiFixture();
const typeChangedUiRange = inspectGitRange(typeChangedUiFixture.path, typeChangedUiFixture.baseSha, typeChangedUiFixture.headSha);
const typeChangedUi = assessFixture(authority, {
  ...candidateTask,
  candidate: typeChangedUiRange,
}, typeChangedUiFixture);
assert.equal(typeChangedUi.pullRequestEligible, false, "A non-regular UI Git entry must be rejected before content classification.");

const targetBypassFixture = makeTargetBypassFixture();
const targetBypassRange = inspectGitRange(targetBypassFixture.path, targetBypassFixture.untrustedBaseSha, targetBypassFixture.headSha);
const targetBypass = assessFixture(authority, {
  ...candidateTask,
  candidate: targetBypassRange,
}, targetBypassFixture);
assert.equal(targetBypass.pullRequestEligible, false, "The candidate base must match the trusted pull-request target tip.");

const outOfScopeFixture = makeGitFixture("components/events/authority-note.tsx", "export const eventNote = 'scope';\n");
const outOfScopeRange = inspectGitRange(outOfScopeFixture.path, outOfScopeFixture.baseSha, outOfScopeFixture.headSha);
const outOfScope = assessFixture(authority, {
  ...candidateTask,
  candidate: outOfScopeRange,
}, outOfScopeFixture);
assert.equal(outOfScope.pullRequestEligible, false, "Every verified file must be within the authority scope.");

const removedAuthGuardFixture = makeAuthGuardRemovalFixture();
const removedAuthGuardRange = inspectGitRange(removedAuthGuardFixture.path, removedAuthGuardFixture.baseSha, removedAuthGuardFixture.headSha);
const removedAuthGuard = assessFixture(authority, {
  ...candidateTask,
  candidate: removedAuthGuardRange,
}, removedAuthGuardFixture);
assert.equal(removedAuthGuard.pullRequestEligible, false, "Removing protected behavior must retain the stricter base-content classification.");

const selfReviewed = assessFixture(authority, candidateTask, fixture, "runner-a", trustedEvidenceFor(candidateTask, fixture.headSha, "runner-a"));
assert.equal(selfReviewed.pullRequestEligible, false, "An implementer cannot supply its own independent review.");

const missingImplementer = assessFixture(authority, {
  ...candidateTask,
  implementerId: "",
}, fixture);
assert.equal(missingImplementer.pullRequestEligible, false, "Pull-request preparation requires a named implementation actor.");

const anonymousReview = assessFixture(authority, candidateTask, fixture, "runner-a", trustedEvidenceFor(candidateTask, fixture.headSha, ""));
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
  },
}, fixture);
assert.equal(credentialedRemoteMismatch.pullRequestEligible, false);
assert.equal(JSON.stringify(credentialedRemoteMismatch.details).includes("do-not-expose-this-token"), false, "Denial details must not reflect credential-bearing remote URLs.");

const failedEvidence = assessFixture(authority, candidateTask, fixture, "runner-a", [
  ...trustedEvidenceFor(candidateTask, fixture.headSha),
  trustedEvidenceReceipt(candidateTask, { kind: "tests", status: "fail", candidateHead: fixture.headSha, detail: "A later verification failed." }),
]);
assert.equal(failedEvidence.pullRequestEligible, false, "A current-head failed verification must block pull-request eligibility.");

const untrustedEvidence = assessFixture(authority, candidateTask, fixture, "runner-a", trustedEvidenceFor(candidateTask, fixture.headSha).map((item) => ({ ...item, source: "untrusted-runner" as "authority-controller" })));
assert.equal(untrustedEvidence.pullRequestEligible, false, "Self-reported evidence must not satisfy controller-owned release evidence requirements.");

const unavailableControllerRecord = assessLowRiskPullRequest(authority, candidateTask.id, fixture.path, trustedTargetFor(fixture.baseSha), "runner-a", createAuthorityController({
  getTaskRecord: () => {
    throw new Error("controller record unavailable");
  },
  getEvidenceReceipts: () => [],
  tryClaimTaskLease: () => ({ ok: false, code: "lease_inactive", message: "unavailable" }),
  tryRecordMergedPullRequest: () => ({ ok: false, code: "release_denied", message: "unavailable" }),
}));
assert.equal(unavailableControllerRecord.pullRequestEligible, false, "An unavailable controller record must fail closed.");

const unreadableBlobFixture = makeGitFixture("components/games/large-controller-note.tsx", `export const note = \"${"a".repeat(1_100_000)}\";\n`);
const unreadableBlobRange = inspectGitRange(unreadableBlobFixture.path, unreadableBlobFixture.baseSha, unreadableBlobFixture.headSha);
const unreadableBlob = assessFixture(authority, { ...candidateTask, candidate: unreadableBlobRange }, unreadableBlobFixture);
assert.equal(unreadableBlob.pullRequestEligible, false, "A changed blob that cannot be fully classified must fail closed.");

const regression = assessPostMergeHealth(authority, candidateTask, "fail", "Production health check regressed.");
assert.equal(regression.shouldPauseFurtherWork, true);
assert.equal(assessPostMergeHealth(authority, candidateTask, "pass", "Health check passed.").shouldPauseFurtherWork, false);

rmSync(fixture.path, { force: true, recursive: true });
rmSync(protectedFixture.path, { force: true, recursive: true });
rmSync(outOfScopeFixture.path, { force: true, recursive: true });
rmSync(deletedProtectedFixture.path, { force: true, recursive: true });
rmSync(renamedProtectedFixture.path, { force: true, recursive: true });
rmSync(typeChangedProtectedFixture.path, { force: true, recursive: true });
rmSync(typeChangedUiFixture.path, { force: true, recursive: true });
rmSync(targetBypassFixture.path, { force: true, recursive: true });
rmSync(removedAuthGuardFixture.path, { force: true, recursive: true });
rmSync(unreadableBlobFixture.path, { force: true, recursive: true });

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

function makeTypeChangedUiFixture() {
  const path = makeFixtureRepository();
  writeFileSync(join(path, "components/games/games-hub.tsx"), "export const game = true;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "baseline"]);
  const baseSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["update-ref", "refs/remotes/origin/main", baseSha]);
  writeFileSync(join(path, "symlink-target"), "components/games/unsafe-target.tsx\n");
  const symlinkBlob = runGit(path, ["hash-object", "-w", "symlink-target"]);
  runGit(path, ["update-index", "--add", "--cacheinfo", `120000,${symlinkBlob},components/games/games-hub.tsx`]);
  runGit(path, ["commit", "--quiet", "-m", "type change ui file"]);
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

function assessFixture(authorityArg: StandingAuthority, taskArg: AuthorityTask, fixtureArg: { path: string; baseSha: string }, actingRunnerId = "runner-a", evidence = trustedEvidenceFor(taskArg, taskArg.candidate?.headSha ?? "")) {
  return assessLowRiskPullRequest(authorityArg, taskArg.id, fixtureArg.path, trustedTargetFor(fixtureArg.baseSha), actingRunnerId, controller(authorityArg, taskArg, evidence));
}

function controller(
  authorityArg: StandingAuthority,
  taskOrTasks: AuthorityTask | AuthorityTask[],
  evidence: TrustedEvidenceReceipt[],
  options: { mergeReceipt?: TrustedMergedPullRequestReceipt } = {},
) {
  return createAuthorityController(controllerRecords(authorityArg, taskOrTasks, evidence, options));
}

function controllerRecords(
  authorityArg: StandingAuthority,
  taskOrTasks: AuthorityTask | AuthorityTask[],
  evidence: TrustedEvidenceReceipt[],
  options: { mergeReceipt?: TrustedMergedPullRequestReceipt } = {},
): AuthorityControllerRecords {
  const tasks = new Map((Array.isArray(taskOrTasks) ? taskOrTasks : [taskOrTasks]).map((item) => [item.id, copyTask(item)]));

  return {
    getTaskRecord: (authorityId, taskId) => authorityId === authorityArg.id && tasks.has(taskId)
      ? { source: "authority-controller", recordedAt: now, task: copyTask(tasks.get(taskId)!) }
      : undefined,
    getEvidenceReceipts: (authorityId, taskId, candidateHeadSha) => authorityId === authorityArg.id && tasks.get(taskId)?.candidate?.headSha === candidateHeadSha
      ? evidence
      : [],
    tryClaimTaskLease: (authorityId, taskId, runnerId) => {
      const current = tasks.get(taskId);
      if (authorityId !== authorityArg.id || !current) {
        return { ok: false, code: "lease_inactive", message: "No controller-owned task record is available for the lease claim." };
      }

      const timestamp = new Date().toISOString();
      const currentNow = new Date(timestamp).getTime();
      const activeLease = current.lease;
      if (current.implementerId && current.implementerId !== runnerId) {
        return { ok: false, code: "task_locked", message: "Task implementation is already bound to another runner." };
      }
      if (activeLease) {
        const expiresAt = new Date(activeLease.expiresAt).getTime();
        const runtimeDeadline = new Date(activeLease.runtimeDeadline ?? activeLease.expiresAt).getTime();
        if (!Number.isFinite(expiresAt) || !Number.isFinite(runtimeDeadline) || expiresAt <= currentNow || runtimeDeadline <= currentNow) {
          return { ok: false, code: "lease_inactive", message: "The persisted lease is no longer live." };
        }
        if (activeLease.runnerId !== runnerId) {
          return { ok: false, code: "task_locked", message: "Task is already leased by another runner." };
        }
      }

      const occupiedSlots = Array.from(tasks.values()).filter((item) => {
        if (item.id === taskId || item.authorityId !== authorityArg.id || !item.lease) return false;
        const expiresAt = new Date(item.lease.expiresAt).getTime();
        const runtimeDeadline = new Date(item.lease.runtimeDeadline ?? item.lease.expiresAt).getTime();
        return !Number.isFinite(expiresAt) || !Number.isFinite(runtimeDeadline) || (expiresAt > currentNow && runtimeDeadline > currentNow);
      });
      if (occupiedSlots.length >= authorityArg.maxConcurrentTasks) {
        return { ok: false, code: "resource_limit_exceeded", message: "Authority concurrency limit has been reached." };
      }

      const runtimeDeadline = activeLease?.runtimeDeadline ?? new Date(currentNow + authorityArg.maxRuntimeMinutes * 60_000).toISOString();
      const claimed = {
        ...copyTask(current),
        implementerId: current.implementerId || runnerId,
        lease: {
          runnerId,
          acquiredAt: activeLease?.acquiredAt ?? timestamp,
          expiresAt: runtimeDeadline,
          runtimeDeadline,
        },
        updatedAt: timestamp,
      };
      tasks.set(taskId, claimed);
      return { source: "authority-controller" as const, recordedAt: timestamp, task: copyTask(claimed) };
    },
    tryRecordMergedPullRequest: (authorityId, taskId) => {
      const current = tasks.get(taskId);
      const receipt = options.mergeReceipt;
      if (authorityId !== authorityArg.id || !current || !receipt) {
        return { ok: false, code: "release_denied", message: "No controller-owned provider merge receipt is available." };
      }
      if (current.state !== "ready-to-release") {
        return { ok: false, code: "invalid_transition", message: "Only the persisted ready task may be released." };
      }
      if (receipt.source !== "pull-request-provider"
        || receipt.repositoryRemote !== authorityArg.repositoryRemote
        || receipt.branch !== authorityArg.targetBranch
        || receipt.candidateHeadSha !== current.candidate?.headSha
        || !/^[0-9a-f]{7,64}$/i.test(receipt.mergeCommitSha)
        || !Number.isSafeInteger(receipt.pullRequestNumber)
        || receipt.pullRequestNumber < 1
        || !Number.isFinite(new Date(receipt.mergedAt).getTime())) {
        return { ok: false, code: "release_denied", message: "Provider merge receipt does not match the controller-owned task." };
      }
      const released = {
        ...copyTask(current),
        state: "released" as const,
        lease: undefined,
        updatedAt: receipt.mergedAt,
      };
      tasks.set(taskId, released);
      return {
        source: "authority-controller" as const,
        recordedAt: receipt.mergedAt,
        task: copyTask(released),
        receipt,
      };
    },
  };
}

function copyTask(taskArg: AuthorityTask): AuthorityTask {
  return {
    ...taskArg,
    requestedActions: [...taskArg.requestedActions],
    lease: taskArg.lease ? { ...taskArg.lease } : undefined,
    candidate: taskArg.candidate
      ? { ...taskArg.candidate, changedFiles: [...taskArg.candidate.changedFiles] }
      : undefined,
  };
}

function trustedEvidenceFor(taskArg: AuthorityTask, candidateHead: string, independentActorId = "release-reviewer-b") {
  return [
    trustedEvidenceReceipt(taskArg, { kind: "scope", status: "pass", candidateHead, detail: "Classifier records UI-only low risk." }),
    trustedEvidenceReceipt(taskArg, { kind: "tests", status: "pass", candidateHead, detail: "Targeted tests passed." }),
    trustedEvidenceReceipt(taskArg, { kind: "preview", status: "pass", candidateHead, detail: "Preview deployment passed." }),
    trustedEvidenceReceipt(taskArg, { kind: "browser-qa", status: "pass", candidateHead, detail: "Desktop and mobile QA passed." }),
    trustedEvidenceReceipt(taskArg, { kind: "independent-review", status: "pass", candidateHead, independent: true, actorId: independentActorId, detail: "Independent review found no issues." }),
    trustedEvidenceReceipt(taskArg, { kind: "accessibility", status: "pass", candidateHead, detail: "Keyboard and contrast checks passed." }),
  ];
}

function trustedEvidenceReceipt(taskArg: AuthorityTask, evidence: Omit<TrustedEvidenceReceipt, "authorityId" | "taskId" | "recordedAt" | "source">): TrustedEvidenceReceipt {
  return {
    ...evidence,
    authorityId: authority.id,
    taskId: taskArg.id,
    recordedAt: now,
    source: "authority-controller",
  };
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
