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

export type BillingReadinessResponse = {
  ok: boolean;
  role?: "admin" | "support" | "dev";
  starterConfigured: boolean;
  proConfigured: boolean;
  premiumConfigured: boolean;
  stripeSecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  activePlans: Array<{
    plan_key: "starter" | "pro" | "premium";
    name: string;
    price_label: string;
    monthly_price_gbp: number;
    configured: boolean;
  }>;
  missingRequiredVars: string[];
  legacyVarsDetected: string[];
  modeHint?: "test" | "live" | "unknown" | "not_configured";
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
  discordBotConnected?: boolean;
  discordChannelsAvailable?: boolean;
  discordPostableChannelCount?: number;
  admLog?: AdmLogDetection;
};

export type DiscordBotStatusResponse = {
  ok: boolean;
  guild_id: string | null;
  guild_name: string | null;
  bot_token_configured: boolean;
  bot_connected: boolean;
  channels_available: boolean;
  channels_fetched_count: number;
  postable_channels_count: number;
  error_code: "missing_bot_token" | "missing_guild_id" | "bot_not_in_guild" | "discord_api_403" | "discord_api_error" | "not_authorized" | null;
  error_message: string | null;
  invite_url: string | null;
  checked_at: string;
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
  server_category?: string | null;
  tags_json: string;
  region: string | null;
  game?: string | null;
  platform?: string | null;
  ip_address?: string | null;
  player_slots?: number | null;
  status: "pending" | "live" | "error" | "Pending" | "Live" | "Error";
  created_at?: string | null;
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
  player_count_last_checked_at?: string | null;
  player_count_source?: string | null;
  player_count_status?: "fresh" | "stale" | "unavailable" | "unknown" | string | null;
  public_short_description?: string | null;
  public_description?: string | null;
  public_discord_invite?: string | null;
  public_website_url?: string | null;
  public_rules?: string | null;
  public_language?: string | null;
  public_region_label?: string | null;
  public_listing_updated_at?: string | null;
  category_changed_at?: string | null;
  category_cooldown_until?: string | null;
  category_effective_at?: string | null;
  category_first_set_at?: string | null;
  category_first_grace_used_at?: string | null;
  category_locked_until?: string | null;
  category_lock_reason?: string | null;
  listing_visibility?: "public" | "hidden" | string | null;
  tags_changed_at?: string | null;
  tags_cooldown_until?: string | null;
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
  plan_key: "free" | "starter" | "pro" | "premium" | "network" | "partner";
  plan_status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  current_period_end_label: string;
  cancel_at_period_end: boolean;
  entitlements: {
    plan_key: "free" | "starter" | "pro" | "premium" | "network" | "partner";
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
    server_status_interval_minutes?: number;
    adm_discovery_interval_minutes?: number;
    adm_pull_interval_minutes?: number;
    manual_adm_refresh_cooldown_minutes?: number;
    allowed_auto_posts?: string[];
    priority_level?: number;
  };
  linked_server_count: number;
  can_link_more_servers: boolean;
  stripe_customer_exists: boolean;
  checkout_configured: Record<"starter" | "pro" | "premium", boolean>;
};

export type BillingPlanSummary = {
  plan_key: "starter" | "pro" | "premium";
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
  server_status_interval_minutes?: number;
  adm_discovery_interval_minutes?: number;
  adm_pull_interval_minutes?: number;
  manual_adm_refresh_cooldown_minutes?: number;
  public_publish_interval_minutes: number;
  visibility_weight: number;
  allowed_features?: string[];
  allowed_auto_posts?: string[];
  priority_level?: number;
};

export type PostingDestinationSummary = {
  post_type: string;
  allowed: boolean;
  locked_message: string | null;
  discord_channel_id: string | null;
  enabled: boolean;
  required_feature: string | null;
  min_plan_key: string | null;
  updated_at: string | null;
  has_webhook_url?: boolean;
  delivery_mode?: "bot" | "webhook" | "not_configured";
  setup_status?: "active" | "missing_permissions" | "setup_needed";
  setup_label?: string;
  setup_message?: string | null;
  setup_warning?: string | null;
  missing_permissions?: string[];
  last_error?: string | null;
  last_posted_at?: string | null;
  last_edited_at?: string | null;
};

export type DiscordPostingChannel = {
  channel_id: string;
  channel_name: string;
  channel_type: "text" | "announcement" | string;
  category_name: string | null;
  position?: number;
  category_position?: number | null;
  can_view: boolean;
  can_send: boolean;
  can_embed: boolean;
  can_read_history: boolean;
  can_manage_messages: boolean;
  can_post: boolean;
  missing_permissions: string[];
  permission_source?: "administrator" | "guild_roles" | "category_overwrite" | "channel_overwrite" | "member_overwrite" | "unknown" | string;
  permission_diagnostics?: {
    selected_channel_id: string;
    selected_channel_name: string;
    bot_user_id: string | null;
    bot_role_ids: string[];
    bot_role_names: string[];
    bot_has_administrator: boolean;
    base_guild_permissions: string | null;
    effective_channel_permissions: string | null;
    permission_source: string;
    missing_permissions: string[];
  };
};

