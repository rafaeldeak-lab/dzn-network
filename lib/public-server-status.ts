type PublicStatusInput = {
  status: string;
  lifecycle?: { historical?: boolean; label?: string };
  is_online: boolean;
  metadata_last_checked_at?: string | null;
  player_count_last_checked_at?: string | null;
  server_status_confirmed_at?: string | null;
};

const SERVER_STATUS_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

function hasFreshStatusEvidence(value: string | null | undefined, now: number) {
  if (!value) return false;
  const confirmedAt = Date.parse(value);
  return Number.isFinite(confirmedAt) && confirmedAt <= now && now - confirmedAt <= SERVER_STATUS_EVIDENCE_MAX_AGE_MS;
}

// Presentation only: lifecycle defaults and saved tokens are not verification evidence.
export function publicServerStatusPresentation(server: PublicStatusInput): {
  label: string;
  tone: "zinc" | "orange" | "emerald";
} {
  if (server.lifecycle?.historical) return { label: server.lifecycle.label ?? "Legacy / Offline", tone: "zinc" };
  if (server.status.toLowerCase() !== "live") return { label: "Setup incomplete", tone: "orange" };
  if (hasFreshStatusEvidence(server.server_status_confirmed_at, Date.now())) {
    return server.is_online ? { label: "Online", tone: "emerald" } : { label: "Offline", tone: "zinc" };
  }
  const checked = [server.metadata_last_checked_at, server.player_count_last_checked_at]
    .some((value) => Boolean(value) && Number.isFinite(Date.parse(value!)));
  if (!checked) return { label: "Status not checked", tone: "zinc" };
  // These timestamps also advance on failures and player-count-only refreshes.
  // An expired or missing confirmation therefore cannot be presented as Online.
  return { label: "Status unavailable", tone: "zinc" };
}
