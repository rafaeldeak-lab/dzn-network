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

export class NitradoServiceLookupError extends Error {
  constructor(public code: "invalid_token" | "service_not_found" | "access_denied" | "not_dayz" | "api_unavailable") {
    super(code);
  }
}

type NitradoFileEntry = {
  name: string;
  path: string;
  type?: string;
  modified?: string | number | null;
};

type GameSpecificLogDetails = {
  username: string | null;
  usernameFound: boolean;
  logFilesFound: boolean;
  logFilesReturned: number;
  admLogFiles: NitradoFileEntry[];
  selectedAdmFile: NitradoFileEntry | null;
  logContextPaths: string[];
};

type SafeApiStatus = "OK" | "401" | "403" | "404" | "error";
type SampleFetchStatus = SafeApiStatus | "not_attempted";

type AdmApiResponseShape = {
  hasData: boolean;
  hasToken: boolean;
  hasTokenUrl: boolean;
  hasTokenValue: boolean;
  topLevelKeys: string[];
  dataKeys: string[];
  hasDataToken: boolean;
  hasDataTokenUrl: boolean;
  hasDataTokenValue: boolean;
  hasDataDownload: boolean;
  hasDataUrl: boolean;
};

type AdmPathVariant = {
  label: string;
  path: string;
};

type DownloadTokenDescriptor = {
  url: string | null;
  token: string | null;
};

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
  pathVariantLabel: string | null;
  requestUrlPathOnly: string;
  httpStatusCode: number | null;
  responseContentType: string | null;
  status: SafeApiStatus;
  responseShape: AdmApiResponseShape;
  errorMessageSafe: string | null;
  downloadTokenCreated: boolean;
  tokenUrlReceived: boolean;
  sampleFetchAttempted: boolean;
  sampleFetchStatus: SampleFetchStatus;
  sampleReadSucceeded: boolean;
  success: boolean;
};

export type AdmStatAttempt = {
  path: string;
  pathVariantLabel: string | null;
  requestUrlPathOnly: string;
  httpStatusCode: number | null;
  responseContentType: string | null;
  status: SafeApiStatus;
  fileVisible: boolean;
  responseShape: AdmApiResponseShape;
  errorMessageSafe: string | null;
  success: boolean;
};

export type AdmServiceDetailsAttempt = {
  status: SafeApiStatus;
  pathsFound: number;
  gameserverUsernameFound: boolean;
  gameSpecificLogFilesFound: boolean;
  logFilesReturned: number;
  gameSpecificAdmFilesFound: number;
  selectedGameSpecificAdmFile: string | null;
};

export type AdmMethodAttempt = {
  method: "download" | "seek" | "stat" | "list" | "service-details";
  status: SafeApiStatus;
  pathVariantLabel?: string | null;
  path?: string;
  pathRedacted?: string;
  redactedPath?: string;
  requestUrlPathOnly?: string;
  httpStatusCode?: number | null;
  responseContentType?: string | null;
  dir?: string;
  search?: string | null;
  fileVisible?: boolean;
  responseShape?: AdmApiResponseShape;
  errorMessageSafe?: string | null;
  downloadTokenCreated?: boolean;
  tokenUrlReceived?: boolean;
  sampleFetchAttempted?: boolean;
  sampleFetchStatus?: SampleFetchStatus;
  sampleReadSucceeded?: boolean;
  success?: boolean;
  entriesReturned?: number;
  admFilesFound?: number;
};

export type AdmApiDebug = {
  exactManualPath: string | null;
  pathVariants: string[];
  apiLogFilePathVariants: string[];
  pathsChecked: string[];
  methodsTried: AdmMethodAttempt[];
  listAttempts: AdmListAttempt[];
  statAttempts: AdmStatAttempt[];
  serviceDetailsAttempt: AdmServiceDetailsAttempt | null;
  gameserverUsernameFound: boolean;
  gameSpecificLogFilesFound: boolean;
  gameSpecificLogFilesReturned: number;
  gameSpecificAdmFilesFound: string[];
  selectedGameSpecificAdmFile: string | null;
  apiLogFilePathTested: string | null;
  actualUsernameUsed: boolean;
  usernameRedactedInUi: boolean;
  tokenUrlReceived: boolean;
  sampleFetchAttempted: boolean;
  sampleFetchStatus: SampleFetchStatus;
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
  internalAdmPath?: string;
  lastCheckedAt: string;
  checkedPaths: string[];
  debug?: AdmApiDebug;
};

