import type { AuthResponse, DiscordGuild, NitradoService } from "./types";

export async function getMe() {
  return request<AuthResponse>("/api/auth/me");
}

export async function getGuilds() {
  return request<{ guilds: DiscordGuild[] }>("/api/discord/guilds");
}

export async function validateNitradoToken(token: string) {
  return request<{ tokenValid: boolean }>("/api/nitrado/validate-token", {
    method: "POST",
    body: JSON.stringify({ token }),
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
  return request<{ ok: boolean; linkedServerId: number }>("/api/onboarding/save", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function testOnboarding() {
  return request<{
    ok: boolean;
    checks: {
      tokenValid: boolean;
      serviceAccess: boolean;
      admLogsFound: boolean;
      dayzServiceDetected: boolean;
    };
  }>("/api/onboarding/test", { method: "POST" });
}

export async function goLive() {
  return request<{ ok: boolean; status: "Live" }>("/api/onboarding/go-live", {
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
