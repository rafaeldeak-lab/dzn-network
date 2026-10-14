import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { classifyPath, type SystemCategory } from "./risk-classifier";

export type AuthorityState = "active" | "paused" | "revoked";
export type AuthorityTaskState = "proposed" | "authorised" | "implementing" | "validating" | "ready-to-release" | "released" | "blocked" | "reverted";
export type AuthorityAction = "investigate" | "implement-in-branch" | "validate" | "prepare-pr" | "retry-branch-failure";
export type ReleaseEvidenceKind = "scope" | "tests" | "preview" | "browser-qa" | "independent-review";

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
  acceptanceCriteria: string[];
  approvedAt: string;
  revokedAt?: string;
  revocationReason?: string;
};

export type CandidateEvidence = {
  kind: ReleaseEvidenceKind;
  status: "pass" | "fail" | "skip";
  candidateHead: string;
  independent?: boolean;
  actorId?: string;
  detail: string;
};

export type ReleaseCandidate = {
  baseSha: string;
  headSha: string;
  repositoryRemote: string;
  changedFiles: string[];
  diffSha256: string;
  evidence: CandidateEvidence[];
};

export type VerifiedGitRange = {
  baseSha: string;
  headSha: string;
  repositoryRemote: string;
  changedFiles: string[];
  diffSha256: string;
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
  };
  candidate?: ReleaseCandidate;
};

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

const ALLOWED_TRANSITIONS: Record<AuthorityTaskState, AuthorityTaskState[]> = {
  proposed: ["authorised", "blocked"],
  authorised: ["implementing", "blocked"],
  implementing: ["validating", "blocked"],
  validating: ["ready-to-release", "blocked"],
  "ready-to-release": ["released", "blocked"],
  released: ["reverted"],
  blocked: ["authorised"],
  reverted: [],
};

export function makeTaskDeduplicationKey(authorityId: string, title: string, system: SystemCategory) {
  return createHash("sha256")
    .update(`${authorityId}\n${system}\n${title.trim().toLowerCase().replace(/\s+/g, " ")}`)
    .digest("hex");
}