export async function validateNitradoToken(token: string) {
  if (!token || token.length < 12) return false;
  try {
    const response = await fetch(`${NITRADO_API}/services`, {
      headers: nitradoHeaders(token),
    });
    return response.ok;
  } catch {
    throw new NitradoServiceLookupError("api_unavailable");
  }
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

export async function fetchMockNitradoServiceById(serviceId: string) {
  if (serviceId === "18765761") {
    return {
      ...mockNitradoServices[0],
      id: "18765761",
    };
  }
  return mockNitradoServices.find((service) => service.id === serviceId) ?? null;
}

export async function fetchNitradoServiceById(token: string, serviceId: string): Promise<NitradoService> {
  if (!/^\d+$/.test(serviceId)) throw new NitradoServiceLookupError("service_not_found");

  let response: Response;
  try {
    response = await fetch(
      `${NITRADO_API}/services/${encodeURIComponent(serviceId)}/gameservers`,
      { headers: nitradoHeaders(token) },
    );
  } catch {
    throw new NitradoServiceLookupError("api_unavailable");
  }

  if (response.status === 401) throw new NitradoServiceLookupError("invalid_token");
  if (response.status === 403) throw new NitradoServiceLookupError("access_denied");
  if (response.status === 404) throw new NitradoServiceLookupError("service_not_found");
  if (!response.ok) throw new NitradoServiceLookupError("api_unavailable");

  const payload = await response.json().catch(() => null);
  const service = normalizeGameserverDetails(payload, serviceId);
  if (!isDayZService(service)) throw new NitradoServiceLookupError("not_dayz");
  return service;
}

export async function detectNitradoAdmLogs(
  token: string,
  serviceId: string,
): Promise<AdmLogDetection> {
  const lastCheckedAt = new Date().toISOString();
  const checkedPaths = new Set<string>();
  const listAttempts: AdmListAttempt[] = [];
  const statAttempts: AdmStatAttempt[] = [];
  const serviceDetails = await fetchGameserverDetailsAttempt(token, serviceId);
  const gameSpecificLogs = extractGameSpecificLogDetails(serviceDetails.payload);
  const serviceLogPaths = extractServiceLogPaths(serviceDetails.payload);
  const apiPathVariantEntries = buildAdmReadPathVariants(gameSpecificLogs);
  const apiPathVariants = apiPathVariantEntries.map((entry) => entry.path);
  const pathVariantLabels = createPathVariantLabelMap(apiPathVariantEntries);
  const searchDirs = await buildAdmSearchDirs(token, serviceId);
  const candidates = new Map<string, NitradoFileEntry>();

  const gameSpecificReadPaths = dedupeStrings([
    ...apiPathVariants,
    ...serviceLogPaths.filter((path) => /\.adm$/i.test(path)),
  ]);
  const gameSpecificReadAttempts: AdmReadAttempt[] = [];
  let gameSpecificSampleResult: { sample: string | null; status: SafeApiStatus | "not_attempted"; path: string | null } = {
    sample: null,
    status: "not_attempted",
    path: null,
  };

  for (const path of gameSpecificReadPaths) {
    statAttempts.push(await statNitradoFile(token, serviceId, path, pathVariantLabels));
  }

  for (const path of gameSpecificReadPaths) {
    const result = await readNitradoFileSample(token, serviceId, path, gameSpecificReadAttempts, pathVariantLabels);
    gameSpecificSampleResult = { ...result, path };
    if (result.sample !== null) break;
  }

  for (const dir of searchDirs) {
    checkedPaths.add(displayDir(dir));
    const entries = await listAdmFileEntries(token, serviceId, dir, listAttempts);
    for (const entry of entries) {
      if (isAdmFile(entry)) candidates.set(entry.path.toLowerCase(), entry);
    }
  }

  const newest = pickNewestAdmFile([...candidates.values()]);
  const gameSpecificSelectedPath = gameSpecificSampleResult.sample ? gameSpecificSampleResult.path : apiPathVariants[0] ?? gameSpecificLogs.selectedAdmFile?.path ?? null;
  const gameSpecificSampleReadSucceeded = gameSpecificSampleResult.sample !== null;
  const gameSpecificSampleHasMarkers = containsDayZAdminLogMarkers(gameSpecificSampleResult.sample);
  if (gameSpecificLogs.selectedAdmFile && gameSpecificSampleReadSucceeded && gameSpecificSampleHasMarkers && gameSpecificSelectedPath) {
    const selectedDisplayPath = maskNitradoUsernameInPath(gameSpecificSelectedPath, gameSpecificLogs.username);
    const debug = createAdmDebug({
      exactManualPath: null,
      pathVariants: [],
      apiLogFilePathVariants: apiPathVariants,
      pathsChecked: [...checkedPaths],
      listAttempts,
      statAttempts,
      serviceDetailsAttempt: createServiceDetailsDebug(serviceDetails.status, serviceLogPaths, gameSpecificLogs),
      gameSpecificLogs,
      filesFound: dedupeStrings([
        ...gameSpecificLogs.admLogFiles.map((entry) => entry.path),
        ...[...candidates.values()].map((entry) => entry.path),
      ]),
      selectedPath: gameSpecificSelectedPath,
      fileVisibleThroughStat: statAttempts.some((attempt) => attempt.fileVisible),
      sampleReadStatus: gameSpecificSampleResult.status,
      downloadTokenCreated: gameSpecificReadAttempts.some((attempt) => attempt.downloadTokenCreated),
      sampleReadSucceeded: true,
      samplePreview: gameSpecificSampleResult.sample,
      lastCheckedAt,
      message: buildAdmDebugMessage(
        listAttempts,
        gameSpecificReadAttempts,
        statAttempts,
        serviceDetails.status,
        true,
        true,
        gameSpecificSampleHasMarkers,
        gameSpecificSampleResult.sample,
      ),
      readAttempts: gameSpecificReadAttempts,
    });
    return withInternalAdmPath({
      found: true,
      admFileExists: true,
      sampleReadSucceeded: true,
      newestAdmFileName: gameSpecificLogs.selectedAdmFile.name,
      admPath: selectedDisplayPath,
      lastCheckedAt,
      checkedPaths: [...checkedPaths],
      debug,
    }, gameSpecificSelectedPath);
  }

  if (!newest) {
    const admFileExists = Boolean(gameSpecificLogs.selectedAdmFile || gameSpecificReadAttempts.length);
    const debug = createAdmDebug({
      exactManualPath: null,
      pathVariants: [],
      apiLogFilePathVariants: apiPathVariants,
      pathsChecked: [...checkedPaths],
      listAttempts,
      statAttempts,
      serviceDetailsAttempt: createServiceDetailsDebug(serviceDetails.status, serviceLogPaths, gameSpecificLogs),
      gameSpecificLogs,
      filesFound: [],
      selectedPath: null,
      fileVisibleThroughStat: false,
      sampleReadStatus: gameSpecificSampleResult.status,
      downloadTokenCreated: gameSpecificReadAttempts.some((attempt) => attempt.downloadTokenCreated),
      sampleReadSucceeded: gameSpecificSampleReadSucceeded,
      samplePreview: gameSpecificSampleResult.sample,
      lastCheckedAt,
      message: buildAdmDebugMessage(
        listAttempts,
        gameSpecificReadAttempts,
        statAttempts,
        serviceDetails.status,
        admFileExists,
        gameSpecificSampleReadSucceeded,
        gameSpecificSampleHasMarkers,
        gameSpecificSampleResult.sample,
      ),
      readAttempts: gameSpecificReadAttempts,
    });
    return {
      found: false,
      admFileExists,
      sampleReadSucceeded: gameSpecificSampleReadSucceeded,
      newestAdmFileName: gameSpecificLogs.selectedAdmFile?.name ?? null,
      admPath: gameSpecificSelectedPath ? maskNitradoUsernameInPath(gameSpecificSelectedPath, gameSpecificLogs.username) : null,
      lastCheckedAt,
      checkedPaths: [...checkedPaths],
      debug,
    };
  }

  const readAttempts: AdmReadAttempt[] = [];
  const sampleResult = await readNitradoFileSample(token, serviceId, newest.path, readAttempts, pathVariantLabels);
  readAttempts.unshift(...gameSpecificReadAttempts);
  const sampleReadSucceeded = sampleResult.sample !== null;
  const sampleHasMarkers = containsDayZAdminLogMarkers(sampleResult.sample);
  const debug = createAdmDebug({
    exactManualPath: null,
    pathVariants: [],
    apiLogFilePathVariants: apiPathVariants,
    pathsChecked: [...checkedPaths],
    listAttempts,
    statAttempts,
    serviceDetailsAttempt: createServiceDetailsDebug(serviceDetails.status, serviceLogPaths, gameSpecificLogs),
    gameSpecificLogs,
    filesFound: dedupeStrings([
      ...gameSpecificLogs.admLogFiles.map((entry) => entry.path),
      ...[...candidates.values()].map((entry) => entry.path),
    ]),
    selectedPath: newest.path,
    fileVisibleThroughStat: true,
    sampleReadStatus: sampleResult.status,
    downloadTokenCreated: readAttempts.some((attempt) => attempt.downloadTokenCreated),
    sampleReadSucceeded,
    samplePreview: sampleResult.sample,
    lastCheckedAt,
    message: buildAdmDebugMessage(listAttempts, readAttempts, statAttempts, serviceDetails.status, true, sampleReadSucceeded, sampleHasMarkers, sampleResult.sample),
    readAttempts,
  });
  return withInternalAdmPath({
    found: sampleReadSucceeded && sampleHasMarkers,
    admFileExists: true,
    sampleReadSucceeded,
    newestAdmFileName: newest.name,
    admPath: maskNitradoUsernameInPath(newest.path, gameSpecificLogs.username),
    lastCheckedAt,
    checkedPaths: [...checkedPaths],
    debug,
  }, newest.path);
}

export async function testExactNitradoAdmPath(
  token: string,
  serviceId: string,
  inputPath: string,
): Promise<AdmLogDetection> {
  const lastCheckedAt = new Date().toISOString();
  const pathVariants = createAdmPathVariants(inputPath);
  const serviceDetails = await fetchGameserverDetailsAttempt(token, serviceId);
  const gameSpecificLogs = extractGameSpecificLogDetails(serviceDetails.payload);
  const serviceLogPaths = extractServiceLogPaths(serviceDetails.payload);
  const serviceAdmPaths = serviceLogPaths.filter((path) => /\.adm$/i.test(path));
  const apiPathVariantEntries = buildAdmReadPathVariants(gameSpecificLogs, inputPath);
  const apiPathVariants = apiPathVariantEntries.map((entry) => entry.path);
  const pathVariantLabels = createPathVariantLabelMap(apiPathVariantEntries);
  const allPathVariants = dedupeStrings([
    ...apiPathVariants,
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
    statAttempts.push(await statNitradoFile(token, serviceId, path, pathVariantLabels));
  }

  const matchingCandidate = findMatchingAdmCandidate([...candidates.values()], allPathVariants);
  const newest = pickNewestAdmFile([...candidates.values()]);
  const readPaths = dedupeStrings([
    ...apiPathVariants,
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
    const result = await readNitradoFileSample(token, serviceId, path, readAttempts, pathVariantLabels);
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
  const admFileExists = Boolean(selectedEntry || candidates.size || fileVisibleThroughStat || sampleReadSucceeded || gameSpecificLogs.selectedAdmFile);
  const sampleHasMarkers = containsDayZAdminLogMarkers(sampleResult.sample);
  const found = admFileExists && sampleReadSucceeded && sampleHasMarkers;
  const filesFound = [...candidates.values()].map((entry) => entry.path);
  const pathsChecked = dedupeStrings([...exactDirs, ...allPathVariants]).map(displayDir);
  const debug = createAdmDebug({
    exactManualPath: inputPath,
    pathVariants: allPathVariants,
    apiLogFilePathVariants: apiPathVariants,
    pathsChecked,
    listAttempts,
    statAttempts,
    serviceDetailsAttempt: createServiceDetailsDebug(serviceDetails.status, serviceLogPaths, gameSpecificLogs),
    gameSpecificLogs,
    filesFound: dedupeStrings([...gameSpecificLogs.admLogFiles.map((entry) => entry.path), ...filesFound]),
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
      sampleResult.sample,
    ),
    readAttempts,
  });

  return withInternalAdmPath({
    found,
    admFileExists,
    sampleReadSucceeded,
    newestAdmFileName: selectedEntry?.name ?? gameSpecificLogs.selectedAdmFile?.name ?? selectedPath?.split("/").filter(Boolean).at(-1) ?? null,
    admPath: selectedPath ? maskNitradoUsernameInPath(found ? normalizeRemotePath(selectedPath) : selectedPath, gameSpecificLogs.username) : null,
    lastCheckedAt,
    checkedPaths: pathsChecked,
    debug,
  }, selectedPath);
}

export function mockAdmLogDetection(): AdmLogDetection {
  const newestAdmFileName = "DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM";
  const admPath = `dayzps/config/${newestAdmFileName}`;
  const lastCheckedAt = new Date().toISOString();
  const mockResponseShape = {
    hasData: true,
    hasToken: true,
    hasTokenUrl: true,
    hasTokenValue: true,
    topLevelKeys: ["data"],
    dataKeys: ["token"],
    hasDataToken: true,
    hasDataTokenUrl: true,
    hasDataTokenValue: true,
    hasDataDownload: false,
    hasDataUrl: false,
  };
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
      apiLogFilePathVariants: ["/games/{gameserver-username}/noftp/DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM"],
      methodsTried: [
        {
          method: "download",
          path: admPath,
          pathVariantLabel: "C",
          requestUrlPathOnly: "/services/{serviceId}/gameservers/file_server/download?file=dayzps%2Fconfig%2FDAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
          httpStatusCode: 200,
          responseContentType: "application/json",
          pathRedacted: admPath,
          status: "OK",
          responseShape: mockResponseShape,
          errorMessageSafe: null,
          downloadTokenCreated: true,
          tokenUrlReceived: true,
          sampleFetchAttempted: true,
          sampleFetchStatus: "OK",
          sampleReadSucceeded: true,
          success: true,
        },
        {
          method: "seek",
          path: admPath,
          pathVariantLabel: "C",
          requestUrlPathOnly: "/services/{serviceId}/gameservers/file_server/seek?file=dayzps%2Fconfig%2FDAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM&offset=0&length=4096&mode=raw",
          httpStatusCode: 200,
          responseContentType: "application/json",
          pathRedacted: admPath,
          status: "OK",
          responseShape: mockResponseShape,
          errorMessageSafe: null,
          downloadTokenCreated: true,
          tokenUrlReceived: true,
          sampleFetchAttempted: true,
          sampleFetchStatus: "OK",
          sampleReadSucceeded: true,
          success: true,
        },
        {
          method: "stat",
          path: admPath,
          pathVariantLabel: "C",
          requestUrlPathOnly: "/services/{serviceId}/gameservers/file_server/stat?files[]=dayzps%2Fconfig%2FDAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
          httpStatusCode: 200,
          responseContentType: "application/json",
          pathRedacted: admPath,
          status: "OK",
          fileVisible: true,
          responseShape: emptyResponseShape(),
          errorMessageSafe: null,
          success: true,
        },
        { method: "list", dir: "dayzps/config", search: ".ADM", status: "OK", entriesReturned: 1, admFilesFound: 1 },
      ],
      statAttempts: [{
        path: admPath,
        pathVariantLabel: "C",
        requestUrlPathOnly: "/services/{serviceId}/gameservers/file_server/stat?files[]=dayzps%2Fconfig%2FDAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
        httpStatusCode: 200,
        responseContentType: "application/json",
        status: "OK",
        fileVisible: true,
        responseShape: emptyResponseShape(),
        errorMessageSafe: null,
        success: true,
      }],
      serviceDetailsAttempt: {
        status: "OK",
        pathsFound: 1,
        gameserverUsernameFound: true,
        gameSpecificLogFilesFound: true,
        logFilesReturned: 3,
        gameSpecificAdmFilesFound: 1,
        selectedGameSpecificAdmFile: newestAdmFileName,
      },
      gameserverUsernameFound: true,
      gameSpecificLogFilesFound: true,
      gameSpecificLogFilesReturned: 3,
      gameSpecificAdmFilesFound: [newestAdmFileName],
      selectedGameSpecificAdmFile: newestAdmFileName,
      apiLogFilePathTested: "/games/{gameserver-username}/noftp/DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
      actualUsernameUsed: true,
      usernameRedactedInUi: true,
      tokenUrlReceived: true,
      sampleFetchAttempted: true,
      sampleFetchStatus: "OK",
      fileVisibleThroughStat: true,
      downloadTokenCreated: true,
      sampleReadStatus: "OK",
      sampleReadSucceeded: true,
      samplePreview: "AdminLog started\nPlayer MockSurvivor is connected\nPlayer MockSurvivor placed Fireplace",
      lastCheckedAt,
      message: null,
      readAttempts: [{
        path: admPath,
        method: "download",
        pathVariantLabel: "C",
        requestUrlPathOnly: "/services/{serviceId}/gameservers/file_server/download?file=dayzps%2Fconfig%2FDAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
        httpStatusCode: 200,
        responseContentType: "application/json",
        status: "OK",
        responseShape: mockResponseShape,
        errorMessageSafe: null,
        downloadTokenCreated: true,
        tokenUrlReceived: true,
        sampleFetchAttempted: true,
        sampleFetchStatus: "OK",
        sampleReadSucceeded: true,
        success: true,
      }],
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
      ipAddress: details.address?.split(":")[0],
      platform: detectPlatform(`${details.game ?? ""} ${details.folder_short ?? ""} ${details.portlist_short ?? ""}`),
      status: service.status,
    };
  });
}