export type PostingOptionSummary = {
  key: string;
  label: string;
  group: string;
  min_plan_key: string;
  upgrade_label: string;
  allowed_by_plan: boolean;
};

export type PostingChannelSetup = {
  channel_id: string;
  channel_name: string;
  channel_label: string;
  posting_mode: "bot" | "webhook" | "not_configured" | string;
  status: "active" | "disabled" | "locked_by_plan" | "missing_permissions" | "setup_needed" | string;
  missing_permissions: string[];
  has_webhook_url: boolean;
  last_posted_at: string | null;
  last_edited_at: string | null;
  post_types: Array<{
    key: string;
    label: string;
    enabled: boolean;
    allowed_by_plan: boolean;
    setup_status?: string;
    guild_id?: string;
    discord_channel_id?: string;
    discord_message_id?: string | null;
    posting_mode?: string;
    last_payload_hash?: string | null;
    last_posted_at?: string | null;
    last_edited_at?: string | null;
    last_dispatch_attempt_at?: string | null;
    last_dispatch_status?: string | null;
    last_dispatch_error?: string | null;
    queued_job_count?: number;
    latest_automation_job_id?: string | null;
  }>;
};

export type PostingDestinationsResponse = {
  post_type_options?: PostingOptionSummary[];
  post_types: PostingDestinationSummary[];
  setups?: PostingChannelSetup[];
};

export type DiscordChannelsResponse = {
  ok?: boolean;
  channels: DiscordPostingChannel[];
  manual_fallback: boolean;
  warning?: string;
  fetched_at: string;
  retryable?: boolean;
  status?: number;
  message?: string;
  errorCode?: string | null;
  selected_server_id?: string | null;
  selected_guild_id?: string | null;
  guild_name?: string | null;
  bot_token_configured?: boolean;
  bot_connected?: boolean | null;
  bot_invite_url?: string | null;
  error_code?: string | null;
  diagnostics?: {
    selected_server_id: string | null;
    selected_guild_id: string | null;
    guild_name: string | null;
    bot_token_configured: boolean;
    bot_connected: boolean | null;
    channels_fetched_count: number;
    postable_channels_count: number;
    last_fetch_error_code: string | null;
    last_fetch_error_message: string | null;
    last_fetch_status?: number | null;
    last_fetch_attempt_at?: string | null;
    last_fetch_success_at?: string | null;
    using_cached_channel_state?: boolean;
    last_fetch_time: string;
  };
};

export type PostingPermissionCheck = {
  ok: boolean;
  mode: "bot" | "webhook" | "not_configured" | "missing_permissions";
  missing_permissions: string[];
  warning: string | null;
  checked_at: string | null;
};

export type PostingTestPostResult = {
  ok: boolean;
  mode?: string;
  error?: string;
  missing_permissions?: string[];
};

export type AutoPostDispatchNowResult = {
  ok: boolean;
  processed: number;
  edited: number;
  sent: number;
  posted?: number;
  skipped: number;
  failed: number;
  results: Array<{
    guild_id?: string;
    post_type: string;
    channel_id: string | null;
    status: string;
    message_id: string | null;
    reason: string | null;
    old_payload_hash?: string | null;
    new_payload_hash?: string | null;
    last_edited_at?: string | null;
    message_state_found?: boolean;
  }>;
};

