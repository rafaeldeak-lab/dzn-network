import type {
  AdmRecentSyncEvent,
  AdmSyncRunResult,
  AdmSyncStatus,
  AuthResponse,
  DiscordGuild,
  NitradoLogAccessDiagnostics,
  NitradoService,
  OnboardingChecks,
} from "./types";

export async function getMe() {
  return request<AuthResponse>("/api/auth/me");
}

export async function getGuilds() {
  return request<{ guilds: DiscordGuild[] }>("/api/discord/guilds");
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
}) {
  return request<{ ok: boolean; linkedServerId: string }>("/api/onboarding/save", {
    method: "POST",
    body: JSON.stringify(data),
  });
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

export async function goLive() {
  return request<{ ok: boolean; status: "live" }>("/api/onboarding/go-live", {
    method: "POST",
  });
}

export async function logout() {
  return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
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