function normalizeGameserverDetails(payload: unknown, serviceId: string): NitradoService {
  const gameserver = findRecordByKey(payload, "gameserver") ?? {};
  const details = isRecord(gameserver.details) ? gameserver.details : {};
  const settings = isRecord(gameserver.settings) ? gameserver.settings : {};
  const config = isRecord(settings.config) ? settings.config : {};
  const query = isRecord(gameserver.query) ? gameserver.query : {};
  const gameSpecific = isRecord(gameserver.game_specific) ? gameserver.game_specific : {};

  const name = firstString(
    config.hostname,
    gameserver.name,
    gameserver.hostname,
    details.name,
    details.server_name,
    query.name,
  ) || `Nitrado Service ${serviceId}`;
  const game = firstString(
    gameserver.game,
    gameserver.game_human,
    gameserver.game_short,
    details.game,
    details.folder_short,
    details.portlist_short,
    gameSpecific.game,
  ) || "Unknown";
  const ipAddress = normalizeIpAddress(firstString(
    gameserver.ip,
    gameserver.address,
    query.ip,
    query.address,
    details.address,
  ));
  const platform = firstString(
    gameSpecific.platform,
    gameserver.platform,
    details.platform,
  ) || detectPlatform(`${game} ${details.folder_short ?? ""} ${details.portlist_short ?? ""}`);
  const playerSlots = firstNumber(
    gameserver.slots,
    gameserver.player_slots,
    gameserver.maxplayers,
    config.slots,
    config.maxplayers,
    query.maxplayers,
    query.max_players,
  );
  const status = firstString(gameserver.status, query.status, details.status);

  return {
    id: serviceId,
    name,
    game,
    region: ipAddress,
    platform,
    ipAddress,
    playerSlots,
    status,
  };
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
  pathVariantLabels?: Map<string, string>,
) {
  const download = await readNitradoFileViaDownload(token, serviceId, file, readAttempts, pathVariantLabels);
  if (download.sample !== null) return download;
  return readNitradoFileViaSeek(token, serviceId, file, readAttempts, pathVariantLabels);
}

