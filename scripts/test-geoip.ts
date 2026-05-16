import assert from "node:assert/strict";

import { buildPublicMapNodeFromRow, type MapNodeRow } from "../functions/api/public/home-stats";
import { geolocateServerIp } from "../functions/_lib/geoip";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const privateLookup = await geolocateServerIp("192.168.1.10");
  assert.equal(privateLookup.latitude, null);
  assert.equal(privateLookup.longitude, null);

  const providerLookup = await geolocateServerIp("8.8.8.8", {
    fetcher: async () =>
      new Response(
        JSON.stringify({
          latitude: 51.5074,
          longitude: -0.1278,
          country_name: "United Kingdom",
          region: "England",
          city: "London",
          timezone: "Europe/London",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(providerLookup.latitude, 51.5074);
  assert.equal(providerLookup.longitude, -0.1278);
  assert.equal(providerLookup.source, "ipapi");

  const baseRow: MapNodeRow = {
    id: "server-1",
    public_slug: "london-dayz",
    server_name: "London DayZ",
    guild_name: null,
    server_type: "PVP",
    region: null,
    platform: "PlayStation",
    map_name: "Chernarus",
    geo_latitude: 51.5074,
    geo_longitude: -0.1278,
    geo_country: "United Kingdom",
    geo_region: "England",
    geo_city: "London",
    geo_timezone: "Europe/London",
    geo_source: "ipapi",
    stats_active: 1,
  };

  const node = buildPublicMapNodeFromRow(baseRow);
  assert.ok(node);
  assert.equal(node.latitude, 51.5074);
  assert.equal(node.longitude, -0.1278);
  assert.equal(node.location_label, "London, England, United Kingdom");
  assert.equal(node.active, true);
  assert.equal(JSON.stringify(node).includes("8.8.8.8"), false);
  assert.equal("ip_address" in node, false);

  const unknownNode = buildPublicMapNodeFromRow({
    ...baseRow,
    id: "unknown",
    public_slug: "unknown",
    server_name: "Unknown Server",
    region: null,
    geo_latitude: null,
    geo_longitude: null,
    geo_country: null,
    geo_region: null,
    geo_city: null,
    geo_timezone: null,
    geo_source: null,
  });
  assert.equal(unknownNode, null);

  const coordinateCounts = new Map<string, number>();
  const firstNode = buildPublicMapNodeFromRow(baseRow, 0, coordinateCounts);
  const secondNode = buildPublicMapNodeFromRow({ ...baseRow, id: "server-2", public_slug: "london-dayz-2" }, 1, coordinateCounts);
  assert.ok(firstNode);
  assert.ok(secondNode);
  assert.notEqual(`${firstNode.latitude}:${firstNode.longitude}`, `${secondNode.latitude}:${secondNode.longitude}`);

  console.log("GeoIP and public map node tests passed.");
}
