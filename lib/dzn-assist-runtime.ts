import { DZN_ASSIST_GUIDES, type DznAssistGuide, type DznAssistLink } from "./dzn-assist";

export type DznAssistRankingRow = {
  rank: number;
  name: string;
  detail: string;
};

export type DznAssistRankings = {
  players: DznAssistRankingRow[];
  servers: DznAssistRankingRow[];
  updatedAt: string | null;
  unavailable: boolean;
  stale: boolean;
};

export type DznAssistWorkflow = {
  id: string;
  category: DznAssistGuide["category"];
  title: string;
  summary: string;
  steps: string[];
  links: DznAssistLink[];
  nextPrompts: string[];
};

export type DznAssistReply = {
  kind: "boundary" | "guidance" | "ranking" | "fallback";
  message: string;
  links: DznAssistLink[];
  workflows: DznAssistWorkflow[];
  suggestedPrompts: string[];
  guideIds: string[];
  wantsRankings: boolean;
  showPlayers: boolean;
  showServers: boolean;
};

type DznAssistOptions = {
  guides?: readonly DznAssistGuide[];
  previousGuideIds?: readonly string[];
};

const SENSITIVE_PRIVATE_REQUEST = /\b(card number|cvv|cvc|password|passcode|token|secret|credential|api key|bank|account number|private message|dm|server file)\b/i;
const ACCOUNT_SPECIFIC_REQUEST = /\b(my account|my payment|my bill|my invoice|my receipt|my subscription|my discord|reported me|reporter|appeal|ban)\b/i;
const PUBLIC_ACCOUNT_ROUTE_REQUEST = /\b(sign in|log in(?:to)?|login|create (?:an )?account|join dzn)\b/i;
const PLAYER_RANKING_REQUEST = /\b(top|leaderboard|ranking|rankings|ranked|best)\b[\s\S]*\b(player|players|survivor|survivors|kills?)\b|\b(top player|top players|player leaderboard)\b/i;
const SERVER_RANKING_REQUEST = /\b(top|leaderboard|ranking|rankings|ranked|best)\b[\s\S]*\b(server|servers|community|communities)\b|\b(top server|top servers|server leaderboard)\b/i;
const RANKING_REQUEST = /\b(leaderboard|ranking|rankings|ranked)\b|\btop\s*(?:10|ten)\b|\btop\b[\s\S]*\b(player|players|server|servers|community|communities|survivor|survivors|kills?)\b/i;
const FOLLOW_UP_REQUEST = /^(?:and\s+)?(?:(?:what\s+)?(?:should\s+i\s+)?do\s+next|what\s+should\s+i\s+do|where\s+do\s+i\s+(?:go|start)|how\s+do\s+i\s+(?:continue|start)|next|continue|more|details|tell\s+me\s+more|how\s+does\s+that\s+work)\??$/i;
const COMMON_QUERY_TERMS = new Set(["a", "an", "and", "are", "can", "do", "for", "from", "help", "how", "i", "in", "is", "it", "me", "my", "need", "of", "on", "or", "please", "show", "the", "to", "want", "what", "when", "where", "with", "you", "your"]);
const UNAVAILABLE_LEADERBOARD_SOURCES = new Set(["empty_no_cache", "fallback_empty", "empty_no_db"]);
const DEFAULT_PROMPTS = ["I want to join DZN", "How do I add my server?", "How do I link my DayZ stats?", "Show the top players"];

export function isPublicRankingRequest(question: string) {
  return RANKING_REQUEST.test(question);
}