async function readNitradoFileViaSeek(
  token: string,
  serviceId: string,
  file: string,
  readAttempts?: AdmReadAttempt[],
  pathVariantLabels?: Map<string, string>,
) {
  const pathVariantLabel = getPathVariantLabel(pathVariantLabels, file);
  const requestUrlPathOnly = buildRequestUrlPathOnly(serviceId, "seek", file);
  if (isUnsafeRemotePathForRequest(file)) {
    readAttempts?.push(createReadAttempt(file, "seek", "error", {
      pathVariantLabel,
      requestUrlPathOnly,
      errorMessageSafe: "Skipped unsafe or placeholder path",
    }));
    return createSampleResult(null, "error", false, "error", false, "Skipped unsafe or placeholder path");
  }

  try {
    const url = new URL(`${NITRADO_API}${requestUrlPathOnly}`);
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    const responseContentType = response.headers.get("content-type");
    if (!response.ok) {
      const status = safeResponseStatus(response);
      readAttempts?.push(createReadAttempt(file, "seek", status, {
        pathVariantLabel,
        requestUrlPathOnly,
        httpStatusCode: response.status,
        responseContentType,
        errorMessageSafe: safeFileApiError(status),
      }));
      return createSampleResult(null, status, false, "not_attempted", false, safeFileApiError(status));
    }
    const payload = await parseJsonPayload(response);
    const sample = await fetchTokenizedFileSample(payload, token);
    readAttempts?.push(createReadAttempt(file, "seek", sample.status, {
      pathVariantLabel,
      requestUrlPathOnly,
      httpStatusCode: response.status,
      responseContentType,
      responseShape: sample.responseShape,
      errorMessageSafe: sample.errorMessageSafe,
      downloadTokenCreated: sample.downloadTokenCreated,
      tokenUrlReceived: sample.tokenUrlReceived,
      sampleFetchAttempted: sample.sampleFetchAttempted,
      sampleFetchStatus: sample.sampleFetchStatus,
      sampleReadSucceeded: sample.sample !== null,
    }));
    return sample;
  } catch {
    readAttempts?.push(createReadAttempt(file, "seek", "error", {
      pathVariantLabel,
      requestUrlPathOnly,
      errorMessageSafe: "Nitrado seek request failed",
    }));
    return createSampleResult(null, "error", false, "error", false, "Nitrado seek request failed");
  }
}

async function readNitradoFileViaDownload(
  token: string,
  serviceId: string,
  file: string,
  readAttempts?: AdmReadAttempt[],
  pathVariantLabels?: Map<string, string>,
) {
  const pathVariantLabel = getPathVariantLabel(pathVariantLabels, file);
  const requestUrlPathOnly = buildRequestUrlPathOnly(serviceId, "download", file);
  if (isUnsafeRemotePathForRequest(file)) {
    readAttempts?.push(createReadAttempt(file, "download", "error", {
      pathVariantLabel,
      requestUrlPathOnly,
      errorMessageSafe: "Skipped unsafe or placeholder path",
    }));
    return createSampleResult(null, "error", false, "error", false, "Skipped unsafe or placeholder path");
  }

  try {
    const url = new URL(`${NITRADO_API}${requestUrlPathOnly}`);
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    const responseContentType = response.headers.get("content-type");
    if (!response.ok) {
      const status = safeResponseStatus(response);
      readAttempts?.push(createReadAttempt(file, "download", status, {
        pathVariantLabel,
        requestUrlPathOnly,
        httpStatusCode: response.status,
        responseContentType,
        errorMessageSafe: safeFileApiError(status),
      }));
      return createSampleResult(null, status, false, "not_attempted", false, safeFileApiError(status));
    }
    const payload = await parseJsonPayload(response);
    const sample = await fetchTokenizedFileSample(payload, token);
    readAttempts?.push(createReadAttempt(file, "download", sample.status, {
      pathVariantLabel,
      requestUrlPathOnly,
      httpStatusCode: response.status,
      responseContentType,
      responseShape: sample.responseShape,
      errorMessageSafe: sample.errorMessageSafe,
      downloadTokenCreated: sample.downloadTokenCreated,
      tokenUrlReceived: sample.tokenUrlReceived,
      sampleFetchAttempted: sample.sampleFetchAttempted,
      sampleFetchStatus: sample.sampleFetchStatus,
      sampleReadSucceeded: sample.sample !== null,
    }));
    return sample;
  } catch {
    readAttempts?.push(createReadAttempt(file, "download", "error", {
      pathVariantLabel,
      requestUrlPathOnly,
      errorMessageSafe: "Nitrado download request failed",
    }));
    return createSampleResult(null, "error", false, "error", false, "Nitrado download request failed");
  }
}

