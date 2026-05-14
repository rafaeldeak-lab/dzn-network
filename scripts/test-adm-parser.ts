import assert from "node:assert/strict";

import { parseAdmLine, parseAdmLines } from "../functions/_lib/adm-parser";

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

const invalidPosition = parseAdmLine(
  '11:43:32 | Player "ExamplePlayer" (id=PLAYER_ID pos=<-340282346638528859811704183484516925440.0, 10326.4, 339.3>) is connected',
  context,
);
assert.equal(invalidPosition.eventType, "player_connected");
assert.equal(invalidPosition.position, null);

const unknown = parseAdmLine("this is not a valid ADM line", context);
assert.equal(unknown.eventType, "unknown");

console.log("ADM parser tests passed");
