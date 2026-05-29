CREATE TABLE IF NOT EXISTS nitrado_rate_limits (
  service_id TEXT PRIMARY KEY,
  rate_limited_until TEXT,
  last_rate_limit_at TEXT,
  rate_limit_count INTEGER DEFAULT 0,
  last_rate_limit_method TEXT,
  last_rate_limit_endpoint TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS adm_live_source_state (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  last_tested_at TEXT,
  last_status TEXT,
  last_http_status INTEGER,
  last_error_code TEXT,
  last_response_excerpt TEXT,
  works INTEGER DEFAULT 0,
  preferred INTEGER DEFAULT 0,
  next_test_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(service_id, source_name)
);

CREATE INDEX IF NOT EXISTS idx_adm_live_source_state_service_next
ON adm_live_source_state(service_id, next_test_at);

CREATE INDEX IF NOT EXISTS idx_nitrado_rate_limits_until
ON nitrado_rate_limits(rate_limited_until);
