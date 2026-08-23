import { maxRisk, type ValidationProfileName } from "./lib";
import type { RiskClassification, SystemCategory } from "./risk-classifier";

export type ValidationCommand = {
  command: string;
  args: string[];
  reason: string;
  timeoutMs?: number;
};

export type ValidationProfile = {
  name: ValidationProfileName;
  description: string;
  commands: ValidationCommand[];
  requiresBrowserQa: boolean;
  requiresSecurityReview: boolean;
};

export type QualityGateProfileSelection = {
  classifications: RiskClassification[];
  requestedProfile?: string;
  inGithubActions?: boolean;
};

export const VALIDATION_PROFILES: Record<ValidationProfileName, ValidationProfile> = {
  docs: {
    name: "docs",
    description: "Documentation, instructions, and skill-only changes.",
    requiresBrowserQa: false,
    requiresSecurityReview: false,
    commands: [
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
      npm("test:agent-foundation", "Instruction and skill invariants."),
      npm("test:autodev", "AutoDev policy invariants."),
    ],
  },
  ui: {
    name: "ui",
    description: "User-facing UI changes without sensitive API behavior.",
    requiresBrowserQa: true,
    requiresSecurityReview: false,
    commands: [
      npm("test:autodev", "AutoDev policy invariants."),
      typecheck("TypeScript validation."),
      npm("lint", "Lint validation."),
      npm("build", "Production build validation.", 180000),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
  general: {
    name: "general",
    description: "General platform changes without a more specific subsystem profile.",
    requiresBrowserQa: false,
    requiresSecurityReview: false,
    commands: [
      npm("test:autodev", "AutoDev policy invariants."),
      npm("test:github-workflows", "Workflow safety boundary tests."),
      typecheck("TypeScript validation."),
      npm("lint", "Lint validation."),
      npm("build", "Production build validation.", 180000),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
  auth: {
    name: "auth",
    description: "Authentication, sessions, Discord OAuth, and protected-route behavior.",
    requiresBrowserQa: true,
    requiresSecurityReview: true,
    commands: [
      npm("test:auth-return-flow", "Discord OAuth return-flow regression tests."),
      npm("test:public-access-gating", "Public/protected access gating tests."),
      npm("test:autodev", "AutoDev policy invariants."),
      typecheck("TypeScript validation."),
      npm("lint", "Lint validation."),
      npm("build", "Production build validation.", 180000),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
  billing: {
    name: "billing",
    description: "Billing, Stripe, subscriptions, plans, entitlements, and allowance reservations.",
    requiresBrowserQa: true,
    requiresSecurityReview: true,
    commands: [
      npm("test:billing-plans", "Plan and Stripe readiness tests."),
      npm("test:billing-integrity", "Billing integrity and allowance tests."),
      npm("test:autodev", "AutoDev policy invariants."),
      typecheck("TypeScript validation."),
      npm("lint", "Lint validation."),
      npm("build", "Production build validation.", 180000),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
  "nitrado-adm": {
    name: "nitrado-adm",
    description: "Nitrado, ADM diagnostics, ADM imports, ADM Worker, retry/backoff, and Sync Health.",
    requiresBrowserQa: false,
    requiresSecurityReview: true,
    commands: [
      npm("test:nitrado-diagnostics", "Nitrado ADM diagnostics tests."),
      npm("test:adm-parser", "ADM parser tests."),
      npm("test:adm-import-pipeline", "ADM import pipeline tests."),
      npm("test:adm-sync-runner", "ADM sync runner tests."),
      npm("test:auto-sync-dashboard", "ADM Sync Health dashboard tests."),
      npm("test:autodev", "AutoDev policy invariants."),
      typecheck("TypeScript validation."),
      npm("lint", "Lint validation."),
      npm("build", "Production build validation.", 180000),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
  events: {
    name: "events",
    description: "Events, tournaments, seasons, CTF, Server Wars, and same-category competition behavior.",
    requiresBrowserQa: true,
    requiresSecurityReview: false,
    commands: [
      npm("test:events", "Events ecosystem tests."),
      npm("test:creator-event-governance", "Creator event governance tests."),
      npm("test:ctf-tournament-engine", "CTF tournament engine tests."),
      npm("test:dzn-seasons", "DZN seasons tests."),
      npm("test:server-wars", "Server Wars tests."),
      npm("test:autodev", "AutoDev policy invariants."),
      typecheck("TypeScript validation."),
      npm("lint", "Lint validation."),
      npm("build", "Production build validation.", 180000),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
  "github-workflows": {
    name: "github-workflows",
    description: "GitHub Actions, issue routing, prompt artifacts, permissions, and CI automation.",
    requiresBrowserQa: false,
    requiresSecurityReview: true,
    commands: [
      npm("test:github-workflows", "Workflow safety boundary tests."),
      npm("test:autodev-codex", "Codex safe-fix pipeline tests."),
      npm("test:agent-foundation", "Instruction and skill invariants."),
      npm("test:autodev", "AutoDev policy invariants."),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
  autodev: {
    name: "autodev",
    description: "AutoDev config, risk classification, issue routing, quality gates, and Agent Skills.",
    requiresBrowserQa: false,
    requiresSecurityReview: true,
    commands: [
      npm("test:agent-foundation", "Agent foundation invariants."),
      npm("test:autodev", "AutoDev policy and ADM preservation tests."),
      npm("test:autodev-codex", "Codex safe-fix pipeline tests."),
      npm("test:github-workflows", "Workflow safety boundary tests."),
      typecheck("TypeScript validation."),
      npm("lint", "Lint validation."),
      npm("build", "Production build validation.", 180000),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
  "release-high-risk": {
    name: "release-high-risk",
    description: "High-risk or mixed release changes that require broad validation.",
    requiresBrowserQa: true,
    requiresSecurityReview: true,
    commands: [
      npm("test:full-system", "Full-system release validation.", 1200000),
      cmd("git", ["diff", "--check"], "Whitespace and conflict-marker check."),
    ],
  },
};

export function selectValidationProfile(classifications: RiskClassification[]): ValidationProfile {
  if (!classifications.length) return VALIDATION_PROFILES.general;

  const systems = new Set<SystemCategory>(classifications.map((item) => item.system));
  const risk = maxRisk(classifications.map((item) => item.risk));
  const onlyDocsOrTests = classifications.every((item) => item.system === "docs" || item.system === "tests");
  const highestRiskClassifications = classifications.filter((item) => item.risk === risk);
  const highestRiskProfiles = materialProfileNames(highestRiskClassifications);

  if (risk === "blocked") return VALIDATION_PROFILES["release-high-risk"];

  if (risk === "high") {
    if (highestRiskProfiles.size === 1) return VALIDATION_PROFILES[[...highestRiskProfiles][0]];
    return VALIDATION_PROFILES["release-high-risk"];
  }

  if (highestRiskProfiles.size === 1) return VALIDATION_PROFILES[[...highestRiskProfiles][0]];

  if (risk === "medium") {
    if (highestRiskProfiles.has("autodev")) return VALIDATION_PROFILES.autodev;
    if (highestRiskProfiles.has("github-workflows")) return VALIDATION_PROFILES["github-workflows"];
    if (highestRiskProfiles.has("events")) return VALIDATION_PROFILES.events;
    return VALIDATION_PROFILES.general;
  }

  if (systems.has("autodev")) return VALIDATION_PROFILES.autodev;
  if (systems.has("github-actions")) return VALIDATION_PROFILES["github-workflows"];
  if (systems.has("events")) return VALIDATION_PROFILES.events;
  if (systems.has("ui")) return VALIDATION_PROFILES.ui;
  if (onlyDocsOrTests) return VALIDATION_PROFILES.docs;
  return VALIDATION_PROFILES.general;
}

export function selectQualityGateProfile(selection: QualityGateProfileSelection): ValidationProfile {
  if (selection.requestedProfile) {
    const requested = VALIDATION_PROFILES[selection.requestedProfile as ValidationProfileName];
    if (!requested) throw new Error(`Unknown AUTODEV_VALIDATION_PROFILE: ${selection.requestedProfile}`);
    return requested;
  }
  if (!selection.classifications.length && selection.inGithubActions === true) return VALIDATION_PROFILES["release-high-risk"];
  return selectValidationProfile(selection.classifications);
}

export function profileNames() {
  return Object.keys(VALIDATION_PROFILES) as ValidationProfileName[];
}

function npm(script: string, reason: string, timeoutMs?: number): ValidationCommand {
  return cmd("npm", ["run", script], reason, timeoutMs);
}

function typecheck(reason: string, timeoutMs?: number): ValidationCommand {
  return npx("tsc", ["--noEmit", "--pretty", "false", "--incremental", "false"], reason, timeoutMs);
}

function materialProfileNames(classifications: RiskClassification[]) {
  const profiles = new Set<ValidationProfileName>();
  for (const classification of classifications) profiles.add(profileForSystem(classification.system, classification.risk));
  return profiles;
}

function profileForSystem(system: SystemCategory, risk: RiskClassification["risk"]): ValidationProfileName {
  if (risk === "blocked") return "release-high-risk";
  if (risk === "high" && (system === "docs" || system === "tests")) return "autodev";
  if (system === "autodev") return "autodev";
  if (system === "github-actions") return "github-workflows";
  if (system === "auth") return "auth";
  if (system === "billing" || system === "stripe" || system === "onboarding") return "billing";
  if (system === "adm" || system === "nitrado") return "nitrado-adm";
  if (system === "events") return "events";
  if (system === "ui") return "ui";
  if (system === "docs" || system === "tests") return "docs";
  if (risk === "high" || system === "release" || system === "cloudflare-worker" || system === "owner-api") return "release-high-risk";
  return "general";
}

function npx(executable: string, args: string[], reason: string, timeoutMs?: number): ValidationCommand {
  return cmd("npx", [executable, ...args], reason, timeoutMs);
}

function cmd(command: string, args: string[], reason: string, timeoutMs?: number): ValidationCommand {
  return { command, args, reason, timeoutMs };
}
