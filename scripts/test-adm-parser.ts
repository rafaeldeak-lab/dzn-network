import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseAdmLine, parseAdmLines } from "../functions/_lib/adm-parser";
import { buildAdmImportDebugReport } from "../functions/_lib/adm-sync";
import { classifyParsedBuildEvent, summarizeBuildStats } from "../functions/_lib/build-events";

const context = { admDate: "2026-05-14" };

const adminStarted = parseAdmLine("AdminLog started on 2026-05-14 at 10:30:46");
assert.equal(adminStarted.eventType, "admin_log_started");
assert.equal(adminStarted.admDate, "2026-05-14");
assert.equal(adminStarted.admStartTime, "10:30:46");

const connecting = parseAdmLine('11:43:12 | Player "ExamplePlayer" (id=PLAYER_ID) is connecting', context);
assert.equal(connecting.eventType, "player_connecting");
assert.equal(connecting.playerName, "ExamplePlayer");
assert.equal(connecting.playerId, "PLAYER_ID");
assert.equal(connecting.occurredAt, "2026-05-14T11:43:12.000Z");

const connected = parseAdmLine(
  '11:43:32 | Player "ExamplePlayer" (id=PLAYER_ID pos=<4482.6, 10326.4, 339.3>) is connected',
  context,
);
assert.equal(connected.eventType, "player_connected");
assert.deepEqual(connected.position, { x: 4482.6, y: 10326.4, z: 339.3 });

const disconnected = parseAdmLine(
  '11:44:58 | Player "ExamplePlayer" (id=PLAYER_ID pos=<4521.4, 10334.4, 339.4>) has been disconnected',
  context,
);
assert.equal(disconnected.eventType, "player_disconnected");

const pvpKill = parseAdmLine(
  '13:46:10 | Player "VictimName" (DEAD) (id=VICTIM_ID pos=<4511.8, 10366.9, 339.4>) killed by Player "KillerName" (id=KILLER_ID pos=<4519.4, 10373.2, 339.4>) with LAR from 9.836 meters',
  context,
);
assert.equal(pvpKill.eventType, "player_killed");
assert.equal(pvpKill.victimName, "VictimName");
assert.equal(pvpKill.killerName, "KillerName");
assert.equal(pvpKill.weapon, "LAR");
assert.equal(pvpKill.distance, 9.836);
assert.equal(pvpKill.isPvpKill, true);
assert.equal(pvpKill.isCreditedKill, true);

const deadKillerPvpKill = parseAdmLine(
  '17:24:11 | Player "xAKA-MINI_KickAs" (DEAD) (id=VICTIM_ID pos=<6363.7, 8031.0, 333.0>) killed by Player "monkeyman178x" (DEAD) (id=KILLER_ID pos=<6370.1, 8033.4, 333.0>) with M4-A1 from 11.6167 meters',
  { admDate: "2026-05-17" },
);
assert.equal(deadKillerPvpKill.eventType, "player_killed");
assert.equal(deadKillerPvpKill.victimName, "xAKA-MINI_KickAs");
assert.equal(deadKillerPvpKill.killerName, "monkeyman178x");
assert.equal(deadKillerPvpKill.weapon, "M4-A1");
assert.equal(deadKillerPvpKill.distance, 11.6167);
assert.equal(deadKillerPvpKill.isCreditedKill, true);

const demonchaserManualPasteKillLine = '00:58 | Player "Demonchaser69420" (DEAD) (id=PLZk8nv5S7Wc90LP6G_b7J3eLJVZqgjF5v74mmBUXws= pos=<6427.9, 8104.8, 333.0>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6410.2, 8089.4, 339.5>) with M4-A1 from 24.38 meters';
const demonchaserManualPasteKill = parseAdmLine(demonchaserManualPasteKillLine, { admDate: "2026-05-20" });
assert.equal(demonchaserManualPasteKill.eventType, "player_killed");
assert.equal(demonchaserManualPasteKill.victimName, "Demonchaser69420");
assert.equal(demonchaserManualPasteKill.killerName, "xAKA-MINI_KickAs");
assert.equal(demonchaserManualPasteKill.weapon, "M4-A1");
assert.equal(demonchaserManualPasteKill.distance, 24.38);
assert.equal(demonchaserManualPasteKill.occurredAt, "2026-05-20T00:00:58.000Z");
assert.equal(demonchaserManualPasteKill.isPvpKill, true);
assert.equal(demonchaserManualPasteKill.isCreditedKill, true);
assert.equal(parseAdmLines([demonchaserManualPasteKillLine], { admDate: "2026-05-20" }).filter((event) => event.eventType === "player_killed" && event.isCreditedKill).length, 1);

