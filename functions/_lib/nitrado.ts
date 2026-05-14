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
const EXACT_ADM_LIST_DIRS = [
  "/",
  "",
  "dayzps",
  "/dayzps",
  "dayzps/config",
  "/dayzps/config",
  "config",
  "/config",
];
const EXACT_ADM_SEARCH_TERMS = [undefined, ".ADM", ".adm", "DayZServer", "DAYZSERVER"];
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

type SafeApiStatus = "OK" | "401" | "403" | "404" | "error";

export type AdmListAttempt = {
  dir: string;
  search: string | null;
  status: SafeApiStatus;
  fileCount: number;
  admFileCount: number;
};

export type AdmReadAttempt = {
  path: string;
  method: "seek" | "download";
  status: SafeApiStatus;
};

export type AdmApiDebug = {
  pathsChecked: string[];
  listAttempts: AdmListAttempt[];
  filesFound: string[];
  exactSelectedAdmPath: string | null;
  sampleReadStatus: SafeApiStatus | "not_attempted";
  samplePreview: string | null;
  lastCheckedAt: string;
  message: string | null;
  readAttempts: AdmReadAttempt[];
};

export type AdmLogDetection = {
  found: boolean;
  admFileExists: boolean;
  sampleReadSucceeded: boolean;
  newestAdmFileName: string | null;
  admPath: string | null;
  lastCheckedAt: string;
  checkedPaths: string[];
  debug?: AdmApiDebug;
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
  const listAttempts: AdmListAttempt[] = [];
  const searchDirs = await buildAdmSearchDirs(token, serviceId);
  const candidates = new Map<string, NitradoFileEntry>();

  for (const dir of searchDirs) {
    checkedPaths.add(displayDir(dir));
    const entries = await listAdmFileEntries(token, serviceId, dir, listAttempts);
    for (const entry of entries) {
      if (isAdmFile(entry)) candidates.set(entry.path.toLowerCase(), entry);
    }
  }

  const newest = pickNewestAdmFile([...candidates.values()]);
  if (!newest) {
    const debug = createAdmDebug({
      pathsChecked: [...checkedPaths],
      listAttempts,
      filesFound: [],
      selectedPath: null,
      sampleReadStatus: "not_attempted",
      samplePreview: null,
      lastCheckedAt,
      message: buildAdmDebugMessage(listAttempts, [], false, false),
      readAttempts: [],
    });
    return {
      found: false,
      admFileExists: false,
      sampleReadSucceeded: false,
      newestAdmFileName: null,
      admPath: null,
      lastCheckedAt,
      checkedPaths: [...checkedPaths],
      debug,
    };
  }

  const readAttempts: AdmReadAttempt[] = [];
  const sampleResult = await readNitradoFileSample(token, serviceId, newest.path, readAttempts);
  const sampleReadSucceeded = sampleResult.sample !== null;
  const sampleHasMarkers = containsDayZAdminLogMarkers(sampleResult.sample);
  const debug = createAdmDebug({
    pathsChecked: [...checkedPaths],
    listAttempts,
    filesFound: [...candidates.values()].map((entry) => entry.path),
    selectedPath: newest.path,
    sampleReadStatus: sampleResult.status,
    samplePreview: sampleResult.sample,
    lastCheckedAt,
    message: buildAdmDebugMessage(listAttempts, readAttempts, true, sampleReadSucceeded, sampleHasMarkers),
    readAttempts,
  });
  return {
    found: sampleReadSucceeded && sampleHasMarkers,
    admFileExists: true,
    sampleReadSucceeded,
    newestAdmFileName: newest.name,
    admPath: newest.path,
    lastCheckedAt,
    checkedPaths: [...checkedPaths],
    debug,
  };
}

