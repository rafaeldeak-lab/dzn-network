type GameplaySummary = {
  visible: boolean;
  totals: {
    kills: number;
    deaths: number;
    suicides: number;
    longest_kill_distance: number;
    linked_public_servers: number;
  } | null;
};

// Use the same missing/hidden distinction on the visitor page and its owner preview.
export function publicGameplayPresentation(summary: GameplaySummary) {
  const totals = summary.visible ? summary.totals : null;
  const status = !summary.visible ? "hidden" : !totals ? "unavailable" : totals.linked_public_servers > 0 ? "available" : "empty";
  const placeholder = status === "hidden" ? "Hidden" : "--";
  const hasStats = status === "available" && totals !== null;
  return {
    status,
    message: status === "hidden" ? "Gameplay totals are hidden."
      : status === "unavailable" ? "Server stats are not available right now."
      : status === "empty" ? "No linked server stats yet."
      : "Stats from linked public servers.",
    publicServers: hasStats ? String(totals.linked_public_servers) : placeholder,
    kills: hasStats ? String(totals.kills) : placeholder,
    deaths: hasStats ? String(totals.deaths) : placeholder,
    suicides: hasStats ? String(totals.suicides) : placeholder,
    longest: hasStats ? `${Number.isFinite(totals.longest_kill_distance) ? Math.max(0, Math.round(totals.longest_kill_distance)) : 0}m` : placeholder,
  };
}