export function answerDznAssist(question: string, options: DznAssistOptions = {}): DznAssistReply {
  const normalized = question.trim().replace(/\s+/g, " ");
  const guides = options.guides ?? DZN_ASSIST_GUIDES;

  if (!normalized) return fallbackReply();

  if ((SENSITIVE_PRIVATE_REQUEST.test(normalized) || (ACCOUNT_SPECIFIC_REQUEST.test(normalized) && !PUBLIC_ACCOUNT_ROUTE_REQUEST.test(normalized))) && !isPublicRankingRequest(normalized)) {
    return {
      kind: "boundary",
      message: "I can explain public DZN routes, but I cannot view or disclose account, payment, player, Discord, moderation, or server-private information. Use the signed-in controls or private support for that case.",
      links: privateSupportLinks(guides),
      workflows: [],
      suggestedPrompts: ["Compare DZN plans", "How do I add my server?", "Show the top servers"],
      guideIds: [],
      wantsRankings: false,
      showPlayers: false,
      showServers: false,
    };
  }

  const showPlayers = PLAYER_RANKING_REQUEST.test(normalized) || (!SERVER_RANKING_REQUEST.test(normalized) && RANKING_REQUEST.test(normalized));
  const showServers = SERVER_RANKING_REQUEST.test(normalized) || (!PLAYER_RANKING_REQUEST.test(normalized) && RANKING_REQUEST.test(normalized));
  if (showPlayers || showServers) {
    return {
      kind: "ranking",
      message: "I can show the current public standings. I will only use the public DZN leaderboard and will not expose private profiles or hidden server data.",
      links: [{ href: "/leaderboards", label: "Open full leaderboards" }],
      workflows: [],
      suggestedPrompts: ["How do I link my DayZ stats?", "How do I add my server?", "What events are live?"],
      guideIds: [],
      wantsRankings: true,
      showPlayers,
      showServers,
    };
  }

  const matchedGuides = findGuides(normalized, guides, options.previousGuideIds);
  if (matchedGuides.length) {
    const workflows = matchedGuides.map(toWorkflow);
    const guideIds = workflows.map((workflow) => workflow.id);
    const message = workflows.length === 1
      ? `Here is the clearest public route for ${workflows[0].title.toLocaleLowerCase()}.`
      : `I can help with both parts. Start with ${workflows[0].title.toLocaleLowerCase()}, then continue with ${workflows[1].title.toLocaleLowerCase()}.`;
    return {
      kind: "guidance",
      message,
      links: uniqueLinks(workflows.flatMap((workflow) => workflow.links)),
      workflows,
      suggestedPrompts: nextPromptsFor(workflows),
      guideIds,
      wantsRankings: false,
      showPlayers: false,
      showServers: false,
    };
  }

  return fallbackReply();
}

export function parseDznAssistRankings(value: unknown): DznAssistRankings {
  const record = asRecord(value);
  const payload = asRecord(record?.data) ?? record;
  const source = stringValue(payload?.source);
  return {
    players: parseRows(payload?.top_players, "player"),
    servers: parseRows(payload?.top_servers, "server"),
    updatedAt: normalizedTimestamp(payload?.updated_at),
    unavailable: UNAVAILABLE_LEADERBOARD_SOURCES.has(source),
    stale: payload?.stale === true || source === "snapshot",
  };
}

function findGuides(question: string, guides: readonly DznAssistGuide[], previousGuideIds: readonly string[] | undefined) {
  const terms = questionTerms(question);
  const guideTermCounts = termCounts(guides);
  const rankedGuides = guides
    .map((guide) => {
      const guideTokens = guideTerms(guide);
      const matches = terms.filter((term) => guideTokens.has(term));
      const phraseBonus = phraseScore(question, guide.id);
      const score = matches.reduce((total, term) => total + (guideTermCounts.get(term) === 1 ? 3 : 1), 0) + phraseBonus;
      return { guide, score, confident: phraseBonus > 0 || matches.length >= 2 || matches.some((term) => guideTermCounts.get(term) === 1) };
    })
    .filter((item) => item.confident)
    .sort((left, right) => right.score - left.score || left.guide.title.localeCompare(right.guide.title));

  if (!rankedGuides.length && FOLLOW_UP_REQUEST.test(question) && previousGuideIds?.length) {
    return previousGuideIds
      .map((id) => guides.find((guide) => guide.id === id))
      .filter((guide): guide is DznAssistGuide => Boolean(guide))
      .slice(0, 2);
  }

  return rankedGuides
    .slice(0, 2)
    .map((item) => item.guide)
    .sort((left, right) => workflowOrder(left.id) - workflowOrder(right.id));
}

function workflowOrder(guideId: string) {
  const order: Record<string, number> = {
    "account-access": 10,
    "server-setup": 20,
    "server-data": 30,
    "player-stats-link": 40,
    "server-owner-discord-access": 50,
    "plans-and-billing": 60,
    "comms-safety": 70,
    "events-and-leaderboards": 80,
  };
  return order[guideId] ?? 100;
}