export type AutomationHealth = {
  ok: boolean;
  checked_at: string;
  last_metadata_sync_run: string | null;
  last_adm_discovery_run: string | null;
  last_adm_sync_run: string | null;
  last_discord_dispatcher_run: string | null;
  last_cron_trigger_source: "cloudflare" | "github-backup" | "manual" | string | null;
  last_cron_trigger_job_type: string | null;
  last_cron_trigger_status: string | null;
  last_cron_trigger_started_at: string | null;
  last_cron_trigger_finished_at: string | null;
  last_cron_trigger_at: string | null;
  latest_cloudflare_cron_run_at: string | null;
  latest_github_backup_cron_run_at: string | null;
  cron_health?: {
    status: "healthy" | "cloudflare_missing" | "github_backup_missing" | "cron_secret_mismatch" | "no_recent_automation" | string;
    message: string;
    cloudflare: AutomationCronRunSummary | null;
    github_backup: AutomationCronRunSummary | null;
    latest: AutomationCronRunSummary | null;
    metadata: AutomationCronRunSummary | null;
    adm: AutomationCronRunSummary | null;
    discord_posts: AutomationCronRunSummary | null;
  };
  last_metadata_cron_run_at?: string | null;
  last_metadata_cron_status?: string | null;
  last_metadata_cron_source?: string | null;
  last_metadata_cron_error?: string | null;
  last_adm_cron_run_at?: string | null;
  last_adm_cron_status?: string | null;
  last_adm_cron_source?: string | null;
  last_adm_cron_error?: string | null;
  last_discord_posts_cron_run_at?: string | null;
  last_discord_posts_cron_status?: string | null;
  last_discord_posts_cron_source?: string | null;
  last_discord_posts_cron_error?: string | null;
  due_metadata_jobs: number;
  due_adm_discovery_jobs: number;
  due_adm_jobs: number;
  newest_adm_found?: string | null;
  newest_adm_found_at?: string | null;
  newest_adm_readable?: boolean;
  newest_readable_adm_filename?: string | null;
  newest_readable_adm_timestamp?: string | null;
  latest_scheduled_nitrado_job?: {
    id: string;
    server_id: string;
    filename: string;
    source: string;
    status: string;
    total_lines: number;
    current_line: number;
    chunk_size: number;
    total_chunks: number;
    chunks_processed: number;
    parsed_kills: number;
    written_kills: number;
    joins: number;
    disconnects: number;
    playerlist_snapshots: number;
    error_message: string | null;
    updated_at: string | null;
    completed_at: string | null;
  } | null;
  active_adm_import_jobs_count?: number;
  stuck_adm_import_jobs_count?: number;
  completed_adm_import_jobs_today?: number;
  failed_retryable_adm_import_jobs?: number;
  last_adm_import_chunk_processed_at?: string | null;
  last_completed_adm_file?: string | null;
  next_adm_discovery_due_at?: string | null;
  next_adm_processing_due_at?: string | null;
  queued_discord_post_jobs: number;
  failed_jobs: number;
  stuck_currently_checking_status_locks: number;
  stuck_currently_syncing_adm_locks: number;
  server_count_by_plan: Record<string, number>;
  subscription_count_by_status: Record<string, number>;
  due_server_diagnostics?: Array<{
    linked_server_id: string;
    guild_id: string | null;
    public_slug: string | null;
    server_name: string | null;
    nitrado_service_id: string | null;
    plan_key: string;
    subscription_status: string | null;
    status_interval_minutes?: number;
    adm_discovery_interval_minutes?: number;
    adm_processing_interval_minutes?: number;
    next_status_check_due_at: string | null;
    next_adm_discovery_due_at: string | null;
    next_adm_pull_due_at: string | null;
    currently_checking_status: boolean;
    currently_syncing_adm: boolean;
    status_sync_started_at?: string | null;
    adm_sync_started_at?: string | null;
    status_lock_age_minutes?: number | null;
    adm_lock_age_minutes?: number | null;
    skipped_reason: string;
  }>;
  automation_cron_runs_table_exists: boolean;
  automation_cron_runs_runtime_created: boolean;
  automation_cron_runs_migration_applied: boolean | null;
  automation_cron_metrics_migration_applied?: boolean | null;
  migrationWarning: boolean;
  migrationWarningMessage: string | null;
};

export type AutomationCronRunSummary = {
  source: string | null;
  job_type: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
  error_message: string | null;
  duration_ms: number | null;
  processed_count: number | null;
  skipped_count: number | null;
  failed_count: number | null;
  age_minutes: number | null;
};

export type SyncLockRecoveryResult = {
  ok: boolean;
  server_id: string;
  guild_id: string;
  public_slug: string | null;
  server_name: string | null;
  recovered_status_lock: boolean;
  recovered_adm_lock: boolean;
  recovered: boolean;
  before: SyncLockSnapshot;
  after: SyncLockSnapshot;
};

export type SyncLockSnapshot = {
  currently_checking_status: boolean;
  currently_syncing_adm: boolean;
  updated_at: string | null;
  status_sync_started_at?: string | null;
  adm_sync_started_at?: string | null;
  last_adm_pull_at?: string | null;
  lock_age_minutes: number | null;
  status_lock_age_minutes?: number | null;
  adm_lock_age_minutes?: number | null;
  last_status_error: string | null;
  last_adm_error: string | null;
};

