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
-- Review before applying to a local D1 database. Do not apply to production.

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

-- Demo notifications require an existing local user id. Replace demo-user-id before applying locally.
INSERT OR IGNORE INTO user_notifications (
  id, user_id, type, title, body, action_url, priority, dedupe_key, metadata, created_at
) VALUES
  ('demo-pulse-event-alert', 'demo-user-id', 'upcoming_event', 'Event starts in 2 hours', 'Spring Clash • Faction Wars', '/events', 80, 'demo:event-start-2h', '{}', '${starts}'),
  ('demo-pulse-rank-update', 'demo-user-id', 'event_rank_update', 'Your server is currently Rank #3', 'Warlords PvP climbed to #3 in the global Deathmatch rankings.', '/leaderboards', 70, 'demo:rank-3', '{}', '${now}'),
  ('demo-pulse-achievement', 'demo-user-id', 'achievement_unlocked', 'Flag Captain', 'Capture 50 flags in total. +250 XP', '/dashboard', 60, 'demo:achievement-flag-captain', '{}', '${now}'),
  ('demo-pulse-monthly-rank', 'demo-user-id', 'monthly_global_rank', 'Monthly global rank updated', 'You are now in the top 2.5%.', '/leaderboards', 50, 'demo:monthly-rank', '{}', '${now}'),
  ('demo-pulse-news', 'demo-user-id', 'dzn_news', 'New DZN season announced', 'New events, rewards, and champions are coming.', '/events', 40, 'demo:season-news', '{}', '${now}');
`;

mkdirSync("tmp", { recursive: true });
const output = join("tmp", "dzn-pulse-demo-seed.sql");
writeFileSync(output, sql);
console.log(`Wrote local/demo DZN Pulse seed SQL to ${output}.`);
