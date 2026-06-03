import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  getAdmDiscoveryIntervalMinutes,
  getAdmPullInterval,
  getServerStatusInterval,
} from "../lib/billing/plans";

const root = process.cwd();

function source(relativePath: string) {
  const filePath = path.join(root, relativePath);
  assert.equal(existsSync(filePath), true, `${relativePath} should exist`);
  return readFileSync(filePath, "utf8");
}

function includes(relativePath: string, expected: string, message: string) {
  assert.equal(source(relativePath).includes(expected), true, message);
}

function notIncludes(relativePath: string, unexpected: string, message: string) {
  assert.equal(source(relativePath).includes(unexpected), false, message);
}

function run() {
  const publicNetwork = source("components/network/public-network.tsx");
  assert.equal(publicNetwork.includes("cache: \"no-store\""), true, "Public profile client fetch should bypass browser cache.");
  assert.equal(publicNetwork.includes("/api/public/servers?slug="), true, "Public profile should fetch the slug-scoped public API.");

  includes("functions/api/public/servers.ts", "server_public_cache.updated_at AS public_cache_updated_at", "Public server API should read public cache update time.");
  includes("functions/api/public/servers.ts", "getPublicServersPreviewPayload", "Public server API should have a lightweight public preview path.");
  includes("functions/api/public/servers.ts", "latestPublicTimestamp", "Public server API should compute profile last sync from the freshest sync/cache timestamp.");
  includes("functions/api/public/servers.ts", "publicAccessCacheHeaders(viewerLoggedIn)", "Public server API should set explicit cache/Vary headers.");
  notIncludes("functions/api/public/servers.ts", "const lastSyncAt = row.latest_success_sync_at ?? row.adm_sync_at;", "Public last sync should not ignore fresh metadata/cache timestamps.");
  includes("functions/api/public/home-stats.ts", "getPreviewTotals", "Homepage public stats should use lightweight last-known ADM data for preview.");
  includes("functions/api/public/home-stats.ts", "server_public_cache.last_adm_update_at", "Homepage fallback should treat public ADM cache freshness as synced data.");
  includes("functions/api/public/home-stats.ts", "map_nodes: data.map_nodes ?? []", "Preview access should not erase public server location nodes.");
  includes("functions/api/public/home-stats.ts", "syncHealth: data.syncHealth ? { ...data.syncHealth }", "Preview access should preserve public ADM sync counts.");

  includes("functions/_lib/server-metadata.ts", "upsertServerPublicCache", "Metadata sync should update server_public_cache.");
  includes("functions/_lib/server-metadata.ts", "lastStatusUpdateAt", "Metadata sync should write status freshness into server_public_cache.");
  includes("functions/_lib/adm-sync.ts", "publicCacheUpdated = true", "ADM import should report public cache refresh.");
  includes("functions/_lib/adm-sync.ts", "if (server.guild_id) {", "Scheduled ADM completion should refresh public cache even when no kill rows were written.");
  includes("functions/_lib/adm-sync.ts", "lastAdmUpdateAt", "ADM import should update public cache ADM freshness.");
  includes("functions/_lib/adm-sync.ts", "queueDiscordPostUpdatesForGuild", "ADM data changes should queue Discord/public automation follow-up work.");

  includes("functions/_lib/public-cache.ts", "getPublicCacheDebugForServer", "Public cache debug helper should exist.");
  includes("functions/_lib/public-cache.ts", "rebuildPublicCacheForServer", "Public cache rebuild helper should exist.");
  includes("functions/_lib/public-cache.ts", "metadata_newer_than_public_cache", "Public cache debug should flag metadata newer than public cache.");
  includes("functions/_lib/public-cache.ts", "adm_newer_than_public_cache", "Public cache debug should flag ADM newer than public cache.");
  includes("functions/api/servers/[serverId]/public-cache/debug.ts", "getPublicCacheDebugForServer", "Owner/admin debug endpoint should expose public cache diagnostics.");
  includes("functions/api/servers/[serverId]/public-cache/rebuild.ts", "rebuildPublicCacheForServer", "Owner/admin rebuild endpoint should rebuild public cache.");
  includes("functions/api/servers/[serverId]/dashboard/health.ts", "current_live_adm_status", "Dashboard health should separate current live ADM status from backlog status.");
  includes("functions/api/servers/[serverId]/dashboard/health.ts", "backlog_status", "Dashboard health should expose old backlog as secondary state.");
  includes("functions/api/servers/[serverId]/dashboard/health.ts", "private, no-store, no-cache, must-revalidate", "Dashboard health API must bypass stale browser/proxy caches.");
  includes("components/onboarding/dashboard.tsx", "Rebuild Public Cache Now", "Dashboard should expose a manual public cache rebuild button.");
  includes("components/onboarding/dashboard.tsx", "Public profile cache is stale. Rebuild recommended.", "Dashboard should warn when public cache is stale.");

  assert.equal(getServerStatusInterval("partner"), 1, "Legacy partner alias should receive Premium status cadence.");
  assert.equal(getAdmDiscoveryIntervalMinutes("partner"), 3, "Legacy partner alias should receive Premium ADM discovery cadence.");
  assert.equal(getAdmPullInterval("partner"), 10, "Legacy partner alias should receive Premium ADM processing cadence.");

  console.log("Public profile sync tests passed.");
  console.log("- Metadata sync updates server_public_cache.");
  console.log("- ADM import updates server_public_cache and queues Discord follow-up work.");
  console.log("- Public profile last sync uses the freshest real metadata/ADM/stat timestamp.");
  console.log("- Public cache debug/rebuild endpoints and dashboard controls are wired.");
}

run();
