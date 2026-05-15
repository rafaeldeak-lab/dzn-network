export const navItems = [
  { label: "Features", href: "#features" },
  { label: "Leaderboards", href: "/leaderboards" },
  { label: "Servers", href: "/servers" },
  { label: "Modes", href: "#modes" },
  { label: "Community", href: "#community" },
];

export const serverStats = [
  {
    label: "Players seen",
    value: "Live",
    detail: "from public sync data",
    icon: "Users",
    trend: "D1",
  },
  {
    label: "Servers linked",
    value: "Live",
    detail: "connected DayZ communities",
    icon: "Server",
    trend: "D1",
  },
  {
    label: "Kills tracked",
    value: "Live",
    detail: "confirmed PvP kills",
    icon: "Crosshair",
    trend: "D1",
  },
  {
    label: "Active servers",
    value: "Live",
    detail: "sync engine online",
    icon: "Shield",
    trend: "D1",
  },
];

export const leaderboardRows = [
  {
    rank: 1,
    player: "Warlords Network",
    faction: "Server Rank",
    kd: "0.00",
    kills: "0",
    score: "Pending",
    accent: "text-orange-300",
  },
  {
    rank: 2,
    player: "Outbreak RP",
    faction: "Server Rank",
    kd: "0.00",
    kills: "0",
    score: "Pending",
    accent: "text-violet-300",
  },
  {
    rank: 3,
    player: "Rogue Survival",
    faction: "Server Rank",
    kd: "0.00",
    kills: "0",
    score: "Pending",
    accent: "text-sky-300",
  },
  {
    rank: 4,
    player: "DeadZone EU",
    faction: "Server Rank",
    kd: "0.00",
    kills: "0",
    score: "Pending",
    accent: "text-emerald-300",
  },
  {
    rank: 5,
    player: "Last Haven",
    faction: "Server Rank",
    kd: "0.00",
    kills: "0",
    score: "Pending",
    accent: "text-rose-300",
  },
];

export const gameModes = [
  {
    title: "PvP",
    icon: "Swords",
    description:
      "Open-world survival servers with clan wars, territorial claims, and ruthless extraction routes.",
    stat: "148 live servers",
    glow: "from-red-500/24 via-orange-500/10 to-transparent",
  },
  {
    title: "Deathmatch",
    icon: "Skull",
    description:
      "Fast-cycle arenas, instant loadouts, heatmaps, and global frag leaderboards for pure combat.",
    stat: "72 active arenas",
    glow: "from-sky-500/24 via-blue-500/10 to-transparent",
  },
  {
    title: "PvE",
    icon: "Shield",
    description:
      "Story-led survival, fortified trader hubs, co-op expeditions, and long-form progression.",
    stat: "54 campaign worlds",
    glow: "from-emerald-500/22 via-teal-500/10 to-transparent",
  },
  {
    title: "PvP / PvE",
    icon: "Crosshair",
    description:
      "Hybrid shards with protected zones, contested objectives, and rotating high-risk events.",
    stat: "38 hybrid servers",
    glow: "from-violet-500/26 via-fuchsia-500/10 to-transparent",
  },
];

export const features = [
  {
    title: "Global Leaderboards",
    icon: "Trophy",
    description:
      "Rank connected servers by kills, K/D, activity, longest kills, and season reputation.",
  },
  {
    title: "Faction Wars",
    icon: "Swords",
    description:
      "Track territory claims, base raids, ceasefires, objective captures, and faction-wide momentum.",
  },
  {
    title: "Server Analytics",
    icon: "Activity",
    description:
      "See population curves, kill zones, retention trends, event impact, and queue pressure in real time.",
  },
  {
    title: "Server Vs Server Events",
    icon: "Eye",
    description:
      "Monthly server wars, seasonal stat battles, and live leaderboard events are coming soon.",
  },
  {
    title: "Live Events",
    icon: "Flame",
    description:
      "Broadcast convoy ambushes, radiation surges, loot drops, and faction objectives as they unfold.",
  },
  {
    title: "Server Discovery",
    icon: "Globe2",
    description:
      "Find the right shard by mode, region, population, modset, wipe schedule, and community style.",
  },
];

export const activityFeed = [
  {
    title: "Warlords PvP captured North Point",
    meta: "5m ago",
    icon: "Flag",
    tone: "text-red-300",
  },
  {
    title: "Waiting for first PvP kill",
    meta: "10m ago",
    icon: "Skull",
    tone: "text-zinc-100",
  },
  {
    title: "Outbreak PvE reached 50 players",
    meta: "15m ago",
    icon: "Users",
    tone: "text-sky-300",
  },
  {
    title: "New server Apocalypse DM joined the network",
    meta: "22m ago",
    icon: "Radio",
    tone: "text-violet-300",
  },
  {
    title: "DeathDealer is on a 10 killstreak",
    meta: "30m ago",
    icon: "Flame",
    tone: "text-orange-300",
  },
];

export const communityStats = [
  { value: "Live", label: "connected servers" },
  { value: "Live", label: "active sync servers" },
  { value: "Live", label: "players seen" },
];
