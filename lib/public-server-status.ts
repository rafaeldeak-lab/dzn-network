type PublicStatusInput = {
  status: string;
  lifecycle?: { historical?: boolean; label?: string };
  server_status?: string | null;
  is_online: boolean;
  metadata_last_checked_at?: string | null;
  player_count_last_checked_at?: string | null;
  player_count_status?: string | null;
};

// Presentation only: lifecycle defaults and saved tokens are not verification evidence.
export function publicServerStatusPresentation(server: PublicStatusInput): {
  label: string;
  tone: "zinc" | "orange" | "emerald";
} {
  if (server.lifecycle?.historical) return { label: server.lifecycle.label ?? "Legacy / Offline", tone: "zinc" };
  if (server.status.toLowerCase() !== "live") return { label: "Setup incomplete", tone: "orange" };

  // Player-count refreshes can fail independently and only advance their own
  // timestamp. Public state therefore requires the successful metadata timestamp.
  if (!isValidTimestamp(server.metadata_last_checked_at)) return { label: "Status not checked", tone: "zinc" };

  const status = server.server_status?.trim().toLowerCase();
  if (server.is_online && isOnlineStatus(status)) return { label: "Online", tone: "emerald" };
  if (!server.is_online && isOfflineStatus(status)) return { label: "Offline", tone: "zinc" };

  // A retained boolean, an unknown provider state, or contradictory values are
  // not sufficient evidence for a public online/offline claim.
  return { label: "Status unavailable", tone: "zinc" };
}

function isValidTimestamp(value: string | null | undefined) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isOnlineStatus(value: string | undefined) {
  return value === "started" || value === "running" || value === "online" || value === "active";
}

function isOfflineStatus(value: string | undefined) {
  return value === "stopped" || value === "offline" || value === "shutdown" || value === "terminated";
}