export type PublicCacheDebug = {
  ok: boolean;
  server_id: string;
  guild_id: string | null;
  public_slug: string | null;
  plan_key: string;
  subscription_status: string | null;
  timestamps: {
    metadata_last_checked_at: string | null;
    status_last_checked_at: string | null;
    adm_last_processed_at: string | null;
    public_cache_updated_at: string | null;
    public_cache_last_status_update_at: string | null;
    public_cache_last_adm_update_at: string | null;
    profile_last_sync_display_source: string;
    profile_last_sync_display_at: string | null;
  };
  staleness: {
    public_cache_age_minutes: number | null;
    metadata_age_minutes: number | null;
    status_age_minutes: number | null;
    adm_age_minutes: number | null;
  };
  plan_due_state: {
    status_interval_minutes: number;
    adm_discovery_interval_minutes: number;
    adm_processing_interval_minutes: number;
    next_status_due_at: string | null;
    next_adm_discovery_due_at: string | null;
    next_adm_pull_due_at: string | null;
    status_due: boolean;
    adm_discovery_due: boolean;
    adm_processing_due: boolean;
    skipped_reason: string | null;
  };
  cron: {
    last_metadata_cron_at: string | null;
    last_adm_cron_at: string | null;
    last_discord_posts_cron_at: string | null;
    last_cloudflare_cron_at: string | null;
    last_github_backup_cron_at: string | null;
    last_cron_source: string | null;
    last_cron_status: string | null;
    last_cron_error: string | null;
  };
  problem_flags: string[];
};

export type PublicCacheRebuildResult = {
  ok: boolean;
  before: PublicCacheDebug;
  after: PublicCacheDebug;
  rebuilt_at: string;
};

export type AdvertisingBumpStatus = {
  last_bumped_at: string | null;
  bump_count_current_period: number;
  bump_period_start: string | null;
  bump_period_end: string | null;
  included_bumps_per_month: number;
  bump_cooldown_hours: number;
};

export type NitradoLogSettingsConfirmation = {
  nitrado_reduce_log_output_confirmed: boolean;
  nitrado_log_playerlist_confirmed: boolean;
  nitrado_log_settings_confirmed_at: string | null;
  nitrado_log_settings_verification_source?: string | null;
  nitrado_admin_log_enabled?: boolean | null;
  nitrado_server_log_enabled?: boolean | null;
  nitrado_log_settings_last_checked_at?: string | null;
  nitrado_log_settings_last_error?: string | null;
};

export type NitradoLogSettingsCheckResponse = {
  ok: boolean;
  verified: boolean;
  valid: boolean | null;
  source: "nitrado_api" | "manual_required" | string;
  verificationStatus: "not_checked" | "verified" | "verified_wrong" | "manual_required" | "manual_confirmed" | string;
  checked_at: string;
  reason?: string | null;
  warnings?: string[];
  discovered_setting_keys?: string[];
  settings: {
    admin_log_enabled: boolean | null;
    server_log_enabled: boolean | null;
    reduce_log_output_disabled: boolean | null;
    log_playerlist_enabled: boolean | null;
  };
  diagnostics?: {
    source: string;
    verificationStatus: string;
    last_checked_at: string | null;
    last_error: string | null;
    discovered_setting_keys: string[];
    parsed_values: {
      admin_log_enabled: boolean | null;
      server_log_enabled: boolean | null;
      reduce_log_output_disabled: boolean | null;
      log_playerlist_enabled: boolean | null;
    };
  };
  saved_settings: NitradoLogSettingsConfirmation;
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
  last_adm_discovery_check_at: string | null;
  next_adm_discovery_due_at: string | null;
  last_successful_adm_discovery_at: string | null;
  last_failed_adm_discovery_at: string | null;
  last_adm_discovery_error: string | null;
  adm_discovery_status: string | null;
  next_adm_pull_due_at: string | null;
  newest_available_adm_filename: string | null;
  newest_available_adm_timestamp: string | null;
  newest_readable_adm_filename: string | null;
  newest_readable_adm_timestamp: string | null;
  first_adm_after_restart_at: string | null;
  first_adm_after_restart_delay_minutes: number | null;
  first_useful_adm_line_after_restart_at: string | null;
  observed_playerlist_interval_minutes: number | null;
  observed_adm_cadence_minutes: number | null;
  newest_adm_file_age_minutes: number | null;
  last_useful_adm_event_at: string | null;
  last_playerlist_at: string | null;
  next_expected_adm_update_at: string | null;
  nitrado_reduce_log_output_confirmed: boolean;
  nitrado_log_playerlist_confirmed: boolean;
  nitrado_log_settings_confirmed_at: string | null;
  nitrado_log_settings_verification_source: string | null;
  nitrado_admin_log_enabled: boolean | null;
  nitrado_server_log_enabled: boolean | null;
  nitrado_log_settings_last_checked_at: string | null;
  nitrado_log_settings_last_error: string | null;
  last_sync_trigger: string | null;
  last_scheduled_sync_at: string | null;
  last_manual_sync_at: string | null;
  last_successful_sync_at: string | null;
  adm_health_label: string;
  latest_adm_processed: string | null;
  newest_unprocessed_adm_file: string | null;
  unreadable_files_queued: number;
  raw_kill_lines_found: number;
  parsed_kill_lines_found: number;
  parser_skipped_lines: number;
  active_adm_import_job: AdmImportJobProgressResult | null;
  adm_backfill_status: AdmBackfillStatus;
  last_adm_import_report: {
    admFileName: string | null;
    cursorStart: number;
    cursorEnd: number;
    rawKilledByLinesFound: number;
    parsedPvpKills: number;
    parsedJoins?: number;
    parsedDisconnects?: number;
    parsedPlayerlistSnapshots?: number;
    parsedHitLines?: number;
    skippedDeadHitLines: number;
    parsedSuicides: number;
    parsedUncreditedDeaths: number;
    duplicateSkips: number;
    pvpKillLineNumbers: number[];
    importSource?: string | null;
    importedAt?: string | null;
    importReportId?: string | null;
    parserWarnings?: string[];
    attemptedDbWrites: number;
    successfulDbWrites: number;
    writtenKills: number;
    failedWrites: number;
    cursorBefore: number;
    cursorAfter: number;
    cursorAdvanced: boolean;
    publicCacheUpdated: boolean;
    discordQueuesCreated: number;
    cacheRefreshStatus: string;
    discordQueueStatus: string;
    cursorValidationStatus:
      | "valid"
      | "legacy_no_hash"
      | "hash_mismatch"
      | "line_out_of_range"
      | "hash_found_repositioned"
      | "safe_tail_reprocess"
      | "new_file";
    cursorValidationError: string | null;
    cursorRecoveryStrategy: string | null;
    cursorRecoveryReason: string | null;
    previousLineHash: string | null;
    currentLineHash: string | null;
    cursorLineChecked: number | null;
    cursorHashMatched: boolean | null;
  } | null;
  manual_import_history: ManualAdmImportHistoryItem[];
  current_recovery_action: string;
  recent_sync_runs: SyncRunSummary[];
};

