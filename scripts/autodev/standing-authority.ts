import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { classifyPath, detectUnsafeExecutableTestOperations, type RiskClassification, type SystemCategory } from "./risk-classifier";

export type AuthorityState = "active" | "paused" | "revoked";
export type AuthorityTaskState = "proposed" | "authorised" | "implementing" | "validating" | "ready-to-release" | "released" | "blocked" | "reverted";
export type AuthorityAction = "investigate" | "implement-in-branch" | "validate" | "prepare-pr" | "retry-branch-failure";
export type ReleaseEvidenceKind = "scope" | "tests" | "preview" | "browser-qa" | "independent-review";

export type ApprovedTaskBinding = {
  taskId: string;
  title: string;
  system: SystemCategory;
  allowedActions: AuthorityAction[];
};

export type AuthorityAcceptanceCriterion = {
  id: string;
  description: string;
  requiresIndependentActor?: boolean;
};

export type StandingAuthority = {
  id: string;
  approvedGoal: string;
  state: AuthorityState;
  repositoryRemote: string;
  targetBranch: string;
  allowedSystems: SystemCategory[];
  excludedSystems: SystemCategory[];
  allowedActions: AuthorityAction[];
  policyVersion: string;
  maxConcurrentTasks: number;
  maxAttemptsPerTask: number;
  maxRuntimeMinutes: number;
  maxChangedFiles: number;
  subscriptionOnly: boolean;
  maxExtraMonthlySpendUsd: number;
  approvedTasks: ApprovedTaskBinding[];
  acceptanceCriteria: AuthorityAcceptanceCriterion[];
  approvedAt: string;
  revokedAt?: string;
  revocationReason?: string;
};

export type CandidateEvidence = {
  kind: ReleaseEvidenceKind | (string & {});
  status: "pass" | "fail" | "skip";
  candidateHead: string;
  independent?: boolean;
  actorId?: string;
  detail: string;
};

export type TrustedEvidenceReceipt = CandidateEvidence & {
  authorityId: string;
  taskId: string;
  recordedAt: string;
  source: "authority-controller";
};

export type ReleaseCandidate = {
  baseSha: string;
  headSha: string;
  repositoryRemote: string;
  changedFiles: string[];
  diffSha256: string;
};

export type VerifiedGitRange = {
  baseSha: string;
  headSha: string;
  repositoryRemote: string;
  changedFiles: string[];
  diffSha256: string;
};

export type TrustedPullRequestTarget = {
  repositoryRemote: string;
  branch: string;
  headSha: string;
  source: "pull-request-provider";
};

export type TrustedMergedPullRequestReceipt = {
  repositoryRemote: string;
  branch: string;
  candidateHeadSha: string;
  mergeCommitSha: string;
  pullRequestNumber: number;
  mergedAt: string;
  source: "pull-request-provider";
};

export type AuthorityTask = {
  id: string;
  authorityId: string;
  title: string;
  system: SystemCategory;
  requestedActions: AuthorityAction[];
  state: AuthorityTaskState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  implementerId: string;
  lease?: {
    runnerId: string;
    acquiredAt: string;
    expiresAt: string;
    runtimeDeadline?: string;
  };
  candidate?: ReleaseCandidate;
};

export type TrustedAuthorityTaskRecord = {
  source: "authority-controller";
  recordedAt: string;
  task: AuthorityTask;
};

export type TrustedStandingAuthorityRecord = {
  source: "authority-controller";
  recordedAt: string;
  authority: StandingAuthority;
};

export type TrustedMergedAuthorityTaskRecord = TrustedAuthorityTaskRecord & {
  receipt: TrustedMergedPullRequestReceipt;
};

/**
 * The controller supplies this guard to its trusted record adapter. The adapter
 * must invoke it inside the same atomic transaction that would persist a lease
 * or lifecycle transition. The authority and task must come from that same
 * transaction; callers never receive this function or either record.
 */
export type ControllerTaskWriteGuard = (currentAuthority: StandingAuthority, currentTask: AuthorityTask) => AuthorityDecision;