const playerHit = parseAdmLine(
  '13:46:10 | Player "VictimName" (DEAD) (id=VICTIM_ID pos=<4511.8, 10366.9, 339.4>)[HP: 0] hit by Player "KillerName" (id=KILLER_ID pos=<4519.4, 10373.2, 339.4>) into Head(0) for 30.5589 damage (Bullet_308Win) with LAR from 9.836 meters',
  context,
);
assert.equal(playerHit.eventType, "player_hit");
assert.equal(playerHit.victimHp, 0);
assert.equal(playerHit.attackerName, "KillerName");
assert.equal(playerHit.hitZone, "Head");
assert.equal(playerHit.hitZoneIndex, 0);
assert.equal(playerHit.damage, 30.5589);
assert.equal(playerHit.ammo, "Bullet_308Win");
assert.equal(playerHit.isCreditedKill, false);

const explosionHit = parseAdmLine(
  '19:46:17 | Player "ExamplePlayer" (id=PLAYER_ID pos=<4497.8, 10348.1, 339.3>)[HP: 56.8594] hit by explosion (M67Grenade_Ammo)',
  context,
);
assert.equal(explosionHit.eventType, "player_hit_explosion");
assert.equal(explosionHit.hp, 56.8594);
assert.equal(explosionHit.explosionType, "M67Grenade_Ammo");

const unknownAttackerHit = parseAdmLine(
  '02:55:38 | Player "ExamplePlayer" (DEAD) (id=PLAYER_ID pos=<4483.0, 10328, 339.2>)[HP: 0] hit by M4A1 into Head(0) for 24.006 damage (Bullet_556x45)',
  context,
);
assert.equal(unknownAttackerHit.eventType, "player_hit_unknown_attacker");
assert.equal(unknownAttackerHit.weapon, "M4A1");
assert.equal(unknownAttackerHit.isCreditedKill, false);

const fragDeath = parseAdmLine(
  '19:47:06 | Player "ExamplePlayer" (DEAD) (id=PLAYER_ID pos=<4498.7, 10346.6, 339.3>) killed by 6-M7 Frag Grenade',
  context,
);
assert.equal(fragDeath.eventType, "player_killed_environment");
assert.equal(fragDeath.cause, "6-M7 Frag Grenade");
assert.equal(fragDeath.isPvpKill, false);
assert.equal(fragDeath.isCreditedKill, false);

const flashbangDeath = parseAdmLine(
  '19:47:06 | Player "ExamplePlayer" (DEAD) (id=PLAYER_ID pos=<4498.7, 10346.6, 339.3>) killed by 8-M4 Flashbang',
  context,
);
assert.equal(flashbangDeath.eventType, "player_killed_environment");
assert.equal(flashbangDeath.cause, "8-M4 Flashbang");

const unconscious = parseAdmLine(
  '13:47:02 | Player "ExamplePlayer" (id=PLAYER_ID pos=<4489.2, 10322.4, 339.2>) is unconscious',
  context,
);
assert.equal(unconscious.eventType, "player_unconscious");

const regained = parseAdmLine(
  '13:47:04 | Player "ExamplePlayer" (id=PLAYER_ID pos=<4488.7, 10321.8, 339.2>) regained consciousness',
  context,
);
assert.equal(regained.eventType, "player_regained_consciousness");

const suicide = parseAdmLine(
  '12:48:12 | Player "ExamplePlayer" (id=PLAYER_ID pos=<4489.8, 10324.9, 339.2>) committed suicide',
  context,
);
assert.equal(suicide.eventType, "player_suicide");
assert.equal(suicide.victimName, "ExamplePlayer");

const diedStats = parseAdmLine(
  '12:48:12 | Player "ExamplePlayer" (DEAD) (id=PLAYER_ID pos=<4489.8, 10324.9, 339.2>) died. Stats> Water: 582.795 Energy: 582.795 Bleed sources: 0',
  context,
);
assert.equal(diedStats.eventType, "player_died_stats");
assert.equal(diedStats.water, 582.795);
assert.equal(diedStats.energy, 582.795);
assert.equal(diedStats.bleedSources, 0);

const emote = parseAdmLine(
  '20:21:51 | Player "ExamplePlayer" (id=PLAYER_ID pos=<4500.7, 10344.1, 339.3>) performed EmoteSuicide with FAL',
  context,
);
assert.equal(emote.eventType, "player_performed_action");
assert.equal(emote.action, "EmoteSuicide");
assert.equal(emote.itemOrWeapon, "FAL");

