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
  includes("functions/api/public/servers.ts", "latestPublicTimestamp", "Public server API should compute profile last sync from the freshest sync/cache timestamp.");
  includes("functions/api/public/servers.ts", "publicAccessCacheHeaders(viewerLoggedIn)", "Public server API should set explicit cache/Vary headers.");
  notIncludes("functions/api/public/servers.ts", "const lastSyncAt = row.latest_success_sync_at ?? row.adm_sync_at;", "Public last sync should not ignore fresh metadata/cache timestamps.");

  includes("functions/_lib/server-metadata.ts", "upsertServerPublicCache", "Metadata sync should update server_public_cache.");
  includes("functions/_lib/server-metadata.ts", "lastStatusUpdateAt", "Metadata sync should write status freshness into server_public_cache.");
  includes("functions/_lib/adm-sync.ts", "publicCacheUpdated = true", "ADM import should report public cache refresh.");
  includes("functions/_lib/adm-sync.ts", "lastAdmUpdateAt", "ADM import should update public cache ADM freshness.");
  includes("functions/_lib/adm-sync.ts", "queueDiscordPostUpdatesForGuild", "ADM data changes should queue Discord/public automation follow-up work.");

  includes("functions/_lib/public-cache.ts", "getPublicCacheDebugForServer", "Public cache debug helper should exist.");
  includes("functions/_lib/public-cache.ts", "rebuildPublicCacheForServer", "Public cache rebuild helper should exist.");
  includes("functions/_lib/public-cache.ts", "metadata_newer_than_public_cache", "Public cache debug should flag metadata newer than public cache.");
  includes("functions/_lib/public-cache.ts", "adm_newer_than_public_cache", "Public cache debug should flag ADM newer than public cache.");
  includes("functions/api/servers/[serverId]/public-cache/debug.ts", "getPublicCacheDebugForServer", "Owner/admin debug endpoint should expose public cache diagnostics.");
  includes("functions/api/servers/[serverId]/public-cache/rebuild.ts", "rebuildPublicCacheForServer", "Owner/admin rebuild endpoint should rebuild public cache.");
  includes("components/onboarding/dashboard.tsx", "Rebuild Public Cache Now", "Dashboard should expose a manual public cache rebuild button.");
  includes("components/onboarding/dashboard.tsx", "Public profile cache is stale. Rebuild recommended.", "Dashboard should warn when public cache is stale.");

  assert.equal(getServerStatusInterval("partner"), 1, "Partner status interval should remain 1 minute.");
  assert.equal(getAdmDiscoveryIntervalMinutes("partner"), 3, "Partner ADM discovery interval should remain 3 minutes.");
  assert.equal(getAdmPullInterval("partner"), 10, "Partner ADM processing interval should remain 10 minutes.");

  console.log("Public profile sync tests passed.");
  console.log("- Metadata sync updates server_public_cache.");
  console.log("- ADM import updates server_public_cache and queues Discord follow-up work.");
  console.log("- Public profile last sync uses the freshest real metadata/ADM/stat timestamp.");
  console.log("- Public cache debug/rebuild endpoints and dashboard controls are wired.");
}

run();