export type AuthorityControllerRecords = {
  /** Returns the current authority policy held by the trusted host. */
  getAuthorityRecord(authorityId: string): TrustedStandingAuthorityRecord | undefined;
  getTaskRecord(authorityId: string, taskId: string): TrustedAuthorityTaskRecord | undefined;
  /**
   * Resolves the current protected target through the host-owned pull-request
   * provider adapter. Runners never supply a target SHA to the controller.
   */
  getPullRequestTarget(authorityId: string): TrustedPullRequestTarget | undefined;
  getEvidenceReceipts(authorityId: string, taskId: string, candidateHeadSha: string): TrustedEvidenceReceipt[];
  /**
   * Atomically reads the current controller-owned authority and task, checks
   * live authority capacity, invokes the controller write guard, and persists
   * the lease claim.
   * It must not use runner snapshots or persist if the guard denies the task.
   */
  tryClaimTaskLease(authorityId: string, taskId: string, runnerId: string, guard: ControllerTaskWriteGuard): TrustedAuthorityTaskRecord | AuthorityDecision;
  /**
   * Atomically reads the current controller-owned authority and task, applies a
   * permitted lifecycle transition, invokes the controller write guard before
   * persistence, and persists the resulting task. It must not accept a
   * runner-supplied task snapshot or persist if the guard denies the task.
   */
  tryTransitionTask(authorityId: string, taskId: string, nextState: AuthorityTaskState, runnerId: string, guard: ControllerTaskWriteGuard): TrustedAuthorityTaskRecord | AuthorityDecision;
  /**
   * Atomically reads the current controller-owned ready task, verifies the
   * provider's completed merge, and persists the released task record.
   */
  tryRecordMergedPullRequest(authorityId: string, taskId: string): TrustedMergedAuthorityTaskRecord | AuthorityDecision;
};

export type AuthorityController = {
  acquireTaskLease(taskId: string, runnerId: string): AuthorityDecision & { task?: AuthorityTask };
  transitionTask(taskId: string, nextState: AuthorityTaskState, runnerId: string): AuthorityDecision & { task?: AuthorityTask };
  assessLowRiskPullRequest(taskId: string, repositoryPath: string, actingRunnerId: string): PullRequestAssessment;
  recordTrustedMerge(taskId: string): AuthorityDecision & { task?: AuthorityTask };
};

/**
 * Builds the trusted host's controller around its own record adapter. Treat
 * this as host bootstrap: task callers receive the resulting controller and
 * can supply only task identifiers, requested states, and runner identifiers.
 * Authority policy, task state, and all record adapters remain host-owned.
 */
export function createAuthorityController(authorityId: string, records: AuthorityControllerRecords): AuthorityController {
  return Object.freeze({
    acquireTaskLease: (taskId, runnerId) => {
      return acquireTaskLeaseFromRecords(authorityId, taskId, runnerId, records);
    },
    transitionTask: (taskId, nextState, runnerId) => {
      return transitionTaskFromRecords(authorityId, taskId, nextState, runnerId, records);
    },
    assessLowRiskPullRequest: (taskId, repositoryPath, actingRunnerId) => {
      const authority = resolveControllerAuthority(authorityId, records);
      return isAuthorityDecision(authority)
        ? pullRequestDeny(authority.message, authority.details)
        : assessLowRiskPullRequestFromRecords(authority, taskId, repositoryPath, actingRunnerId, records);
    },
    recordTrustedMerge: (taskId) => {
      const authority = resolveControllerAuthority(authorityId, records);
      return isAuthorityDecision(authority) ? authority : recordTrustedMergeFromRecords(authority, taskId, records);
    },
  });
}

export type AuthorityDecision = {
  ok: boolean;
  code:
    | "allowed"
    | "authority_inactive"
    | "authority_scope_denied"
    | "action_denied"
    | "resource_limit_exceeded"
    | "invalid_transition"
    | "task_locked"
    | "lease_inactive"
    | "release_denied";
  message: string;
  details?: Record<string, unknown>;
};

export type PullRequestAssessment = AuthorityDecision & {
  pullRequestEligible: boolean;
  requiresSeparateHumanMerge: boolean;
  shouldPauseFurtherWork: boolean;
};

const NON_DELEGABLE_ACTIONS = new Set([
  "production-mutation",
  "production-deploy",
  "billing-mutation",
  "discord-membership-change",
  "secret-change",
]);

const PULL_REQUEST_PROTECTED_PATHS = [
  /^\.autodev\//,
  /^scripts\/autodev\//,
  /^\.github\/workflows\//,
  /(^|\/)AGENTS\.md$/,
  /^package(?:-lock)?\.json$/,
  /^migrations\//,
  /^functions\/(?:api\/(?:auth|stripe|billing|nitrado)|_lib\/(?:crypto|discord|nitrado|adm))/,
  /^workers\//,
];

const REQUIRED_RELEASE_CRITERIA: AuthorityAcceptanceCriterion[] = [
  { id: "scope", description: "Verified scope check passes." },
  { id: "tests", description: "Targeted tests pass." },
  { id: "preview", description: "Preview validation passes." },
  { id: "independent-review", description: "An independent review passes.", requiresIndependentActor: true },
];

const BROWSER_QA_CRITERION: AuthorityAcceptanceCriterion = {
  id: "browser-qa",
  description: "Browser QA passes for UI changes.",
};

export function makeTaskDeduplicationKey(authorityId: string, title: string, system: SystemCategory) {
  return createHash("sha256")
    .update(`${authorityId}\n${system}\n${title.trim().toLowerCase().replace(/\s+/g, " ")}`)
    .digest("hex");
}

