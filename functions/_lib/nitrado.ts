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
  "dayzstandalone",
  "dayzstandalone/logs",
  "/dayzstandalone/logs",
  "config",
  "/config",
  "logs",
  "/logs",
];
const EXACT_ADM_SEARCH_TERMS = [undefined, ".ADM", ".adm", "DayZServer", "DAYZSERVER"];
const ADM_SAMPLE_BYTES = 4096;

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
  downloadTokenCreated: boolean;
  sampleReadSucceeded: boolean;
};

export type AdmStatAttempt = {
  path: string;
  status: SafeApiStatus;
  fileVisible: boolean;
};

export type AdmServiceDetailsAttempt = {
  status: SafeApiStatus;
  pathsFound: number;
};

export type AdmMethodAttempt = {
  method: "download" | "seek" | "stat" | "list" | "service-details";
  status: SafeApiStatus;
  path?: string;
  dir?: string;
  search?: string | null;
  fileVisible?: boolean;
  downloadTokenCreated?: boolean;
  sampleReadSucceeded?: boolean;
  entriesReturned?: number;
  admFilesFound?: number;
};

export type AdmApiDebug = {
  exactManualPath: string | null;
  pathVariants: string[];
  pathsChecked: string[];
  methodsTried: AdmMethodAttempt[];
  listAttempts: AdmListAttempt[];
  statAttempts: AdmStatAttempt[];
  serviceDetailsAttempt: AdmServiceDetailsAttempt | null;
  filesFound: string[];
  exactSelectedAdmPath: string | null;
  fileVisibleThroughStat: boolean;
  downloadTokenCreated: boolean;
  sampleReadStatus: SafeApiStatus | "not_attempted";
  sampleReadSucceeded: boolean;
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
      exactManualPath: null,
      pathVariants: [],
      pathsChecked: [...checkedPaths],
      listAttempts,
      statAttempts: [],
      serviceDetailsAttempt: null,
      filesFound: [],
      selectedPath: null,
      fileVisibleThroughStat: false,
      sampleReadStatus: "not_attempted",
      downloadTokenCreated: false,
      sampleReadSucceeded: false,
      samplePreview: null,
      lastCheckedAt,
      message: buildAdmDebugMessage(listAttempts, [], [], null, false, false),
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
    exactManualPath: null,
    pathVariants: [],
    pathsChecked: [...checkedPaths],
    listAttempts,
    statAttempts: [],
    serviceDetailsAttempt: null,
    filesFound: [...candidates.values()].map((entry) => entry.path),
    selectedPath: newest.path,
    fileVisibleThroughStat: true,
    sampleReadStatus: sampleResult.status,
    downloadTokenCreated: readAttempts.some((attempt) => attempt.downloadTokenCreated),
    sampleReadSucceeded,
    samplePreview: sampleResult.sample,
    lastCheckedAt,
    message: buildAdmDebugMessage(listAttempts, readAttempts, [], null, true, sampleReadSucceeded, sampleHasMarkers),
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
  const serviceDetails = await fetchGameserverDetailsAttempt(token, serviceId);
  const serviceLogPaths = extractServiceLogPaths(serviceDetails.payload);
  const serviceAdmPaths = serviceLogPaths.filter((path) => /\.adm$/i.test(path));
  const allPathVariants = dedupeStrings([
    ...serviceAdmPaths.flatMap(createAdmPathVariants),
    ...pathVariants,
  ]);
  const exactDirs = createExactAdmListDirs([...allPathVariants, ...serviceLogPaths]);
  const listAttempts: AdmListAttempt[] = [];
  const statAttempts: AdmStatAttempt[] = [];
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

  for (const path of allPathVariants) {
    statAttempts.push(await statNitradoFile(token, serviceId, path));
  }

  const matchingCandidate = findMatchingAdmCandidate([...candidates.values()], allPathVariants);
  const newest = pickNewestAdmFile([...candidates.values()]);
  const readPaths = dedupeStrings([
    ...serviceAdmPaths,
    ...(matchingCandidate ? [matchingCandidate.path] : []),
    ...allPathVariants,
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

  const selectedPath = successfulReadPath ?? matchingCandidate?.path ?? allPathVariants[0] ?? newest?.path ?? null;
  const selectedEntry = selectedPath ? findEntryForPath([...candidates.values()], selectedPath) : null;
  const sampleReadSucceeded = sampleResult.sample !== null;
  const fileVisibleThroughStat = statAttempts.some((attempt) => attempt.fileVisible);
  const admFileExists = Boolean(selectedEntry || candidates.size || fileVisibleThroughStat || sampleReadSucceeded);
  const sampleHasMarkers = containsDayZAdminLogMarkers(sampleResult.sample);
  const found = admFileExists && sampleReadSucceeded && sampleHasMarkers;
  const filesFound = [...candidates.values()].map((entry) => entry.path);
  const pathsChecked = dedupeStrings([...exactDirs, ...allPathVariants]).map(displayDir);
  const debug = createAdmDebug({
    exactManualPath: inputPath,
    pathVariants: allPathVariants,
    pathsChecked,
    listAttempts,
    statAttempts,
    serviceDetailsAttempt: {
      status: serviceDetails.status,
      pathsFound: serviceLogPaths.length,
    },
    filesFound,
    selectedPath,
    fileVisibleThroughStat,
    sampleReadStatus: sampleResult.status,
    downloadTokenCreated: readAttempts.some((attempt) => attempt.downloadTokenCreated),
    sampleReadSucceeded,
    samplePreview: sampleResult.sample,
    lastCheckedAt,
    message: buildAdmDebugMessage(
      listAttempts,
      readAttempts,
      statAttempts,
      serviceDetails.status,
      filesFound.length > 0 || admFileExists,
      sampleReadSucceeded,
      sampleHasMarkers,
    ),
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
      exactManualPath: admPath,
      pathVariants: [admPath, `/${admPath}`],
      methodsTried: [
        { method: "download", path: admPath, status: "OK", downloadTokenCreated: true, sampleReadSucceeded: true },
        { method: "seek", path: admPath, status: "OK", downloadTokenCreated: true, sampleReadSucceeded: true },
        { method: "stat", path: admPath, status: "OK", fileVisible: true },
        { method: "list", dir: "dayzps/config", search: ".ADM", status: "OK", entriesReturned: 1, admFilesFound: 1 },
      ],
      statAttempts: [{ path: admPath, status: "OK", fileVisible: true }],
      serviceDetailsAttempt: { status: "OK", pathsFound: 1 },
      fileVisibleThroughStat: true,
      downloadTokenCreated: true,
      sampleReadStatus: "OK",
      sampleReadSucceeded: true,
      samplePreview: "AdminLog started\nPlayer MockSurvivor is connected\nPlayer MockSurvivor placed Fireplace",
      lastCheckedAt,
      message: null,
      readAttempts: [{ path: admPath, method: "download", status: "OK", downloadTokenCreated: true, sampleReadSucceeded: true }],
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
  const result = await fetchGameserverDetailsAttempt(token, serviceId);
  return result.payload;
}

async function fetchGameserverDetailsAttempt(token: string, serviceId: string) {
  try {
    const response = await fetch(
      `${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers`,
      { headers: nitradoHeaders(token) },
    );
    if (!response.ok) return { status: safeResponseStatus(response), payload: null };
    return { status: "OK" as const, payload: await response.json() };
  } catch {
    return { status: "error" as const, payload: null };
  }
}

async function readNitradoFileSample(
  token: string,
  serviceId: string,
  file: string,
  readAttempts?: AdmReadAttempt[],
) {
  const download = await readNitradoFileViaDownload(token, serviceId, file, readAttempts);
  if (download.sample !== null) return download;
  return readNitradoFileViaSeek(token, serviceId, file, readAttempts);
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
      readAttempts?.push({ path: file, method: "seek", status, downloadTokenCreated: false, sampleReadSucceeded: false });
      return { sample: null, status, downloadTokenCreated: false };
    }
    const payload = await response.json();
    const sample = await fetchTokenizedFileSample(payload);
    readAttempts?.push({
      path: file,
      method: "seek",
      status: sample.status,
      downloadTokenCreated: sample.downloadTokenCreated,
      sampleReadSucceeded: sample.sample !== null,
    });
    return sample;
  } catch {
    readAttempts?.push({ path: file, method: "seek", status: "error", downloadTokenCreated: false, sampleReadSucceeded: false });
    return { sample: null, status: "error" as const, downloadTokenCreated: false };
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
      readAttempts?.push({ path: file, method: "download", status, downloadTokenCreated: false, sampleReadSucceeded: false });
      return { sample: null, status, downloadTokenCreated: false };
    }
    const payload = await response.json();
    const sample = await fetchTokenizedFileSample(payload);
    readAttempts?.push({
      path: file,
      method: "download",
      status: sample.status,
      downloadTokenCreated: sample.downloadTokenCreated,
      sampleReadSucceeded: sample.sample !== null,
    });
    return sample;
  } catch {
    readAttempts?.push({ path: file, method: "download", status: "error", downloadTokenCreated: false, sampleReadSucceeded: false });
    return { sample: null, status: "error" as const, downloadTokenCreated: false };
  }
}

async function statNitradoFile(
  token: string,
  serviceId: string,
  file: string,
): Promise<AdmStatAttempt> {
  try {
    const url = new URL(`${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers/file_server/stat`);
    url.searchParams.append("files[]", file);
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    const status = safeResponseStatus(response);
    if (!response.ok) return { path: file, status, fileVisible: false };
    const payload = await response.json();
    return { path: file, status: "OK", fileVisible: statPayloadShowsFile(payload, file) };
  } catch {
    return { path: file, status: "error", fileVisible: false };
  }
}

async function fetchTokenizedFileSample(payload: unknown) {
  const token = extractDownloadToken(payload);
  if (!token) return { sample: null, status: "error" as const, downloadTokenCreated: false };

  const url = new URL(token.url);
  url.searchParams.set("token", token.token);
  url.searchParams.set("offset", "0");
  url.searchParams.set("count", String(ADM_SAMPLE_BYTES));

  const response = await fetch(url);
  if (!response.ok) {
    return { sample: null, status: safeResponseStatus(response), downloadTokenCreated: true };
  }
  return { sample: await response.text(), status: "OK" as const, downloadTokenCreated: true };
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

function statPayloadShowsFile(payload: unknown, file: string) {
  const normalized = normalizeRemotePath(file).toLowerCase();
  const basename = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  if (payloadContainsPath(payload, normalized, basename)) return true;
  const candidateArrays = ["files", "stats", "entries", "file"];
  return candidateArrays.some((key) => {
    const found = findArrayByKey(payload, key);
    return Boolean(found?.length);
  });
}

function payloadContainsPath(value: unknown, normalizedPath: string, basename: string): boolean {
  if (typeof value === "string") {
    const normalizedValue = normalizeRemotePath(value).toLowerCase();
    return normalizedValue === normalizedPath || normalizedValue.endsWith(`/${basename}`) || normalizedValue === basename;
  }
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((child) => payloadContainsPath(child, normalizedPath, basename));
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

function extractServiceLogPaths(payload: unknown) {
  const paths = new Set<string>();
  collectServiceLogPaths(payload, [], false, paths);
  return [...paths].slice(0, 24);
}

function collectServiceLogPaths(
  value: unknown,
  keyPath: string[],
  inLogContext: boolean,
  paths: Set<string>,
) {
  if (typeof value === "string") {
    const lastKey = keyPath.at(-1) ?? "";
    if ((inLogContext || /\.adm$/i.test(value)) && isSafePathLikeValue(value) && !isSensitiveKey(lastKey)) {
      paths.add(normalizeRemotePath(value));
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) continue;
    const nextLogContext = inLogContext || /^(log_files?|logs?|bookmarks?|file_server|current_log|admin_log|adm)$/i.test(key);
    collectServiceLogPaths(child, [...keyPath, key], nextLogContext, paths);
  }
}

function isSafePathLikeValue(value: string) {
  if (/^https?:\/\//i.test(value)) return false;
  if (/(password|passwd|secret|token|credential|mysql|ftp)/i.test(value)) return false;
  return /(\.adm$|dayz|config|logs?)/i.test(value);
}

function isSensitiveKey(key: string) {
  return /(password|passwd|secret|token|credential|mysql|ftp)/i.test(key);
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
  exactManualPath,
  pathVariants,
  pathsChecked,
  listAttempts,
  statAttempts,
  serviceDetailsAttempt,
  filesFound,
  selectedPath,
  fileVisibleThroughStat,
  sampleReadStatus,
  downloadTokenCreated,
  sampleReadSucceeded,
  samplePreview,
  lastCheckedAt,
  message,
  readAttempts,
}: {
  exactManualPath: string | null;
  pathVariants: string[];
  pathsChecked: string[];
  listAttempts: AdmListAttempt[];
  statAttempts: AdmStatAttempt[];
  serviceDetailsAttempt: AdmServiceDetailsAttempt | null;
  filesFound: string[];
  selectedPath: string | null;
  fileVisibleThroughStat: boolean;
  sampleReadStatus: SafeApiStatus | "not_attempted";
  downloadTokenCreated: boolean;
  sampleReadSucceeded: boolean;
  samplePreview: string | null;
  lastCheckedAt: string;
  message: string | null;
  readAttempts: AdmReadAttempt[];
}): AdmApiDebug {
  return {
    exactManualPath,
    pathVariants: dedupeStrings(pathVariants).slice(0, 24),
    pathsChecked: dedupeStrings(pathsChecked).slice(0, 64),
    methodsTried: buildMethodAttempts(serviceDetailsAttempt, listAttempts, statAttempts, readAttempts).slice(0, 140),
    listAttempts: listAttempts.map(stripListAttemptEntries).slice(0, 80),
    statAttempts: statAttempts.slice(0, 32),
    serviceDetailsAttempt,
    filesFound: dedupeStrings(filesFound).slice(0, 40),
    exactSelectedAdmPath: selectedPath,
    fileVisibleThroughStat,
    downloadTokenCreated,
    sampleReadStatus,
    sampleReadSucceeded,
    samplePreview: samplePreview ? samplePreview.slice(0, 300) : null,
    lastCheckedAt,
    message,
    readAttempts: readAttempts.slice(0, 20),
  };
}

function buildMethodAttempts(
  serviceDetailsAttempt: AdmServiceDetailsAttempt | null,
  listAttempts: AdmListAttempt[],
  statAttempts: AdmStatAttempt[],
  readAttempts: AdmReadAttempt[],
): AdmMethodAttempt[] {
  return [
    ...(serviceDetailsAttempt
      ? [{
          method: "service-details" as const,
          status: serviceDetailsAttempt.status,
          entriesReturned: serviceDetailsAttempt.pathsFound,
        }]
      : []),
    ...listAttempts.map((attempt) => ({
      method: "list" as const,
      status: attempt.status,
      dir: attempt.dir,
      search: attempt.search,
      entriesReturned: attempt.fileCount,
      admFilesFound: attempt.admFileCount,
    })),
    ...statAttempts.map((attempt) => ({
      method: "stat" as const,
      status: attempt.status,
      path: attempt.path,
      fileVisible: attempt.fileVisible,
    })),
    ...readAttempts.map((attempt) => ({
      method: attempt.method,
      status: attempt.status,
      path: attempt.path,
      downloadTokenCreated: attempt.downloadTokenCreated,
      sampleReadSucceeded: attempt.sampleReadSucceeded,
    })),
  ];
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
  statAttempts: AdmStatAttempt[],
  serviceDetailsStatus: SafeApiStatus | null,
  admFileExists: boolean,
  sampleReadSucceeded: boolean,
  sampleHasMarkers = false,
) {
  if (hasStatus(listAttempts, "403") || hasReadStatus(readAttempts, "403") || hasStatStatus(statAttempts, "403") || serviceDetailsStatus === "403") {
    return "Token may not have permission to read file server logs.";
  }
  if (hasStatus(listAttempts, "401") || hasReadStatus(readAttempts, "401") || hasStatStatus(statAttempts, "401") || serviceDetailsStatus === "401") {
    return "Nitrado token was rejected while reading file server logs.";
  }
  if (!admFileExists && (hasStatus(listAttempts, "404") || hasReadStatus(readAttempts, "404") || hasStatStatus(statAttempts, "404"))) {
    return "Path not found through API. Try copying the exact 'Your log link' from Nitrado.";
  }
  if (!admFileExists && (readAttempts.length > 0 || statAttempts.length > 0)) {
    return "ADM file exists in Nitrado Web Interface, but Nitrado API could not read it. This may mean the API exposes log files differently for this console service. DZN needs the API-accessible log path or a supported Nitrado file endpoint.";
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

function hasStatStatus(attempts: AdmStatAttempt[], status: SafeApiStatus) {
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
