export type AuthResponse = {
  authenticated: boolean;
  user?: {
    id: string;
    discord_id: string;
    username: string;
    avatar: string | null;
  };
  linkedServer?: LinkedServer | null;
  linkedServers?: LinkedServer[];
};

export type DiscordGuild = {
  id?: string;
  guild_id: string;
  name: string;
  icon: string | null;
  icon_url: string | null;
  owner: boolean;
  administrator?: boolean;
  manageable?: boolean;
  permissions: string;
  bot_present?: boolean;
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
  metadataSynced?: boolean;
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
  display_name?: string | null;
  hostname?: string | null;
  description?: string | null;
  max_players?: number | null;
  current_players?: number | null;
  game_port?: number | null;
  query_port?: number | null;
  map_name?: string | null;
  mission?: string | null;
  server_status?: string | null;
  is_online?: number | boolean | null;
  server_mode?: string | null;
  server_mode_source?: string | null;
  metadata_hash?: string | null;
  metadata_last_checked_at?: string | null;
  metadata_last_changed_at?: string | null;
  public_short_description?: string | null;
  public_description?: string | null;
  public_discord_invite?: string | null;
  public_website_url?: string | null;
  public_rules?: string | null;
  public_language?: string | null;
  public_region_label?: string | null;
  public_listing_updated_at?: string | null;
  adm_path?: string | null;
  adm_status?: "Connected" | "Discovered, read pending" | "Needs review" | string | null;
  adm_latest_file?: string | null;
  adm_last_checked_at?: string | null;
  adm_logs_found?: number | null;
  original_owner_is_current_user?: boolean;
  global_rank?: number | null;
  rank?: number | null;
  server_score?: number | null;
  score?: number | null;
  score_label?: string | null;
  score_breakdown?: ScoreBreakdown | null;
  kd?: number | null;
  kd_label?: string | null;
  longest_kill?: number | null;
  stats_sync_active?: boolean | null;
};

export type BillingStatus = {
  plan_key: "free" | "starter" | "pro" | "network" | "partner";
  plan_status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  entitlements: {
    plan_key: "free" | "starter" | "pro" | "network" | "partner";
    max_linked_servers: number;
    can_use_reviews: boolean;
    can_use_public_listing: boolean;
    can_use_advanced_analytics: boolean;
    can_join_events: boolean;
    can_use_ad_bumps: boolean;
    included_bumps_per_month: number;
    bump_cooldown_hours: number;
    can_use_featured_slots: boolean;
    stat_history_days: number;
  };
  linked_server_count: number;
  can_link_more_servers: boolean;
  stripe_customer_exists: boolean;
  checkout_configured: Record<"starter" | "pro" | "network" | "partner", boolean>;
};

export type BillingPlanSummary = {
  plan_key: "starter" | "pro" | "network" | "partner";
  name: string;
  price_label: string;
  monthly_price_gbp: number;
  configured: boolean;
  features: string[];
  max_linked_servers: number;
  can_use_reviews: boolean;
  can_use_public_listing: boolean;
  can_use_advanced_analytics: boolean;
  can_join_events: boolean;
  can_use_ad_bumps: boolean;
  included_bumps_per_month: number;
  bump_cooldown_hours: number;
  can_use_featured_slots: boolean;
  stat_history_days: number;
};

export type AdvertisingBumpStatus = {
  last_bumped_at: string | null;
  bump_count_current_period: number;
  bump_period_start: string | null;
  bump_period_end: string | null;
  included_bumps_per_month: number;
  bump_cooldown_hours: number;
};

export type ScoreBreakdown = {
  kills_points: number;
  unique_players_points: number;
  joins_points: number;
  longest_kill_points: number;
  sync_bonus: number;
  death_penalty: number;
  final_score: number;
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
  last_lines_read: number;
  last_lines_processed: number;
  last_raw_events_stored: number;
  last_player_events_stored: number;
  last_kill_events_stored: number;
  last_events_created: number;
  last_kills_created: number;
  last_unknown_lines: number;
  last_duplicate_lines: number;
  last_sync_duration_ms: number | null;
  last_readable_route: string | null;
  last_sync_trigger: string | null;
  last_scheduled_sync_at: string | null;
  last_manual_sync_at: string | null;
  recent_sync_runs: SyncRunSummary[];
};

export type SyncRunSummary = {
  id: string;
  trigger_type: string;
  status: string;
  message: string | null;
  lines_read: number;
  lines_processed: number;
  events_created: number;
  kills_created: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string | null;
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
  event_label: string;
  detail: string | null;
  cause: string | null;
  object_type: string | null;
  is_mock: boolean;
};

export type NitradoLogAccessAttempt = {
  label: string;
  method: "GET";
  requestUrlPathOnly: string;
  httpStatusCode: number | null;
  status: "OK" | "401" | "403" | "404" | "error";
  responseContentType: string | null;
  topLevelJsonKeys: string[];
  dataKeys: string[];
  arrayLengths: { path: string; length: number }[];
  containsLogLikeText: boolean;
  containsAdmFilenames: boolean;
  hasDownloadTokenFields: boolean;
  sampleFetchAttempted: boolean;
  sampleReadSucceeded: boolean;
  safeErrorMessage: string | null;
};

export type NitradoLogAccessDiagnostics = {
  serviceId: string;
  lastCheckedAt: string;
  gameserverUsernameFound: boolean;
  gameSpecificLogFilesFound: boolean;
  gameSpecificLogFilesReturned: number;
  admFilesFromGameSpecific: number;
  newestAdmFileName: string | null;
  testedPathVariants: string[];
  readable: {
    found: boolean;
    sourceLabel: string | null;
    method: string | null;
    lineCount: number;
    routeRecommendation: string | null;
    message: string;
  };
  attempts: NitradoLogAccessAttempt[];
};

export type AdmSyncRunResult = {
  status: string;
  message: string;
  linesSeen: number;
  linesProcessed: number;
  eventsCreated: number;
  killsCreated: number;
  killsFound: number;
  newKillsCreated: number;
  duplicateKillsSkipped: number;
  playersUpdated: number;
  latestAdmFile: string | null;
  lastProcessedLine: number;
  lastSyncAt: string;
  readableRouteUsed: string | null;
  linesRead: number;
  syncStatus: string;
  rawEventsStored: number;
  playerEventsStored: number;
  killEventsStored: number;
  unknownLines: number;
  skippedDuplicateLines: number;
  syncDurationMs: number;
};