export type AdmBackfillStatus = {
  missing_files_detected: number;
  queued_files: string[];
  active_file: string | null;
  active_job: AdmImportJobProgressResult | null;
  completed_files_today: number;
  skipped_already_imported: number;
  oldest_missing_file: string | null;
  newest_missing_file: string | null;
  unreadable_files: string[];
  next_action: string;
  last_planned_at: string | null;
};

export type ManualAdmImportHistoryItem = {
  id: string;
  filename: string | null;
  imported_at: string | null;
  source: string;
  status: string;
  raw_lines: number;
  parsed_kills: number;
  written_kills: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  duplicate_skips: number;
  failed_writes: number;
};

export type ManualAdmImportResult = {
  ok: true;
  http_status?: number;
  response_body?: string;
  filename: string;
  source: string;
  raw_lines: number;
  raw_kill_lines_found: number;
  parsed_kills: number;
  written_kills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  suicides: number;
  uncredited_deaths: number;
  hit_lines: number;
  raw_events_stored: number;
  player_events_stored: number;
  duplicate_skips: number;
  failed_writes: number;
  public_cache_updated: boolean;
  discord_jobs_queued: number;
  import_report_id: string;
  imported_at: string;
  parser_warnings: string[];
  total_kills: number;
  total_deaths: number;
  kill_previews: Array<{
    line_number: number;
    occurred_at: string | null;
    victim_name: string | null;
    killer_name: string | null;
    weapon: string | null;
    distance: number | null;
    event_type: "pvp_kill";
  }>;
  import_report: NonNullable<AdmSyncStatus["last_adm_import_report"]>;
};

export type ManualAdmImportErrorResult = {
  ok: false;
  http_status?: number;
  response_body?: string;
  error_code: string;
  message: string;
  details?: unknown;
};

export type ManualAdmImportApiResult = ManualAdmImportResult | ManualAdmImportErrorResult;

export type ManualAdmParsePreviewResult = {
  ok: true;
  http_status?: number;
  response_body?: string;
  filename: string;
  source: "manual_preview";
  raw_lines: number;
  raw_kill_lines_found: number;
  parsed_kills: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  suicides: number;
  uncredited_deaths: number;
  hit_lines: number;
  skipped_dead_hit_lines: number;
  parser_warnings: string[];
  kill_previews: Array<{
    line_number: number;
    occurred_at: string | null;
    victim_name: string | null;
    killer_name: string | null;
    weapon: string | null;
    distance: number | null;
    event_type: "pvp_kill";
  }>;
};

