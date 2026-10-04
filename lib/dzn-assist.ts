export type DznAssistLink = { href: string; label: string };

export type DznAssistGuide = {
  id: string;
  category: "Account" | "Players" | "Servers" | "Billing" | "Community";
  title: string;
  summary: string;
  keywords: string[];
  links: DznAssistLink[];
};

export const DZN_ASSIST_GUIDES: DznAssistGuide[] = [
  {
    id: "account-access",
    category: "Account",
    title: "Sign in or open your account",
    summary: "Use Discord sign-in to reach your private Player Hub. Server owners see their owner tools after DZN confirms the Discord account and server association.",
    keywords: ["account", "discord", "login", "log in", "profile", "sign in", "signup"],
    links: [{ href: "/login", label: "Sign in" }, { href: "/player", label: "Open Player Hub" }],
  },
  {
    id: "player-stats-link",
    category: "Players",
    title: "Connect your DayZ stats",
    summary: "Choose the server you play on and submit the exact gamertag shown in its imported leaderboard. The matching owner or a DZN admin must verify the imported game profile before it is linked.",
    keywords: ["claim", "dayz", "game account", "gamertag", "link", "player", "profile", "stats"],
    links: [{ href: "/login?returnTo=%2Fplayer%2Fprofile%23game-account", label: "Link game stats" }, { href: "/player", label: "View Player Hub" }],
  },
  {
    id: "server-setup",
    category: "Servers",
    title: "Add or resume a server setup",
    summary: "Start from the setup page. Saved setup details resume for the same signed-in owner, so check the existing draft before starting another server record.",
    keywords: ["add server", "adm", "draft", "nitrado", "owner", "resume", "server", "setup", "token"],
    links: [{ href: "/setup", label: "Open server setup" }, { href: "/dashboard", label: "Open dashboard" }],
  },
  {
    id: "server-data",
    category: "Servers",
    title: "Check missing or old server data",
    summary: "Open the owner dashboard to review setup, connection and sync status. Imported statistics depend on a completed server connection and supported ADM files; public pages can lag while a sync is still running.",
    keywords: ["adm", "data", "import", "missing", "old", "players", "server", "status", "sync"],
    links: [{ href: "/dashboard", label: "Check server status" }, { href: "/servers", label: "View public servers" }],
  },
  {
    id: "plans-and-billing",
    category: "Billing",
    title: "Plans, payments or cancellation",
    summary: "Compare owner plans on Pricing. Subscription, receipt, cancellation and recovery controls belong to the signed-in account that made the purchase; never share payment details in Global Chat.",
    keywords: ["billing", "cancel", "card", "invoice", "payment", "plan", "price", "receipt", "refund", "subscription"],
    links: [{ href: "/pricing", label: "Compare plans" }, { href: "/refunds", label: "Refund policy" }],
  },
  {
    id: "comms-safety",
    category: "Community",
    title: "Use Global Chat safely",
    summary: "Global Chat is moderated. Sign in with Discord to use enabled member actions, report abuse with the message controls, and never post tokens, payment details or personal information.",
    keywords: ["abuse", "chat", "comms", "discord", "message", "moderation", "report", "safety"],
    links: [{ href: "/community#global-chat", label: "Open Global Chat" }],
  },
  {
    id: "events-and-leaderboards",
    category: "Community",
    title: "Find events and rankings",
    summary: "Use Events for published competitions and Leaderboards for current public rankings. Availability depends on live server data and the rules of each event.",
    keywords: ["competition", "event", "leaderboard", "rank", "ranking", "score", "tournament"],
    links: [{ href: "/events", label: "Browse events" }, { href: "/leaderboards", label: "View leaderboards" }],
  },
];

export const DZN_ASSIST_CATEGORIES = ["All", "Account", "Players", "Servers", "Billing", "Community"] as const;
