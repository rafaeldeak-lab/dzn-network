export type DznAssistLink = { href: string; label: string };

export type DznAssistGuide = {
  id: string;
  category: "Account" | "Players" | "Servers" | "Billing" | "Community";
  title: string;
  summary: string;
  steps: string[];
  nextPrompts: string[];
  keywords: string[];
  links: DznAssistLink[];
};

export const DZN_ASSIST_GUIDES: DznAssistGuide[] = [
  {
    id: "account-access",
    category: "Account",
    title: "Sign in or open your account",
    summary: "Use Discord sign-in to reach your private Player Hub. Server owners see their owner tools after DZN confirms the Discord account and server association.",
    steps: ["Choose Discord sign-in.", "Return to DZN after Discord confirms your identity.", "Open Player Hub or your owner dashboard."],
    nextPrompts: ["How do I link my DayZ stats?", "How do I add my server?"],
    keywords: ["account", "discord", "login", "log in", "profile", "sign in", "signup"],
    links: [{ href: "/login", label: "Sign in" }, { href: "/player", label: "Open Player Hub" }],
  },
  {
    id: "player-stats-link",
    category: "Players",
    title: "Connect your DayZ stats",
    summary: "Choose the server you play on and submit the exact gamertag shown in its imported leaderboard. The matching owner or a DZN admin must verify the imported game profile before it is linked.",
    steps: ["Sign in with Discord.", "Open your Player Hub and choose the server you play on.", "Enter the exact imported gamertag and wait for verification."],
    nextPrompts: ["Show the top players", "Why are my stats missing?"],
    keywords: ["claim", "dayz", "game account", "gamertag", "link", "player", "profile", "stats"],
    links: [{ href: "/login?returnTo=%2Fplayer%2Fprofile%23game-account", label: "Link game stats" }, { href: "/player", label: "View Player Hub" }],
  },
  {
    id: "server-discovery",
    category: "Players",
    title: "Find a DZN server",
    summary: "Browse the public Servers directory to compare communities that DZN can currently show. Open a server profile before joining and treat current public information as a guide rather than a promise of live availability.",
    steps: ["Open the public Servers directory.", "Choose a listed community and read its current profile information.", "Follow that community's published joining guidance, then link your DayZ stats later if you want a verified player profile."],
    nextPrompts: ["How do I link my DayZ stats?", "Show the top servers"],
    keywords: ["browse", "community", "communities", "directory", "discover", "find", "server"],
    links: [{ href: "/servers", label: "Browse public servers" }, { href: "/leaderboards", label: "View server standings" }],
  },
  {
    id: "server-setup",
    category: "Servers",
    title: "Add or resume a server setup",
    summary: "Start from the setup page. Saved setup details resume for the same signed-in owner, so check the existing draft before starting another server record.",
    steps: ["Sign in with the Discord account that owns the server.", "Open server setup and check for an existing saved draft first.", "Complete the connection details, then monitor the dashboard for its first sync."],
    nextPrompts: ["How do I check my server sync?", "How do I request owner Discord access?"],
    keywords: ["add server", "adm", "draft", "nitrado", "owner", "resume", "server", "setup", "token"],
    links: [{ href: "/setup", label: "Open server setup" }, { href: "/dashboard", label: "Open dashboard" }],
  },
  {
    id: "server-owner-discord-access",
    category: "Servers",
    title: "Request server-owner Discord access",
    summary: "Use an active DZN server linked to your Discord account to request access to the restricted owner area. DZN reviews the exact server before any private Discord invite is created.",
    steps: ["Sign in with the Discord account linked to your active DZN server.", "Open the owner-access request and select the correct server.", "Wait for DZN to review the ownership evidence before an invite is issued."],
    nextPrompts: ["How do I add my server?", "How do I check my server sync?"],
    keywords: ["access", "discord", "invite", "owner", "private", "role", "server owner", "verified"],
    links: [{ href: "/login?returnTo=%2Fdiscord-owner-access", label: "Request owner access" }, { href: "/dashboard", label: "Open dashboard" }],
  },
  {
    id: "server-data",
    category: "Servers",
    title: "Check missing or old server data",
    summary: "Open the owner dashboard to review setup, connection and sync status. Imported statistics depend on a completed server connection and supported ADM files; public pages can lag while a sync is still running.",
    steps: ["Open your signed-in owner dashboard.", "Review the server connection and sync status before changing anything.", "Use the listed diagnostics if a supported ADM import has not completed."],
    nextPrompts: ["How do I add my server?", "Show the top servers"],
    keywords: ["adm", "data", "import", "missing", "old", "players", "server", "status", "sync"],
    links: [{ href: "/dashboard", label: "Check server status" }, { href: "/servers", label: "View public servers" }],
  },
  {
    id: "plans-and-billing",
    category: "Billing",
    title: "Plans, payments or cancellation",
    summary: "Compare owner plans on Pricing. Subscription, receipt, cancellation and recovery controls belong to the signed-in account that made the purchase; never share payment details in Global Chat.",
    steps: ["Compare public plan features and prices.", "Use the signed-in account that made the purchase for billing controls.", "Use the public refund policy before requesting private billing support."],
    nextPrompts: ["Compare DZN plans", "Show the refund policy"],
    keywords: ["billing", "cancel", "card", "invoice", "payment", "plan", "price", "receipt", "refund", "subscription"],
    links: [
      { href: "/login?returnTo=%2Fdashboard", label: "Manage billing" },
      { href: "/pricing", label: "Compare plans" },
      { href: "/refunds", label: "Refund policy" },
    ],
  },
  {
    id: "comms-safety",
    category: "Community",
    title: "Use Global Chat safely",
    summary: "Global Chat is moderated. Sign in with Discord to use enabled member actions, report abuse with the message controls, and never post tokens, payment details or personal information.",
    steps: ["Sign in with Discord before using member chat actions.", "Keep personal information, payment details, and credentials out of public chat.", "Use the report control instead of escalating abuse in the channel."],
    nextPrompts: ["How do I join DZN Discord?", "Show the community rules"],
    keywords: ["abuse", "chat", "comms", "community rules", "discord", "message", "moderation", "report", "rules", "safety"],
    links: [{ href: "/community#global-chat", label: "Open Global Chat" }],
  },
  {
    id: "dzn-updates",
    category: "Community",
    title: "Find verified DZN updates",
    summary: "DZN Updates is the read-only release log for material website, community, player and server-owner changes. It is separate from Global Chat, so official notices never pretend to be player activity.",
    steps: ["Open DZN Updates for the latest verified release notes.", "Use the attached route to open the related DZN area.", "Use Global Chat for player conversation and DZN Assist for guided help."],
    nextPrompts: ["How do I use Global Chat safely?", "How do I add my server?"],
    keywords: ["announcement", "change", "changelog", "latest", "news", "release", "updates", "what is new", "whats new"],
    links: [{ href: "/updates", label: "Open DZN Updates" }, { href: "/community#dzn-updates", label: "Open updates in Comms" }],
  },
  {
    id: "events-and-leaderboards",
    category: "Community",
    title: "Find events and rankings",
    summary: "Use Events for published competitions and Leaderboards for current public rankings. Availability depends on live server data and the rules of each event.",
    steps: ["Open Events to see published competition details.", "Use Leaderboards for the current public standings.", "Check the event rules before joining a competition."],
    nextPrompts: ["Show the top players", "Show the top servers"],
    keywords: ["competition", "event", "leaderboard", "rank", "ranking", "score", "tournament"],
    links: [{ href: "/events", label: "Browse events" }, { href: "/leaderboards", label: "View leaderboards" }],
  },
];

export const DZN_ASSIST_CATEGORIES = ["All", "Account", "Players", "Servers", "Billing", "Community"] as const;
