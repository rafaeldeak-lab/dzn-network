-- DZN Event Platform Phase 2A community suggestions.
-- Additive only: no gameplay stats, player profiles, sessions, subscriptions,
-- Nitrado tokens, Discord credentials, or historical event rows are removed.

CREATE TABLE IF NOT EXISTS event_suggestions (
  id TEXT PRIMARY KEY,
  submitted_by_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  competition_format TEXT NOT NULL,
  platform TEXT NOT NULL,
  map_name TEXT,
  suggested_server_id TEXT,
  open_to_any_server INTEGER NOT NULL DEFAULT 1,
  suggested_date_start TEXT,
  suggested_date_end TEXT,
  structure_notes TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'pending_moderation',
  public_status TEXT NOT NULL DEFAULT 'submitted',
  creator_decision TEXT,
  converted_event_id TEXT,
  creator_response TEXT,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  downvote_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  hot_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  moderated_at TEXT,
  FOREIGN KEY(submitted_by_user_id) REFERENCES users(id),
  FOREIGN KEY(suggested_server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(converted_event_id) REFERENCES competitive_events(id)
);

CREATE TABLE IF NOT EXISTS event_suggestion_votes (
  suggestion_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  vote_value INTEGER NOT NULL CHECK(vote_value IN (1, -1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (suggestion_id, user_id),
  FOREIGN KEY(suggestion_id) REFERENCES event_suggestions(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS event_suggestion_reports (
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  safe_note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  FOREIGN KEY(suggestion_id) REFERENCES event_suggestions(id),
  FOREIGN KEY(reporter_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS event_suggestion_moderation_actions (
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  safe_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(suggestion_id) REFERENCES event_suggestions(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS event_suggestion_servers (
  suggestion_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'suggested',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (suggestion_id, linked_server_id, relationship_type),
  FOREIGN KEY(suggestion_id) REFERENCES event_suggestions(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_event_suggestions_moderation_created
ON event_suggestions(moderation_status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_event_suggestions_public_hot
ON event_suggestions(public_status, hot_score DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_event_suggestions_public_created
ON event_suggestions(public_status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_event_suggestions_public_supported
ON event_suggestions(public_status, upvote_count DESC, downvote_count ASC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_event_suggestions_public_supported_score
ON event_suggestions(public_status, (upvote_count - downvote_count) DESC, upvote_count DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_event_suggestions_public_active
ON event_suggestions(public_status, upvote_count DESC, downvote_count DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_event_suggestions_public_active_total
ON event_suggestions(public_status, (upvote_count + downvote_count) DESC, upvote_count DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_event_suggestions_submitted_user_created
ON event_suggestions(submitted_by_user_id, created_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_suggestions_fingerprint
ON event_suggestions(content_fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_suggestions_converted_event
ON event_suggestions(converted_event_id)
WHERE converted_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_suggestions_owner_review
ON event_suggestions(moderation_status, public_status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_event_suggestion_votes_suggestion
ON event_suggestion_votes(suggestion_id);

CREATE INDEX IF NOT EXISTS idx_event_suggestion_votes_user
ON event_suggestion_votes(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_event_suggestion_reports_suggestion_status
ON event_suggestion_reports(suggestion_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_suggestion_reports_user_open
ON event_suggestion_reports(suggestion_id, reporter_user_id)
WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_event_suggestion_moderation_suggestion_time
ON event_suggestion_moderation_actions(suggestion_id, created_at);

CREATE INDEX IF NOT EXISTS idx_event_suggestion_servers_linked_server
ON event_suggestion_servers(linked_server_id, created_at);
