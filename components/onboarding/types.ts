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
    path?: string;
    dir?: string;
    search?: string | null;
    fileVisible?: boolean;
    downloadTokenCreated?: boolean;
    sampleReadSucceeded?: boolean;
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
    status: "OK" | "401" | "403" | "404" | "error";
    fileVisible: boolean;
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
    status: "OK" | "401" | "403" | "404" | "error";
  }[];
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
  status: "pending" | "live" | "error" | "Pending" | "Live" | "Error";
  public_slug: string;
  adm_path?: string | null;
  adm_status?: "Connected" | "Needs review" | string | null;
  adm_latest_file?: string | null;
  adm_last_checked_at?: string | null;
  adm_logs_found?: number | null;
};
