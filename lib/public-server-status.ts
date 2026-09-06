type PublicStatusInput = {
  status: string;
  lifecycle?: { historical?: boolean; label?: string };
  is_online: boolean;
  metadata_last_checked_at?: string | null;
  player_count_last_checked_at?: string | null;
};

// Presentation only: lifecycle defaults and saved tokens are not verification evidence.
export function publicServerStatusPresentation(server: PublicStatusInput): {
  label: string;
  tone: "zinc" | "orange" | "emerald";
} {
  if (server.lifecycle?.historical) return { label: server.lifecycle.label ?? "Legacy / Offline", tone: "zinc" };
  if (server.status.toLowerCase() !== "live") return { label: "Setup incomplete", tone: "orange" };
  const checked = [server.metadata_last_checked_at, server.player_count_last_checked_at]
    .some((value) => Boolean(value) && Number.isFinite(Date.parse(value!)));
  if (!checked) return { label: "Status not checked", tone: "zinc" };
  // These timestamps also advance on failures and player-count-only refreshes.
  // There is no separate successful online-status timestamp in this payload.
  return { label: "Status unavailable", tone: "zinc" };
}