async function statNitradoFile(
  token: string,
  serviceId: string,
  file: string,
  pathVariantLabels?: Map<string, string>,
): Promise<AdmStatAttempt> {
  const pathVariantLabel = getPathVariantLabel(pathVariantLabels, file);
  const requestUrlPathOnly = buildRequestUrlPathOnly(serviceId, "stat", file);
  if (isUnsafeRemotePathForRequest(file)) {
    return {
      path: file,
      pathVariantLabel,
      requestUrlPathOnly,
      httpStatusCode: null,
      responseContentType: null,
      status: "error",
      fileVisible: false,
      responseShape: emptyResponseShape(),
      errorMessageSafe: "Skipped unsafe or placeholder path",
      success: false,
    };
  }

  try {
    const url = new URL(`${NITRADO_API}${requestUrlPathOnly}`);
    const response = await fetch(url, { headers: nitradoHeaders(token) });
    const responseContentType = response.headers.get("content-type");
    const status = safeResponseStatus(response);
    if (!response.ok) {
      return {
        path: file,
        pathVariantLabel,
        requestUrlPathOnly,
        httpStatusCode: response.status,
        responseContentType,
        status,
        fileVisible: false,
        responseShape: emptyResponseShape(),
        errorMessageSafe: safeFileApiError(status),
        success: false,
      };
    }
    const payload = await parseJsonPayload(response);
    const fileVisible = statPayloadShowsFile(payload, file);
    return {
      path: file,
      pathVariantLabel,
      requestUrlPathOnly,
      httpStatusCode: response.status,
      responseContentType,
      status: "OK",
      fileVisible,
      responseShape: describeFileTokenResponseShape(payload),
      errorMessageSafe: null,
      success: fileVisible,
    };
  } catch {
    return {
      path: file,
      pathVariantLabel,
      requestUrlPathOnly,
      httpStatusCode: null,
      responseContentType: null,
      status: "error",
      fileVisible: false,
      responseShape: emptyResponseShape(),
      errorMessageSafe: "Nitrado stat request failed",
      success: false,
    };
  }
}

async function fetchTokenizedFileSample(payload: unknown, nitradoToken: string) {
  const responseShape = describeFileTokenResponseShape(payload);
  const token = extractDownloadToken(payload);
  if (!token) {
    const message = responseShape.hasData || responseShape.topLevelKeys.length > 0
      ? "Nitrado responded successfully but did not include a recognized download token shape."
      : "No JSON response body returned by Nitrado file API";
    return createSampleResult(
      null,
      "OK",
      false,
      "not_attempted",
      false,
      message,
      responseShape,
      false,
    );
  }

  if (!token.url) {
    return createSampleResult(
      null,
      "OK",
      true,
      "not_attempted",
      false,
      "Download token response did not include a usable URL",
      responseShape,
      false,
    );
  }

  const sampleAttempts = [
    () => fetchTokenizedFileSampleUrl(token, { tokenQuery: true, offsetCount: true, authorizationToken: null }),
    () => fetchTokenizedFileSampleUrl(token, { tokenQuery: false, offsetCount: true, authorizationToken: nitradoToken }),
    () => fetchTokenizedFileSampleUrl(token, { tokenQuery: false, offsetCount: true, authorizationToken: null }),
    () => fetchTokenizedFileSampleUrl(token, { tokenQuery: false, offsetCount: false, authorizationToken: nitradoToken }),
    () => fetchTokenizedFileSampleUrl(token, { tokenQuery: false, offsetCount: false, authorizationToken: null }),
  ];

  let lastResult = createSampleResult(null, "error", true, "error", true, "Tokenized sample fetch failed");
  for (const attempt of sampleAttempts) {
    const result = await attempt();
    lastResult = result;
    if (result.sample !== null) {
      return {
        ...result,
        responseShape,
        downloadTokenCreated: true,
        tokenUrlReceived: true,
        sampleFetchAttempted: true,
        errorMessageSafe: null,
      };
    }
  }

  return {
    ...lastResult,
    responseShape,
    status: "OK" as const,
    downloadTokenCreated: true,
    tokenUrlReceived: true,
    sampleFetchAttempted: true,
    errorMessageSafe: "Tokenized sample fetch failed",
  };
}

async function fetchTokenizedFileSampleUrl(
  token: DownloadTokenDescriptor,
  options: { tokenQuery: boolean; offsetCount: boolean; authorizationToken: string | null },
) {
  if (!token.url) {
    return createSampleResult(null, "error", true, "not_attempted", false, "Download token response did not include a usable URL");
  }

  try {
    const url = new URL(token.url);
    if (options.tokenQuery && token.token) url.searchParams.set("token", token.token);
    if (options.offsetCount) {
      url.searchParams.set("offset", "0");
      url.searchParams.set("count", String(ADM_SAMPLE_BYTES));
    }

    const response = await fetch(url, {
      headers: options.authorizationToken ? { authorization: `Bearer ${options.authorizationToken}` } : undefined,
    });
    const status = safeResponseStatus(response);
    if (!response.ok) {
      return createSampleResult(null, status, true, status, true, "Tokenized sample fetch failed");
    }
    return {
      ...createSampleResult((await response.text()).slice(0, ADM_SAMPLE_BYTES), "OK", true, "OK", true, null),
    };
  } catch {
    return createSampleResult(null, "error", true, "error", true, "Tokenized sample fetch failed");
  }
}

function createSampleResult(
  sample: string | null,
  status: SafeApiStatus,
  downloadTokenCreated: boolean,
  sampleFetchStatus: SampleFetchStatus,
  sampleFetchAttempted: boolean,
  errorMessageSafe: string | null,
  responseShape: AdmApiResponseShape = emptyResponseShape(),
  tokenUrlReceived = downloadTokenCreated,
) {
  return {
    sample,
    status,
    downloadTokenCreated,
    tokenUrlReceived,
    sampleFetchAttempted,
    sampleFetchStatus,
    sampleReadSucceeded: sample !== null,
    responseShape,
    errorMessageSafe,
  };
}

function createReadAttempt(
  path: string,
  method: "seek" | "download",
  status: SafeApiStatus,
  values: Partial<Omit<AdmReadAttempt, "path" | "method" | "status">> = {},
): AdmReadAttempt {
  return {
    path,
    method,
    pathVariantLabel: values.pathVariantLabel ?? null,
    requestUrlPathOnly: values.requestUrlPathOnly ?? "",
    httpStatusCode: values.httpStatusCode ?? null,
    responseContentType: values.responseContentType ?? null,
    status,
    responseShape: values.responseShape ?? emptyResponseShape(),
    errorMessageSafe: values.errorMessageSafe ?? null,
    downloadTokenCreated: values.downloadTokenCreated ?? false,
    tokenUrlReceived: values.tokenUrlReceived ?? false,
    sampleFetchAttempted: values.sampleFetchAttempted ?? false,
    sampleFetchStatus: values.sampleFetchStatus ?? "not_attempted",
    sampleReadSucceeded: values.sampleReadSucceeded ?? false,
    success: values.success ?? values.sampleReadSucceeded ?? false,
  };
}

function emptyResponseShape(): AdmApiResponseShape {
  return {
    hasData: false,
    hasToken: false,
    hasTokenUrl: false,
    hasTokenValue: false,
    topLevelKeys: [],
    dataKeys: [],
    hasDataToken: false,
    hasDataTokenUrl: false,
    hasDataTokenValue: false,
    hasDataDownload: false,
    hasDataUrl: false,
  };
}