export async function testExactNitradoAdmPath(
  token: string,
  serviceId: string,
  inputPath: string,
): Promise<AdmLogDetection> {
  const lastCheckedAt = new Date().toISOString();
  const pathVariants = createAdmPathVariants(inputPath);
  const exactDirs = createExactAdmListDirs(pathVariants);
  const listAttempts: AdmListAttempt[] = [];
  const candidates = new Map<string, NitradoFileEntry>();

  const attempts = await Promise.all(
    exactDirs.flatMap((dir) =>
      EXACT_ADM_SEARCH_TERMS.map((search) => fetchFileListAttempt(token, serviceId, dir, search)),
    ),
  );
  for (const attempt of attempts) {
    listAttempts.push(attempt);
    for (const entry of attempt.entries) {
      if (isAdmFile(entry)) {
        candidates.set(entry.path.toLowerCase(), entry);
      }
    }
  }

  const matchingCandidate = findMatchingAdmCandidate([...candidates.values()], pathVariants);
  const newest = pickNewestAdmFile([...candidates.values()]);
  const readPaths = dedupeStrings([
    ...(matchingCandidate ? [matchingCandidate.path] : []),
    ...pathVariants,
    ...(newest ? [newest.path] : []),
  ]);
  const readAttempts: AdmReadAttempt[] = [];
  let sampleResult: { sample: string | null; status: SafeApiStatus | "not_attempted"; path: string | null } = {
    sample: null,
    status: "not_attempted",
    path: null,
  };
  let successfulReadPath: string | null = null;

  for (const path of readPaths) {
    const result = await readNitradoFileSample(token, serviceId, path, readAttempts);
    sampleResult = { ...result, path };
    if (result.sample !== null) {
      successfulReadPath = path;
      break;
    }
  }

  const selectedPath = successfulReadPath ?? matchingCandidate?.path ?? pathVariants[0] ?? newest?.path ?? null;
  const selectedEntry = selectedPath ? findEntryForPath([...candidates.values()], selectedPath) : null;
  const sampleReadSucceeded = sampleResult.sample !== null;
  const admFileExists = Boolean(selectedEntry || candidates.size || sampleReadSucceeded);
  const sampleHasMarkers = containsDayZAdminLogMarkers(sampleResult.sample);
  const found = admFileExists && sampleReadSucceeded && sampleHasMarkers;
  const filesFound = [...candidates.values()].map((entry) => entry.path);
  const pathsChecked = dedupeStrings([...exactDirs, ...pathVariants]).map(displayDir);
  const debug = createAdmDebug({
    pathsChecked,
    listAttempts,
    filesFound,
    selectedPath,
    sampleReadStatus: sampleResult.status,
    samplePreview: sampleResult.sample,
    lastCheckedAt,
    message: buildAdmDebugMessage(listAttempts, readAttempts, filesFound.length > 0 || admFileExists, sampleReadSucceeded, sampleHasMarkers),
    readAttempts,
  });

  return {
    found,
    admFileExists,
    sampleReadSucceeded,
    newestAdmFileName: selectedEntry?.name ?? selectedPath?.split("/").filter(Boolean).at(-1) ?? null,
    admPath: found ? normalizeRemotePath(selectedPath ?? "") : selectedPath,
    lastCheckedAt,
    checkedPaths: pathsChecked,
    debug,
  };
}

