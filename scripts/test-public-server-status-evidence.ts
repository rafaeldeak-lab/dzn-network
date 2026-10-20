import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicServerStatusPresentation } from "../lib/public-server-status";

const metadataSource = readFileSync("functions/_lib/server-metadata.ts", "utf8");
const publicServersSource = readFileSync("functions/api/public/servers.ts", "utf8");

assert.match(
  metadataSource,
  /UPDATE linked_servers SET[\s\S]*?\.run\(\);[\s\S]*?await recordServerStatusEvidence\(db, linkedServer\.id, metadata\)/,
  "A complete metadata update must record evidence only after the linked-server write succeeds.",
);
assert.match(metadataSource, /if \(!metadata\.server_status\) return;/, "An incomplete provider status must not produce public status evidence.");
assert.match(metadataSource, /INSERT INTO dzn_server_status_evidence/, "Successful full metadata refreshes must write isolated status evidence.");
assert.match(metadataSource, /ON CONFLICT\(server_id\) DO UPDATE SET server_status_confirmed_at/, "A later complete refresh must replace only its own confirmation timestamp.");

assert.doesNotMatch(publicServersSource, /COALESCE\(server_public_cache\.server_status, linked_servers\.server_status\)/, "Public status must not be taken from a lagging cache.");
assert.doesNotMatch(publicServersSource, /COALESCE\(server_public_cache\.server_online, linked_servers\.is_online\)/, "Public online state must not be taken from a lagging cache.");
assert.match(publicServersSource, /linked_servers\.server_status AS server_status/, "Public status must come from the linked server record.");
assert.match(publicServersSource, /linked_servers\.is_online AS is_online/, "Public online state must come from the linked server record.");
assert.match(publicServersSource, /LEFT JOIN dzn_server_status_evidence ON dzn_server_status_evidence\.server_id = linked_servers\.id/, "Public status must require isolated confirmation evidence.");

const confirmedAt = new Date().toISOString();
assert.deepEqual(publicServerStatusPresentation({ status: "live", is_online: true, server_status_confirmed_at: confirmedAt }), { label: "Online", tone: "emerald" });
assert.deepEqual(publicServerStatusPresentation({ status: "live", is_online: false, server_status_confirmed_at: confirmedAt }), { label: "Offline", tone: "zinc" });
assert.deepEqual(
  publicServerStatusPresentation({ status: "live", is_online: true, server_status_confirmed_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() }),
  { label: "Status not checked", tone: "zinc" },
  "Expired provider evidence must not claim a live status.",
);

console.log("Public server status evidence tests passed.");
