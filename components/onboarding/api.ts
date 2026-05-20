import type {
  AdmRecentSyncEvent,
  AdmSyncRunResult,
  AdmSyncStatus,
  AdmFileDiscoveryDebug,
  AuthResponse,
  AdvertisingBumpStatus,
  AutomationHealth,
  BillingPlanSummary,
  BillingStatus,
  DiscordBotStatusResponse,
  DiscordGuild,
  DiscordChannelsResponse,
  LinkedServer,
  NitradoLogSettingsCheckResponse,
  NitradoLogSettingsConfirmation,
  NitradoLogAccessDiagnostics,
  NitradoService,
  OnboardingChecks,
  PostingPermissionCheck,
  PostingDestinationsResponse,
  PostingTestPostResult,
  AutoPostDispatchNowResult,
  PublicCacheDebug,
  PublicCacheRebuildResult,
  SyncLockRecoveryResult,
  ManualAdmImportApiResult,
  BulkAdmImportApiResult,
  AdmImportJobApiResult,
  ManualAdmParsePreviewApiResult,
} from "./types";

export async function getMe() {
  return request<AuthResponse>("/api/auth/me", { cache: "no-store" });
}

export async function getGuilds(options: { fresh?: boolean } = {}) {
  const query = options.fresh ? "?fresh=1" : "";
  return request<{ guilds: DiscordGuild[]; fetched_at?: string; fresh?: boolean }>(`/api/discord/guilds${query}`);
}

export async function getDiscordBotStatus(guildId: string) {
  return request<DiscordBotStatusResponse>(`/api/discord/bot-status?guild_id=${encodeURIComponent(guildId)}`, {
    cache: "no-store",
  });
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

export async function getBillingPlans() {
  return request<{ plans: BillingPlanSummary[] }>("/api/billing/plans");
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

export async function getNitradoLogSettings(linkedServerId: string, options: { check?: boolean } = {}) {
  const query = options.check ? "?check=1" : "";
  return request<NitradoLogSettingsCheckResponse>(`/api/servers/${encodeURIComponent(linkedServerId)}/nitrado-log-settings${query}`, {
    cache: "no-store",
  });
}

export async function getAdmFileDiscoveryDebug(linkedServerId: string, options: { knownLatestFile?: string } = {}) {
  const query = options.knownLatestFile ? `?known_latest_file=${encodeURIComponent(options.knownLatestFile)}` : "";
  return request<AdmFileDiscoveryDebug>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm-file-discovery/debug${query}`, {
    cache: "no-store",
  });
}

export async function saveNitradoLogSettings(linkedServerId: string, data: NitradoLogSettingsConfirmation) {
  return request<{ ok: boolean; settings: NitradoLogSettingsConfirmation }>(`/api/servers/${encodeURIComponent(linkedServerId)}/nitrado-log-settings`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function runManualSync(linkedServerId?: string) {
  return request<AdmSyncRunResult>("/api/sync/adm/run", {
    method: "POST",
    body: JSON.stringify(linkedServerId ? { linked_server_id: linkedServerId } : {}),
  });
}

export async function importManualAdmText(linkedServerId: string, data: {
  filename: string;
  admText: string;
  source?: "manual_paste" | "manual_upload" | string;
}) {
  return manualAdmRequest<ManualAdmImportApiResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm/manual-import`, data);
}

export async function previewManualAdmText(linkedServerId: string, data: {
  filename: string;
  admText: string;
}) {
  return manualAdmRequest<ManualAdmParsePreviewApiResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm/parse-preview`, data);
}

export async function bulkImportAdmFiles(linkedServerId: string, data: {
  files: Array<{ filename: string; admText: string }>;
  source?: "manual_file_upload" | "manual_paste" | string;
  preview?: boolean;
}) {
  const query = data.preview ? "?preview=1" : "";
  return manualAdmRequest<BulkAdmImportApiResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm/bulk-import${query}`, data);
}

export async function startAdmImportJob(linkedServerId: string, data: {
  filename: string;
  totalLines: number;
  totalChunks: number;
  chunkSize: number;
  source?: "manual_file_upload" | "manual_paste" | string;
  importHitLines?: boolean;
}) {
  return manualAdmRequest<AdmImportJobApiResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm/import-job/start`, data);
}

export async function sendAdmImportJobChunk(linkedServerId: string, data: {
  jobId: string;
  filename: string;
  chunkIndex: number;
  startLine: number;
  lines: string[];
  previousLines?: string[];
}) {
  return manualAdmRequest<AdmImportJobApiResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm/import-job/chunk`, data);
}