function describeFileTokenResponseShape(payload: unknown): AdmApiResponseShape {
  const token = findTokenObject(payload);
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const dataToken = data.token;
  return {
    hasData: payloadHasKey(payload, "data"),
    hasToken: payloadHasKey(payload, "token"),
    hasTokenUrl: Boolean(token?.url),
    hasTokenValue: Boolean(token?.token),
    topLevelKeys: safeObjectKeys(payload),
    dataKeys: safeObjectKeys(data),
    hasDataToken: Object.prototype.hasOwnProperty.call(data, "token"),
    hasDataTokenUrl: isRecord(dataToken) && typeof dataToken.url === "string",
    hasDataTokenValue: typeof dataToken === "string" || (isRecord(dataToken) && typeof dataToken.token === "string"),
    hasDataDownload: Object.prototype.hasOwnProperty.call(data, "download"),
    hasDataUrl: typeof data.url === "string",
  };
}

function safeObjectKeys(value: unknown) {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .filter((key) => !isSensitiveResponseKey(key))
    .slice(0, 16);
}

function isSensitiveResponseKey(key: string) {
  return /(password|passwd|secret|credential|mysql|^ftp$|ftp_|_ftp|ftpuser|ftp_user)/i.test(key);
}

function payloadHasKey(value: unknown, key: string): boolean {
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((child) => payloadHasKey(child, key));
}

function safeFileApiError(status: SafeApiStatus) {
  if (status === "401") return "Nitrado token was rejected";
  if (status === "403") return "Nitrado file browser permission denied";
  if (status === "404") return "Nitrado file path not found";
  return "Nitrado file request failed";
}

async function parseJsonPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/json/i.test(contentType)) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildRequestUrlPathOnly(serviceId: string, method: "download" | "seek" | "stat", path: string) {
  const base = `/services/${encodeURIComponent(serviceId)}/gameservers/file_server/${method}`;
  if (method === "download") {
    return `${base}?file=${encodeURIComponent(path)}`;
  }
  if (method === "seek") {
    return `${base}?file=${encodeURIComponent(path)}&offset=0&length=${ADM_SAMPLE_BYTES}&mode=raw`;
  }
  return `${base}?files[]=${encodeURIComponent(path)}`;
}

function buildSafeRequestUrlPathOnly(method: "download" | "seek" | "stat", redactedPath: string) {
  const base = `/services/{serviceId}/gameservers/file_server/${method}`;
  if (method === "download") {
    return `${base}?file=${encodeURIComponent(redactedPath)}`;
  }
  if (method === "seek") {
    return `${base}?file=${encodeURIComponent(redactedPath)}&offset=0&length=${ADM_SAMPLE_BYTES}&mode=raw`;
  }
  return `${base}?files[]=${encodeURIComponent(redactedPath)}`;
}

function extractDownloadToken(payload: unknown): DownloadTokenDescriptor | null {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const candidates = [
    tokenFromValue(data.token),
    tokenFromValue(data.download),
    tokenFromValue(data.url),
    tokenFromValue(root.token),
    tokenFromValue(root.url),
  ].filter((candidate): candidate is DownloadTokenDescriptor => Boolean(candidate));

  const url = candidates.find((candidate) => candidate.url)?.url ?? null;
  const token = candidates.find((candidate) => candidate.token)?.token ?? null;
  if (url || token) return { url, token };
  return candidates[0] ?? findTokenObject(payload);
}

function findTokenObject(value: unknown): DownloadTokenDescriptor | null {
  if (!isRecord(value)) return null;
  const direct = tokenFromValue(value);
  if (direct?.url || direct?.token) return direct;
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    const found = findTokenObject(child);
    if (found) return found;
  }
  return null;
}

function tokenFromValue(value: unknown): DownloadTokenDescriptor | null {
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value)
      ? { url: value, token: null }
      : { url: null, token: value };
  }
  if (!isRecord(value)) return null;
  const url = stringValue(value.url || value.href || value.download_url || value.downloadUrl);
  const token = stringValue(value.token || value.value || value.key);
  if (!url && !token) return null;
  return { url: url || null, token: token || null };
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

function normalizeGameSpecificLogFile(value: unknown): NitradoFileEntry | null {
  if (typeof value === "string" || typeof value === "number") {
    const path = normalizeRemotePath(String(value));
    if (!isSafePathLikeValue(path) || !isAdmLogPath(path)) return null;
    const name = path.split("/").filter(Boolean).at(-1) ?? path;
    return { name, path };
  }

  if (!isRecord(value)) return null;
  const name = stringValue(value.name ?? value.filename ?? value.file_name ?? value.log_file);
  const rawPath = stringValue(value.path ?? value.file ?? value.filename ?? value.name ?? value.log_file);
  const dir = stringValue(value.dir ?? value.directory ?? value.dirpath ?? value.dir_path);
  const path = normalizeRemotePath(rawPath && rawPath !== name ? rawPath : joinRemotePath(dir, name || rawPath));
  if (!path || !isSafePathLikeValue(path) || !isAdmLogPath(path)) return null;

  return {
    name: name || path.split("/").filter(Boolean).at(-1) || path,
    path,
    modified: stringValue(value.modified ?? value.mtime ?? value.last_modified ?? value.changed) ?? null,
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

function findRecordByKey(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const direct = value[key];
  if (isRecord(direct)) return direct;
  for (const child of Object.values(value)) {
    const found = findRecordByKey(child, key);
    if (found) return found;
  }
  return null;
}

function flattenSafeLogValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenSafeLogValues);
  if (typeof value === "string" || typeof value === "number") return [value];
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (isSensitiveKey(key)) return [];
    const values = flattenSafeLogValues(child);
    return isAdmLogPath(key) ? [key, ...values] : values;
  });
}

function extractGameSpecificLogContextPaths(gameSpecific: Record<string, unknown>) {
  const paths = new Set<string>();
  collectGameSpecificLogContextPaths(gameSpecific, [], false, paths);
  return [...paths].slice(0, 64);
}

function collectGameSpecificLogContextPaths(
  value: unknown,
  keyPath: string[],
  inLogContext: boolean,
  paths: Set<string>,
) {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    const lastKey = keyPath.at(-1) ?? "";
    if ((inLogContext || isAdmLogPath(text)) && !isSensitiveKey(lastKey) && isSafePathLikeValue(text)) {
      paths.add(normalizeRemotePath(text));
    }
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    const nextLogContext = inLogContext || isGameSpecificLogContextKey(key);
    if (nextLogContext && isAdmLogPath(key)) paths.add(normalizeRemotePath(key));
    collectGameSpecificLogContextPaths(child, [...keyPath, key], nextLogContext, paths);
  }
}

