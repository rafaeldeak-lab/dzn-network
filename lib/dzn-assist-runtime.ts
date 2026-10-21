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

export type DznAssistReply = {
  kind: "boundary" | "guide" | "ranking" | "fallback";
  message: string;
  links: DznAssistLink[];
  wantsRankings: boolean;
  showPlayers: boolean;
  showServers: boolean;
};

type DznAssistOptions = {
  guides?: readonly DznAssistGuide[];
};

const PRIVATE_REQUEST = /\b(account|my account|my payment|my bill|invoice|receipt|card|email address|discord id|token|secret|password|credential|moderation|reporter|ban|appeal|private message|dm|server file)\b/i;
const PLAYER_RANKING_REQUEST = /\b(top|leaderboard|ranking|rankings|ranked|best)\b[\s\S]*\b(player|players|survivor|survivors|kills?)\b|\b(top player|top players|player leaderboard)\b/i;
const SERVER_RANKING_REQUEST = /\b(top|leaderboard|ranking|rankings|ranked|best)\b[\s\S]*\b(server|servers|community|communities)\b|\b(top server|top servers|server leaderboard)\b/i;
const RANKING_REQUEST = /\b(leaderboard|ranking|rankings|ranked)\b|\btop\s*(?:10|ten)\b|\btop\b[\s\S]*\b(player|players|server|servers|community|communities|survivor|survivors|kills?)\b/i;
const COMMON_QUERY_TERMS = new Set(["a", "an", "and", "are", "can", "do", "for", "from", "help", "how", "i", "in", "is", "it", "me", "my", "need", "of", "on", "or", "please", "show", "the", "to", "want", "what", "when", "where", "with", "you", "your"]);
const UNAVAILABLE_LEADERBOARD_SOURCES = new Set(["empty_no_cache", "fallback_empty", "empty_no_db"]);

export function isPublicRankingRequest(question: string) {
  return RANKING_REQUEST.test(question);
}

export function answerDznAssist(question: string, options: DznAssistOptions = {}): DznAssistReply {
  const normalized = question.trim().replace(/\s+/g, " ");
  const guides = options.guides ?? DZN_ASSIST_GUIDES;

  if (!normalized) {
    return {
      kind: "fallback",
      message: "Ask about joining DZN, linking DayZ stats, setting up a server, plans, community tools, or the public top ten.",
      links: [],
      wantsRankings: false,
      showPlayers: false,
      showServers: false,
    };
  }

  if (PRIVATE_REQUEST.test(normalized) && !isPublicRankingRequest(normalized)) {
    return {
      kind: "boundary",
      message: "I cannot view or disclose account, payment, player-private, Discord, moderation, server-file, or credential information. Use the signed-in account controls or private support for that kind of help.",
      links: privateSupportLinks(guides),
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
      message: "I will show only the latest public top-ten standings returned by DZN. I do not expose private profiles, account details, or hidden server data.",
      links: [{ href: "/leaderboards", label: "Open full leaderboards" }],
      wantsRankings: true,
      showPlayers,
      showServers,
    };
  }

  const terms = questionTerms(normalized);
  const guideTermCounts = termCounts(guides);
  const rankedGuides = guides
    .map((guide) => {
      const matches = terms.filter((term) => guideTerms(guide).has(term));
      return {
        guide,
        score: matches.reduce((score, term) => score + (guideTermCounts.get(term) === 1 ? 2 : 1), 0),
        confident: matches.length >= 2 || matches.some((term) => guideTermCounts.get(term) === 1),
      };
    })
    .filter((item) => item.confident)
    .sort((left, right) => right.score - left.score || left.guide.title.localeCompare(right.guide.title));
  const match = rankedGuides[0]?.guide;

  if (match) {
    return {
      kind: "guide",
      message: match.summary,
      links: match.links,
      wantsRankings: false,
      showPlayers: false,
      showServers: false,
    };
  }

  return {
    kind: "fallback",
    message: "I can help with public DZN site navigation, player-stat linking, server setup, plans, community rules, and public standings. For account-specific help, use private support.",
    links: privateSupportLinks(guides),
    wantsRankings: false,
    showPlayers: false,
    showServers: false,
  };
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