const playerList = parseAdmLines(
  [
    "AdminLog started on 2026-05-14 at 13:45:00",
    "13:46:16 | ##### PlayerList log: 2 players",
    "13:46:16 | #####",
    '13:46:16 | Player "PlayerOne" (DEAD) (id=PLAYER_ONE_ID pos=<4511.0, 10365.6, 339.4>)',
    '13:46:16 | Player "PlayerTwo" (id=PLAYER_TWO_ID pos=<4517.4, 10370.1, 339.4>)',
  ],
);
assert.equal(playerList[1]?.eventType, "playerlist_snapshot");
assert.equal(playerList[1]?.playerCount, 2);
assert.equal(playerList[2]?.eventType, "playerlist_delimiter");
assert.equal(playerList[3]?.eventType, "playerlist_entry");
assert.equal(playerList[3]?.isDead, true);
assert.equal(playerList[4]?.eventType, "playerlist_entry");
assert.equal(playerList[4]?.isDead, false);

const respawn = parseAdmLine(
  '07:41:41 | Player "ExamplePlayer" (DEAD) (id=PLAYER_ID pos=<4494.4, 10342.8, 339.1>) is choosing to respawn',
  context,
);
assert.equal(respawn.eventType, "player_choosing_respawn");
assert.equal(respawn.isDead, true);

const placed = parseAdmLine(
  '11:33:52 | Player "ExamplePlayer" (id=PLAYER_ID pos=<10633.3, 12408.6, 264.4>) placed Fireplace',
  context,
);
assert.equal(placed.eventType, "player_placed_object");
assert.equal(placed.objectType, "Fireplace");

const placedFenceKit = parseAdmLine(
  '19:58:57 | Player "romekczerepowicz" (id=6f1_FexaEOgH1953a17uuuLQRMndd_up8aWIYWzcjAY= pos=<22.3, 7892.5, 303.1>) placed Fence Kit<FenceKit>',
  context,
);
assert.equal(placedFenceKit.eventType, "player_placed_object");
assert.equal(placedFenceKit.playerName, "romekczerepowicz");
assert.equal(placedFenceKit.placedObject, "Fence Kit");
assert.equal(placedFenceKit.placedClass, "FenceKit");
assert.deepEqual(placedFenceKit.position, { x: 22.3, y: 7892.5, z: 303.1 });

const builtBase = parseAdmLine(
  '19:59:30 | Player "romekczerepowicz" (id=6f1_FexaEOgH1953a17uuuLQRMndd_up8aWIYWzcjAY= pos=<22.4, 7891.1, 303.0>)Built base on Fence with Shovel',
  context,
);
assert.equal(builtBase.eventType, "player_built_structure");
assert.equal(builtBase.buildPart, "base");
assert.equal(builtBase.targetObject, "Fence");
assert.equal(builtBase.tool, "Shovel");

const builtWallBaseUp = parseAdmLine(
  '20:00:27 | Player "romekczerepowicz" (id=6f1_FexaEOgH1953a17uuuLQRMndd_up8aWIYWzcjAY= pos=<22.3, 7891.3, 303.1>) Built wall_base_up on Fence with Hatchet',
  context,
);
assert.equal(builtWallBaseUp.eventType, "player_built_structure");
assert.equal(builtWallBaseUp.buildPart, "wall_base_up");
assert.equal(builtWallBaseUp.targetObject, "Fence");
assert.equal(builtWallBaseUp.tool, "Hatchet");

const builtGate = parseAdmLine(
  '20:01:27 | Player "romekczerepowicz" (id=6f1_FexaEOgH1953a17uuuLQRMndd_up8aWIYWzcjAY= pos=<22.4, 7891.5, 303.1>)Built wall_gate on Gate with Pliers',
  context,
);
assert.equal(builtGate.eventType, "player_built_structure");
assert.equal(builtGate.buildPart, "wall_gate");
assert.equal(builtGate.targetObject, "Gate");
assert.equal(builtGate.tool, "Pliers");