function isGameSpecificLogContextKey(key: string) {
  return /(log|logs|log_files|adm|admin|file|files|crash|rpt)/i.test(key);
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

function isAdmLogPath(value: string) {
  return /\.adm$/i.test(value) || (/dayzserver/i.test(value) && /\.adm/i.test(value));
}

function dedupeFileEntries(entries: NitradoFileEntry[]) {
  const seen = new Map<string, NitradoFileEntry>();
  for (const entry of entries) {
    seen.set(normalizeRemotePath(entry.path).toLowerCase(), entry);
  }
  return [...seen.values()];
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

function containsAdminLogStarted(sample: string | null) {
  return Boolean(sample && /AdminLog started/i.test(sample));
}

function containsPlayerActivityMarkers(sample: string | null) {
  if (!sample) return false;
  return [
    /Player/i,
    /is connected/i,
    /has been disconnected/i,
    /\bplaced\b/i,
    /\bkilled\b/i,
    /\bdied\b/i,
  ].some((marker) => marker.test(sample));
}

function createAdmPathVariants(inputPath: string) {
  const normalized = normalizeRemotePath(inputPath.trim().replace(/[\u0000-\u001f]/g, ""));
  if (isUnsafeRemotePathForRequest(normalized)) return [];
  const upperFileName = uppercaseRemoteFileName(normalized);
  return dedupeStrings([
    normalized,
    `/${normalized}`,
    upperFileName,
    `/${upperFileName}`,
  ]);
}

function isUnsafeRemotePathForRequest(path: string) {
  const normalized = normalizeRemotePath(path.trim().replace(/[\u0000-\u001f]/g, ""));
  return (
    !normalized ||
    /^https?:\/\//i.test(normalized) ||
    normalized.includes("..") ||
    /[{}]/.test(normalized) ||
    /gameserver-username/i.test(normalized)
  );
}

function extractGameSpecificLogDetails(payload: unknown): GameSpecificLogDetails {
  const gameserver = findRecordByKey(payload, "gameserver");
  const rawUsername = gameserver ? stringValue(gameserver.username).trim() : "";
  const username = isSafeNitradoPathSegment(rawUsername) ? rawUsername : null;
  const gameSpecific = gameserver && isRecord(gameserver.game_specific) ? gameserver.game_specific : null;
  const logFilesFound = Boolean(gameSpecific && Object.prototype.hasOwnProperty.call(gameSpecific, "log_files"));
  const directLogFiles = gameSpecific && logFilesFound ? flattenSafeLogValues(gameSpecific.log_files) : [];
  const logContextPaths = gameSpecific ? extractGameSpecificLogContextPaths(gameSpecific) : [];
  const admLogFiles = dedupeFileEntries([
    ...directLogFiles.map(normalizeGameSpecificLogFile).filter((entry): entry is NitradoFileEntry => Boolean(entry)),
    ...logContextPaths.map((path) => normalizeGameSpecificLogFile(path)).filter((entry): entry is NitradoFileEntry => Boolean(entry)),
  ]).filter(isAdmFile);
  const selectedAdmFile = pickNewestAdmFile(admLogFiles);

  return {
    username,
    usernameFound: Boolean(username),
    logFilesFound,
    logFilesReturned: directLogFiles.length,
    admLogFiles,
    selectedAdmFile,
    logContextPaths,
  };
}

function buildAdmReadPathVariants(details: GameSpecificLogDetails, manualPath?: string): AdmPathVariant[] {
  const sources = dedupeStrings([
    ...(details.selectedAdmFile ? [details.selectedAdmFile.path] : []),
    ...(manualPath ? [manualPath] : []),
    ...details.admLogFiles.map((entry) => entry.path),
  ]);
  const variants: AdmPathVariant[] = [];

  for (const source of sources) {
    const normalized = normalizeRemotePath(source);
    if (isUnsafeRemotePathForRequest(normalized)) continue;
    const fileName = normalized.split("/").filter(Boolean).at(-1);
    if (!fileName || !/(\.adm$|dayzserver.*\.adm$)/i.test(fileName)) continue;
    const visiblePath = normalizeRemotePath(manualPath || (normalized.includes("/") ? normalized : `dayzps/config/${fileName}`));

    variants.push({ label: "A", path: fileName });
    variants.push({ label: "B", path: `/${fileName}` });
    variants.push({ label: "C", path: visiblePath });
    variants.push({ label: "D", path: `/${visiblePath}` });

    if (!details.username) continue;

    variants.push({ label: "E", path: `/games/${details.username}/noftp/${fileName}` });
    variants.push({ label: "F", path: `/games/${details.username}/noftp/dayzps/config/${fileName}` });
    variants.push({ label: "G", path: `/games/${details.username}/noftp/config/${fileName}` });

    const noftpPath = normalized.toLowerCase().startsWith(`games/${details.username.toLowerCase()}/noftp/`)
      ? `/${normalized}`
      : `/games/${details.username}/noftp/${normalized}`;
    variants.push({ label: "H", path: noftpPath });
  }

  return dedupePathVariants(variants).slice(0, 80);
}

function createServiceDetailsDebug(
  status: SafeApiStatus,
  serviceLogPaths: string[],
  gameSpecificLogs: GameSpecificLogDetails,
): AdmServiceDetailsAttempt {
  return {
    status,
    pathsFound: dedupeStrings([...serviceLogPaths, ...gameSpecificLogs.logContextPaths]).length,
    gameserverUsernameFound: gameSpecificLogs.usernameFound,
    gameSpecificLogFilesFound: gameSpecificLogs.logFilesFound,
    logFilesReturned: gameSpecificLogs.logFilesReturned,
    gameSpecificAdmFilesFound: gameSpecificLogs.admLogFiles.length,
    selectedGameSpecificAdmFile: gameSpecificLogs.selectedAdmFile?.name ?? null,
  };
}

function dedupePathVariants(variants: AdmPathVariant[]) {
  const seen = new Map<string, AdmPathVariant>();
  for (const variant of variants) {
    const normalized = normalizeRemotePath(variant.path);
    if (isUnsafeRemotePathForRequest(normalized)) continue;
    if (!seen.has(normalized.toLowerCase())) {
      seen.set(normalized.toLowerCase(), variant);
    }
  }
  return [...seen.values()];
}

function createPathVariantLabelMap(variants: AdmPathVariant[]) {
  const labels = new Map<string, string>();
  for (const variant of variants) {
    labels.set(normalizeRemotePath(variant.path).toLowerCase(), variant.label);
  }
  return labels;
}

function getPathVariantLabel(labels: Map<string, string> | undefined, path: string) {
  return labels?.get(normalizeRemotePath(path).toLowerCase()) ?? null;
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
  if (/(password|passwd|secret|token|credential|mysql|ftp:\/\/)/i.test(value)) return false;
  return /(\.adm$|dayz|config|logs?|games\/.+\/noftp)/i.test(value);
}

function isSensitiveKey(key: string) {
  return /(password|passwd|secret|token|credential|mysql|^ftp$|ftp_|_ftp|ftpuser|ftp_user)/i.test(key);
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
  apiLogFilePathVariants,
  pathsChecked,
  listAttempts,
  statAttempts,
  serviceDetailsAttempt,
  gameSpecificLogs,
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
  apiLogFilePathVariants: string[];
  pathsChecked: string[];
  listAttempts: AdmListAttempt[];
  statAttempts: AdmStatAttempt[];
  serviceDetailsAttempt: AdmServiceDetailsAttempt | null;
  gameSpecificLogs: GameSpecificLogDetails;
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
  const mask = (value: string) => maskNitradoUsernameInPath(value, gameSpecificLogs.username);
  const username = gameSpecificLogs.username;
  const actualUsernameUsed = Boolean(
    username &&
      [
        ...apiLogFilePathVariants,
        ...pathVariants,
        ...statAttempts.map((attempt) => attempt.path),
        ...readAttempts.map((attempt) => attempt.path),
        selectedPath ?? "",
      ].some((path) => pathUsesNitradoUsername(path, username)),
  );
  const successfulReadAttempt = readAttempts.find((attempt) => attempt.sampleReadSucceeded);
  const latestReadAttempt = readAttempts.at(-1);
  const representativeReadAttempt = successfulReadAttempt ?? latestReadAttempt;
  return {
    exactManualPath,
    pathVariants: dedupeStrings(pathVariants.map(mask)).slice(0, 24),
    apiLogFilePathVariants: dedupeStrings(apiLogFilePathVariants.map(mask)).slice(0, 24),
    pathsChecked: dedupeStrings(pathsChecked.map(mask)).slice(0, 64),
    methodsTried: buildMethodAttempts(serviceDetailsAttempt, listAttempts, statAttempts, readAttempts, gameSpecificLogs.username).slice(0, 140),
    listAttempts: listAttempts.map((attempt) => stripListAttemptEntries(attempt, gameSpecificLogs.username)).slice(0, 80),
    statAttempts: statAttempts.map((attempt) => {
      const redactedPath = mask(attempt.path);
      return {
        ...attempt,
        path: redactedPath,
        requestUrlPathOnly: buildSafeRequestUrlPathOnly("stat", redactedPath),
      };
    }).slice(0, 32),
    serviceDetailsAttempt,
    gameserverUsernameFound: gameSpecificLogs.usernameFound,
    gameSpecificLogFilesFound: gameSpecificLogs.logFilesFound,
    gameSpecificLogFilesReturned: gameSpecificLogs.logFilesReturned,
    gameSpecificAdmFilesFound: dedupeStrings(gameSpecificLogs.admLogFiles.map((entry) => mask(entry.path))).slice(0, 40),
    selectedGameSpecificAdmFile: gameSpecificLogs.selectedAdmFile?.name ?? null,
    apiLogFilePathTested: selectedPath ? mask(selectedPath) : null,
    actualUsernameUsed,
    usernameRedactedInUi: actualUsernameUsed,
    tokenUrlReceived: readAttempts.some((attempt) => attempt.tokenUrlReceived),
    sampleFetchAttempted: readAttempts.some((attempt) => attempt.sampleFetchAttempted),
    sampleFetchStatus: representativeReadAttempt?.sampleFetchStatus ?? "not_attempted",
    filesFound: dedupeStrings(filesFound.map(mask)).slice(0, 40),
    exactSelectedAdmPath: selectedPath ? mask(selectedPath) : null,
    fileVisibleThroughStat,
    downloadTokenCreated,
    sampleReadStatus,
    sampleReadSucceeded,
    samplePreview: samplePreview ? samplePreview.slice(0, 300) : null,
    lastCheckedAt,
    message,
    readAttempts: readAttempts.map((attempt) => {
      const redactedPath = mask(attempt.path);
      return {
        ...attempt,
        path: redactedPath,
        requestUrlPathOnly: buildSafeRequestUrlPathOnly(attempt.method, redactedPath),
      };
    }).slice(0, 20),
  };
}

function buildMethodAttempts(
  serviceDetailsAttempt: AdmServiceDetailsAttempt | null,
  listAttempts: AdmListAttempt[],
  statAttempts: AdmStatAttempt[],
  readAttempts: AdmReadAttempt[],
  username: string | null,
): AdmMethodAttempt[] {
  const mask = (value: string) => maskNitradoUsernameInPath(value, username);
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
      dir: mask(attempt.dir),
      search: attempt.search,
      entriesReturned: attempt.fileCount,
      admFilesFound: attempt.admFileCount,
    })),
    ...statAttempts.map((attempt) => ({
      method: "stat" as const,
      status: attempt.status,
      pathVariantLabel: attempt.pathVariantLabel,
      path: mask(attempt.path),
      pathRedacted: mask(attempt.path),
      redactedPath: mask(attempt.path),
      requestUrlPathOnly: buildSafeRequestUrlPathOnly("stat", mask(attempt.path)),
      httpStatusCode: attempt.httpStatusCode,
      responseContentType: attempt.responseContentType,
      fileVisible: attempt.fileVisible,
      responseShape: attempt.responseShape,
      errorMessageSafe: attempt.errorMessageSafe,
      success: attempt.success,
    })),
    ...readAttempts.map((attempt) => ({
      method: attempt.method,
      status: attempt.status,
      pathVariantLabel: attempt.pathVariantLabel,
      path: mask(attempt.path),
      pathRedacted: mask(attempt.path),
      redactedPath: mask(attempt.path),
      requestUrlPathOnly: buildSafeRequestUrlPathOnly(attempt.method, mask(attempt.path)),
      httpStatusCode: attempt.httpStatusCode,
      responseContentType: attempt.responseContentType,
      responseShape: attempt.responseShape,
      errorMessageSafe: attempt.errorMessageSafe,
      downloadTokenCreated: attempt.downloadTokenCreated,
      tokenUrlReceived: attempt.tokenUrlReceived,
      sampleFetchAttempted: attempt.sampleFetchAttempted,
      sampleFetchStatus: attempt.sampleFetchStatus,
      sampleReadSucceeded: attempt.sampleReadSucceeded,
      success: attempt.success,
    })),
  ];
}