export function assessTaskAuthority(authority: StandingAuthority, task: AuthorityTask): AuthorityDecision {
  if (authority.state !== "active" || authority.revokedAt) {
    return deny("authority_inactive", "Standing authority is not active; this task cannot continue.", { state: authority.state, revokedAt: authority.revokedAt ?? null });
  }
  if (task.authorityId !== authority.id) return deny("authority_scope_denied", "Task is not bound to this standing authority.");
  if (!authority.allowedSystems.includes(task.system) || authority.excludedSystems.includes(task.system)) {
    return deny("authority_scope_denied", "Task system is outside the approved standing-authority scope.", { system: task.system });
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
  return allow("Task is within the active authority scope.");
}

export function transitionTask(authority: StandingAuthority, task: AuthorityTask, nextState: AuthorityTaskState, at: string): AuthorityDecision & { task?: AuthorityTask } {
  const authorityDecision = assessTaskAuthority(authority, task);
  if (!authorityDecision.ok && nextState !== "blocked") return authorityDecision;
  if (!ALLOWED_TRANSITIONS[task.state].includes(nextState)) {
    return deny("invalid_transition", "Task state transition is not allowed.", { from: task.state, to: nextState });
  }
  return {
    ...allow(`Task transitioned from ${task.state} to ${nextState}.`),
    task: { ...task, state: nextState, updatedAt: at },
  };
}

export function acquireTaskLease(authority: StandingAuthority, task: AuthorityTask, activeTasks: AuthorityTask[], runnerId: string, now: Date): AuthorityDecision & { task?: AuthorityTask } {
  const authorityDecision = assessTaskAuthority(authority, task);
  if (!authorityDecision.ok) return authorityDecision;
  const persistedTask = activeTasks.find((item) => item.id === task.id);
  const activeLease = persistedTask?.lease ?? task.lease;
  if (activeLease && new Date(activeLease.expiresAt).getTime() > now.getTime() && activeLease.runnerId !== runnerId) {
    return deny("task_locked", "Task is already leased by another runner.", { runnerId: activeLease.runnerId, expiresAt: activeLease.expiresAt });
  }
  const activeLeases = activeTasks.filter((item) => item.authorityId === authority.id && item.id !== task.id && item.lease && new Date(item.lease.expiresAt).getTime() > now.getTime());
  if (activeLeases.length >= authority.maxConcurrentTasks) {
    return deny("resource_limit_exceeded", "Authority concurrency limit has been reached.", { maxConcurrentTasks: authority.maxConcurrentTasks, activeLeases: activeLeases.length });
  }
  const expiresAt = new Date(now.getTime() + authority.maxRuntimeMinutes * 60_000).toISOString();
  return {
    ...allow("Task lease acquired."),
    task: { ...task, lease: { runnerId, acquiredAt: now.toISOString(), expiresAt }, updatedAt: now.toISOString() },
  };
}

export function inspectGitRange(repositoryPath: string, baseSha: string, headSha: string): VerifiedGitRange {
  if (!isCommitSha(baseSha) || !isCommitSha(headSha)) {
    throw new Error("Candidate ranges must use immutable Git commit SHAs.");
  }

  const actualBaseSha = runGit(repositoryPath, ["rev-parse", "--verify", `${baseSha}^{commit}`]);
  const actualHeadSha = runGit(repositoryPath, ["rev-parse", "--verify", `${headSha}^{commit}`]);
  const repositoryRemote = runGit(repositoryPath, ["remote", "get-url", "origin"]);
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

export function assessLowRiskPullRequest(authority: StandingAuthority, task: AuthorityTask, repositoryPath: string): PullRequestAssessment {
  const authorityDecision = assessTaskAuthority(authority, task);
  if (!authorityDecision.ok) return pullRequestDeny(authorityDecision.message, authorityDecision.details);
  if (task.state !== "ready-to-release") return pullRequestDeny("Only a ready-to-release task can be assessed for a pull request.", { state: task.state });
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

  let trustedBaseSha: string;
  try {
    trustedBaseSha = resolveTrustedTargetBase(repositoryPath, authority.targetBranch);
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

  if (candidate.baseSha !== verifiedRange.baseSha || candidate.headSha !== verifiedRange.headSha || candidate.repositoryRemote !== verifiedRange.repositoryRemote || candidate.repositoryRemote !== authority.repositoryRemote || candidate.diffSha256 !== verifiedRange.diffSha256 || !sameFiles(candidate.changedFiles, verifiedRange.changedFiles)) {
    return pullRequestDeny("Candidate metadata does not match the verified Git commit range.", {
      declaredRemote: candidate.repositoryRemote,
      verifiedRemote: verifiedRange.repositoryRemote,
      declaredFiles: candidate.changedFiles,
      verifiedFiles: verifiedRange.changedFiles,
    });
  }
  if (verifiedRange.changedFiles.length === 0) return pullRequestDeny("Verified candidate range has no changed files.");
  if (verifiedRange.changedFiles.length > authority.maxChangedFiles) {
    return pullRequestDeny("Verified candidate exceeds the approved changed-file limit.", { changedFiles: verifiedRange.changedFiles.length, maxChangedFiles: authority.maxChangedFiles });
  }
  const protectedFiles = verifiedRange.changedFiles.filter((file) => PULL_REQUEST_PROTECTED_PATHS.some((pattern) => pattern.test(file)));
  if (protectedFiles.length) return pullRequestDeny("Verified candidate changes a protected release-control or production-sensitive path.", { protectedFiles });
  const independentlyClassified = verifiedRange.changedFiles.map((file) => classifyPath(file, readChangedGitBlob(repositoryPath, verifiedRange.baseSha, verifiedRange.headSha, file)));
  if (independentlyClassified.some((item) => item.risk !== "low" || item.system === "unknown")) {
    return pullRequestDeny("Every verified changed file must classify as low risk.", { classifications: independentlyClassified });
  }
  const outOfScope = independentlyClassified.filter((item) => !authority.allowedSystems.includes(item.system) || authority.excludedSystems.includes(item.system));
  if (outOfScope.length) {
    return pullRequestDeny("Every verified changed file must be within the standing-authority system scope.", { outOfScope });
  }
  const requiredEvidence: ReleaseEvidenceKind[] = ["scope", "tests", "preview", "independent-review"];
  if (independentlyClassified.some((item) => item.system === "ui")) requiredEvidence.push("browser-qa");
  const failedEvidence = candidate.evidence.filter((item) => requiredEvidence.includes(item.kind) && item.candidateHead === candidate.headSha && item.status === "fail");
  if (failedEvidence.length) {
    return pullRequestDeny("Pull-request evidence includes a failed result for the current candidate head.", { failedEvidence });
  }
  const missing = requiredEvidence.filter((kind) => !candidate.evidence.some((item) => item.kind === kind && item.status === "pass" && item.candidateHead === candidate.headSha && (kind !== "independent-review" || (item.independent === true && typeof item.actorId === "string" && item.actorId.trim().length > 0 && item.actorId !== task.implementerId))));
  if (missing.length) return pullRequestDeny("Pull-request evidence is missing, failed, stale, or non-independent.", { missing, candidateHead: candidate.headSha });
  return {
    ...allow("Candidate is eligible only for pull-request preparation. A separate human-approved merge remains mandatory."),
    pullRequestEligible: true,
    requiresSeparateHumanMerge: true,
    shouldPauseFurtherWork: false,
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
  return execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runGitBuffer(repositoryPath: string, args: string[]) {
  return execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
}

function listChangedPaths(repositoryPath: string, baseSha: string, headSha: string) {
  const fields = runGitBuffer(repositoryPath, ["diff", "--name-status", "-z", "--find-renames=50%", "--diff-filter=ACMRD", baseSha, headSha])
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

function resolveTrustedTargetBase(repositoryPath: string, targetBranch: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(targetBranch) || targetBranch.includes("..") || targetBranch.includes("@{") || targetBranch.startsWith("-")) {
    throw new Error("Standing authority target branch is invalid.");
  }
  return runGit(repositoryPath, ["rev-parse", "--verify", `refs/remotes/origin/${targetBranch}^{commit}`]);
}

function isAncestor(repositoryPath: string, ancestorSha: string, descendantSha: string) {
  try {
    execFileSync("git", ["-C", repositoryPath, "merge-base", "--is-ancestor", ancestorSha, descendantSha], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readChangedGitBlob(repositoryPath: string, baseSha: string, headSha: string, file: string) {
  try {
    return readGitBlob(repositoryPath, headSha, file);
  } catch {
    return readGitBlob(repositoryPath, baseSha, file);
  }
}

function readGitBlob(repositoryPath: string, commitSha: string, file: string) {
  return execFileSync("git", ["-C", repositoryPath, "show", `${commitSha}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function sameFiles(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((file, index) => file === sortedRight[index]);
}