const buildCoverageLines = [
  '20:02:00 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) placed Watchtower Kit<WatchtowerKit>',
  '20:02:01 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) placed Wooden Crate<WoodenCrate>',
  '20:02:02 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) placed Construction Light<Spotlight>',
  '20:02:03 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) placed Tripwire<TripwireTrap>',
  '20:02:04 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>)Built level_1_base on Watchtower with Pickaxe',
  '20:02:05 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>)Built level_2_wall_2_wood_down on Watchtower with Hatchet',
  '20:02:06 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>)Built level_3_wall_3_metal_down on Watchtower with Hammer',
  '20:02:07 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>)Dismantled Upper Wooden Wall from Watchtower with Hatchet',
  '20:02:08 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>)Dismantled Upper Frame from Watchtower with Hatchet',
  '20:02:09 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) folded Fence',
  '20:02:10 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) has raised Flag_SSahrani on TerritoryFlag at <8250.864258, 353.267975, 7003.206543>',
  '20:02:11 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) has lowered Flag_NSahrani on TerritoryFlag at <8250.864258, 353.267975, 7003.206543>',
];
const buildCoverageEvents = parseAdmLines(buildCoverageLines, context);
assert.deepEqual(buildCoverageEvents.map((event) => event.eventType), [
  "player_placed_object",
  "player_placed_object",
  "player_placed_object",
  "player_placed_object",
  "player_built_structure",
  "player_built_structure",
  "player_built_structure",
  "player_dismantled_structure",
  "player_dismantled_structure",
  "player_folded_structure",
  "territory_flag_raised",
  "territory_flag_lowered",
]);
assert.equal(buildCoverageEvents[2]?.placedObject, "Construction Light");
assert.equal(buildCoverageEvents[2]?.placedClass, "Spotlight");
assert.equal(buildCoverageEvents[3]?.placedClass, "TripwireTrap");
assert.equal(buildCoverageEvents[4]?.buildPart, "level_1_base");
assert.equal(buildCoverageEvents[5]?.buildPart, "level_2_wall_2_wood_down");
assert.equal(buildCoverageEvents[6]?.buildPart, "level_3_wall_3_metal_down");
assert.equal(buildCoverageEvents[7]?.buildPart, "Upper Wooden Wall");
assert.equal(buildCoverageEvents[7]?.targetObject, "Watchtower");
assert.equal(buildCoverageEvents[9]?.buildPart, "Fence");
assert.equal(buildCoverageEvents[10]?.action, "flag_raised");
assert.equal(buildCoverageEvents[10]?.placedObject, "Flag_SSahrani");
assert.deepEqual(buildCoverageEvents[10]?.objectPosition, { x: 8250.864258, y: 353.267975, z: 7003.206543 });
const classifiedBuildCoverage = buildCoverageEvents.map((event) => classifyParsedBuildEvent(event));
assert.deepEqual(classifiedBuildCoverage.map((event) => event?.eventType), [
  "placed",
  "placed",
  "placed",
  "placed",
  "built",
  "built",
  "built",
  "dismantled",
  "dismantled",
  "folded",
  "flag_raised",
  "flag_lowered",
]);
assert.equal(classifiedBuildCoverage[2]?.category, "utility");
assert.equal(classifiedBuildCoverage[3]?.category, "trap");
const buildSummary = summarizeBuildStats(classifiedBuildCoverage.filter(Boolean).map((event) => ({
  eventType: event!.eventType,
  category: event!.category,
  buildPart: event!.buildPart,
  placedClass: event!.placedClass,
})));
assert.equal(buildSummary.structuresBuilt, 3);
assert.equal(buildSummary.buildItemsPlaced, 1);
assert.equal(buildSummary.storageItemsPlaced, 1);
assert.equal(buildSummary.trapsPlaced, 1);

const extraBuildEdgeLines = [
  '20:03:00 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) placed Barrel<Barrel_Red>',
  '20:03:01 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) placed Barrel<Barrel_Blue>',
  '20:03:02 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) placed Barrel<Barrel_Yellow>',
  '20:03:03 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) placed Sea Chest<SeaChest>',
  '20:03:04 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>)Built wall_platform on Fence with Hatchet',
  '20:03:05 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) Built wall_platform on Fence with Hatchet',
  '20:03:06 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) has raised Flag_Zagorky on TerritoryFlag at <8250.864258, 353.267975, 7003.206543>',
  '20:03:07 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) has lowered Flag_Zagorky on TerritoryFlag at <8250.864258, 353.267975, 7003.206543>',
  '20:03:08 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>) performed EmoteSitA',
  '20:03:09 | Player "Builder" (id=BUILDER_ID pos=<22.4, 7891.5, 303.1>)[HP: 97.5775] hit by Infected into Torso(1) for 2.4225 damage (MeleeInfectedLong)',
  "20:03:10 | ##### PlayerList log: 1 players",
];
const extraBuildEdgeEvents = parseAdmLines(extraBuildEdgeLines, context);
assert.deepEqual(extraBuildEdgeEvents.map((event) => event.eventType), [
  "player_placed_object",
  "player_placed_object",
  "player_placed_object",
  "player_placed_object",
  "player_built_structure",
  "player_built_structure",
  "territory_flag_raised",
  "territory_flag_lowered",
  "player_performed_action",
  "player_hit_unknown_attacker",
  "playerlist_snapshot",
]);
const classifiedExtraBuildEdges = extraBuildEdgeEvents.map((event) => classifyParsedBuildEvent(event));
assert.deepEqual(classifiedExtraBuildEdges.map((event) => event?.eventType ?? null), [
  "placed",
  "placed",
  "placed",
  "placed",
  "built",
  "built",
  "flag_raised",
  "flag_lowered",
  null,
  null,
  null,
]);
assert.deepEqual(classifiedExtraBuildEdges.slice(0, 4).map((event) => event?.category), ["storage", "storage", "storage", "storage"]);
assert.deepEqual(classifiedExtraBuildEdges.slice(0, 4).map((event) => event?.placedClass), ["barrel_red", "barrel_blue", "barrel_yellow", "seachest"]);
assert.equal(extraBuildEdgeEvents[4]?.buildPart, "wall_platform");
assert.equal(extraBuildEdgeEvents[5]?.buildPart, "wall_platform");
assert.equal(classifiedExtraBuildEdges[4]?.category, "structure");
assert.equal(classifiedExtraBuildEdges[5]?.category, "structure");
assert.equal(classifiedExtraBuildEdges[6]?.placedObject, "Flag_Zagorky");
assert.equal(classifiedExtraBuildEdges[7]?.placedObject, "Flag_Zagorky");
assert.equal(classifiedExtraBuildEdges[7]?.score, 0);