export type BulkAdmFileResult = {
  ok: boolean;
  filename: string;
  source: string;
  status: "previewed" | "imported" | "processing" | "completed_with_warnings" | "duplicate_only" | "completed_duplicate_only" | "failed" | "failed_retryable" | "cancelled" | string;
  failed_endpoint?: string | null;
  failed_chunk_index?: number | null;
  first_failed_line_number?: number | null;
  first_failed_line_preview?: string | null;
  client_file_read_ok?: boolean;
  client_total_lines?: number;
  client_total_chunks?: number;
  job_status?: string | null;
  job_id?: string | null;
  chunks_processed?: number;
  total_chunks?: number;
  raw_lines: number;
  raw_kill_lines_found: number;
  parsed_kills: number;
  written_kills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  suicides: number;
  uncredited_deaths: number;
  hit_lines: number;
  raw_events_stored: number;
  player_events_stored: number;
  duplicate_skips: number;
  failed_writes: number;
  public_cache_updated: boolean;
  discord_jobs_queued: number;
  parser_warnings: string[];
  kill_previews: ManualAdmParsePreviewResult["kill_previews"];
  import_report_id: string | null;
  imported_at: string | null;
  error_code?: string;
  message?: string;
  details?: unknown;
  http_status?: number;
  response_body?: string;
};

export type BulkAdmImportResult = {
  ok: true;
  http_status?: number;
  response_body?: string;
  mode: "preview" | "import";
  source: string;
  files_uploaded: number;
  files_imported: number;
  processing_files?: number;
  failed_files: number;
  total_raw_lines: number;
  raw_kill_lines_found: number;
  parsed_kills: number;
  written_kills: number;
  duplicate_kills_skipped: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  deaths: number;
  suicides: number;
  hit_lines: number;
  raw_events_stored: number;
  player_events_stored: number;
  public_cache_updated: boolean;
  discord_jobs_queued: number;
  warnings: string[];
  errors: string[];
  files: BulkAdmFileResult[];
};

export type BulkAdmImportApiResult = BulkAdmImportResult | ManualAdmImportErrorResult;

export type ManualAdmParsePreviewApiResult = ManualAdmParsePreviewResult | ManualAdmImportErrorResult;

