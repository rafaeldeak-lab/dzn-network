import { mockNitradoServices } from "./mock";
import type { NitradoService } from "./types";

const NITRADO_API = "https://api.nitrado.net";

type NitradoRawService = {
  id?: number | string;
  service_id?: number | string;
  details?: {
    name?: string;
    game?: string;
    folder_short?: string;
    portlist_short?: string;
    address?: string;
  };
  type?: string;
  status?: string;
  websocket_token?: string;
};

export async function validateNitradoToken(token: string) {
  if (!token || token.length < 12) return false;
  const response = await fetch(`${NITRADO_API}/services`, {
    headers: nitradoHeaders(token),
  });
  return response.ok;
}

export async function fetchNitradoServices(token: string): Promise<NitradoService[]> {
  const response = await fetch(`${NITRADO_API}/services`, {
    headers: nitradoHeaders(token),
  });
  if (!response.ok) throw new Error("Nitrado services fetch failed");
  const payload = (await response.json()) as { data?: { services?: NitradoRawService[] } };
  return normalizeServices(payload.data?.services ?? []).filter(isDayZService);
}

export async function fetchMockNitradoServices() {
  return mockNitradoServices;
}

export function isDayZService(service: NitradoService) {
  const haystack = `${service.name} ${service.game}`.toLowerCase();
  return haystack.includes("dayz") || haystack.includes("day z");
}

function normalizeServices(services: NitradoRawService[]): NitradoService[] {
  return services.map((service) => {
    const details = service.details ?? {};
    const name = details.name || `Nitrado Service ${service.id ?? service.service_id ?? ""}`.trim();
    return {
      id: String(service.id ?? service.service_id ?? ""),
      name,
      game: details.game || details.folder_short || details.portlist_short || service.type || "Unknown",
      region: details.address?.split(":")[0],
    };
  });
}

function nitradoHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
  };
}