function stripListAttemptEntries(attempt: AdmListAttempt, username: string | null) {
  return {
    dir: maskNitradoUsernameInPath(attempt.dir, username),
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
  sample: string | null = null,
) {
  if (sampleReadSucceeded) {
    if (sampleHasMarkers) {
      return containsAdminLogStarted(sample) && !containsPlayerActivityMarkers(sample)
        ? "ADM Connected - waiting for player activity"
        : null;
    }
    return "ADM file read succeeded, but no DayZ admin log markers were found in the sample.";
  }

  if (admFileExists && readAttempts.length > 0 && !sampleReadSucceeded) {
    if (readAttempts.some((attempt) => attempt.status === "403")) {
      return "Token can see service details but may not have file download permission.";
    }
    if (readAttempts.every((attempt) => attempt.status === "404")) {
      return "ADM file is listed, but this file path format was not found by the API.";
    }
    if (readAttempts.some((attempt) => attempt.status === "OK" && !attempt.downloadTokenCreated)) {
      return "Nitrado responded successfully but did not include a recognized download token shape.";
    }
    if (!readAttempts.some((attempt) => attempt.downloadTokenCreated)) {
      return "ADM file discovered, but not yet readable through Nitrado file API.";
    }
  }

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

export function getAdmLogStoragePath(admLog: AdmLogDetection) {
  return admLog.internalAdmPath ?? admLog.admPath;
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text) return text;
  }
  return "";
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function normalizeIpAddress(value: string) {
  if (!value) return undefined;
  const withoutPort = value.split(":")[0]?.trim();
  return withoutPort || undefined;
}

function detectPlatform(value: string) {
  if (/ps4|ps5|playstation/i.test(value)) return "PlayStation";
  if (/xbox|xb/i.test(value)) return "Xbox";
  if (/pc|steam|standalone/i.test(value)) return "PC";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeNitradoPathSegment(value: string) {
  return Boolean(value && !value.includes("/") && !value.includes("\\") && !value.includes("..") && !/^https?:/i.test(value));
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

function maskNitradoUsernameInPath(path: string, username: string | null) {
  if (!username) return path;
  const escaped = escapeRegExp(username);
  return path.replace(new RegExp(`(/?games/)${escaped}(/noftp)`, "gi"), "$1{gameserver-username}$2");
}

function pathUsesNitradoUsername(path: string, username: string) {
  const escaped = escapeRegExp(username);
  return new RegExp(`/?games/${escaped}/noftp`, "i").test(path);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withInternalAdmPath<T extends AdmLogDetection>(detection: T, internalPath: string | null): T {
  if (internalPath) {
    Object.defineProperty(detection, "internalAdmPath", {
      value: internalPath,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return detection;
}