export async function finishAdmImportJob(linkedServerId: string, jobId: string) {
  return manualAdmRequest<AdmImportJobApiResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm/import-job/finish`, { jobId });
}

export async function retryAdmImportJob(linkedServerId: string, jobId: string) {
  return manualAdmRequest<AdmImportJobApiResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm/import-job/retry`, { jobId });
}

export async function forceProcessLatestAdm(linkedServerId: string) {
  return request<(AdmSyncRunResult & { ok?: true }) | { ok: false; error_code: string; message: string; details?: unknown }>(`/api/servers/${encodeURIComponent(linkedServerId)}/adm/force-latest`, {
    method: "POST",
    cache: "no-store",
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
    player_count_last_checked_at?: string | null;
    player_count_source?: string | null;
    player_count_status?: string | null;
    metadata?: Partial<LinkedServer> & {
      metadata_source?: string | null;
      player_count_last_checked_at?: string | null;
      player_count_source?: string | null;
      player_count_status?: string | null;
      changed_fields?: string[];
    };
  }>(`/api/servers/${encodeURIComponent(linkedServerId)}/refresh-metadata`, {
    method: "POST",
    cache: "no-store",
  });
}

export async function getPostingDestinations(linkedServerId: string) {
  return request<PostingDestinationsResponse>(`/api/servers/${encodeURIComponent(linkedServerId)}/posting-destinations`, {
    cache: "no-store",
  });
}

export async function savePostingDestination(linkedServerId: string, data: {
  action?: "save" | "test" | "disable" | "delete";
  channel_id?: string;
  post_types?: string[];
  test_post_type?: string;
  post_type?: string;
  discord_channel_id?: string;
  discord_webhook_url?: string | null;
  enabled: boolean;
  send_test_post?: boolean;
}) {
  return request<PostingDestinationsResponse & { permission_check?: PostingPermissionCheck; test_post?: PostingTestPostResult | null }>(`/api/servers/${encodeURIComponent(linkedServerId)}/posting-destinations`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function runAutoPostDispatcherNow(linkedServerId: string) {
  return request<AutoPostDispatchNowResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/auto-posts/run-now`, {
    method: "POST",
  });
}

export async function getDiscordPostingChannels(linkedServerId: string) {
  const response = await fetch(`/api/servers/${encodeURIComponent(linkedServerId)}/discord-channels`, {
    cache: "no-store",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
  });
  const data = (await response.json().catch(() => ({}))) as DiscordChannelsResponse & { error?: string };
  if (!response.ok && !data.diagnostics && !data.error_code && !data.errorCode) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export async function getAutomationHealth() {
  return request<AutomationHealth>("/api/automation/health", { cache: "no-store" });
}

export async function getPublicCacheDebug(linkedServerId: string) {
  return request<PublicCacheDebug>(`/api/servers/${encodeURIComponent(linkedServerId)}/public-cache/debug`, { cache: "no-store" });
}

export async function rebuildPublicCache(linkedServerId: string) {
  return request<PublicCacheRebuildResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/public-cache/rebuild`, {
    method: "POST",
  });
}

export async function recoverStuckSyncLocks(linkedServerId: string) {
  return request<SyncLockRecoveryResult>(`/api/servers/${encodeURIComponent(linkedServerId)}/sync/recover-locks`, {
    method: "POST",
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

async function manualAdmRequest<T extends { ok: boolean; http_status?: number; response_body?: string }>(path: string, data: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(path, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    });
    const responseBody = await response.text();
    const parsed = parseJsonBody(responseBody);
    if (parsed && typeof parsed === "object") {
      return {
        ...(parsed as T),
        http_status: response.status,
        response_body: responseBody,
      };
    }
    return {
      ok: false,
      http_status: response.status,
      response_body: responseBody,
      error_code: response.ok ? "invalid_json_response" : "request_failed",
      message: response.ok ? "The ADM import endpoint returned an invalid JSON response." : `Request failed: ${response.status}`,
      details: responseBody,
    } as unknown as T;
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      http_status: 0,
      response_body: "",
      error_code: aborted ? "request_timeout" : "fetch_failed",
      message: aborted ? "Manual ADM import timed out before the server returned a response." : error instanceof Error ? error.message : "Manual ADM import request failed.",
      details: error instanceof Error ? error.message : String(error),
    } as unknown as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseJsonBody(value: string) {
  try {
    return value ? JSON.parse(value) as unknown : null;
  } catch {
    return null;
  }
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
