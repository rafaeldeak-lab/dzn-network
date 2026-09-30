import assert from "node:assert/strict";

import {
  buildPublicMapNodeFromRow,
  buildPublicMapNodesFromRows,
  sanitizePublicHomeStatsSnapshot,
  type MapNodeRow,
} from "../functions/api/public/home-stats";
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
  assert.equal(node.location_label, "United Kingdom");
  assert.equal(node.region, "United Kingdom");
  assert.equal(node.country, "United Kingdom");
  assert.equal(node.approximate, true);
  assert.equal(node.active, true);
  assert.equal(JSON.stringify(node).includes("8.8.8.8"), false);
  assert.equal("ip_address" in node, false);
  assert.equal("latitude" in node, false);
  assert.equal("longitude" in node, false);
  assert.equal("lat" in node, false);
  assert.equal("lng" in node, false);
  assert.equal("city" in node, false);

  const sameRegionNode = buildPublicMapNodeFromRow({
    ...baseRow,
    id: "server-elsewhere",
    public_slug: "elsewhere-uk",
    geo_latitude: 57.1497,
    geo_longitude: -2.0943,
    geo_region: "Scotland",
    geo_city: "Aberdeen",
  });
  assert.equal(sameRegionNode.x, node.x);
  assert.equal(sameRegionNode.y, node.y);
  assert.equal(sameRegionNode.location_label, "United Kingdom");

  for (const [country, latitude, longitude] of [
    ["Sweden", 59.3293, 18.0686],
    ["Russia", 55.7558, 37.6173],
    ["South Africa", -33.9249, 18.4241],
  ] as const) {
    const countryNode = buildPublicMapNodeFromRow({
      ...baseRow,
      id: country.toLowerCase().replace(/\s+/g, "-"),
      public_slug: country.toLowerCase().replace(/\s+/g, "-"),
      geo_country: country,
      geo_region: null,
      geo_latitude: latitude,
      geo_longitude: longitude,
    });
    assert.equal(countryNode.location_label, country);
    assert.equal(countryNode.country, country);
    assert.notEqual(`${countryNode.x}:${countryNode.y}`, "50:38.9");
    assert.equal("latitude" in countryNode, false);
    assert.equal("longitude" in countryNode, false);
  }

  const southAmericaNode = buildPublicMapNodeFromRow({
    ...baseRow,
    id: "south-america",
    public_slug: "south-america",
    geo_country: null,
    geo_region: "South America",
    geo_latitude: null,
    geo_longitude: null,
  });
  assert.equal(southAmericaNode.location_label, "South America");
  assert.equal(southAmericaNode.x, 33.8);

  const americanSamoaNode = buildPublicMapNodeFromRow({
    ...baseRow,
    id: "american-samoa",
    public_slug: "american-samoa",
    geo_country: "American Samoa",
    geo_region: null,
    geo_latitude: -14.271,
    geo_longitude: -170.1322,
  });
  assert.equal(americanSamoaNode.location_label, "American Samoa");
  assert.notEqual(`${americanSamoaNode.x}:${americanSamoaNode.y}`, `${node.x}:${node.y}`);

  for (const [id, latitude, longitude] of [
    ["country-only", null, null],
    ["missing-latitude", null, 18.0686],
    ["missing-longitude", 59.3293, null],
  ] as const) {
    const incompleteNode = buildPublicMapNodeFromRow({
      ...baseRow,
      id,
      public_slug: id,
      geo_country: "Sweden",
      geo_region: null,
      geo_latitude: latitude,
      geo_longitude: longitude,
    });
    assert.equal(incompleteNode.location_label, "Location awaiting metadata");
    assert.equal(incompleteNode.country, null);
  }

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
  assert.ok(unknownNode);
  assert.equal(unknownNode.location_label, "Location awaiting metadata");
  assert.equal(unknownNode.approximate, true);
  assert.equal("latitude" in unknownNode, false);
  assert.equal("longitude" in unknownNode, false);

  const coordinateCounts = new Map<string, number>();
  const firstNode = buildPublicMapNodeFromRow(baseRow, 0, coordinateCounts);
  const secondNode = buildPublicMapNodeFromRow({ ...baseRow, id: "server-2", public_slug: "london-dayz-2" }, 1, coordinateCounts);
  assert.ok(firstNode);
  assert.ok(secondNode);
  assert.notEqual(`${firstNode.x}:${firstNode.y}`, `${secondNode.x}:${secondNode.y}`);

  const publicRows: MapNodeRow[] = [
    { ...baseRow, id: "pandora", public_slug: "pandora-dayz", server_name: "PANDORA DayZ" },
    { ...baseRow, id: "nuketown", public_slug: "nuketown-deathmatch", server_name: "NukeTown DEATHMATCH", geo_latitude: 54.3, geo_longitude: -2.5 },
    {
      ...baseRow,
      id: "warlords",
      public_slug: "warlords-pvp",
      server_name: "Warlords PvP",
      stats_active: 0,
      geo_latitude: null,
      geo_longitude: null,
      geo_country: null,
      geo_region: null,
      geo_city: null,
      geo_timezone: null,
      geo_source: null,
    },
  ];
  const publicNodes = buildPublicMapNodesFromRows(publicRows);
  assert.equal(publicNodes.length, 3);
  assert.deepEqual(publicNodes.map((item) => item.name), ["PANDORA DayZ", "NukeTown DEATHMATCH", "Warlords PvP"]);
  assert.equal(publicNodes[2].sync_status, "pending");
  assert.equal(publicNodes[2].location_label, "Location awaiting metadata");
  assert.equal(JSON.stringify(publicNodes).includes("ip_address"), false);
  assert.equal(JSON.stringify(publicNodes).includes("London"), false);

  const filteredNodes = buildPublicMapNodesFromRows([
    ...publicRows,
    { ...baseRow, id: "private", status: "private", public_slug: "private-server", server_name: "Private Server" },
    { ...baseRow, id: "merged", merged_into_server_id: "canonical", public_slug: "merged-server", server_name: "Merged Server" },
  ]);
  assert.equal(filteredNodes.length, 3);

  const sanitizedSnapshot = sanitizePublicHomeStatsSnapshot({
    map_nodes: [
      {
        id: "safe-current",
        name: "Safe current node",
        x: 40,
        y: 60,
        latitude: 51.5074,
        longitude: -0.1278,
        lat: 51.5074,
        lng: -0.1278,
        city: "London",
        ip_address: "8.8.8.8",
        approximate: false,
      },
      {
        id: "legacy-exact",
        name: "Legacy exact node",
        latitude: 51.5074,
        longitude: -0.1278,
      },
    ],
  });
  assert.equal(sanitizedSnapshot.map_nodes.length, 1);
  assert.deepEqual(sanitizedSnapshot.map_nodes[0], {
    id: "safe-current",
    name: "Safe current node",
    display_name: "Safe current node",
    slug: null,
    mode: "UNKNOWN",
    server_type: "UNKNOWN",
    status: "pending",
    sync_status: "pending",
    active: false,
    x: 40,
    y: 60,
    country: null,
    region: null,
    approximate: true,
    location_label: "Location awaiting metadata",
  });
  assert.equal(JSON.stringify(sanitizedSnapshot).includes("latitude"), false);
  assert.equal(JSON.stringify(sanitizedSnapshot).includes("longitude"), false);
  assert.equal(JSON.stringify(sanitizedSnapshot).includes("ip_address"), false);

  console.log("GeoIP and public map node tests passed.");
}
