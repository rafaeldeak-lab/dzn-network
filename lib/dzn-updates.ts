export type DznUpdateAudience = "Everyone" | "Players" | "Server owners";
export type DznUpdateCategory = "Community" | "Website" | "Games" | "Servers";

export type DznOfficialUpdate = {
  id: string;
  publishedAt: string;
  audience: DznUpdateAudience;
  category: DznUpdateCategory;
  title: string;
  summary: string;
  href: string;
};

// This is the source-controlled public release log. A material player or
// server-owner change is added here with the same reviewed website release;
// it is deliberately separate from player conversation and private notices.
export const DZN_OFFICIAL_UPDATES: readonly DznOfficialUpdate[] = [
  {
    id: "global-chat-english-only-safety",
    publishedAt: "2026-10-23",
    audience: "Everyone",
    category: "Community",
    title: "Global Chat English-only safety has been strengthened",
    summary: "Global Chat now has stronger English-only and abuse controls before messages are posted. A small set of common safe greetings can be converted locally into English, while known unsupported foreign phrases are rejected.",
    href: "/community#global-chat",
  },
  {
    id: "dzn-assist-saved-conversations",
    publishedAt: "2026-10-23",
    audience: "Everyone",
    category: "Website",
    title: "DZN Assist now keeps conversations on this device",
    summary: "DZN Assist can recall a recent support conversation on the same device, so players can return to useful guidance without turning it into a public chat record or exposing private account data.",
    href: "/community#dzn-assist",
  },
  {
    id: "dzn-assist-verified-server-guidance",
    publishedAt: "2026-10-23",
    audience: "Everyone",
    category: "Servers",
    title: "DZN Assist can guide players to verified servers",
    summary: "Ask DZN Assist how to find or join a server for direct guidance to verified public DZN server information. It does not expose private player, owner, billing or Discord details.",
    href: "/community#dzn-assist",
  },
  {
    id: "global-chat-earlier-history",
    publishedAt: "2026-10-23",
    audience: "Everyone",
    category: "Community",
    title: "Global Chat can now load earlier public messages",
    summary: "Players can load earlier Global Chat history when it is available, while the official DZN Updates channel remains read-only and separate from player conversation.",
    href: "/community#global-chat",
  },
  {
    id: "official-comms-updates-channel",
    publishedAt: "2026-10-21",
    audience: "Everyone",
    category: "Community",
    title: "Official DZN Updates now have their own Comms channel",
    summary: "Major DZN website and community changes are published here as verified release notes. Global Chat stays for real player conversation, not automated filler.",
    href: "/community#dzn-updates",
  },
  {
    id: "dzn-assist-conversation-improvements",
    publishedAt: "2026-10-21",
    audience: "Everyone",
    category: "Website",
    title: "DZN Assist now supports guided conversations",
    summary: "Ask a question, continue with a follow-up, open a verified DZN route, or request current public leaderboards. Private account, payment, player and server data stays protected.",
    href: "/community#dzn-assist",
  },
  {
    id: "games-hub-development-notice",
    publishedAt: "2026-10-21",
    audience: "Players",
    category: "Games",
    title: "Games Hub is in active development",
    summary: "DZN is improving its games in focused releases. Finished changes will be announced here when they are ready to play, rather than being presented as complete early.",
    href: "/games",
  },
  {
    id: "games-hub-maintenance-window",
    publishedAt: "2026-10-22",
    audience: "Players",
    category: "Games",
    title: "Games Hub is temporarily closed for maintenance",
    summary: "DZN is rebuilding the arcade before the next public opening. Existing verified player records remain protected, and completed game releases will be announced here when they are ready to play.",
    href: "/games",
  },
] as const;

export function officialDznUpdates() {
  return DZN_OFFICIAL_UPDATES
    .map((update, index) => ({ update, index }))
    .sort((left, right) => Date.parse(right.update.publishedAt) - Date.parse(left.update.publishedAt) || left.index - right.index)
    .map(({ update }) => update);
}

export function formatDznUpdateDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
