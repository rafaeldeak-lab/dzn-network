import { createHash } from "node:crypto";

import type { RiskLevel } from "./lib";
import { classifyPath, type SystemCategory } from "./risk-classifier";

export type AuthorityState = "active" | "paused" | "revoked";
export type AuthorityTaskState = "proposed" | "authorised" | "implementing" | "validating" | "ready-to-release" | "released" | "blocked" | "reverted";
export type AuthorityAction = "investigate" | "implement-in-branch" | "validate" | "prepare-pr" | "retry-branch-failure" | "auto-release-low-risk";
export type ReleaseEvidenceKind = "scope" | "tests" | "preview" | "browser-qa" | "independent-review";

export type StandingAuthority = {
  id: string;
  approvedGoal: string;
  state: AuthorityState;
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
  changedFiles: string[];
  classifications: Array<{ file: string; system: SystemCategory; risk: RiskLevel }>;
  evidence: CandidateEvidence[];
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

export type ReleaseAssessment = AuthorityDecision & {
  releaseEligible: boolean;
  requiresTrustedController: boolean;
  shouldPauseFurtherReleases: boolean;
};

const NON_DELEGABLE_ACTIONS = new Set([
  "production-mutation",
  "production-deploy",
  "billing-mutation",
  "discord-membership-change",
  "secret-change",
]);

const AUTOMATIC_RELEASE_PROTECTED_PATHS = [
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

export function assessLowRiskRelease(authority: StandingAuthority, task: AuthorityTask): ReleaseAssessment {
  const authorityDecision = assessTaskAuthority(authority, task);
  if (!authorityDecision.ok) return releaseDeny(authorityDecision.message, authorityDecision.details);
  if (task.state !== "ready-to-release") return releaseDeny("Only a ready-to-release task can be assessed for automatic release.", { state: task.state });
  if (!authority.allowedActions.includes("auto-release-low-risk")) return releaseDeny("Automatic low-risk release is not approved for this authority.");
  if (!task.implementerId.trim()) return releaseDeny("Automatic release requires a named implementation actor.");
  const candidate = task.candidate;
  if (!candidate || !candidate.headSha || !candidate.baseSha) return releaseDeny("Release candidate must include immutable base and head commits.");
  if (candidate.baseSha === candidate.headSha) return releaseDeny("Release candidate base and head commits must differ.");
  if (candidate.changedFiles.length === 0) return releaseDeny("Release candidate has no changed files.");
  if (candidate.changedFiles.length > authority.maxChangedFiles) {
    return releaseDeny("Release candidate exceeds the approved changed-file limit.", { changedFiles: candidate.changedFiles.length, maxChangedFiles: authority.maxChangedFiles });
  }
  const protectedFiles = candidate.changedFiles.filter((file) => AUTOMATIC_RELEASE_PROTECTED_PATHS.some((pattern) => pattern.test(file)));
  if (protectedFiles.length) return releaseDeny("Release candidate changes a protected release-control or production-sensitive path.", { protectedFiles });
  const independentlyClassified = candidate.changedFiles.map((file) => classifyPath(file));
  const suppliedByFile = new Map(candidate.classifications.map((item) => [item.file, item]));
  const classificationMismatch = independentlyClassified.some((item) => {
    const supplied = suppliedByFile.get(item.file);
    return !supplied || supplied.risk !== item.risk || supplied.system !== item.system;
  });
  if (candidate.classifications.length !== candidate.changedFiles.length || classificationMismatch || independentlyClassified.some((item) => item.risk !== "low" || item.system === "unknown")) {
    return releaseDeny("Every changed file must have an independently verified low-risk classification.", { classifications: candidate.classifications });
  }
  const requiredEvidence: ReleaseEvidenceKind[] = ["scope", "tests", "preview", "independent-review"];
  if (independentlyClassified.some((item) => item.system === "ui")) requiredEvidence.push("browser-qa");
  const missing = requiredEvidence.filter((kind) => !candidate.evidence.some((item) => item.kind === kind && item.status === "pass" && item.candidateHead === candidate.headSha && (kind !== "independent-review" || (item.independent === true && typeof item.actorId === "string" && item.actorId.trim().length > 0 && item.actorId !== task.implementerId))));
  if (missing.length) return releaseDeny("Release evidence is missing, failed, stale, or non-independent.", { missing, candidateHead: candidate.headSha });
  return {
    ...allow("Candidate is eligible for a separately configured trusted low-risk release controller."),
    releaseEligible: true,
    requiresTrustedController: true,
    shouldPauseFurtherReleases: false,
  };
}

export function assessPostReleaseHealth(authority: StandingAuthority, task: AuthorityTask, result: "pass" | "fail", detail: string): ReleaseAssessment {
  if (result === "pass") {
    return { ...allow("Post-release verification passed."), releaseEligible: false, requiresTrustedController: false, shouldPauseFurtherReleases: false };
  }
  return {
    ...deny("release_denied", "Post-release verification failed. Pause subsequent automatic releases and investigate before resuming.", { taskId: task.id, detail, authorityId: authority.id }),
    releaseEligible: false,
    requiresTrustedController: false,
    shouldPauseFurtherReleases: true,
  };
}

function allow(message: string): AuthorityDecision {
  return { ok: true, code: "allowed", message };
}

function deny(code: Exclude<AuthorityDecision["code"], "allowed">, message: string, details?: Record<string, unknown>): AuthorityDecision {
  return { ok: false, code, message, details };
}

function releaseDeny(message: string, details?: Record<string, unknown>): ReleaseAssessment {
  return { ...deny("release_denied", message, details), releaseEligible: false, requiresTrustedController: true, shouldPauseFurtherReleases: false };
}