function assessTaskAuthority(authority: StandingAuthority, task: AuthorityTask): AuthorityDecision {
  if (authority.state !== "active" || authority.revokedAt) {
    return deny("authority_inactive", "Standing authority is not active; this task cannot continue.", { state: authority.state, revokedAt: authority.revokedAt ?? null });
  }
  if (task.authorityId !== authority.id) return deny("authority_scope_denied", "Task is not bound to this standing authority.");
  if (!authority.allowedSystems.includes(task.system) || authority.excludedSystems.includes(task.system)) {
    return deny("authority_scope_denied", "Task system is outside the approved standing-authority scope.", { system: task.system });
  }
  const approvedTask = authority.approvedTasks.find((binding) => binding.taskId === task.id);
  if (!approvedTask || normalizeTaskTitle(approvedTask.title) !== normalizeTaskTitle(task.title) || approvedTask.system !== task.system) {
    return deny("authority_scope_denied", "Task is not bound to an approved task record.", { taskId: task.id, system: task.system });
  }
  if (task.requestedActions.some((action) => !approvedTask.allowedActions.includes(action))) {
    return deny("action_denied", "Task requests an action outside its approved task record.", { taskId: task.id, requestedActions: task.requestedActions });
  }
  if (task.requestedActions.some((action) => !authority.allowedActions.includes(action) || NON_DELEGABLE_ACTIONS.has(action))) {
    return deny("action_denied", "Task requests an action outside the approved authority.", { requestedActions: task.requestedActions });
  }
  if (!authority.subscriptionOnly || authority.maxExtraMonthlySpendUsd !== 0) {
    return deny("resource_limit_exceeded", "Authority must retain the subscription-only, zero-extra-spend limit.", {
      subscriptionOnly: authority.subscriptionOnly,
      maxExtraMonthlySpendUsd: authority.maxExtraMonthlySpendUsd,
    });
  }
  if (task.attempts >= authority.maxAttemptsPerTask) {
    return deny("resource_limit_exceeded", "Task reached the approved retry limit.", { attempts: task.attempts, maxAttemptsPerTask: authority.maxAttemptsPerTask });
  }
  if (!hasValidAcceptanceCriteria(authority.acceptanceCriteria)) {
    return deny("authority_scope_denied", "Standing authority acceptance criteria must be uniquely identified and describable.");
  }
  return allow("Task is within the active authority scope.");
}

function transitionTaskFromRecords(authorityId: string, taskId: string, nextState: AuthorityTaskState, runnerId: string, controllerRecords: AuthorityControllerRecords): AuthorityDecision & { task?: AuthorityTask } {
  let transitionRecord: TrustedAuthorityTaskRecord | AuthorityDecision;
  try {
    transitionRecord = controllerRecords.tryTransitionTask(authorityId, taskId, nextState, runnerId, (currentAuthority, currentTask) => assessTaskAuthority(currentAuthority, currentTask));
  } catch {
    return deny("invalid_transition", "The controller-owned task transition could not be persisted.", { taskId, nextState });
  }
  if (isAuthorityDecision(transitionRecord)) {
    return transitionRecord.ok
      ? deny("invalid_transition", "The controller transition returned no trusted task record.", { taskId, nextState })
      : transitionRecord;
  }
  const authority = resolveControllerAuthority(authorityId, controllerRecords);
  if (isAuthorityDecision(authority)) return authority;
  if (!isTrustedTaskRecord(transitionRecord, authority, taskId)) {
    return deny("invalid_transition", "Task transitions require a current controller-owned task record.", { taskId, nextState });
  }
  const task = transitionRecord.task;
  const authorityDecision = assessTaskAuthority(authority, task);
  if (!authorityDecision.ok) return authorityDecision;
  if (task.state !== nextState) {
    return deny("invalid_transition", "The controller-owned transition did not reach the requested state.", {
      taskId,
      expectedState: nextState,
      actualState: task.state,
    });
  }
  if (requiresLiveLease(nextState)) {
    const leaseDecision = assessTaskLease(authority, task, runnerId);
    if (!leaseDecision.ok) return leaseDecision;
  }
  return {
    ...allow(`Task transitioned to ${nextState}.`),
    task,
  };
}

function acquireTaskLeaseFromRecords(authorityId: string, taskId: string, runnerId: string, controllerRecords: AuthorityControllerRecords): AuthorityDecision & { task?: AuthorityTask } {
  let leaseRecord: TrustedAuthorityTaskRecord | AuthorityDecision;
  try {
    leaseRecord = controllerRecords.tryClaimTaskLease(authorityId, taskId, runnerId, (currentAuthority, currentTask) => assessTaskLeaseClaim(currentAuthority, currentTask));
  } catch {
    return deny("lease_inactive", "The controller-owned lease record could not be claimed.", { taskId });
  }
  if (isAuthorityDecision(leaseRecord)) {
    return leaseRecord.ok
      ? deny("lease_inactive", "The controller lease operation returned no trusted task record.", { taskId })
      : leaseRecord;
  }
  const authority = resolveControllerAuthority(authorityId, controllerRecords);
  if (isAuthorityDecision(authority)) return authority;
  if (!isTrustedTaskRecord(leaseRecord, authority, taskId)) {
    return deny("lease_inactive", "Lease acquisition requires a current controller-owned task record.", { taskId });
  }
  const authoritativeTask = leaseRecord.task;
  const authorityDecision = assessTaskAuthority(authority, authoritativeTask);
  if (!authorityDecision.ok) return authorityDecision;
  const leaseDecision = assessTaskLease(authority, authoritativeTask, runnerId);
  if (!leaseDecision.ok) return leaseDecision;
  return {
    ...allow("Task lease acquired."),
    task: authoritativeTask,
  };
}