export type AdmImportJobProgressResult = {
  ok: true;
  http_status?: number;
  response_body?: string;
  job_id: string;
  filename: string;
  source: string;
  status: "queued" | "processing" | "parsing" | "writing" | "rebuilding" | "completed" | "completed_with_warnings" | "failed" | "failed_retryable" | "cancelled";
  total_lines: number;
  current_line: number;
  chunk_size: number;
  total_chunks: number;
  chunks_processed: number;
  display_current_chunk?: number;
  chunk_count_mismatch?: boolean;
  already_processed?: boolean;
  import_hit_lines?: boolean;
  last_chunk_index?: number | null;
  failed_chunk_index?: number | null;
  progress: number;
  parsed_kills: number;
  written_kills: number;
  duplicate_skips: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  hit_lines: number;
  raw_events_stored: number;
  player_events_stored: number;
  public_cache_updated: boolean;
  discord_jobs_queued: number;
  warnings: string[];
  file_result: BulkAdmFileResult | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

export type AdmImportJobApiResult = AdmImportJobProgressResult | ManualAdmImportErrorResult;

export type AdmImportJobStatusApiResult = { ok: true; job: AdmImportJobProgressResult } | ManualAdmImportErrorResult;

export type AdmBackfillPlanResult = {
  ok: boolean;
  status: string;
  message: string;
  plan_key: string;
  files_found: number;
  window_files: string[];
  missing_files: string[];
  queued_files: string[];
  created_jobs: AdmImportJobProgressResult[];
  active_job: AdmImportJobProgressResult | null;
  completed_files: string[];
  skipped_already_imported: string[];
  unreadable_files: Array<{ filename: string; error: string | null }>;
  oldest_missing_file: string | null;
  newest_missing_file: string | null;
  newest_available_adm_file: string | null;
  newest_available_adm_timestamp: string | null;
  newest_readable_adm_file: string | null;
  newest_readable_adm_timestamp: string | null;
  next_action: string;
};

export type AdmBackfillApiResult = AdmBackfillPlanResult | ManualAdmImportErrorResult;

export type AdmAutomationStatusJob = {
  id: string;
  job_id: string;
  filename: string;
  source: string;
  status: string;
  current_line: number;
  total_lines: number;
  current_chunk: number;
  total_chunks: number;
  chunks_processed: number;
  parsed_kills: number;
  written_kills: number;
  duplicate_skips: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  updated_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  chunk_count_normalized?: boolean;
};

export type AdmAutomationStatusResult = {
  ok: true;
  checked_at: string;
  server_id: string;
  service_id: string | null;
  server: {
    id: string;
    guild_id: string | null;
    public_slug: string | null;
    name: string | null;
    status: string | null;
  };
  plan: {
    plan_key: string;
    configured_plan_key: string;
    subscription_status: string | null;
    status_interval_minutes: number;
    adm_discovery_interval_minutes: number;
    adm_processing_interval_minutes: number;
  };
  cron: {
    cloudflare_last_metadata: AutomationCronRunSummary | null;
    cloudflare_last_adm: AutomationCronRunSummary | null;
    cloudflare_last_discord_posts: AutomationCronRunSummary | null;
    latest_cloudflare: AutomationCronRunSummary | null;
    cron_healthy: boolean;
  };
  nitrado: {
    service_id: string | null;
    newest_available_adm_filename: string | null;
    newest_readable_adm_filename: string | null;
    newest_readable: boolean;
    last_read_error: string | null;
  };
  adm: {
    newest_available_adm_filename: string | null;
    newest_available_adm_timestamp: string | null;
    newest_readable_adm_filename: string | null;
    newest_readable_adm_timestamp: string | null;
    last_processed_adm_filename: string | null;
    last_successful_adm_sync_at: string | null;
    last_adm_discovery_check_at: string | null;
    next_adm_discovery_due_at: string | null;
    next_adm_processing_due_at: string | null;
    last_adm_error: string | null;
    discovery_status: string | null;
    last_sync_status: string | null;
  };
  active_job: AdmAutomationStatusJob | null;
  queued_jobs: AdmAutomationStatusJob[];
  latest_completed_job: AdmAutomationStatusJob | null;
  completed_jobs: AdmAutomationStatusJob[];
  recent_imports: AdmAutomationStatusJob[];
  missing_files: string[];
  unreadable_files: Array<{ filename: string; status: string; last_error: string | null; updated_at: string | null }>;
  latest_events: {
    recent_events_count: number;
    latest_event_at: string | null;
  };
  recent_events_count: number;
  latest_event_at: string | null;
  stats: {
    kills: number;
    deaths: number;
    joins: number;
    disconnects: number;
    unique_players: number;
    score: number;
  };
  discord: {
    queued_post_jobs: number;
  };
  problem_flags: string[];
  next_action: string;
};

export type AdmAutomationStatusApiResult = AdmAutomationStatusResult | ManualAdmImportErrorResult;

export type DashboardHealthJob = AdmAutomationStatusJob;

export type DashboardHealthCronRun = {
  job_type: string | null;
  status: string | null;
  source: string | null;
  created_at: string | null;
};

export type DashboardHealthResult = {
  ok: true;
  generated_at: string;
  stale: boolean;
  source: "live" | "snapshot" | "local_fallback" | string;
  server_id: string;
  server_name: string;
  server: {
    id: string;
    guild_id: string | null;
    public_slug: string | null;
    service_id: string | null;
    status: string | null;
    current_players: number | null;
    max_players: number | null;
    player_count_last_checked_at: string | null;
    player_count_status: string | null;
  };
  current_plan: "free" | "starter" | "pro" | "premium" | "network" | "partner" | string;
  configured_plan: string;
  subscription_status: string | null;
  plan_limits: {
    status_interval_minutes: number;
    adm_discovery_interval_minutes: number;
    adm_processing_interval_minutes: number;
  };
  stats: {
    players: number;
    kills: number;
    deaths: number;
    joins: number;
    disconnects: number;
    unique_players: number;
    score: number;
  };
  autoSync?: {
    overallStatus: string;
    headline: string;
    message: string;
    admSource?: string | null;
    latestAdmState: string;
    latestAdmFile: string | null;
    lastSuccessfulImportAt: string | null;
    lastAttemptedReadAt: string | null;
    nextDiscoveryAt: string | null;
    nextProcessingAt: string | null;
    latestClassifiedError: string | null;
    upstreamHttpStatus: number | null;
    retryMode: "automatic" | string;
    backoffEnabled: boolean;
    queueStatus: string;
    manualActionRequired: boolean;
  };
  recent_events_count: number;
  latest_event_at: string | null;
  latest_events: AdmRecentSyncEvent[];
  sync: {
    status: string;
    adm_status: "ADM Sync Active" | "Importing ADM" | "Waiting for Nitrado" | "Needs Attention" | string;
    active_job: DashboardHealthJob | null;
    backfill_status: {
      missing_files_count: number;
      queued_jobs_count: number;
      active_file: string | null;
      completed_today: number;
      oldest_missing_file: string | null;
      newest_missing_file: string | null;
      unreadable_files_count: number;
      next_action: string;
    };
    latest_read_issue: {
      file_name: string | null;
      status: string | null;
      retry_count: number;
      next_retry_at: string | null;
      last_http_status: number | null;
      last_endpoint_kind: string | null;
      last_method: string | null;
      last_error: string | null;
      last_diagnostic_at: string | null;
      last_checked_at: string | null;
    } | null;
    last_attempted_adm_read?: string | null;
    latest_unreadable_file?: string | null;
    latest_classified_error?: string | null;
    latest_http_status?: number | null;
    latest_endpoint_kind?: string | null;
    latest_method?: string | null;
    adm_source?: string | null;
    latest_completed_import?: {
      id: string | null;
      filename: string | null;
      source: string | null;
      status: string | null;
      completed_at: string | null;
      updated_at: string | null;
    } | null;
    newest_available_adm_filename: string | null;
    newest_readable_adm_filename: string | null;
    last_processed_adm_filename: string | null;
    last_successful_sync: string | null;
    next_adm_discovery_due_at: string | null;
    next_adm_processing_due_at: string | null;
    last_error: string | null;
    next_action: string;
  };
  cron: {
    metadata_recent: boolean;
    adm_recent: boolean;
    discord_recent: boolean;
    metadata: DashboardHealthCronRun | null;
    adm: DashboardHealthCronRun | null;
    discord: DashboardHealthCronRun | null;
  };
  setup_progress: {
    percent: number;
    checks: Array<{ label: string; done: boolean }>;
  };
  warnings: string[];
};

export type DashboardHealthApiResult = DashboardHealthResult | ManualAdmImportErrorResult;

export type AdmFileDiscoveryCandidateDebug = {
  name: string;
  path: string;
  sources: string[];
  parsed_timestamp: string | null;
  modified_at: string | number | null;
  sort_key: number | null;
  is_adm: boolean;
  selected_as_newest_available: boolean;
  selected_as_expected_by_filename: boolean;
  selected_as_expected_by_modified: boolean;
  sample_read_attempted: boolean;
  sample_read_success: boolean;
  sample_read_error: string | null;
  readable_sample_status: string;
  seek_sample_attempted: boolean;
  seek_sample_status: string;
  seek_sample_error: string | null;
  download_fallback_attempted: boolean;
  download_fallback_status: string;
  download_fallback_error: string | null;
  selected_read_method: "seek" | "download_fallback" | "none";
  selected_successful_path: string | null;
  attempted_paths: Array<{
    path: string;
    tokenRequestOk: boolean;
    fileFetchOk: boolean;
    error?: string | null;
  }>;
  first_lines_preview: string[];
  read_attempts: Array<{
    method: "seek" | "download";
    pathVariantLabel: string | null;
    requestUrlPathOnly: string;
    httpStatusCode: number | null;
    status: string;
    sampleFetchAttempted: boolean;
    sampleFetchStatus: string;
    sampleReadSucceeded: boolean;
    errorMessageSafe: string | null;
  }>;
};

export type AdmFileDiscoveryDebug = {
  ok: true;
  linked_server_id: string;
  service_id: string;
  username: string | null;
  server_name: string | null;
  base_paths_used: string[];
  checked_at: string;
  service_details_status: string;
  log_files_raw_count: number;
  game_specific_adm_count: number;
  listed_adm_count: number;
  file_browser_adm_count?: number;
  preferred_adm_count: number;
  total_adm_candidates: number;
  merged_adm_count?: number;
  readable_adm_count?: number;
  unreadable_adm_count?: number;
  list_attempts: Array<{
    dir: string;
    search: string | null;
    status: string;
    fileCount: number;
    admFileCount: number;
  }>;
  adm_candidates: AdmFileDiscoveryCandidateDebug[];
  selected_newest_available: AdmFileDiscoveryCandidateDebug | null;
  selected_newest_readable: AdmFileDiscoveryCandidateDebug | null;
  newest_by_filename: AdmFileDiscoveryCandidateDebug | null;
  newest_by_modified: AdmFileDiscoveryCandidateDebug | null;
  known_latest_file: string | null;
  known_latest_file_present: boolean | null;
  problem_flags: string[];
  current_saved_state: {
    newest_available_adm_filename: string | null;
    newest_available_adm_timestamp: string | null;
    newest_readable_adm_filename: string | null;
    newest_readable_adm_timestamp: string | null;
    last_processed_adm_filename: string | null;
    last_processed_adm_line: number | null;
    last_adm_discovery_check_at: string | null;
    next_adm_discovery_due_at: string | null;
    adm_discovery_status: string | null;
  } | null;
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
  source: "kill" | "player" | "build";
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
  job?: AdmImportJobProgressResult | null;
  duplicateExistingJob?: boolean;
  linesSeen: number;
  linesProcessed: number;
  eventsCreated: number;
  killsCreated: number;
  killsFound: number;
  newKillsCreated: number;
  duplicateKillsSkipped: number;
  playersUpdated: number;
  latestAdmFile: string | null;
  latestAdmTimestamp?: string | null;
  newestAvailableAdmFile?: string | null;
  newestAvailableAdmTimestamp?: string | null;
  newestReadableAdmFile?: string | null;
  newestReadableAdmTimestamp?: string | null;
  lastProcessedLine: number;
  lastSyncAt: string;
  readableRouteUsed: string | null;
  linesRead: number;
  syncStatus: string;
  rawEventsStored: number;
  playerEventsStored: number;
  killEventsStored: number;
  buildEventsStored: number;
  unknownLines: number;
  skippedDuplicateLines: number;
  syncDurationMs: number;
};
