import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assessPostMergeHealth,
  createAuthorityController,
  inspectGitRange,
  makeTaskDeduplicationKey,
  type AuthorityTask,
  type AuthorityTaskState,
  type AuthorityDecision,
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

assert.equal(transitionFixture(authority, task()).ok, true);
assert.equal(transitionFixture(authority, task({ system: "billing" })).code, "authority_scope_denied");
assert.equal(transitionFixture(authority, task({ title: "Replace every public screen" })).code, "authority_scope_denied");
assert.equal(transitionFixture(authority, task({ id: "unapproved-task" })).code, "authority_scope_denied");
assert.equal(transitionFixture({ ...authority, acceptanceCriteria: [{ id: "independent-review", description: "Try to weaken the mandatory review." }] }, task()).code, "authority_scope_denied");
assert.equal(transitionFixture({ ...authority, state: "revoked", revokedAt: now }, task()).code, "authority_inactive");
assert.equal(transitionFixture({ ...authority, maxExtraMonthlySpendUsd: 1 }, task()).code, "resource_limit_exceeded");
assert.equal(transitionFixture(authority, task({ attempts: 3 })).code, "resource_limit_exceeded");

const initialTask = task();
const leaseController = controller(authority, initialTask, []);
const authorised = leaseController.transitionTask(initialTask.id, "authorised", "runner-a");
assert.equal(authorised.ok, true);
assert.deepEqual(Object.keys(leaseController).sort(), ["acquireTaskLease", "assessLowRiskPullRequest", "recordTrustedMerge", "transitionTask"], "The trusted host exposes lifecycle methods without its record adapter, authority policy, or task snapshots.");
const leased = leaseController.acquireTaskLease(authorised.task!.id, "runner-a");
assert.equal(leased.ok, true);
assert.equal(leased.task?.lease?.runnerId, "runner-a");
assert.equal(leased.task?.implementerId, "runner-a", "The implementation actor must be fixed when its runner acquires the lease.");
assert.ok(leased.task?.lease?.runtimeDeadline, "A new lease must record its non-extendable runtime deadline.");
const renewedLease = leaseController.acquireTaskLease(leased.task!.id, "runner-a");
assert.equal(renewedLease.ok, true);
assert.equal(renewedLease.task?.lease?.acquiredAt, leased.task?.lease?.acquiredAt, "Renewing a lease must preserve its original acquisition time.");
assert.equal(renewedLease.task?.lease?.runtimeDeadline, leased.task?.lease?.runtimeDeadline, "Renewing a lease must preserve its original runtime deadline.");
assert.equal(renewedLease.task?.lease?.expiresAt, leased.task?.lease?.expiresAt, "Renewing a lease must not extend the runtime deadline.");
const implementing = leaseController.transitionTask(leased.task!.id, "implementing", "runner-a");
assert.equal(controller(authority, leased.task!, []).transitionTask(leased.task!.id, "implementing", "runner-b").code, "task_locked", "Only the runner that holds the lease can advance the task.");
const validating = leaseController.transitionTask(implementing.task!.id, "validating", "runner-a");
const ready = leaseController.transitionTask(validating.task!.id, "ready-to-release", "runner-a");
assert.equal(ready.ok, true);
assert.equal(transitionFixture(authority, task(), "released").code, "invalid_transition");
assert.equal(transitionFixture(authority, task({ state: "authorised", implementerId: "runner-a", requestedActions: ["investigate", "validate", "prepare-pr"], lease: leased.task!.lease }), "implementing").code, "action_denied");
assert.equal(transitionFixture(authority, task({ state: "implementing", implementerId: "runner-a", requestedActions: ["investigate", "implement-in-branch", "prepare-pr"], lease: leased.task!.lease }), "validating").code, "action_denied");
assert.equal(transitionFixture(authority, task({ state: "authorised", implementerId: "runner-a", lease: { runnerId: "runner-a", acquiredAt: "2026-10-13T22:00:00.000Z", expiresAt: "2026-10-13T22:30:00.000Z" } }), "implementing").code, "lease_inactive");
assert.equal(transitionFixture(authority, task({ state: "blocked", requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr"] })).code, "action_denied");
const retried = transitionFixture(authority, task({ state: "blocked", requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"] }));
assert.equal(retried.ok, true);
assert.equal(retried.task?.attempts, 1, "Reauthorising a blocked task must consume a retry attempt.");
assert.equal(transitionFixture(authority, task({ state: "blocked", attempts: authority.maxAttemptsPerTask - 1, requestedActions: ["investigate", "implement-in-branch", "validate", "prepare-pr", "retry-branch-failure"] })).code, "resource_limit_exceeded", "A retry must not enter an authorised state after exhausting its budget.");
assert.equal(leaseController.acquireTaskLease(ready.task!.id, "runner-b").code, "task_locked");

const parallelController = controller(authority, [
  task({ id: "task-ui-nav-spacing", state: "authorised" }),
  task({ id: "parallel-task", state: "authorised" }),
], []);
const firstParallelLease = parallelController.acquireTaskLease("task-ui-nav-spacing", "runner-a");
const secondParallelLease = parallelController.acquireTaskLease("parallel-task", "runner-b");
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
const renewedPersistedLease = persistedLeaseController.acquireTaskLease(persistedBlockedTask.id, "runner-a");
assert.equal(renewedPersistedLease.task?.state, "blocked", "Lease renewal must retain the persisted task state.");
assert.equal(renewedPersistedLease.task?.attempts, authority.maxAttemptsPerTask - 1, "Lease renewal must retain persisted attempt usage.");
assert.equal(createAuthorityController(authority.id, {
  ...controllerRecords(authority, persistedBlockedTask, []),
  tryClaimTaskLease: () => {
    throw new Error("controller write unavailable");
  },
}).acquireTaskLease(persistedBlockedTask.id, "runner-a").code, "lease_inactive", "Lease acquisition must fail closed when the atomic controller operation is unavailable.");

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
assert.equal(transitionFixture(authority, candidateTask, "released").code, "invalid_transition", "A trusted merged-pull-request receipt is required to record release.");
const invalidMergeReceipt = {
  repositoryRemote: authority.repositoryRemote,
  branch: authority.targetBranch,
  candidateHeadSha: fixture.headSha,
  mergeCommitSha: fixture.headSha,
  pullRequestNumber: 330,
  mergedAt: now,
  source: "untrusted-source" as "pull-request-provider",
};
assert.equal(controller(authority, candidateTask, [], { mergeReceipt: invalidMergeReceipt }).recordTrustedMerge(candidateTask.id).code, "release_denied");
const validMergeReceipt = {
  repositoryRemote: authority.repositoryRemote,
  branch: authority.targetBranch,
  candidateHeadSha: fixture.headSha,
  mergeCommitSha: fixture.headSha,
  pullRequestNumber: 330,
  mergedAt: now,
  source: "pull-request-provider",
} as const;
const mergeController = controller(authority, candidateTask, [], { mergeReceipt: validMergeReceipt });
const released = mergeController.recordTrustedMerge(candidateTask.id);
assert.equal(released.ok, true);
assert.equal(released.task?.state, "released");
assert.equal(mergeController.recordTrustedMerge(candidateTask.id).code, "invalid_transition", "A controller-owned merge record may only release the current ready task once.");

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

const replacementObjectFixture = makeReplacementObjectFixture();
const replacementObjectRange = inspectGitRange(replacementObjectFixture.path, replacementObjectFixture.baseSha, replacementObjectFixture.protectedHeadSha);
assert.equal(replacementObjectRange.headSha, replacementObjectFixture.protectedHeadSha, "Verified candidate identity must remain the requested protected commit.");
assert.ok(replacementObjectRange.changedFiles.includes("scripts/autodev/release-control.ts"), "Git replacement objects must not hide protected changed paths.");
assert.equal(assessFixture(authority, {
  ...candidateTask,
  candidate: replacementObjectRange,
}, replacementObjectFixture).pullRequestEligible, false, "A local replacement object must not turn a protected candidate into a low-risk release.");

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

const unavailableControllerRecord = createAuthorityController(authority.id, {
  getAuthorityRecord: (authorityId) => authorityId === authority.id
    ? { source: "authority-controller", recordedAt: now, authority: copyAuthority(authority) }
    : undefined,
  getTaskRecord: () => {
    throw new Error("controller record unavailable");
  },
  getPullRequestTarget: () => trustedTargetFor(authority, fixture.baseSha),
  getEvidenceReceipts: () => [],
  tryClaimTaskLease: () => ({ ok: false, code: "lease_inactive", message: "unavailable" }),
  tryTransitionTask: () => ({ ok: false, code: "invalid_transition", message: "unavailable" }),
  tryRecordMergedPullRequest: () => ({ ok: false, code: "release_denied", message: "unavailable" }),
}).assessLowRiskPullRequest(candidateTask.id, fixture.path, "runner-a");
assert.equal(unavailableControllerRecord.pullRequestEligible, false, "An unavailable controller record must fail closed.");

const unavailableTargetProvider = controller(authority, candidateTask, trustedEvidenceFor(candidateTask, fixture.headSha))
  .assessLowRiskPullRequest(candidateTask.id, fixture.path, "runner-a");
assert.equal(unavailableTargetProvider.pullRequestEligible, false, "Pull-request eligibility must fail closed when the controller-owned target provider is unavailable.");

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
rmSync(replacementObjectFixture.path, { force: true, recursive: true });
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

function makeReplacementObjectFixture() {
  const path = makeFixtureRepository();
  writeFileSync(join(path, "components/games/games-hub.tsx"), "export const baseline = true;\n");
  writeFileSync(join(path, "scripts/autodev/release-control.ts"), "export const release = true;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "baseline"]);
  const baseSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["update-ref", "refs/remotes/origin/main", baseSha]);

  writeFileSync(join(path, "scripts/autodev/release-control.ts"), "export const release = false;\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "protected candidate"]);
  const protectedHeadSha = runGit(path, ["rev-parse", "HEAD"]);

  runGit(path, ["checkout", "--quiet", "--detach", baseSha]);
  writeFileSync(join(path, "components/games/games-hub.tsx"), "export const status = 'ready';\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "--quiet", "-m", "benign replacement"]);
  const benignHeadSha = runGit(path, ["rev-parse", "HEAD"]);
  runGit(path, ["replace", protectedHeadSha, benignHeadSha]);

  return { path, baseSha, protectedHeadSha };
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
  return controller(authorityArg, taskArg, evidence, {
    pullRequestTarget: trustedTargetFor(authorityArg, fixtureArg.baseSha),
  }).assessLowRiskPullRequest(taskArg.id, fixtureArg.path, actingRunnerId);
}

function transitionFixture(authorityArg: StandingAuthority, taskArg: AuthorityTask, nextState: AuthorityTaskState = "authorised", runnerId = "runner-a") {
  return controller(authorityArg, taskArg, []).transitionTask(taskArg.id, nextState, runnerId);
}

function controller(
  authorityArg: StandingAuthority,
  taskOrTasks: AuthorityTask | AuthorityTask[],
  evidence: TrustedEvidenceReceipt[],
  options: { mergeReceipt?: TrustedMergedPullRequestReceipt; pullRequestTarget?: TrustedPullRequestTarget } = {},
) {
  return createAuthorityController(authorityArg.id, controllerRecords(authorityArg, taskOrTasks, evidence, options));
}

function controllerRecords(
  authorityArg: StandingAuthority,
  taskOrTasks: AuthorityTask | AuthorityTask[],
  evidence: TrustedEvidenceReceipt[],
  options: { mergeReceipt?: TrustedMergedPullRequestReceipt; pullRequestTarget?: TrustedPullRequestTarget } = {},
): AuthorityControllerRecords {
  const tasks = new Map((Array.isArray(taskOrTasks) ? taskOrTasks : [taskOrTasks]).map((item) => [item.id, copyTask(item)]));

  return {
    getAuthorityRecord: (authorityId) => authorityId === authorityArg.id
      ? { source: "authority-controller", recordedAt: now, authority: copyAuthority(authorityArg) }
      : undefined,
    getTaskRecord: (authorityId, taskId) => authorityId === authorityArg.id && tasks.has(taskId)
      ? { source: "authority-controller", recordedAt: now, task: copyTask(tasks.get(taskId)!) }
      : undefined,
    getPullRequestTarget: (authorityId) => authorityId === authorityArg.id && options.pullRequestTarget
      ? { ...options.pullRequestTarget }
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
    tryTransitionTask: (authorityId, taskId, nextState, runnerId) => {
      const current = tasks.get(taskId);
      if (authorityId !== authorityArg.id || !current) {
        return { ok: false, code: "invalid_transition", message: "No controller-owned task record is available for the transition." };
      }
      const result = transitionStoredTask(authorityArg, current, nextState, runnerId);
      if (!result.ok || !result.task) return result;
      tasks.set(taskId, copyTask(result.task));
      return { source: "authority-controller" as const, recordedAt: result.task.updatedAt, task: copyTask(result.task) };
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

function transitionStoredTask(authorityArg: StandingAuthority, current: AuthorityTask, nextState: AuthorityTaskState, runnerId: string): AuthorityDecision & { task?: AuthorityTask } {
  const allowedTransitions: Record<AuthorityTaskState, AuthorityTaskState[]> = {
    proposed: ["authorised", "blocked"],
    authorised: ["implementing", "blocked"],
    implementing: ["validating", "blocked"],
    validating: ["ready-to-release", "blocked"],
    "ready-to-release": ["blocked"],
    released: ["reverted"],
    blocked: ["authorised"],
    reverted: [],
  };
  if (!allowedTransitions[current.state].includes(nextState)) {
    return { ok: false, code: "invalid_transition", message: "Task state transition is not allowed." };
  }
  const nowValue = new Date();
  const requiresLease = nextState === "implementing" || nextState === "validating" || nextState === "ready-to-release";
  if (requiresLease) {
    const lease = current.lease;
    const expiresAt = lease ? new Date(lease.expiresAt).getTime() : Number.NaN;
    const deadline = lease ? new Date(lease.runtimeDeadline ?? lease.expiresAt).getTime() : Number.NaN;
    if (!lease || !Number.isFinite(expiresAt) || !Number.isFinite(deadline) || expiresAt <= nowValue.getTime() || deadline <= nowValue.getTime()) {
      return { ok: false, code: "lease_inactive", message: "Task must retain a live lease before it can continue." };
    }
    if (lease.runnerId !== runnerId) return { ok: false, code: "task_locked", message: "Only the current lease holder can advance the task." };
  }
  const requiredAction = current.state === "blocked" && nextState === "authorised"
    ? "retry-branch-failure"
    : nextState === "implementing"
      ? "implement-in-branch"
      : nextState === "validating"
        ? "validate"
        : nextState === "ready-to-release"
          ? "prepare-pr"
          : undefined;
  if (requiredAction && !current.requestedActions.includes(requiredAction)) {
    return { ok: false, code: "action_denied", message: "Task did not request the action required for this state transition." };
  }
  const attempts = current.state === "blocked" && nextState === "authorised" ? current.attempts + 1 : current.attempts;
  if (attempts >= authorityArg.maxAttemptsPerTask) {
    return { ok: false, code: "resource_limit_exceeded", message: "Retry would exceed the approved attempt limit." };
  }
  return {
    ok: true,
    code: "allowed",
    message: `Task transitioned to ${nextState}.`,
    task: {
      ...copyTask(current),
      state: nextState,
      attempts,
      updatedAt: nowValue.toISOString(),
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

function copyAuthority(authorityArg: StandingAuthority): StandingAuthority {
  return {
    ...authorityArg,
    allowedSystems: [...authorityArg.allowedSystems],
    excludedSystems: [...authorityArg.excludedSystems],
    allowedActions: [...authorityArg.allowedActions],
    approvedTasks: authorityArg.approvedTasks.map((binding) => ({ ...binding, allowedActions: [...binding.allowedActions] })),
    acceptanceCriteria: authorityArg.acceptanceCriteria.map((criterion) => ({ ...criterion })),
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

function trustedTargetFor(authorityArg: StandingAuthority, headSha: string): TrustedPullRequestTarget {
  return {
    repositoryRemote: authorityArg.repositoryRemote,
    branch: authorityArg.targetBranch,
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