export function inspectGitRange(repositoryPath: string, baseSha: string, headSha: string): VerifiedGitRange {
  if (!isCommitSha(baseSha) || !isCommitSha(headSha)) {
    throw new Error("Candidate ranges must use immutable Git commit SHAs.");
  }

  const actualBaseSha = runGit(repositoryPath, ["rev-parse", "--verify", `${baseSha}^{commit}`]);
  const actualHeadSha = runGit(repositoryPath, ["rev-parse", "--verify", `${headSha}^{commit}`]);
  const repositoryRemote = normalizeRepositoryRemote(runGit(repositoryPath, ["remote", "get-url", "origin"]));
  const changedFiles = listChangedPaths(repositoryPath, actualBaseSha, actualHeadSha);
  const diff = runGitBuffer(repositoryPath, ["diff", "--no-ext-diff", "--binary", actualBaseSha, actualHeadSha]);

  return {
    baseSha: actualBaseSha,
    headSha: actualHeadSha,
    repositoryRemote,
    changedFiles,
    diffSha256: createHash("sha256").update(diff).digest("hex"),
  };
}

function assessLowRiskPullRequestFromRecords(authority: StandingAuthority, taskId: string, repositoryPath: string, actingRunnerId: string, controllerRecords: AuthorityControllerRecords): PullRequestAssessment {
  let taskRecord: TrustedAuthorityTaskRecord | undefined;
  try {
    taskRecord = controllerRecords.getTaskRecord(authority.id, taskId);
  } catch {
    return pullRequestDeny("The controller-owned task record could not be read for pull-request preparation.", { taskId });
  }
  if (!isTrustedTaskRecord(taskRecord, authority, taskId)) {
    return pullRequestDeny("Pull-request preparation requires a current controller-owned task record.", { taskId });
  }
  const task = taskRecord.task;
  const authorityDecision = assessTaskAuthority(authority, task);
  if (!authorityDecision.ok) return pullRequestDeny(authorityDecision.message, authorityDecision.details);
  if (task.state !== "ready-to-release") return pullRequestDeny("Only a ready-to-release task can be assessed for a pull request.", { state: task.state });
  const leaseDecision = assessTaskLease(authority, task, actingRunnerId);
  if (!leaseDecision.ok) return pullRequestDeny(leaseDecision.message, leaseDecision.details);
  if (!task.requestedActions.includes("prepare-pr")) return pullRequestDeny("The task did not request pull-request preparation.");
  if (!task.implementerId.trim()) return pullRequestDeny("Pull-request preparation requires a named implementation actor.");
  const candidate = task.candidate;
  if (!candidate || !candidate.headSha || !candidate.baseSha) return pullRequestDeny("Pull-request candidate must include immutable base and head commits.");
  if (candidate.baseSha === candidate.headSha) return pullRequestDeny("Pull-request candidate base and head commits must differ.");

  let verifiedRange: VerifiedGitRange;
  try {
    verifiedRange = inspectGitRange(repositoryPath, candidate.baseSha, candidate.headSha);
  } catch (error) {
    return pullRequestDeny("The candidate commit range could not be verified in the repository.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let trustedTarget: TrustedPullRequestTarget | undefined;
  let trustedBaseSha: string;
  try {
    trustedTarget = controllerRecords.getPullRequestTarget(authority.id);
    if (!trustedTarget) throw new Error("The controller-owned pull-request provider returned no target.");
    trustedBaseSha = resolveTrustedTargetBase(repositoryPath, authority, trustedTarget);
  } catch (error) {
    return pullRequestDeny("The approved pull-request target could not be verified in the repository.", {
      targetBranch: authority.targetBranch,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (verifiedRange.baseSha !== trustedBaseSha) {
    return pullRequestDeny("Candidate base commit does not match the verified pull-request target.", {
      candidateBaseSha: verifiedRange.baseSha,
      trustedBaseSha,
      targetBranch: authority.targetBranch,
    });
  }
  if (!isAncestor(repositoryPath, trustedBaseSha, verifiedRange.headSha)) {
    return pullRequestDeny("Candidate head is not a descendant of the verified pull-request target.", {
      trustedBaseSha,
      candidateHeadSha: verifiedRange.headSha,
    });
  }

  const baseMatches = candidate.baseSha === verifiedRange.baseSha;
  const headMatches = candidate.headSha === verifiedRange.headSha;
  const candidateRemoteMatches = candidate.repositoryRemote === verifiedRange.repositoryRemote;
  const authorityRemoteMatches = verifiedRange.repositoryRemote === authority.repositoryRemote;
  const diffMatches = candidate.diffSha256 === verifiedRange.diffSha256;
  const filesMatch = sameFiles(candidate.changedFiles, verifiedRange.changedFiles);
  if (!baseMatches || !headMatches || !candidateRemoteMatches || !authorityRemoteMatches || !diffMatches || !filesMatch) {
    return pullRequestDeny("Candidate metadata does not match the verified Git commit range.", {
      baseMatches,
      headMatches,
      repositoryRemoteMatches: candidateRemoteMatches && authorityRemoteMatches,
      diffMatches,
      filesMatch,
    });
  }
  if (verifiedRange.changedFiles.length === 0) return pullRequestDeny("Verified candidate range has no changed files.");
  if (verifiedRange.changedFiles.length > authority.maxChangedFiles) {
    return pullRequestDeny("Verified candidate exceeds the approved changed-file limit.", { changedFiles: verifiedRange.changedFiles.length, maxChangedFiles: authority.maxChangedFiles });
  }
  const protectedFiles = verifiedRange.changedFiles.filter((file) => PULL_REQUEST_PROTECTED_PATHS.some((pattern) => pattern.test(file)));
  if (protectedFiles.length) return pullRequestDeny("Verified candidate changes a protected release-control or production-sensitive path.", { protectedFiles });
  const nonRegularFiles = verifiedRange.changedFiles.filter((file) => hasNonRegularGitEntry(repositoryPath, verifiedRange.baseSha, file)
    || hasNonRegularGitEntry(repositoryPath, verifiedRange.headSha, file));
  if (nonRegularFiles.length) return pullRequestDeny("Verified candidate includes a non-regular Git entry.", { nonRegularFiles });
  let independentlyClassified: RiskClassification[];
  try {
    independentlyClassified = verifiedRange.changedFiles.flatMap((file) => classifyChangedPath(repositoryPath, verifiedRange.baseSha, verifiedRange.headSha, file));
  } catch {
    return pullRequestDeny("Every verified changed file must be readable and classifiable before pull-request preparation.");
  }
  if (independentlyClassified.some((item) => item.risk !== "low" || item.system === "unknown")) {
    return pullRequestDeny("Every verified changed file must classify as low risk.", { classifications: independentlyClassified });
  }
  const outOfScope = independentlyClassified.filter((item) => !authority.allowedSystems.includes(item.system) || authority.excludedSystems.includes(item.system));
  if (outOfScope.length) {
    return pullRequestDeny("Every verified changed file must be within the standing-authority system scope.", { outOfScope });
  }
  const requiredCriteria = getRequiredAcceptanceCriteria(authority, independentlyClassified.some((item) => isBrowserFacingPath(item.file)));
  const requiredCriterionIds = new Set(requiredCriteria.map((criterion) => criterion.id));
  let trustedEvidence: TrustedEvidenceReceipt[];
  try {
    trustedEvidence = controllerRecords.getEvidenceReceipts(authority.id, task.id, candidate.headSha)
      .filter((item) => isTrustedEvidenceReceipt(item, authority, task, candidate.headSha));
  } catch {
    return pullRequestDeny("The controller-owned acceptance evidence could not be read for pull-request preparation.", { taskId: task.id });
  }
  const failedEvidence = trustedEvidence.filter((item) => requiredCriterionIds.has(item.kind) && item.status === "fail");
  if (failedEvidence.length) {
    return pullRequestDeny("Pull-request evidence includes a failed result for the current candidate head.", { failedEvidence });
  }
  const missing = requiredCriteria
    .filter((criterion) => !trustedEvidence.some((item) => item.kind === criterion.id
      && item.status === "pass"
      && (!criterion.requiresIndependentActor || (item.independent === true && typeof item.actorId === "string" && item.actorId.trim().length > 0 && item.actorId !== task.implementerId))))
    .map((criterion) => criterion.id);
  if (missing.length) return pullRequestDeny("Pull-request evidence is missing, failed, stale, or non-independent.", { missing, candidateHead: candidate.headSha });
  return {
    ...allow("Candidate is eligible only for pull-request preparation. A separate human-approved merge remains mandatory."),
    pullRequestEligible: true,
    requiresSeparateHumanMerge: true,
    shouldPauseFurtherWork: false,
  };
}

function recordTrustedMergeFromRecords(authority: StandingAuthority, taskId: string, controllerRecords: AuthorityControllerRecords): AuthorityDecision & { task?: AuthorityTask } {
  let mergeRecord: TrustedMergedAuthorityTaskRecord | AuthorityDecision;
  try {
    mergeRecord = controllerRecords.tryRecordMergedPullRequest(authority.id, taskId);
  } catch {
    return deny("release_denied", "The controller-owned merged-pull-request record could not be read.", { taskId });
  }
  if (isAuthorityDecision(mergeRecord)) {
    return mergeRecord.ok
      ? deny("release_denied", "The merge controller returned no trusted merged task record.", { taskId })
      : mergeRecord;
  }
  if (!isTrustedMergedTaskRecord(mergeRecord, authority, taskId)) {
    return deny("release_denied", "Release requires a current controller-owned merged-pull-request record.", { taskId });
  }
  const { task, receipt } = mergeRecord;
  const authorityDecision = assessTaskAuthority(authority, task);
  if (!authorityDecision.ok) return authorityDecision;
  if (task.state !== "released" || task.lease) {
    return deny("release_denied", "The controller-owned merge record did not persist a released task.", { state: task.state, taskId });
  }
  if (!task.candidate || !isCommitSha(task.candidate.headSha)) {
    return deny("release_denied", "A released task must retain its immutable candidate and provider merge receipt.");
  }
  if (receipt.source !== "pull-request-provider"
    || normalizeRepositoryRemote(receipt.repositoryRemote) !== authority.repositoryRemote
    || receipt.branch !== authority.targetBranch
    || receipt.candidateHeadSha !== task.candidate.headSha
    || !isCommitSha(receipt.mergeCommitSha)
    || !Number.isSafeInteger(receipt.pullRequestNumber)
    || receipt.pullRequestNumber < 1
    || !isValidTimestamp(receipt.mergedAt)
    || task.updatedAt !== receipt.mergedAt) {
    return deny("release_denied", "Release requires a valid provider-sourced merged-pull-request receipt.", {
      targetBranch: authority.targetBranch,
      pullRequestNumber: receipt.pullRequestNumber,
    });
  }
  return {
    ...allow("Trusted provider merge receipt recorded."),
    task,
  };
}

export function assessPostMergeHealth(authority: StandingAuthority, task: AuthorityTask, result: "pass" | "fail", detail: string): PullRequestAssessment {
  if (result === "pass") {
    return { ...allow("Post-merge verification passed."), pullRequestEligible: false, requiresSeparateHumanMerge: true, shouldPauseFurtherWork: false };
  }
  return {
    ...deny("release_denied", "Post-merge verification failed. Pause further authority work and investigate before resuming.", { taskId: task.id, detail, authorityId: authority.id }),
    pullRequestEligible: false,
    requiresSeparateHumanMerge: true,
    shouldPauseFurtherWork: true,
  };
}

function allow(message: string): AuthorityDecision {
  return { ok: true, code: "allowed", message };
}

function deny(code: Exclude<AuthorityDecision["code"], "allowed">, message: string, details?: Record<string, unknown>): AuthorityDecision {
  return { ok: false, code, message, details };
}

function pullRequestDeny(message: string, details?: Record<string, unknown>): PullRequestAssessment {
  return { ...deny("release_denied", message, details), pullRequestEligible: false, requiresSeparateHumanMerge: true, shouldPauseFurtherWork: false };
}

function isCommitSha(value: string) {
  return /^[0-9a-f]{7,64}$/i.test(value);
}

function runGit(repositoryPath: string, args: string[]) {
  return execFileSync("git", gitCommandArgs(repositoryPath, args), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runGitBuffer(repositoryPath: string, args: string[]) {
  return execFileSync("git", gitCommandArgs(repositoryPath, args), { encoding: "buffer", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommandArgs(repositoryPath: string, args: string[]) {
  // Candidate verification must inspect the real object graph, never a local replacement view.
  return ["--no-replace-objects", "-C", repositoryPath, ...args];
}

function listChangedPaths(repositoryPath: string, baseSha: string, headSha: string) {
  const fields = runGitBuffer(repositoryPath, ["diff", "--name-status", "-z", "--find-renames=50%", baseSha, headSha])
    .toString("utf8")
    .split("\0");
  const paths: string[] = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) continue;
    if (status.startsWith("R")) {
      const from = fields[index++];
      const to = fields[index++];
      if (from) paths.push(from);
      if (to) paths.push(to);
      continue;
    }
    const path = fields[index++];
    if (path) paths.push(path);
  }

  return Array.from(new Set(paths)).sort();
}

function hasNonRegularGitEntry(repositoryPath: string, commitSha: string, file: string) {
  const entry = readGitTreeEntry(repositoryPath, commitSha, file);
  return entry !== undefined && (entry.objectType !== "blob" || !isRegularFileMode(entry.mode));
}

function readGitTreeEntry(repositoryPath: string, commitSha: string, file: string) {
  const raw = runGitBuffer(repositoryPath, ["ls-tree", "-z", commitSha, "--", file]).toString("utf8");
  if (!raw) return undefined;
  const [entry] = raw.split("\0");
  const [header] = entry.split("\t", 1);
  const [mode, objectType] = header.split(" ");
  if (!mode || !objectType) throw new Error("Git tree entry could not be parsed.");
  return { mode, objectType };
}

function isRegularFileMode(mode: string) {
  return mode === "100644" || mode === "100755";
}

function resolveTrustedTargetBase(repositoryPath: string, authority: StandingAuthority, trustedTarget: TrustedPullRequestTarget) {
  if (!isBranchName(trustedTarget.branch) || trustedTarget.branch !== authority.targetBranch) {
    throw new Error("Standing authority target branch is invalid.");
  }
  if (trustedTarget.source !== "pull-request-provider" || !isCommitSha(trustedTarget.headSha)) {
    throw new Error("Trusted pull-request target must provide an immutable provider-sourced commit SHA.");
  }
  if (normalizeRepositoryRemote(trustedTarget.repositoryRemote) !== authority.repositoryRemote) {
    throw new Error("Trusted pull-request target does not belong to the approved repository.");
  }
  return runGit(repositoryPath, ["rev-parse", "--verify", `${trustedTarget.headSha}^{commit}`]);
}

function isBranchName(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !value.includes("..") && !value.includes("@{") && !value.startsWith("-");
}

function normalizeRepositoryRemote(remote: string) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(remote)) {
    const parsed = new URL(remote);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }
  const scpStyle = /^([^@/:]+)@([^:]+):(.+)$/.exec(remote);
  return scpStyle ? `${scpStyle[2]}:${scpStyle[3]}` : remote;
}

function isAncestor(repositoryPath: string, ancestorSha: string, descendantSha: string) {
  try {
    execFileSync("git", gitCommandArgs(repositoryPath, ["merge-base", "--is-ancestor", ancestorSha, descendantSha]), { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function requiresLiveLease(nextState: AuthorityTaskState) {
  return nextState === "implementing" || nextState === "validating" || nextState === "ready-to-release";
}

function isLeaseRunnableState(state: AuthorityTaskState) {
  return state === "authorised" || requiresLiveLease(state);
}

function assessTaskLeaseClaim(authority: StandingAuthority, task: AuthorityTask): AuthorityDecision {
  const authorityDecision = assessTaskAuthority(authority, task);
  if (!authorityDecision.ok) return authorityDecision;
  if (!isLeaseRunnableState(task.state)) {
    return deny("invalid_transition", "Only an authorised or active task may claim a runner lease.", { taskId: task.id, state: task.state });
  }
  return allow("Task may claim a lease.");
}

function assessTaskLease(authority: StandingAuthority, task: AuthorityTask, actingRunnerId?: string): AuthorityDecision {
  const at = controllerNow();
  if (!task.lease) {
    return deny("lease_inactive", "Task must retain a live lease before it can continue lifecycle or pull-request work.", { taskId: task.id });
  }
  if (!actingRunnerId?.trim() || task.lease.runnerId !== actingRunnerId) {
    return deny("task_locked", "Task lease belongs to a different runner.", {
      taskId: task.id,
      leaseRunnerId: task.lease.runnerId,
    });
  }
  if (task.implementerId !== task.lease.runnerId) {
    return deny("task_locked", "Task implementation actor must match the controller-recorded lease owner.", {
      taskId: task.id,
      implementerId: task.implementerId,
      leaseRunnerId: task.lease.runnerId,
    });
  }
  const expiresAt = new Date(task.lease.expiresAt).getTime();
  const runtimeDeadline = resolveLeaseRuntimeDeadline(authority, task.lease);
  if (!Number.isFinite(expiresAt) || !runtimeDeadline || expiresAt <= at.getTime() || runtimeDeadline.getTime() <= at.getTime()) {
    return deny("lease_inactive", "Task lease has expired and must be reacquired before lifecycle or pull-request work can continue.", {
      taskId: task.id,
      expiresAt: task.lease.expiresAt,
      runtimeDeadline: task.lease.runtimeDeadline ?? null,
      at: at.toISOString(),
    });
  }
  return allow("Task lease is active.");
}

function controllerNow() {
  const current = new Date();
  if (!Number.isFinite(current.getTime())) {
    throw new Error("The controller clock did not produce a valid timestamp.");
  }
  return current;
}

function isValidTimestamp(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function classifyChangedPath(repositoryPath: string, baseSha: string, headSha: string, file: string): RiskClassification[] {
  const classifications = [baseSha, headSha].flatMap((commitSha) => {
    if (!readGitTreeEntry(repositoryPath, commitSha, file)) return [];
    const content = readGitBlob(repositoryPath, commitSha, file);
    const classification = classifyPath(file, content);
    const blockedOperations = isExecutableTestPath(file) ? detectUnsafeExecutableTestOperations(content) : [];
    return [blockedOperations.length > 0
      ? { ...classification, risk: "blocked" as const, reasons: [...classification.reasons, ...blockedOperations], blockedReason: blockedOperations.join("; ") }
      : classification];
  });
  if (classifications.length === 0) throw new Error("Changed path was unavailable in both verified commits.");
  return classifications;
}

function isExecutableTestPath(file: string) {
  return /^scripts\/test-[^/]+\.[cm]?[jt]sx?$/i.test(file);
}

function readGitBlob(repositoryPath: string, commitSha: string, file: string) {
  return execFileSync("git", gitCommandArgs(repositoryPath, ["show", `${commitSha}:${file}`]), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function resolveControllerAuthority(authorityId: string, controllerRecords: AuthorityControllerRecords): StandingAuthority | AuthorityDecision {
  let authorityRecord: TrustedStandingAuthorityRecord | undefined;
  try {
    authorityRecord = controllerRecords.getAuthorityRecord(authorityId);
  } catch {
    return deny("authority_inactive", "The controller-owned authority record could not be read.", { authorityId });
  }
  if (!isTrustedAuthorityRecord(authorityRecord, authorityId)) {
    return deny("authority_inactive", "A current controller-owned authority record is required.", { authorityId });
  }
  return copyAuthority(authorityRecord.authority);
}

function isTrustedAuthorityRecord(record: TrustedStandingAuthorityRecord | undefined, authorityId: string): record is TrustedStandingAuthorityRecord {
  return record?.source === "authority-controller"
    && isValidTimestamp(record.recordedAt)
    && record.authority.id === authorityId;
}

function isTrustedTaskRecord(record: TrustedAuthorityTaskRecord | undefined, authority: StandingAuthority, taskId: string): record is TrustedAuthorityTaskRecord {
  if (!record) return false;
  return record.source === "authority-controller"
    && isValidTimestamp(record.recordedAt)
    && record.task.id === taskId
    && record.task.authorityId === authority.id;
}

function copyAuthority(authority: StandingAuthority): StandingAuthority {
  return {
    ...authority,
    allowedSystems: [...authority.allowedSystems],
    excludedSystems: [...authority.excludedSystems],
    allowedActions: [...authority.allowedActions],
    approvedTasks: authority.approvedTasks.map((task) => ({ ...task, allowedActions: [...task.allowedActions] })),
    acceptanceCriteria: authority.acceptanceCriteria.map((criterion) => ({ ...criterion })),
  };
}

function isTrustedMergedTaskRecord(record: TrustedMergedAuthorityTaskRecord | undefined, authority: StandingAuthority, taskId: string): record is TrustedMergedAuthorityTaskRecord {
  return isTrustedTaskRecord(record, authority, taskId)
    && record.receipt.source === "pull-request-provider"
    && isValidTimestamp(record.receipt.mergedAt);
}

function isAuthorityDecision(value: unknown): value is AuthorityDecision {
  return typeof value === "object"
    && value !== null
    && "ok" in value
    && "code" in value
    && typeof value.ok === "boolean"
    && typeof value.code === "string";
}

function isTrustedEvidenceReceipt(receipt: TrustedEvidenceReceipt | undefined, authority: StandingAuthority, task: AuthorityTask, candidateHeadSha: string) {
  if (!receipt) return false;
  return receipt.source === "authority-controller"
    && receipt.authorityId === authority.id
    && receipt.taskId === task.id
    && receipt.candidateHead === candidateHeadSha
    && isValidTimestamp(receipt.recordedAt);
}

function resolveLeaseRuntimeDeadline(authority: StandingAuthority, lease: NonNullable<AuthorityTask["lease"]>) {
  if (lease.runtimeDeadline) {
    const deadline = new Date(lease.runtimeDeadline);
    return Number.isFinite(deadline.getTime()) ? deadline : undefined;
  }
  const acquiredAt = new Date(lease.acquiredAt);
  if (!Number.isFinite(acquiredAt.getTime())) return undefined;
  return new Date(acquiredAt.getTime() + authority.maxRuntimeMinutes * 60_000);
}


function sameFiles(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((file, index) => file === sortedRight[index]);
}

function normalizeTaskTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasValidAcceptanceCriteria(criteria: AuthorityAcceptanceCriterion[]) {
  const ids = criteria.map((criterion) => criterion.id.trim());
  return criteria.every((criterion) => criterion.id.trim().length > 0 && criterion.description.trim().length > 0)
    && new Set(ids).size === ids.length
    && ids.every((id) => !REQUIRED_RELEASE_CRITERIA.some((criterion) => criterion.id === id) && id !== BROWSER_QA_CRITERION.id);
}

function getRequiredAcceptanceCriteria(authority: StandingAuthority, includesUi: boolean) {
  const criteria = [...authority.acceptanceCriteria, ...REQUIRED_RELEASE_CRITERIA];
  if (includesUi) criteria.push(BROWSER_QA_CRITERION);
  return Array.from(new Map(criteria.map((criterion) => [criterion.id, criterion])).values());
}

function isBrowserFacingPath(file: string) {
  return /^(?:app|components)\//.test(file);
}
