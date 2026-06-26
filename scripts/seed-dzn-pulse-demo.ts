import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.DZN_PULSE_SEED_LOCAL !== "1") {
  console.error("Refusing to generate DZN Pulse demo seed SQL without DZN_PULSE_SEED_LOCAL=1.");
  console.error("This helper is local/demo-only and does not connect to D1.");
  process.exit(1);
}

const now = new Date().toISOString();
const starts = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const ends = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

const sql = `-- Local/demo-only DZN Pulse seed SQL.
-- Review before applying to a local or preview D1 database. Do not apply to production.

INSERT OR IGNORE INTO notification_campaigns (
  id, slug, type, title, body, action_url, priority, audience_metadata, metadata, starts_at, ends_at, created_at, updated_at
) VALUES (
  'demo-weekend-kill-race',
  'demo-weekend-kill-race',
  'upcoming_event',
  'Weekend Kill Race',
  'Two servers enter. One server leaves. Rack up the most kills across the weekend.',
  '/events',
  100,
  '{}',
  '{"reward_preview":"Victory Crate, configured rewards, server banner, badge, or event prize.","allow_link_server":true}',
  '${now}',
  '${ends}',
  '${now}',
  '${now}'
);

-- Demo notifications attach to the first existing local/preview user when one exists.
-- A fresh preview database with no users seeds the campaign and skips user-scoped rows.
WITH demo_user AS (
  SELECT id AS user_id
  FROM users
  ORDER BY created_at ASC
  LIMIT 1
),
demo_notifications(id, type, title, body, action_url, priority, dedupe_key, metadata, created_at) AS (
  VALUES
    ('demo-pulse-event-alert', 'upcoming_event', 'Event starts in 2 hours', 'Spring Clash - Faction Wars', '/events', 80, 'demo:event-start-2h', '{}', '${starts}'),
    ('demo-pulse-rank-update', 'event_rank_update', 'Your server is currently Rank #3', 'Warlords PvP climbed to #3 in the global Deathmatch rankings.', '/leaderboards', 70, 'demo:rank-3', '{}', '${now}'),
    ('demo-pulse-achievement', 'achievement_unlocked', 'Flag Captain', 'Capture 50 flags in total. +250 XP', '/dashboard', 60, 'demo:achievement-flag-captain', '{}', '${now}'),
    ('demo-pulse-monthly-rank', 'monthly_global_rank', 'Monthly global rank updated', 'You are now in the top 2.5%.', '/leaderboards', 50, 'demo:monthly-rank', '{}', '${now}'),
    ('demo-pulse-news', 'dzn_news', 'New DZN season announced', 'New events, rewards, and champions are coming.', '/events', 40, 'demo:season-news', '{}', '${now}')
)
INSERT OR IGNORE INTO user_notifications (
  id, user_id, type, title, body, action_url, priority, dedupe_key, metadata, created_at
)
SELECT
  demo_notifications.id,
  demo_user.user_id,
  demo_notifications.type,
  demo_notifications.title,
  demo_notifications.body,
  demo_notifications.action_url,
  demo_notifications.priority,
  demo_notifications.dedupe_key,
  demo_notifications.metadata,
  demo_notifications.created_at
FROM demo_notifications
CROSS JOIN demo_user;

INSERT OR IGNORE INTO notification_preferences (
  user_id, in_app_enabled, discord_enabled, events_enabled, scores_enabled, achievements_enabled, news_enabled, created_at, updated_at
)
SELECT id, 1, 0, 1, 1, 1, 1, '${now}', '${now}'
FROM users
ORDER BY created_at ASC
LIMIT 1;
`;

mkdirSync("tmp", { recursive: true });
const output = join("tmp", "dzn-pulse-demo-seed.sql");
writeFileSync(output, sql);
console.log(`Wrote local/demo DZN Pulse seed SQL to ${output}.`);