function phraseScore(question: string, guideId: string) {
  const matches: Record<string, RegExp> = {
    "account-access": /\b(sign in|log in|login|create (?:an )?account|join dzn)\b/i,
    "player-stats-link": /\b(link|claim|connect).{0,24}\b(dayz|stats|gamertag|profile)\b|\b(dayz stats|player stats|game stats)\b/i,
    "server-setup": /\b(add|set up|setup|connect|register).{0,30}\b(server|nitrado|adm)\b|\b(add my server|server setup)\b/i,
    "server-owner-discord-access": /\b(server owner|owner access|verified owner|owner role|private owner)\b/i,
    "server-data": /\b(sync|import|server data|missing data|old data|adm files?)\b/i,
    "plans-and-billing": /\b(plan|pricing|refund policy|cancel(?:lation)?|subscription|billing)\b/i,
    "comms-safety": /\b(chat|comms|community rules|report abuse|moderation|safety)\b/i,
    "events-and-leaderboards": /\b(event|competition|tournament)\b/i,
  };
  return matches[guideId]?.test(question) ? 6 : 0;
}

function toWorkflow(guide: DznAssistGuide): DznAssistWorkflow {
  return {
    id: guide.id,
    category: guide.category,
    title: guide.title,
    summary: guide.summary,
    steps: guide.steps,
    links: guide.links,
    nextPrompts: guide.nextPrompts,
  };
}

function nextPromptsFor(workflows: readonly DznAssistWorkflow[]) {
  const prompts = workflows.flatMap((workflow) => workflow.nextPrompts);
  return [...new Set([...prompts, "What should I do next?"])].slice(0, 3);
}

function fallbackReply(): DznAssistReply {
  return {
    kind: "fallback",
    message: "Tell me what you are trying to do and I will point you to the right verified DZN route. I can help with joining DZN, setting up a server, linking DayZ stats, community tools, plans, events, and public standings.",
    links: [],
    workflows: [],
    suggestedPrompts: DEFAULT_PROMPTS,
    guideIds: [],
    wantsRankings: false,
    showPlayers: false,
    showServers: false,
  };
}

function guideTerms(guide: DznAssistGuide) {
  return new Set(tokenize([guide.title, guide.category, ...guide.keywords].join(" ")));
}

function questionTerms(value: string) {
  const terms = tokenize(value).filter((term) => term.length > 1 && !COMMON_QUERY_TERMS.has(term));
  if (/\bset\s+up\b/i.test(value)) terms.push("setup");
  return [...new Set(terms)];
}

function termCounts(guides: readonly DznAssistGuide[]) {
  const counts = new Map<string, number>();
  for (const guide of guides) {
    for (const term of guideTerms(guide)) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return counts;
}

function tokenize(value: string) {
  return value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function parseRows(value: unknown, kind: "player" | "server") {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item, index) => {
    const row = asRecord(item);
    const name = stringValue(row?.[kind === "player" ? "player_name" : "server_name"]);
    if (!name) return [];
    const rank = toPositiveInteger(row?.rank) ?? index + 1;
    const detail = kind === "player"
      ? [stringValue(row?.server_name), numberLabel(row?.kills, "kills"), stringValue(row?.kd_label)].filter(Boolean).join(" · ")
      : [stringValue(row?.mode), numberLabel(row?.score, "score"), numberLabel(row?.unique_players, "players")].filter(Boolean).join(" · ");
    return [{ rank, name: name.slice(0, 100), detail: detail.slice(0, 160) }];
  });
}

function privateSupportLinks(guides: readonly DznAssistGuide[]) {
  const billing = guides.find((guide) => guide.id === "plans-and-billing");
  const account = guides.find((guide) => guide.id === "account-access");
  return [billing?.links[0], account?.links[0]].filter((link): link is DznAssistLink => Boolean(link));
}

function uniqueLinks(links: readonly DznAssistLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => !seen.has(link.href) && Boolean(seen.add(link.href)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function toPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberLabel(value: unknown, label: string) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value).toLocaleString()} ${label}` : "";
}

function normalizedTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}