const invalidPosition = parseAdmLine(
  '11:43:32 | Player "ExamplePlayer" (id=PLAYER_ID pos=<-340282346638528859811704183484516925440.0, 10326.4, 339.3>) is connected',
  context,
);
assert.equal(invalidPosition.eventType, "player_connected");
assert.equal(invalidPosition.position, null);

const unknown = parseAdmLine("this is not a valid ADM line", context);
assert.equal(unknown.eventType, "unknown");

const realConsoleKillFixture = [
  '19:45:34 | Player "xAKA-MINI_KickAs" (DEAD) (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6363.7, 8031.0, 333.0>) killed by Player "Netfl1xAndK1II" (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6369.5, 8035.0, 333.0>) with M4-A1 from 6.96356 meters',
  '19:46:42 | Player "Netfl1xAndK1II" (DEAD) (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6375.8, 8056.2, 341.9>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6365.1, 8053.2, 341.9>) with M4-A1 from 11.1206 meters',
  '19:47:32 | Player "Netfl1xAndK1II" (DEAD) (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6393.7, 8081.1, 333.0>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6401.7, 8080.4, 338.9>) with M4-A1 from 9.97779 meters',
  '19:48:17 | Player "xAKA-MINI_KickAs" (DEAD) (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6382.5, 8046.7, 333.0>) killed by Player "Netfl1xAndK1II" (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6385.0, 8045.9, 333.0>) with M4-A1 from 2.59635 meters',
  '19:48:29 | Player "Netfl1xAndK1II" (DEAD) (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6375.1, 8036.9, 333.0>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6374.2, 8036.6, 333.3>) with M4-A1 from 0.962042 meters',
  '19:53:17 | Player "Netfl1xAndK1II" (DEAD) (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6406.9, 8072.6, 339.2>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6412.8, 8077.8, 340.2>) with M4-A1 from 7.90784 meters',
  '19:54:07 | Player "Netfl1xAndK1II" (DEAD) (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6407.9, 8082.0, 340.2>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6403.4, 8079.5, 339.2>) with M4-A1 from 5.19115 meters',
  '19:54:19 | Player "Netfl1xAndK1II" (DEAD) (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6427.2, 8082.2, 336.8>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6410.8, 8087.3, 339.6>) with M4-A1 from 17.4068 meters',
  '19:54:58 | Player "Netfl1xAndK1II" (DEAD) (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6428.4, 8088.7, 333.0>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6413.0, 8087.5, 339.2>) with M4-A1 from 16.6234 meters',
  '19:58:08 | Player "Netfl1xAndK1II" (DEAD) (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6385.8, 8071.3, 333.0>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6384.5, 8067.3, 333.0>) with M4-A1 from 4.13884 meters',
];
const realConsoleKills = parseAdmLines(realConsoleKillFixture, { admDate: "2026-05-15" })
  .filter((event) => event.eventType === "player_killed" && event.isCreditedKill);
assert.equal(realConsoleKills.length, 10);
assert.equal(realConsoleKills[0]?.victimName, "xAKA-MINI_KickAs");
assert.equal(realConsoleKills[0]?.victimId, "6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q=");
assert.equal(realConsoleKills[0]?.killerName, "Netfl1xAndK1II");
assert.equal(realConsoleKills[0]?.killerId, "A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk=");
assert.equal(realConsoleKills[0]?.weapon, "M4-A1");
assert.equal(realConsoleKills[0]?.distance, 6.96356);
assert.equal(realConsoleKills[0]?.occurredAt, "2026-05-15T19:45:34.000Z");

