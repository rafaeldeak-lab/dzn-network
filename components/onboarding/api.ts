import type {
  AdmRecentSyncEvent,
  AdmSyncRunResult,
  AdmSyncStatus,
  AuthResponse,
  AdvertisingBumpStatus,
  BillingStatus,
  DiscordGuild,
  LinkedServer,
  NitradoLogAccessDiagnostics,
  NitradoService,
  OnboardingChecks,
} from "./types";

export async function getMe() {
  return request<AuthResponse>("/api/auth/me", { cache: "no-store" });
}

export async function getGuilds(options: { fresh?: boolean } = {}) {
  const query = options.fresh ? "?fresh=1" : "";
  return request<{ guilds: DiscordGuild[]; fetched_at?: string; fresh?: boolean }>(`/api/discord/guilds${query}`);
}

export async function validateNitradoToken(data: {
  token: string;
  discordGuildId: string;
  serverType: string;
  tags: string[];
  serviceId?: string;
}) {
  return request<{ tokenValid: boolean; linkedServerId?: string; service?: NitradoService }>("/api/nitrado/validate-token", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getNitradoServices() {
  return request<{ services: NitradoService[] }>("/api/nitrado/services");
}

export async function saveOnboarding(data: {
  discordGuildId: string;
  serverType: string;
  tags: string[];
  nitradoServiceId: string;
  public_short_description?: string | null;
  public_description?: string | null;
  public_discord_invite?: string | null;
  public_website_url?: string | null;
  public_rules?: string | null;
  public_language?: string | null;
  public_region_label?: string | null;
}) {
  return request<{ ok: boolean; linkedServerId: string }>("/api/onboarding/save", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateServerPublicListing(linkedServerId: string, data: {
  public_short_description?: string | null;
  public_description?: string | null;
  public_discord_invite?: string | null;
  public_website_url?: string | null;
  public_rules?: string | null;
  public_language?: string | null;
  public_region_label?: string | null;
}) {
  return request<{ ok: boolean; listing: Partial<LinkedServer> }>(`/api/servers/${encodeURIComponent(linkedServerId)}/public-listing`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getBillingStatus() {
  return request<BillingStatus>("/api/billing/status");
}

export async function createCheckoutSession(planKey: "starter" | "pro" | "network" | "partner", returnTo = "/dashboard") {
  return request<{ url: string }>("/api/billing/create-checkout-session", {
    method: "POST",
    body: JSON.stringify({ plan_key: planKey, returnTo }),
  });
}

export async function createPortalSession() {
  return request<{ url: string }>("/api/billing/create-portal-session", {
    method: "POST",
  });
}

export async function bumpServer(linkedServerId: string) {
  return request<{ ok: boolean; advertising: AdvertisingBumpStatus }>(`/api/servers/${encodeURIComponent(linkedServerId)}/advertising/bump`, {
    method: "POST",
  });
}

export async function getServerAdvertisingStatus(linkedServerId: string) {
  return request<{ ok: boolean; advertising: AdvertisingBumpStatus }>(`/api/servers/${encodeURIComponent(linkedServerId)}/advertising/bump`);
}

export async function testOnboarding() {
  return request<{
    ok: boolean;
    checks: OnboardingChecks;
  }>("/api/onboarding/test", { method: "POST" });
}

export async function testAdmPath(path: string) {
  return request<{
    ok: boolean;
    checks: OnboardingChecks;
  }>("/api/nitrado/test-adm-path", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export async function getSyncStatus(linkedServerId?: string) {
  const query = linkedServerId ? `?linked_server_id=${encodeURIComponent(linkedServerId)}` : "";
  return request<{ status: AdmSyncStatus }>(`/api/sync/status${query}`);
}

export async function getRecentSyncEvents(linkedServerId?: string) {
  const query = linkedServerId ? `?linked_server_id=${encodeURIComponent(linkedServerId)}` : "";
  return request<{ events: AdmRecentSyncEvent[] }>(`/api/sync/recent-events${query}`);
}

export async function runLogAccessDiagnostics() {
  return request<{ diagnostics: NitradoLogAccessDiagnostics }>("/api/nitrado/log-access-diagnostics");
}

export async function runManualSync(linkedServerId?: string) {
  return request<AdmSyncRunResult>("/api/sync/run", {
    method: "POST",
    body: JSON.stringify(linkedServerId ? { linked_server_id: linkedServerId } : {}),
  });
}

export async function refreshServerMetadata(linkedServerId: string) {
  return request<{
    ok: boolean;
    changed: boolean;
    skipped?: boolean;
    message: string;
    metadata_last_checked_at?: string | null;
    metadata_last_changed_at?: string | null;
    metadata_source?: string | null;
    metadata?: Partial<LinkedServer> & {
      metadata_source?: string | null;
      changed_fields?: string[];
    };
  }>(`/api/servers/${encodeURIComponent(linkedServerId)}/refresh-metadata`, {
    method: "POST",
    cache: "no-store",
  });
}

export async function clearMockTestSyncData(linkedServerId?: string) {
  return request<{ ok: boolean; remainingRows: number }>("/api/sync/clear-test-data", {
    method: "POST",
    body: JSON.stringify(linkedServerId ? { linked_server_id: linkedServerId } : {}),
  });
}

export async function clearOldFailedSyncRuns(linkedServerId?: string) {
  return request<{ ok: boolean; deletedCount: number }>("/api/sync/clear-failed-runs", {
    method: "POST",
    body: JSON.stringify(linkedServerId ? { linked_server_id: linkedServerId } : {}),
  });
}

export async function deleteLinkedServer(data: {
  linkedServerId: string;
  confirmationText: string;
  finalConfirmed: boolean;
}) {
  return request<DeletionResponse>("/api/server/delete", {
    method: "POST",
    body: JSON.stringify({
      linked_server_id: data.linkedServerId,
      confirmation_text: data.confirmationText,
      final_confirmed: data.finalConfirmed,
    }),
  });
}

export async function deleteAccount(data: {
  confirmationText: string;
  finalConfirmed: boolean;
}) {
  return request<DeletionResponse>("/api/account/delete", {
    method: "POST",
    body: JSON.stringify({
      confirmation_text: data.confirmationText,
      final_confirmed: data.finalConfirmed,
    }),
  });
}

export async function goLive() {
  return request<{ ok: boolean; status: "live" }>("/api/onboarding/go-live", {
    method: "POST",
  });
}

export async function logout() {
  return request<{ ok: boolean; redirect?: string }>("/api/auth/logout", { method: "POST" });
}

export function clearClientAuthState() {
  if (typeof window === "undefined") return;

  const keys = ["active_server", "dzn_auth", "dzn_user", "dzn_session", "auth", "user"];
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      for (const key of keys) {
        storage.removeItem(key);
      }
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }
}

export async function logoutAndRedirect() {
  await logout().catch(() => null);
  clearClientAuthState();
  window.location.href = "/";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    cache: init.cache ?? "no-store",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export type DeletionResponse = {
  ok: boolean;
  redirectTarget: string;
  message: string;
  deleted: {
    linkedServers: number;
    serverStats: number;
    playerProfiles: number;
    playerEvents: number;
    killEvents: number;
    admRawEvents: number;
    admSyncState?: number;
    syncRuns: number;
    sessions: number;
    nitradoConnections?: number;
    onboardingChecks?: number;
    serverLogConfig?: number;
    serverMetadataVersions?: number;
    serverSlugAliases?: number;
    discordGuilds?: number;
    users?: number;
  };
};