export function mockAdmLogDetection(): AdmLogDetection {
  const newestAdmFileName = "DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM";
  const admPath = `dayzps/config/${newestAdmFileName}`;
  const lastCheckedAt = new Date().toISOString();
  return {
    found: true,
    admFileExists: true,
    sampleReadSucceeded: true,
    newestAdmFileName,
    admPath,
    lastCheckedAt,
    checkedPaths: ["dayzps/config", "dayzps", "config", "logs"],
    debug: {
      pathsChecked: ["dayzps/config", "dayzps", "config", "logs"],
      listAttempts: [
        { dir: "dayzps/config", search: ".ADM", status: "OK", fileCount: 1, admFileCount: 1 },
      ],
      filesFound: [admPath],
      exactSelectedAdmPath: admPath,
      sampleReadStatus: "OK",
      samplePreview: "AdminLog started\nPlayer MockSurvivor is connected\nPlayer MockSurvivor placed Fireplace",
      lastCheckedAt,
      message: null,
      readAttempts: [{ path: admPath, method: "seek", status: "OK" }],
    },
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

async function listAdmFileEntries(
  token: string,
  serviceId: string,
  dir: string,
  listAttempts?: AdmListAttempt[],
) {
  const seen = new Map<string, NitradoFileEntry>();
  const searches = [".ADM", ".adm", "DayZServer", "DAYZSERVER", "ADM", undefined];
  for (const search of searches) {
    const attempt = await fetchFileListAttempt(token, serviceId, dir, search);
    listAttempts?.push(attempt);
    for (const entry of attempt.entries) {
      if (isAdmFile(entry)) seen.set(entry.path.toLowerCase(), entry);
    }
  }
  return [...seen.values()];
}

async function fetchFileListAttempt(
  token: string,
  serviceId: string,
  dir: string,
  search?: string,
): Promise<AdmListAttempt & { entries: NitradoFileEntry[] }> {
  try {
    const url = new URL(`${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers/file_server/list`);
    if (dir) url.searchParams.set("dir", dir);
    if (search) url.searchParams.set("search", search);
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    if (!response.ok) {
      return {
        dir: displayDir(dir),
        search: search ?? null,
        status: safeResponseStatus(response),
        fileCount: 0,
        admFileCount: 0,
        entries: [],
      };
    }
    const payload = await response.json();
    const entries = normalizeFileEntries(payload, dir);
    return {
      dir: displayDir(dir),
      search: search ?? null,
      status: "OK",
      fileCount: entries.length,
      admFileCount: entries.filter(isAdmFile).length,
      entries,
    };
  } catch {
    return {
      dir: displayDir(dir),
      search: search ?? null,
      status: "error",
      fileCount: 0,
      admFileCount: 0,
      entries: [],
    };
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

async function readNitradoFileSample(
  token: string,
  serviceId: string,
  file: string,
  readAttempts?: AdmReadAttempt[],
) {
  const seek = await readNitradoFileViaSeek(token, serviceId, file, readAttempts);
  if (seek.sample !== null) return seek;
  return readNitradoFileViaDownload(token, serviceId, file, readAttempts);
}

async function readNitradoFileViaSeek(
  token: string,
  serviceId: string,
  file: string,
  readAttempts?: AdmReadAttempt[],
) {
  try {
    const url = new URL(`${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers/file_server/seek`);
    url.searchParams.set("file", file);
    url.searchParams.set("offset", "0");
    url.searchParams.set("length", String(ADM_SAMPLE_BYTES));
    url.searchParams.set("mode", "raw");
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    if (!response.ok) {
      const status = safeResponseStatus(response);
      readAttempts?.push({ path: file, method: "seek", status });
      return { sample: null, status };
    }
    const payload = await response.json();
    const sample = await fetchTokenizedFileSample(payload);
    readAttempts?.push({ path: file, method: "seek", status: sample.status });
    return sample;
  } catch {
    readAttempts?.push({ path: file, method: "seek", status: "error" });
    return { sample: null, status: "error" as const };
  }
}

async function readNitradoFileViaDownload(
  token: string,
  serviceId: string,
  file: string,
  readAttempts?: AdmReadAttempt[],
) {
  try {
    const url = new URL(`${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers/file_server/download`);
    url.searchParams.set("file", file);
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    if (!response.ok) {
      const status = safeResponseStatus(response);
      readAttempts?.push({ path: file, method: "download", status });
      return { sample: null, status };
    }
    const payload = await response.json();
    const sample = await fetchTokenizedFileSample(payload);
    readAttempts?.push({ path: file, method: "download", status: sample.status });
    return sample;
  } catch {
    readAttempts?.push({ path: file, method: "download", status: "error" });
    return { sample: null, status: "error" as const };
  }
}

async function fetchTokenizedFileSample(payload: unknown) {
  const token = extractDownloadToken(payload);
  if (!token) return { sample: null, status: "error" as const };

  const url = new URL(token.url);
  url.searchParams.set("token", token.token);
  url.searchParams.set("offset", "0");
  url.searchParams.set("count", String(ADM_SAMPLE_BYTES));

  const response = await fetch(url);
  if (!response.ok) return { sample: null, status: safeResponseStatus(response) };
  return { sample: await response.text(), status: "OK" as const };
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
    /Player/i,
    /is connected/i,
    /has been disconnected/i,
    /\bplaced\b/i,
    /\bkilled\b/i,
    /\bdied\b/i,
  ];
  return markers.some((marker) => marker.test(sample));
}

function createAdmPathVariants(inputPath: string) {
  const normalized = normalizeRemotePath(inputPath.trim().replace(/[\u0000-\u001f]/g, ""));
  if (!normalized || /^https?:\/\//i.test(normalized) || normalized.includes("..")) return [];
  const upperFileName = uppercaseRemoteFileName(normalized);
  return dedupeStrings([
    normalized,
    `/${normalized}`,
    upperFileName,
    `/${upperFileName}`,
  ]);
}

function createExactAdmListDirs(pathVariants: string[]) {
  const dirs = new Set(EXACT_ADM_LIST_DIRS);
  for (const path of pathVariants) {
    const normalized = normalizeRemotePath(path);
    const dir = normalized.split("/").slice(0, -1).join("/");
    if (!dir) continue;
    dirs.add(dir);
    dirs.add(`/${dir}`);
  }
  return [...dirs];
}

function findMatchingAdmCandidate(entries: NitradoFileEntry[], pathVariants: string[]) {
  const variantSet = new Set(pathVariants.map((path) => normalizeRemotePath(path).toLowerCase()));
  const exactPath = entries.find((entry) => variantSet.has(normalizeRemotePath(entry.path).toLowerCase()));
  if (exactPath) return exactPath;

  const targetNames = new Set(
    pathVariants
      .map((path) => normalizeRemotePath(path).split("/").filter(Boolean).at(-1)?.toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  return entries.find((entry) => targetNames.has(entry.name.toLowerCase())) ?? null;
}

function findEntryForPath(entries: NitradoFileEntry[], path: string) {
  const normalized = normalizeRemotePath(path).toLowerCase();
  return entries.find((entry) => normalizeRemotePath(entry.path).toLowerCase() === normalized) ?? null;
}

function uppercaseRemoteFileName(path: string) {
  const parts = normalizeRemotePath(path).split("/");
  const fileName = parts.pop();
  if (!fileName) return normalizeRemotePath(path);
  return [...parts, fileName.toUpperCase()].join("/");
}

function createAdmDebug({
  pathsChecked,
  listAttempts,
  filesFound,
  selectedPath,
  sampleReadStatus,
  samplePreview,
  lastCheckedAt,
  message,
  readAttempts,
}: {
  pathsChecked: string[];
  listAttempts: AdmListAttempt[];
  filesFound: string[];
  selectedPath: string | null;
  sampleReadStatus: SafeApiStatus | "not_attempted";
  samplePreview: string | null;
  lastCheckedAt: string;
  message: string | null;
  readAttempts: AdmReadAttempt[];
}): AdmApiDebug {
  return {
    pathsChecked: dedupeStrings(pathsChecked).slice(0, 64),
    listAttempts: listAttempts.map(stripListAttemptEntries).slice(0, 80),
    filesFound: dedupeStrings(filesFound).slice(0, 40),
    exactSelectedAdmPath: selectedPath,
    sampleReadStatus,
    samplePreview: samplePreview ? samplePreview.slice(0, 300) : null,
    lastCheckedAt,
    message,
    readAttempts: readAttempts.slice(0, 20),
  };
}

function stripListAttemptEntries(attempt: AdmListAttempt) {
  return {
    dir: attempt.dir,
    search: attempt.search,
    status: attempt.status,
    fileCount: attempt.fileCount,
    admFileCount: attempt.admFileCount,
  };
}

function buildAdmDebugMessage(
  listAttempts: AdmListAttempt[],
  readAttempts: AdmReadAttempt[],
  admFileExists: boolean,
  sampleReadSucceeded: boolean,
  sampleHasMarkers = false,
) {
  if (hasStatus(listAttempts, "403") || hasReadStatus(readAttempts, "403")) {
    return "Token may not have permission to read file server logs.";
  }
  if (hasStatus(listAttempts, "401") || hasReadStatus(readAttempts, "401")) {
    return "Nitrado token was rejected while reading file server logs.";
  }
  if (!admFileExists && (hasStatus(listAttempts, "404") || hasReadStatus(readAttempts, "404"))) {
    return "Path not found through API. Try copying the exact 'Your log link' from Nitrado.";
  }
  if (!admFileExists) return "Could not list ADM files through Nitrado API.";
  if (!sampleReadSucceeded) return "ADM file found, but sample read failed.";
  if (!sampleHasMarkers) return "ADM file read succeeded, but no DayZ admin log markers were found in the sample.";
  return null;
}

function hasStatus(attempts: AdmListAttempt[], status: SafeApiStatus) {
  return attempts.some((attempt) => attempt.status === status);
}

function hasReadStatus(attempts: AdmReadAttempt[], status: SafeApiStatus) {
  return attempts.some((attempt) => attempt.status === status);
}

function safeResponseStatus(response: Response): SafeApiStatus {
  if (response.ok) return "OK";
  if (response.status === 401) return "401";
  if (response.status === 403) return "403";
  if (response.status === 404) return "404";
  return "error";
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

function dedupeStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
