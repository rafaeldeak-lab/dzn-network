import { mockNitradoServices } from "./mock";
import type { NitradoService } from "./types";

const NITRADO_API = "https://api.nitrado.net";
const ADM_SEARCH_DIRS = [
  "dayzps/config",
  "dayzps",
  "dayzxb/config",
  "dayzxb",
  "dayzstandalone/logs",
  "dayzstandalone",
  "config",
  "logs",
  ".",
  "",
];
const ADM_SAMPLE_BYTES = 16 * 1024;

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

type NitradoFileEntry = {
  name: string;
  path: string;
  type?: string;
  modified?: string | number | null;
};

export type AdmLogDetection = {
  found: boolean;
  admFileExists: boolean;
  sampleReadSucceeded: boolean;
  newestAdmFileName: string | null;
  admPath: string | null;
  lastCheckedAt: string;
  checkedPaths: string[];
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

export async function detectNitradoAdmLogs(
  token: string,
  serviceId: string,
): Promise<AdmLogDetection> {
  const lastCheckedAt = new Date().toISOString();
  const checkedPaths = new Set<string>();
  const searchDirs = await buildAdmSearchDirs(token, serviceId);
  const candidates = new Map<string, NitradoFileEntry>();

  for (const dir of searchDirs) {
    checkedPaths.add(displayDir(dir));
    const entries = await listAdmFileEntries(token, serviceId, dir);
    for (const entry of entries) {
      if (isAdmFile(entry)) candidates.set(entry.path.toLowerCase(), entry);
    }
  }

  const newest = pickNewestAdmFile([...candidates.values()]);
  if (!newest) {
    return {
      found: false,
      admFileExists: false,
      sampleReadSucceeded: false,
      newestAdmFileName: null,
      admPath: null,
      lastCheckedAt,
      checkedPaths: [...checkedPaths],
    };
  }

  const sample = await readNitradoFileSample(token, serviceId, newest.path);
  const sampleReadSucceeded = sample !== null;
  return {
    found: sampleReadSucceeded && containsDayZAdminLogMarkers(sample),
    admFileExists: true,
    sampleReadSucceeded,
    newestAdmFileName: newest.name,
    admPath: newest.path,
    lastCheckedAt,
    checkedPaths: [...checkedPaths],
  };
}

export function mockAdmLogDetection(): AdmLogDetection {
  const newestAdmFileName = "DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM";
  return {
    found: true,
    admFileExists: true,
    sampleReadSucceeded: true,
    newestAdmFileName,
    admPath: `dayzps/config/${newestAdmFileName}`,
    lastCheckedAt: new Date().toISOString(),
    checkedPaths: ["dayzps/config", "dayzps", "config", "logs"],
  };
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

async function buildAdmSearchDirs(token: string, serviceId: string) {
  const dirs = new Set(ADM_SEARCH_DIRS);
  const [bookmarks, serviceDetails] = await Promise.all([
    fetchFileBookmarks(token, serviceId),
    fetchGameserverDetails(token, serviceId),
  ]);

  for (const value of [...extractPathLikeStrings(bookmarks), ...extractPathLikeStrings(serviceDetails)]) {
    addPathCandidates(dirs, value);
  }

  return [...dirs].slice(0, 32);
}

async function listAdmFileEntries(token: string, serviceId: string, dir: string) {
  const seen = new Map<string, NitradoFileEntry>();
  const searches = [".ADM", ".adm", "ADM", undefined];
  for (const search of searches) {
    const entries = await fetchFileList(token, serviceId, dir, search);
    for (const entry of entries) {
      if (isAdmFile(entry)) seen.set(entry.path.toLowerCase(), entry);
    }
  }
  return [...seen.values()];
}

async function fetchFileList(
  token: string,
  serviceId: string,
  dir: string,
  search?: string,
): Promise<NitradoFileEntry[]> {
  try {
    const url = new URL(`${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers/file_server/list`);
    if (dir) url.searchParams.set("dir", dir);
    if (search) url.searchParams.set("search", search);
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    if (!response.ok) return [];
    const payload = await response.json();
    return normalizeFileEntries(payload, dir);
  } catch {
    return [];
  }
}

async function fetchFileBookmarks(token: string, serviceId: string) {
  try {
    const response = await fetch(
      `${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers/file_server/bookmarks`,
      { headers: nitradoHeaders(token) },
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function fetchGameserverDetails(token: string, serviceId: string) {
  try {
    const response = await fetch(
      `${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers`,
      { headers: nitradoHeaders(token) },
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function readNitradoFileSample(token: string, serviceId: string, file: string) {
  return (
    (await readNitradoFileViaSeek(token, serviceId, file)) ??
    (await readNitradoFileViaDownload(token, serviceId, file))
  );
}

async function readNitradoFileViaSeek(token: string, serviceId: string, file: string) {
  try {
    const url = new URL(`${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers/file_server/seek`);
    url.searchParams.set("file", file);
    url.searchParams.set("offset", "0");
    url.searchParams.set("length", String(ADM_SAMPLE_BYTES));
    url.searchParams.set("mode", "raw");
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    if (!response.ok) return null;
    const payload = await response.json();
    return fetchTokenizedFileSample(payload);
  } catch {
    return null;
  }
}

async function readNitradoFileViaDownload(token: string, serviceId: string, file: string) {
  try {
    const url = new URL(`${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers/file_server/download`);
    url.searchParams.set("file", file);
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    if (!response.ok) return null;
    const payload = await response.json();
    return fetchTokenizedFileSample(payload);
  } catch {
    return null;
  }
}

async function fetchTokenizedFileSample(payload: unknown) {
  const token = extractDownloadToken(payload);
  if (!token) return null;

  const url = new URL(token.url);
  url.searchParams.set("token", token.token);
  url.searchParams.set("offset", "0");
  url.searchParams.set("count", String(ADM_SAMPLE_BYTES));

  const response = await fetch(url);
  if (!response.ok) return null;
  return response.text();
}

function extractDownloadToken(payload: unknown) {
  const token = findTokenObject(payload);
  if (!token) return null;
  return token;
}

function findTokenObject(value: unknown): { url: string; token: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url === "string" && typeof record.token === "string") {
    return { url: record.url, token: record.token };
  }
  for (const child of Object.values(record)) {
    const found = findTokenObject(child);
    if (found) return found;
  }
  return null;
}

function normalizeFileEntries(payload: unknown, dir: string): NitradoFileEntry[] {
  const entries = findArrayByKey(payload, "entries") ?? [];
  return entries
    .map((entry) => normalizeFileEntry(entry, dir))
    .filter((entry): entry is NitradoFileEntry => Boolean(entry));
}

function normalizeFileEntry(entry: unknown, dir: string): NitradoFileEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const type = stringValue(record.type ?? record.file_type ?? record.kind);
  if (type && /dir|folder/i.test(type)) return null;

  const name = stringValue(record.name ?? record.filename ?? record.file);
  const dirPath = stringValue(record.dirpath ?? record.dir_path ?? record.directory ?? record.dir);
  const rawPath = stringValue(
    record.path ??
      record.full_path ??
      record.fullpath ??
      record.fullfilename ??
      record.full_filename ??
      record.file ??
      record.name,
  );
  let path = normalizeRemotePath(rawPath && rawPath !== name ? rawPath : joinRemotePath(dirPath || dir, name));
  const fileName = name || path.split("/").filter(Boolean).at(-1) || "";
  if (fileName && path && !path.toLowerCase().endsWith(fileName.toLowerCase())) {
    path = joinRemotePath(path, fileName);
  }
  if (!path && fileName) path = joinRemotePath(dirPath || dir, fileName);
  if (!fileName || !path) return null;

  return {
    name: fileName,
    path,
    type,
    modified: stringValue(record.modified ?? record.mtime ?? record.last_modified ?? record.changed) ?? null,
  };
}

function findArrayByKey(value: unknown, key: string): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record[key])) return record[key];
  for (const child of Object.values(record)) {
    const found = findArrayByKey(child, key);
    if (found) return found;
  }
  return null;
}

function isAdmFile(entry: NitradoFileEntry) {
  return /\.adm$/i.test(entry.name) || /\.adm$/i.test(entry.path);
}

function pickNewestAdmFile(entries: NitradoFileEntry[]) {
  return entries.sort(compareAdmFilesNewestFirst)[0] ?? null;
}

function compareAdmFilesNewestFirst(a: NitradoFileEntry, b: NitradoFileEntry) {
  const aTime = timestampScore(a) ?? 0;
  const bTime = timestampScore(b) ?? 0;
  if (aTime !== bTime) return bTime - aTime;
  return b.path.localeCompare(a.path);
}

function timestampScore(entry: NitradoFileEntry) {
  const fromName = parseAdmTimestamp(entry.name) ?? parseAdmTimestamp(entry.path);
  if (fromName) return fromName;
  if (typeof entry.modified === "number") return entry.modified;
  if (typeof entry.modified === "string") {
    const parsed = Date.parse(entry.modified);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function parseAdmTimestamp(value: string) {
  const match = value.match(/(\d{4})[-_](\d{2})[-_](\d{2})[_-](\d{2})[-_](\d{2})[-_](\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function containsDayZAdminLogMarkers(sample: string | null) {
  if (!sample) return false;
  const markers = [
    /AdminLog started/i,
    /Player .* is connecting/i,
    /Player .* is connected/i,
    /has been disconnected/i,
    /\bplaced\b/i,
    /\bkilled\b/i,
  ];
  return markers.some((marker) => marker.test(sample));
}

function extractPathLikeStrings(value: unknown, results = new Set<string>()) {
  if (typeof value === "string") {
    if (/(dayz|config|logs?|\.adm)/i.test(value)) results.add(value);
    return results;
  }
  if (!value || typeof value !== "object") return results;
  for (const child of Object.values(value)) extractPathLikeStrings(child, results);
  return results;
}

function addPathCandidates(dirs: Set<string>, value: string) {
  const normalized = normalizeRemotePath(value);
  if (!normalized || /^https?:\/\//i.test(normalized)) return;
  const withoutAdm = normalized.replace(/\/?[^/]*\.adm$/i, "");
  for (const dir of [normalized, withoutAdm]) {
    if (!dir) continue;
    if (/(dayz|config|logs?)/i.test(dir) && !/\.[a-z0-9]+$/i.test(dir)) dirs.add(dir);
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function normalizeRemotePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

function joinRemotePath(dir: string, name: string) {
  return normalizeRemotePath(`${dir ? `${dir}/` : ""}${name}`);
}

function displayDir(dir: string) {
  return dir || "/";
}
