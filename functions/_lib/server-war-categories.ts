import {
  getServerCategoryLabel,
  normalizeServerCategory,
  normalizeServerCategoryFromRecord,
  type ServerCategory,
  type ServerCategoryInput,
} from "./server-categories";
import {
  SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES,
  normalizeServerLifecycleStatus,
} from "../../lib/server-lifecycle";

export type ServerWarRulesetKey =
  | "deathmatch_war"
  | "pvp_war"
  | "pve_builder_cup"
  | "exploration_race"
  | "longest_kill_cup"
  | "hybrid_war"
  | "most_active_community";

export type ServerWarRuleset = {
  key: ServerWarRulesetKey;
  title: string;
  eventType: string;
  category: string;
  eligibleCategories: ServerCategory[];
  packageRequired: "free" | "starter" | "pro" | "premium";
  scoreEstimated: boolean;
  allowMixedCategoryEvent: boolean;
  allowMixedCategoryChallenge: boolean;
};

export const SERVER_WAR_RULESETS: Record<ServerWarRulesetKey, ServerWarRuleset> = {
  deathmatch_war: {
    key: "deathmatch_war",
    title: "Deathmatch War",
    eventType: "server_war",
    category: "deathmatch",
    eligibleCategories: ["deathmatch"],
    packageRequired: "pro",
    scoreEstimated: false,
    allowMixedCategoryEvent: false,
    allowMixedCategoryChallenge: false,
  },
  pvp_war: {
    key: "pvp_war",
    title: "PvP War",
    eventType: "server_war",
    category: "pvp",
    eligibleCategories: ["pvp", "pvp_pve"],
    packageRequired: "pro",
    scoreEstimated: false,
    allowMixedCategoryEvent: true,
    allowMixedCategoryChallenge: false,
  },
  pve_builder_cup: {
    key: "pve_builder_cup",
    title: "PvE Builder Cup",
    eventType: "server_cup",
    category: "pve",
    eligibleCategories: ["pve", "pvp_pve"],
    packageRequired: "pro",
    scoreEstimated: false,
    allowMixedCategoryEvent: true,
    allowMixedCategoryChallenge: false,
  },
  exploration_race: {
    key: "exploration_race",
    title: "Exploration Race",
    eventType: "server_cup",
    category: "exploration",
    eligibleCategories: ["pve", "pvp_pve", "hardcore"],
    packageRequired: "pro",
    scoreEstimated: true,
    allowMixedCategoryEvent: true,
    allowMixedCategoryChallenge: false,
  },
  longest_kill_cup: {
    key: "longest_kill_cup",
    title: "Longest Kill Cup",
    eventType: "server_cup",
    category: "combat",
    eligibleCategories: ["deathmatch", "pvp", "pvp_pve"],
    packageRequired: "pro",
    scoreEstimated: false,
    allowMixedCategoryEvent: true,
    allowMixedCategoryChallenge: false,
  },
  hybrid_war: {
    key: "hybrid_war",
    title: "Hybrid War",
    eventType: "server_war",
    category: "hybrid",
    eligibleCategories: ["pvp_pve"],
    packageRequired: "pro",
    scoreEstimated: true,
    allowMixedCategoryEvent: false,
    allowMixedCategoryChallenge: false,
  },
  most_active_community: {
    key: "most_active_community",
    title: "Most Active Community",
    eventType: "server_cup",
    category: "community",
    eligibleCategories: ["deathmatch", "pvp", "pve", "pvp_pve", "hardcore", "roleplay", "faction_wars", "vanilla", "modded"],
    packageRequired: "free",
    scoreEstimated: false,
    allowMixedCategoryEvent: true,
    allowMixedCategoryChallenge: false,
  },
};

export class ServerWarCategoryError extends Error {
  code: "unknown_category" | "ineligible_category" | "same_category_required";

  constructor(code: ServerWarCategoryError["code"], message: string) {
    super(message);
    this.name = "ServerWarCategoryError";
    this.code = code;
  }
}

export function getServerWarRuleset(value: unknown): ServerWarRuleset {
  const key = String(value ?? "").trim().toLowerCase() as ServerWarRulesetKey;
  return SERVER_WAR_RULESETS[key] ?? SERVER_WAR_RULESETS.deathmatch_war;
}

export function getServerWarRulesetOptions() {
  return Object.values(SERVER_WAR_RULESETS).map((ruleset) => ({
    key: ruleset.key,
    title: ruleset.title,
    category: ruleset.category,
    eventType: ruleset.eventType,
    eligibleCategories: ruleset.eligibleCategories,
    packageRequired: ruleset.packageRequired,
    scoreEstimated: ruleset.scoreEstimated,
  }));
}

export function getServerWarEligibleCategories(rulesetKey: unknown) {
  return getServerWarRuleset(rulesetKey).eligibleCategories;
}

export function normalizeWarServerCategory(input: ServerCategoryInput | unknown): ServerCategory | null {
  if (input && typeof input === "object") {
    return normalizeServerCategoryFromRecord(input as ServerCategoryInput);
  }
  return normalizeServerCategory(input);
}

export function assertServerWarCategoryEligible(
  server: ServerCategoryInput | unknown,
  rulesetKey: unknown,
): ServerCategory {
  const category = normalizeWarServerCategory(server);
  if (!category) {
    throw new ServerWarCategoryError("unknown_category", "Set a server category before joining a Server War.");
  }
  const ruleset = getServerWarRuleset(rulesetKey);
  if (!ruleset.eligibleCategories.includes(category)) {
    throw new ServerWarCategoryError(
      "ineligible_category",
      `${getServerCategoryLabel(category)} servers are not eligible for ${ruleset.title}.`,
    );
  }
  return category;
}

export function assertSameCategoryChallenge(
  challenger: ServerCategoryInput | unknown,
  opponent: ServerCategoryInput | unknown,
  rulesetKey: unknown,
): ServerCategory {
  const ruleset = getServerWarRuleset(rulesetKey);
  const challengerCategory = assertServerWarCategoryEligible(challenger, ruleset.key);
  const opponentCategory = assertServerWarCategoryEligible(opponent, ruleset.key);
  if (!ruleset.allowMixedCategoryChallenge && challengerCategory !== opponentCategory) {
    throw new ServerWarCategoryError(
      "same_category_required",
      "Server VS Server challenges require both servers to be in the same category.",
    );
  }
  return challengerCategory;
}

export function isPublicServerWarsEligibleServer(row: {
  status?: unknown;
  listing_visibility?: unknown;
  public_visibility?: unknown;
  public_slug?: unknown;
  lifecycle_status?: unknown;
}) {
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status !== "live") return false;
  const visibility = String(row.listing_visibility ?? row.public_visibility ?? "public").trim().toLowerCase();
  if (["private", "unlisted", "hidden", "deleted", "archived"].includes(visibility)) return false;
  const lifecycleStatus = normalizeServerLifecycleStatus(row);
  if (!SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES.includes(lifecycleStatus)) return false;
  return true;
}

export function lockedCategoryMessage(category: unknown, rulesetKey: unknown) {
  const normalized = normalizeWarServerCategory(category);
  if (!normalized) return "Set a category before entering category-specific Server Wars.";
  const ruleset = getServerWarRuleset(rulesetKey);
  return `${getServerCategoryLabel(normalized)} is not eligible for ${ruleset.title}.`;
}
