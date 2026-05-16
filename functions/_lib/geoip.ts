const GEO_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_GEOIP_ENDPOINT = "https://ipapi.co";

export type ServerGeoLocation = {
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  source: string;
  approximate: boolean;
};

export type ServerGeoFields = {
  ip_address?: string | null;
  geo_latitude?: number | null;
  geo_longitude?: number | null;
  geo_last_checked_at?: string | null;
};

type GeoLookupOptions = {
  regionHint?: string | null;
  endpoint?: string | null;
  fetcher?: typeof fetch;
};

type GeoIpPayload = {
  error?: boolean;
  reason?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  country_name?: string | null;
  country?: string | null;
  region?: string | null;
  region_name?: string | null;
  city?: string | null;
  timezone?: string | null;
};

export async function geolocateServerIp(ip: string | null | undefined, options: GeoLookupOptions = {}): Promise<ServerGeoLocation> {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return fallbackLocation(options.regionHint, "invalid");
  if (!isPublicIpv4(normalizedIp)) return fallbackLocation(options.regionHint, "private");

  const endpoint = (options.endpoint ?? DEFAULT_GEOIP_ENDPOINT).replace(/\/+$/, "");
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetcher(`${endpoint}/${encodeURIComponent(normalizedIp)}/json/`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return fallbackLocation(options.regionHint, "geoip-unavailable");
    const payload = (await response.json().catch(() => null)) as GeoIpPayload | null;
    if (!payload || payload.error) return fallbackLocation(options.regionHint, "geoip-unavailable");

    const latitude = finiteNumber(payload.latitude);
    const longitude = finiteNumber(payload.longitude);
    if (latitude === null || longitude === null) return fallbackLocation(options.regionHint, "geoip-unavailable");

    return {
      latitude: clamp(latitude, -90, 90),
      longitude: clamp(longitude, -180, 180),
      country: cleanText(payload.country_name ?? payload.country),
      region: cleanText(payload.region ?? payload.region_name),
      city: cleanText(payload.city),
      timezone: cleanText(payload.timezone),
      source: "ipapi",
      approximate: false,
    };
  } catch {
    return fallbackLocation(options.regionHint, "geoip-unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export function shouldRefreshServerGeo(row: ServerGeoFields, nextIp: string | null | undefined, now = Date.now()) {
  const currentIp = normalizeIp(row.ip_address);
  const normalizedNext = normalizeIp(nextIp);
  if (!normalizedNext || !isPublicIpv4(normalizedNext)) {
    return row.geo_latitude !== null || row.geo_longitude !== null || !row.geo_last_checked_at;
  }
  if (currentIp !== normalizedNext) return true;
  if (!Number.isFinite(Number(row.geo_latitude)) || !Number.isFinite(Number(row.geo_longitude))) return true;
  if (!row.geo_last_checked_at) return true;
  const checkedAt = Date.parse(row.geo_last_checked_at);
  return !Number.isFinite(checkedAt) || now - checkedAt > GEO_STALE_MS;
}

export function normalizeIp(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "localhost") return null;
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const host = withoutProtocol.startsWith("[")
    ? withoutProtocol.slice(1).split("]")[0]
    : withoutProtocol.split("/")[0]?.split(":")[0];
  if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.join(".");
}

export function isPublicIpv4(ip: string) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const [a, b] = normalized.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 88) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

export function fallbackLocation(regionHint: string | null | undefined, reason = "region-fallback"): ServerGeoLocation {
  const region = cleanText(regionHint);
  const location = approximateRegionCoordinates(region);
  if (!location) {
    return {
      latitude: null,
      longitude: null,
      country: null,
      region,
      city: null,
      timezone: null,
      source: reason,
      approximate: true,
    };
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    country: location.country,
    region: location.label,
    city: null,
    timezone: null,
    source: "region-fallback",
    approximate: true,
  };
}

export function locationLabel(location: Pick<ServerGeoLocation, "city" | "region" | "country" | "approximate">) {
  const parts = [location.city, location.region, location.country]
    .map((value) => cleanText(value))
    .filter((value): value is string => Boolean(value));
  const label = parts.length > 0 ? dedupe(parts).join(", ") : null;
  if (!label) return location.approximate ? "Approx. region" : "Location available";
  return location.approximate ? `Approx. region: ${label}` : label;
}

function approximateRegionCoordinates(value: string | null) {
  const text = ` ${value?.toLowerCase() ?? ""} `;
  if (!text.trim()) return null;
  const checks: Array<{ terms: string[]; latitude: number; longitude: number; label: string; country: string | null }> = [
    { terms: ["united kingdom", "great britain", " gb ", " uk ", "london", "england", "scotland", "wales"], latitude: 54.3, longitude: -2.5, label: "United Kingdom", country: "United Kingdom" },
    { terms: ["eu-west", "europe", " eu ", "germany", "deutschland", "berlin", "frankfurt", "france", "spain", "italy", "netherlands", "poland"], latitude: 50.8, longitude: 10.2, label: "Europe", country: null },
    { terms: ["north america", " usa", " us ", "united states", "america", "canada", "mexico", "us-east", "us-west"], latitude: 39.5, longitude: -98.35, label: "North America", country: null },
    { terms: ["south america", "brazil", "argentina", "chile"], latitude: -15.7, longitude: -58.4, label: "South America", country: null },
    { terms: ["asia", "singapore", "japan", "korea", "china", "india"], latitude: 32.4, longitude: 88.2, label: "Asia", country: null },
    { terms: ["oceania", "australia", "sydney", "new zealand"], latitude: -25.3, longitude: 134.5, label: "Oceania", country: null },
  ];
  return checks.find((check) => check.terms.some((term) => text.includes(term))) ?? null;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dedupe(values: string[]) {
  return values.filter((value, index) => values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
}