const nuketown1701FixtureName = "DayZServer_PS4_x64_2026-05-17_17-01-42.ADM";
const nuketown1802FixtureName = "DayZServer_PS4_x64_2026-05-17_18-02-25.ADM";
const nuketown1701Fixture = buildNuketownKillFixture(24, 17, "17");
const nuketown1802Fixture = buildNuketownKillFixture(4, 18, "18");
assert.equal(nuketown1701Fixture.filter((line) => /\bkilled by\s+Player\s+"/i.test(line)).length, 24);
assert.equal(nuketown1802Fixture.filter((line) => /\bkilled by\s+Player\s+"/i.test(line)).length, 4);
assert.equal(
  parseAdmLines(nuketown1701Fixture, { admDate: "2026-05-17" }).filter((event) => event.eventType === "player_killed" && event.isCreditedKill).length,
  24,
  `${nuketown1701FixtureName} should parse all expected kill lines`,
);
assert.equal(
  parseAdmLines(nuketown1802Fixture, { admDate: "2026-05-17" }).filter((event) => event.eventType === "player_killed" && event.isCreditedKill).length,
  4,
  `${nuketown1802FixtureName} should parse all expected kill lines`,
);

const nonKillDamageLines = parseAdmLines([
  '19:45:33 | Player "xAKA-MINI_KickAs" (DEAD) (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6363.7, 8031.0, 333.0>)[HP: 0] hit by Player "Netfl1xAndK1II" (id=A05lJnolLduFHYUSGaa0K81g7ZfYn5Y62WY3lwWfoKk= pos=<6369.5, 8035.0, 333.0>) into Torso(1) for 30 damage (Bullet_556x45) with M4-A1 from 6.96356 meters',
  '19:45:34 | Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6363.7, 8031.0, 333.0>) is unconscious',
  '19:45:35 | Player "xAKA-MINI_KickAs" (DEAD) (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6363.7, 8031.0, 333.0>) died. Stats> Water: 100 Energy: 100 Bleed sources: 0',
], { admDate: "2026-05-15" });
assert.equal(nonKillDamageLines.filter((event) => event.eventType === "player_killed" && event.isCreditedKill).length, 0);

const uploadedAdmFixtureName = "DayZServer_PS4_x64_2026-05-19_16-01-55.ADM";
const uploadedAdmFixtureLines = readFileSync(`scripts/fixtures/${uploadedAdmFixtureName}`, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0);
const uploadedAdmEvents = parseAdmLines(uploadedAdmFixtureLines, { admDate: "2026-05-19" });
const uploadedPvpKills = uploadedAdmEvents.filter((event) => event.eventType === "player_killed" && event.isCreditedKill);
const uploadedSuicides = uploadedAdmEvents.filter((event) => event.eventType === "player_suicide");
const uploadedUncreditedDeaths = uploadedAdmEvents.filter((event) => event.eventType === "player_died_stats");
const uploadedRespawnChoices = uploadedAdmEvents.filter((event) => event.eventType === "player_choosing_respawn");
const uploadedDeadHits = uploadedAdmEvents.filter((event) => event.eventType === "player_hit" && event.victimDead && !event.isCreditedKill);
const uploadedImportReport = buildAdmImportDebugReport(uploadedAdmFixtureLines, { admFileName: uploadedAdmFixtureName });

assert.equal(uploadedAdmFixtureLines.filter((line) => /\bkilled by\s+Player\s+"/i.test(line)).length, 10);
assert.equal(uploadedPvpKills.length, 10);
assert.equal(uploadedImportReport.rawKilledByLinesFound, 10);
assert.equal(uploadedImportReport.parsedPvpKills, 10);
assert.equal(uploadedImportReport.duplicateSkips, 0);
assert.equal(uploadedImportReport.cursorStart, 0);
assert.equal(uploadedImportReport.cursorEnd, uploadedAdmFixtureLines.length);
assert.equal(uploadedImportReport.skippedDeadHitLines, 3);
assert.equal(uploadedDeadHits.length, 3);
assert.equal(uploadedDeadHits.some((event) => event.eventType === "player_killed" || event.isCreditedKill), false);
assert.equal(uploadedSuicides.length, 2);
assert.equal(uploadedImportReport.parsedSuicides, 2);
assert.equal(uploadedUncreditedDeaths.length, 1);
assert.equal(uploadedImportReport.parsedUncreditedDeaths, 1);
assert.equal(uploadedRespawnChoices.length, 1);
assert.equal(uploadedRespawnChoices[0]?.eventType, "player_choosing_respawn");
assert.equal(uploadedRespawnChoices[0]?.isCreditedKill, false);

const expectedUploadedKills = [
  ["16:05:47", "Uractuallybadzzz", "mustard_coffer74", "M4-A1", 4.23161],
  ["16:07:39", "mustard_coffer74", "Uractuallybadzzz", "M4-A1", 3.95237],
  ["16:08:39", "mustard_coffer74", "Uractuallybadzzz", "M4-A1", 8.60826],
  ["16:09:25", "mustard_coffer74", "Uractuallybadzzz", "M4-A1", 4.68658],
  ["16:10:33", "mustard_coffer74", "Uractuallybadzzz", "M4-A1", 9.29149],
  ["16:11:27", "Uractuallybadzzz", "mustard_coffer74", "M4-A1", 6.46832],
  ["16:12:21", "Uractuallybadzzz", "mustard_coffer74", "M4-A1", 12.0174],
  ["16:13:04", "mustard_coffer74", "Uractuallybadzzz", "M4-A1", 48.5404],
  ["16:15:57", "xAKA-MINI_KickAs", "mustard_coffer74", "M4-A1", 7.43367],
  ["16:16:04", "Uractuallybadzzz", "xAKA-MINI_KickAs", "M4-A1", 3.54201],
] as const;

for (const [index, [time, killer, victim, weapon, distance]] of expectedUploadedKills.entries()) {
  const parsed = uploadedPvpKills[index];
  assert.equal(parsed?.occurredAt, `2026-05-19T${time}.000Z`);
  assert.equal(parsed?.killerName, killer);
  assert.equal(parsed?.victimName, victim);
  assert.equal(parsed?.weapon, weapon);
  assert.equal(parsed?.distance, distance);
  assert.equal(parsed?.isPvpKill, true);
  assert.equal(parsed?.isCreditedKill, true);
}

const uploadedKillTotals = uploadedPvpKills.reduce<Record<string, number>>((totals, event) => {
  const killer = event.killerName ?? "unknown";
  totals[killer] = (totals[killer] ?? 0) + 1;
  return totals;
}, {});
assert.deepEqual(uploadedKillTotals, {
  mustard_coffer74: 5,
  Uractuallybadzzz: 4,
  "xAKA-MINI_KickAs": 1,
});

const latestUploadedAdmFixtureName = "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM";
const latestUploadedAdmFixtureLines = readFileSync(`scripts/fixtures/${latestUploadedAdmFixtureName}`, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0);
const latestUploadedAdmEvents = parseAdmLines(latestUploadedAdmFixtureLines, { admDate: "2026-05-20" });
const latestUploadedPvpKills = latestUploadedAdmEvents.filter((event) => event.eventType === "player_killed" && event.isCreditedKill);
const latestUploadedDeadHits = latestUploadedAdmEvents.filter((event) => event.eventType === "player_hit" && event.victimDead && !event.isCreditedKill);
const latestUploadedPlayerListSnapshot = latestUploadedAdmEvents.find((event) => event.eventType === "playerlist_snapshot");
const latestUploadedPlayerListEntries = latestUploadedAdmEvents.filter((event) => event.eventType === "playerlist_entry");
const latestUploadedConnected = latestUploadedAdmEvents.filter((event) => event.eventType === "player_connected");
const latestUploadedDisconnected = latestUploadedAdmEvents.filter((event) => event.eventType === "player_disconnected");

assert.equal(latestUploadedAdmFixtureLines.filter((line) => /\bkilled by\s+Player\s+"/i.test(line)).length, 5);
assert.equal(latestUploadedPvpKills.length, 5);
assert.equal(latestUploadedDeadHits.length > latestUploadedPvpKills.length, true);
assert.equal(latestUploadedDeadHits.some((event) => event.eventType === "player_killed" || event.isCreditedKill), false);
assert.equal(latestUploadedPlayerListSnapshot?.playerCount, 2);
assert.deepEqual(latestUploadedPlayerListEntries.map((event) => event.playerName), ["TempoGreens", "IlIbigIll"]);
assert.equal(latestUploadedConnected.length, 8);
assert.deepEqual(latestUploadedDisconnected.map((event) => event.playerName), ["IlIbigIll"]);

const expectedLatestUploadedKills = [
  ["06:18:09", "xAKA-MINI_KickAs", "TempoGreens"],
  ["06:18:35", "IlIbigIll", "xAKA-MINI_KickAs"],
  ["06:18:35", "TempoGreens", "IlIbigIll"],
  ["06:18:42", "xAKA-MINI_KickAs", "IlIbigIll"],
  ["06:18:43", "IlIbigIll", "xAKA-MINI_KickAs"],
] as const;

for (const [index, [time, killer, victim]] of expectedLatestUploadedKills.entries()) {
  const parsed = latestUploadedPvpKills[index];
  assert.equal(parsed?.occurredAt, `2026-05-20T${time}.000Z`);
  assert.equal(parsed?.killerName, killer);
  assert.equal(parsed?.victimName, victim);
  assert.equal(parsed?.weapon, "M4-A1");
  assert.equal(parsed?.isPvpKill, true);
  assert.equal(parsed?.isCreditedKill, true);
}

assertRealAdmFixtureCounts("DayZServer_PS4_x64_2026-05-20_06-02-03.ADM", {
  pvpKills: 5,
  joins: 8,
  disconnects: 1,
  playerlistSnapshots: 1,
});
assertRealAdmFixtureCounts("DayZServer_PS4_x64_2026-05-20_09-01-27.ADM", {
  pvpKills: 21,
  joins: 32,
  disconnects: 3,
  playerlistSnapshots: 3,
});
assertRealAdmFixtureCounts("DayZServer_PS4_x64_2026-05-20_10-02-17.ADM", {
  pvpKills: 29,
  joins: 43,
  disconnects: 4,
  playerlistSnapshots: 11,
});
assertRealAdmFixtureCounts("DayZServer_PS4_x64_2026-06-29_05-01-57.ADM", {
  pvpKills: 0,
  joins: 1,
  disconnects: 1,
  playerlistSnapshots: 1,
}, "2026-06-29");
assertRealAdmFixtureCounts("DayZServer_PS4_x64_2026-06-29_06-02-10.ADM", {
  pvpKills: 1,
  joins: 3,
  disconnects: 1,
  playerlistSnapshots: 2,
}, "2026-06-29");

const ownerSampleAdmEvents = parseAdmLines(
  readFileSync("scripts/fixtures/DayZServer_PS4_x64_2026-06-29_06-02-10.ADM", "utf8").split(/\r?\n/),
  { admDate: "2026-06-29" },
);
const ownerSampleHit = ownerSampleAdmEvents.find((event) => event.eventType === "player_hit" && event.weapon === "M4-A1");
const ownerSampleKill = ownerSampleAdmEvents.find((event) => event.eventType === "player_killed" && event.isCreditedKill);
assert.equal(ownerSampleHit?.attackerName, "NukeRunner");
assert.equal(ownerSampleHit?.victimName, "BanditTwo");
assert.equal(ownerSampleHit?.ammo, "Bullet_556x45");
assert.equal(ownerSampleHit?.distance, 12.7866);
assert.equal(ownerSampleKill?.killerName, "NukeRunner");
assert.equal(ownerSampleKill?.victimName, "BanditTwo");
assert.equal(ownerSampleAdmEvents.some((event) => event.eventType === "player_choosing_respawn"), true);

console.log("DZN ADM IMPORT DEBUG REPORT", uploadedImportReport);

console.log("ADM parser tests passed");

function buildNuketownKillFixture(count: number, hour: number, prefix: string) {
  return Array.from({ length: count }, (_value, index) => {
    const minute = String(Math.floor(index / 2)).padStart(2, "0");
    const second = String((index * 7) % 60).padStart(2, "0");
    const killerDead = index % 3 === 0 ? " (DEAD)" : "";
    return `${String(hour).padStart(2, "0")}:${minute}:${second} | Player "NukeVictim${prefix}_${index}" (DEAD) (id=VICTIM_${prefix}_${index} pos=<6363.${index}, 8031.0, 333.0>) killed by Player "NukeKiller${prefix}_${index}"${killerDead} (id=KILLER_${prefix}_${index} pos=<6370.${index}, 8033.4, 333.0>) with M4-A1 from ${Number(3 + index / 10).toFixed(4)} meters`;
  });
}

function assertRealAdmFixtureCounts(
  filename: string,
  expected: {
    pvpKills: number;
    joins: number;
    disconnects: number;
    playerlistSnapshots: number;
  },
  admDate = "2026-05-20",
) {
  const lines = readFileSync(`scripts/fixtures/${filename}`, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const events = parseAdmLines(lines, { admDate });
  assert.equal(events.filter((event) => event.eventType === "player_killed" && event.isCreditedKill).length, expected.pvpKills, `${filename} PvP kill count`);
  assert.equal(events.filter((event) => event.eventType === "player_connected").length, expected.joins, `${filename} connected count`);
  assert.equal(events.filter((event) => event.eventType === "player_disconnected").length, expected.disconnects, `${filename} disconnect count`);
  assert.equal(events.filter((event) => event.eventType === "playerlist_snapshot").length, expected.playerlistSnapshots, `${filename} PlayerList snapshot count`);
}
