export type AuthResponse = {
  authenticated: boolean;
  user?: {
    id: string;
    discord_id: string;
    username: string;
    avatar: string | null;
  };
  linkedServer?: LinkedServer | null;
};

export type DiscordGuild = {
  guild_id: string;
  name: string;
  icon: string | null;
  icon_url: string | null;
  owner: boolean;
  permissions: string;
};

export type NitradoService = {
  id: string;
  name: string;
  game: string;
  region?: string;
  platform?: string;
  ipAddress?: string;
  playerSlots?: number;
  status?: string;
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

export type AdmApiDebug = {
  exactManualPath: string | null;
  pathVariants: string[];
  apiLogFilePathVariants: string[];
  pathsChecked: string[];
  methodsTried: {
    method: "download" | "seek" | "stat" | "list" | "service-details";
    status: "OK" | "401" | "403" | "404" | "error";
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
    sampleFetchStatus?: "OK" | "401" | "403" | "404" | "error" | "not_attempted";
    sampleReadSucceeded?: boolean;
    success?: boolean;
    entriesReturned?: number;
    admFilesFound?: number;
  }[];
  listAttempts: {
    dir: string;
    search: string | null;
    status: "OK" | "401" | "403" | "404" | "error";
    fileCount: number;
    admFileCount: number;
  }[];
  statAttempts: {
    path: string;
    pathVariantLabel: string | null;
    requestUrlPathOnly: string;
    httpStatusCode: number | null;
    responseContentType: string | null;
    status: "OK" | "401" | "403" | "404" | "error";
    fileVisible: boolean;
    responseShape: AdmApiResponseShape;
    errorMessageSafe: string | null;
    success: boolean;
  }[];
  serviceDetailsAttempt: {
    status: "OK" | "401" | "403" | "404" | "error";
    pathsFound: number;
    gameserverUsernameFound: boolean;
    gameSpecificLogFilesFound: boolean;
    logFilesReturned: number;
    gameSpecificAdmFilesFound: number;
    selectedGameSpecificAdmFile: string | null;
  } | null;
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
  sampleFetchStatus: "OK" | "401" | "403" | "404" | "error" | "not_attempted";
  filesFound: string[];
  exactSelectedAdmPath: string | null;
  fileVisibleThroughStat: boolean;
  downloadTokenCreated: boolean;
  sampleReadStatus: "OK" | "401" | "403" | "404" | "error" | "not_attempted";
  sampleReadSucceeded: boolean;
  samplePreview: string | null;
  lastCheckedAt: string;
  message: string | null;
  readAttempts: {
    path: string;
    method: "seek" | "download";
    pathVariantLabel: string | null;
    requestUrlPathOnly: string;
    httpStatusCode: number | null;
    responseContentType: string | null;
    status: "OK" | "401" | "403" | "404" | "error";
    responseShape: AdmApiResponseShape;
    errorMessageSafe: string | null;
    downloadTokenCreated: boolean;
    tokenUrlReceived: boolean;
    sampleFetchAttempted: boolean;
    sampleFetchStatus: "OK" | "401" | "403" | "404" | "error" | "not_attempted";
    sampleReadSucceeded: boolean;
    success: boolean;
  }[];
};

export type AdmApiResponseShape = {
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

export type OnboardingChecks = {
  tokenValid: boolean;
  serviceAccess: boolean;
  admLogsFound: boolean;
  dayzServiceDetected: boolean;
  admLog?: AdmLogDetection;
};

export type LinkedServer = {
  id: string;
  guild_id: string;
  guild_name?: string;
  guild_icon_url?: string | null;
  nitrado_service_id: string;
  nitrado_service_name: string;
  server_name: string;
  server_type: string;
  tags_json: string;
  region: string | null;
  game?: string | null;
  platform?: string | null;
  ip_address?: string | null;
  player_slots?: number | null;
  status: "pending" | "live" | "error" | "Pending" | "Live" | "Error";
  public_slug: string;
  adm_path?: string | null;
  adm_status?: "Connected" | "Discovered, read pending" | "Needs review" | string | null;
  adm_latest_file?: string | null;
  adm_last_checked_at?: string | null;
  adm_logs_found?: number | null;
};

export type AdmSyncStatus = {
  last_sync_status: string;
  last_sync_message: string | null;
  latest_adm_file: string | null;
  last_processed_file: string | null;
  last_processed_line: number;
  last_sync_at: string | null;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
};

export type AdmRecentSyncEvent = {
  source: "kill" | "player";
  event_type: string;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
};

export type AdmSyncRunResult = {
  status: string;
  message: string;
  linesSeen: number;
  linesProcessed: number;
  eventsCreated: number;
  killsCreated: number;
  latestAdmFile: string | null;
  lastProcessedLine: number;
  lastSyncAt: string;
};
