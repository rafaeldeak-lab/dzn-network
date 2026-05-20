export type AdmPosition = {
  x: number;
  y: number;
  z: number;
};

export type AdmParseContext = {
  admDate?: string;
  inPlayerList?: boolean;
  previousTime?: string;
};

export type AdmEventType =
  | "admin_log_started"
  | "player_connecting"
  | "player_connected"
  | "player_disconnected"
  | "player_killed"
  | "player_hit"
  | "player_hit_explosion"
  | "player_hit_unknown_attacker"
  | "player_killed_environment"
  | "player_unconscious"
  | "player_regained_consciousness"
  | "player_suicide"
  | "player_died_stats"
  | "player_performed_action"
  | "player_built_structure"
  | "player_dismantled_structure"
  | "playerlist_snapshot"
  | "playerlist_delimiter"
  | "playerlist_entry"
  | "player_choosing_respawn"
  | "player_placed_object"
  | "plain_player_state"
  | "unknown";

export type ParsedAdmEvent = {
  eventType: AdmEventType;
  admDate: string | null;
  admStartTime: string | null;
  occurredAt: string | null;
  playerName: string | null;
  playerId: string | null;
  victimName: string | null;
  victimId: string | null;
  killerName: string | null;
  killerId: string | null;
  attackerName: string | null;
  attackerId: string | null;
  weapon: string | null;
  ammo: string | null;
  cause: string | null;
  distance: number | null;
  damage: number | null;
  hitZone: string | null;
  hitZoneIndex: number | null;
  position: AdmPosition | null;
  victimPosition: AdmPosition | null;
  killerPosition: AdmPosition | null;
  attackerPosition: AdmPosition | null;
  water: number | null;
  energy: number | null;
  bleedSources: number | null;
  action: string | null;
  itemOrWeapon: string | null;
  objectType: string | null;
  buildPart: string | null;
  targetObject: string | null;
  tool: string | null;
  placedObject: string | null;
  placedClass: string | null;
  isDead: boolean;
  victimDead: boolean;
  isPvpKill: boolean;
  isCreditedKill: boolean;
  playerCount: number | null;
  hp: number | null;
  victimHp: number | null;
  explosionType: string | null;
  rawLine: string;
};

type AdmPlayerBlock = {
  name: string;
  id: string | null;
  position: AdmPosition | null;
  isDead: boolean;
};

type TimestampResult = {
  time: string | null;
  occurredAt: string | null;
  admDate: string | null;
  body: string;
};

const NUMBER_PATTERN = "-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?";
const POSITION_PATTERN = new RegExp(`<\\s*(${NUMBER_PATTERN})\\s*,\\s*(${NUMBER_PATTERN})\\s*,\\s*(${NUMBER_PATTERN})\\s*>`, "i");
const MAX_REASONABLE_DAYZ_COORDINATE = 200000;
let deadStateKillParserLogged = false;

export function parseAdmLine(rawLine: string, context: AdmParseContext = {}): ParsedAdmEvent {
  try {
    const line = rawLine.trim();
    const timestamp = parseTimestamp(line, context);
    const eventType = classifyAdmEvent(line, context);

    if (eventType === "admin_log_started") return parseAdminLogStarted(line, rawLine);
    if (eventType === "playerlist_snapshot") return parsePlayerListSnapshot(line, rawLine, timestamp);
    if (eventType === "playerlist_delimiter") return createBaseEvent(rawLine, timestamp, { eventType });
    if (eventType === "player_killed") return parseKillLine(line, rawLine, timestamp);
    if (
      eventType === "player_hit" ||
      eventType === "player_hit_explosion" ||
      eventType === "player_hit_unknown_attacker"
    ) {
      return parseDamageLine(line, rawLine, timestamp, eventType);
    }
    if (eventType === "player_killed_environment") return parseDeathCauseLine(line, rawLine, timestamp);
    if (eventType === "playerlist_entry") return parsePlayerListEntry(line, rawLine, timestamp, "playerlist_entry");
    if (eventType === "plain_player_state") return parsePlayerListEntry(line, rawLine, timestamp, "plain_player_state");

    return parseSinglePlayerEvent(line, rawLine, timestamp, eventType);
  } catch {
    return createBaseEvent(rawLine, { time: null, occurredAt: null, admDate: null, body: rawLine }, { eventType: "unknown" });
  }
}

export function parseAdmLines(lines: string[], options: { admDate?: string } = {}): ParsedAdmEvent[] {
  let admDate = options.admDate;
  let previousTime: string | undefined;
  let inPlayerList = false;

  return lines.map((line) => {
    const event = parseAdmLine(line, { admDate, previousTime, inPlayerList });
    const timestamp = parseTimestamp(line, { admDate, previousTime });

    if (event.eventType === "admin_log_started" && event.admDate) {
      admDate = event.admDate;
    } else if (event.occurredAt) {
      admDate = event.occurredAt.slice(0, 10);
    }

    if (timestamp.time) previousTime = timestamp.time;

    if (event.eventType === "playerlist_snapshot") {
      inPlayerList = true;
    } else if (inPlayerList && (event.eventType === "playerlist_delimiter" || event.eventType === "playerlist_entry")) {
      inPlayerList = true;
    } else if (inPlayerList) {
      inPlayerList = false;
    }

    return event;
  });
}

export function parseTimestamp(rawLine: string, context: AdmParseContext = {}): TimestampResult {
  const line = rawLine.trim();
  const prefixed = /^((?:\d{1,2}:)?\d{2}:\d{2})\s*\|\s*([\s\S]*)$/.exec(line);
  if (prefixed) {
    const time = normaliseAdmTime(prefixed[1]);
    const body = prefixed[2].trim();
    const resolvedDate = resolveTimestampDate(context.admDate, time, context.previousTime);
    return {
      time,
      occurredAt: resolvedDate ? toIsoTimestamp(resolvedDate, time) : null,
      admDate: resolvedDate,
      body,
    };
  }

  const started = /AdminLog started on\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}:\d{2}:\d{2})/i.exec(line);
  if (started) {
    return {
      time: started[2],
      occurredAt: toIsoTimestamp(started[1], started[2]),
      admDate: started[1],
      body: line,
    };
  }

  return {
    time: null,
    occurredAt: null,
    admDate: context.admDate ?? null,
    body: line,
  };
}

function normaliseAdmTime(value: string) {
  const parts = value.split(":");
  if (parts.length === 2) {
    return `00:${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  return parts.map((part) => part.padStart(2, "0")).join(":");
}

export function parsePosition(value: string): AdmPosition | null {
  const match = POSITION_PATTERN.exec(value);
  if (!match) return null;

  const position = {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };

  return isValidPosition(position) ? position : null;
}

export function parsePlayerBlock(value: string): AdmPlayerBlock | null {
  const nameMatch = /Player\s+"([^"]+)"/i.exec(value);
  if (!nameMatch) return null;

  const idMatch = /\bid\s*=\s*([^\s)]+)/i.exec(value);
  return {
    name: nameMatch[1].trim(),
    id: idMatch?.[1]?.trim() ?? null,
    position: parsePosition(value),
    isDead: /\(DEAD\)/i.test(value),
  };
}

export function parsePlayerListEntry(
  line: string,
  rawLine = line,
  timestamp = parseTimestamp(line),
  eventType: "playerlist_entry" | "plain_player_state" = "playerlist_entry",
): ParsedAdmEvent {
  const player = parsePlayerBlock(timestamp.body);
  return createBaseEvent(rawLine, timestamp, {
    eventType,
    playerName: player?.name ?? null,
    playerId: player?.id ?? null,
    position: player?.position ?? null,
    isDead: player?.isDead ?? false,
  });
}

export function isValidPosition(position: AdmPosition): boolean {
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z) &&
    Math.abs(position.x) <= MAX_REASONABLE_DAYZ_COORDINATE &&
    Math.abs(position.y) <= MAX_REASONABLE_DAYZ_COORDINATE &&
    Math.abs(position.z) <= MAX_REASONABLE_DAYZ_COORDINATE
  );
}

export function normaliseWeaponName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

export function classifyAdmEvent(rawLine: string, context: AdmParseContext = {}): AdmEventType {
  const line = rawLine.trim();
  const body = parseTimestamp(line, context).body;

  if (/^AdminLog started\b/i.test(body)) return "admin_log_started";
  if (/^#####\s*PlayerList log:\s*\d+\s+players?/i.test(body)) return "playerlist_snapshot";
  if (/^#####\s*$/i.test(body)) return "playerlist_delimiter";
  if (/\bkilled by\s+Player\s+"/i.test(body)) return "player_killed";
  if (/\bhit by\s+Player\s+"/i.test(body)) return "player_hit";
  if (/\bhit by explosion\b/i.test(body)) return "player_hit_explosion";
  if (/\bhit by\b/i.test(body)) return "player_hit_unknown_attacker";
  if (/\bkilled by\b/i.test(body)) return "player_killed_environment";
  if (/\bis connecting\b/i.test(body)) return "player_connecting";
  if (/\bis connected\b/i.test(body)) return "player_connected";
  if (/\b(has been disconnected|is disconnected|disconnected)\b/i.test(body)) return "player_disconnected";
  if (/\bregained consciousness\b/i.test(body)) return "player_regained_consciousness";
  if (/\bis unconscious\b/i.test(body)) return "player_unconscious";
  if (/\bcommitted suicide\b/i.test(body)) return "player_suicide";
  if (/\bdied\.?\s+Stats>/i.test(body)) return "player_died_stats";
  if (/\bperformed\b/i.test(body)) return "player_performed_action";
  if (/\bBuilt\s+.+?\s+on\s+/i.test(body)) return "player_built_structure";
  if (/\bDismantled\s+.+?\s+on\s+/i.test(body)) return "player_dismantled_structure";
  if (/\bis choosing to respawn\b/i.test(body)) return "player_choosing_respawn";
  if (/\bplaced\b/i.test(body)) return "player_placed_object";
  if (context.inPlayerList && /^Player\s+"/i.test(body)) return "playerlist_entry";
  if (/^Player\s+"/i.test(body)) return "plain_player_state";
  return "unknown";
}

export function parseDamageLine(
  line: string,
  rawLine = line,
  timestamp = parseTimestamp(line),
  eventType: "player_hit" | "player_hit_explosion" | "player_hit_unknown_attacker" = "player_hit",
): ParsedAdmEvent {
  const players = extractPlayerBlocks(timestamp.body);
  const victim = players[0] ?? null;
  const attacker = eventType === "player_hit" ? players[1] ?? null : null;
  const hp = extractHp(timestamp.body);
  const hitDetails = parseHitDetails(timestamp.body);

  if (eventType === "player_hit_explosion") {
    const explosionMatch = /\bhit by explosion\s*\(([^)]+)\)/i.exec(timestamp.body);
    return createBaseEvent(rawLine, timestamp, {
      eventType,
      playerName: victim?.name ?? null,
      playerId: victim?.id ?? null,
      victimName: victim?.name ?? null,
      victimId: victim?.id ?? null,
      position: victim?.position ?? null,
      victimPosition: victim?.position ?? null,
      hp,
      victimHp: hp,
      explosionType: explosionMatch?.[1]?.trim() ?? null,
      isDead: victim?.isDead ?? false,
      victimDead: (victim?.isDead ?? false) || hp === 0,
    });
  }

  if (eventType === "player_hit_unknown_attacker") {
    const weaponMatch = /\bhit by\s+(.+?)\s+into\b/i.exec(timestamp.body);
    return createBaseEvent(rawLine, timestamp, {
      eventType,
      playerName: victim?.name ?? null,
      playerId: victim?.id ?? null,
      victimName: victim?.name ?? null,
      victimId: victim?.id ?? null,
      position: victim?.position ?? null,
      victimPosition: victim?.position ?? null,
      hp,
      victimHp: hp,
      weapon: normaliseWeaponName(weaponMatch?.[1] ?? hitDetails.weapon),
      ammo: hitDetails.ammo,
      damage: hitDetails.damage,
      hitZone: hitDetails.hitZone,
      hitZoneIndex: hitDetails.hitZoneIndex,
      isDead: victim?.isDead ?? false,
      victimDead: (victim?.isDead ?? false) || hp === 0,
    });
  }

  return createBaseEvent(rawLine, timestamp, {
    eventType,
    playerName: victim?.name ?? null,
    playerId: victim?.id ?? null,
    victimName: victim?.name ?? null,
    victimId: victim?.id ?? null,
    attackerName: attacker?.name ?? null,
    attackerId: attacker?.id ?? null,
    position: victim?.position ?? null,
    victimPosition: victim?.position ?? null,
    attackerPosition: attacker?.position ?? null,
    hp,
    victimHp: hp,
    weapon: hitDetails.weapon,
    ammo: hitDetails.ammo,
    damage: hitDetails.damage,
    hitZone: hitDetails.hitZone,
    hitZoneIndex: hitDetails.hitZoneIndex,
    distance: hitDetails.distance,
    isDead: victim?.isDead ?? false,
    victimDead: (victim?.isDead ?? false) || hp === 0,
    isPvpKill: false,
    isCreditedKill: false,
  });
}

export function parseKillLine(line: string, rawLine = line, timestamp = parseTimestamp(line)): ParsedAdmEvent {
  const players = extractPlayerBlocks(timestamp.body);
  const victim = players[0] ?? null;
  const killer = players[1] ?? null;
  const weaponDistance = /\bwith\s+(.+?)\s+from\s+(-?(?:\d+(?:\.\d+)?|\.\d+))\s+meters?\b/i.exec(timestamp.body);

  if ((victim?.isDead || killer?.isDead) && !deadStateKillParserLogged) {
    deadStateKillParserLogged = true;
    console.log("DZN ADM KILL PARSER DEAD STATE FIXED");
  }

  return createBaseEvent(rawLine, timestamp, {
    eventType: "player_killed",
    playerName: killer?.name ?? null,
    playerId: killer?.id ?? null,
    victimName: victim?.name ?? null,
    victimId: victim?.id ?? null,
    killerName: killer?.name ?? null,
    killerId: killer?.id ?? null,
    position: killer?.position ?? null,
    victimPosition: victim?.position ?? null,
    killerPosition: killer?.position ?? null,
    weapon: normaliseWeaponName(weaponDistance?.[1]),
    distance: numberOrNull(weaponDistance?.[2]),
    isDead: victim?.isDead ?? false,
    victimDead: true,
    isPvpKill: true,
    isCreditedKill: true,
  });
}

export function parseDeathCauseLine(line: string, rawLine = line, timestamp = parseTimestamp(line)): ParsedAdmEvent {
  const victim = extractPlayerBlocks(timestamp.body)[0] ?? null;
  const causeMatch = /\bkilled by\s+(.+)$/i.exec(timestamp.body);

  return createBaseEvent(rawLine, timestamp, {
    eventType: "player_killed_environment",
    playerName: victim?.name ?? null,
    playerId: victim?.id ?? null,
    victimName: victim?.name ?? null,
    victimId: victim?.id ?? null,
    position: victim?.position ?? null,
    victimPosition: victim?.position ?? null,
    cause: causeMatch?.[1]?.trim() ?? null,
    isDead: victim?.isDead ?? false,
    victimDead: true,
    isPvpKill: false,
    isCreditedKill: false,
  });
}

function parseAdminLogStarted(line: string, rawLine: string) {
  const timestamp = parseTimestamp(line);
  const started = /AdminLog started on\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{2}:\d{2}:\d{2})/i.exec(line);
  return createBaseEvent(rawLine, timestamp, {
    eventType: "admin_log_started",
    admDate: started?.[1] ?? timestamp.admDate,
    admStartTime: started?.[2] ?? timestamp.time,
  });
}

function parsePlayerListSnapshot(line: string, rawLine: string, timestamp: TimestampResult) {
  const match = /PlayerList log:\s*(\d+)\s+players?/i.exec(line);
  return createBaseEvent(rawLine, timestamp, {
    eventType: "playerlist_snapshot",
    playerCount: numberOrNull(match?.[1]),
  });
}

function parseSinglePlayerEvent(
  line: string,
  rawLine: string,
  timestamp: TimestampResult,
  eventType: AdmEventType,
): ParsedAdmEvent {
  const player = extractPlayerBlocks(timestamp.body)[0] ?? null;
  const base = createBaseEvent(rawLine, timestamp, {
    eventType,
    playerName: player?.name ?? null,
    playerId: player?.id ?? null,
    position: player?.position ?? null,
    isDead: player?.isDead ?? false,
  });

  if (eventType === "player_suicide") {
    return {
      ...base,
      victimName: player?.name ?? null,
      victimId: player?.id ?? null,
      victimPosition: player?.position ?? null,
      victimDead: true,
    };
  }

  if (eventType === "player_died_stats") {
    const water = /Water:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/i.exec(line);
    const energy = /Energy:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/i.exec(line);
    const bleed = /Bleed sources:\s*(\d+)/i.exec(line);
    return {
      ...base,
      victimName: player?.name ?? null,
      victimId: player?.id ?? null,
      victimPosition: player?.position ?? null,
      victimDead: player?.isDead ?? false,
      water: numberOrNull(water?.[1]),
      energy: numberOrNull(energy?.[1]),
      bleedSources: numberOrNull(bleed?.[1]),
    };
  }

  if (eventType === "player_performed_action") {
    const action = /\bperformed\s+([^\s]+)(?:\s+with\s+(.+))?$/i.exec(timestamp.body);
    return {
      ...base,
      action: action?.[1]?.trim() ?? null,
      itemOrWeapon: normaliseWeaponName(action?.[2]),
    };
  }

  if (eventType === "player_built_structure" || eventType === "player_dismantled_structure") {
    const built = /\b(?:Built|Dismantled)\s+(.+?)\s+on\s+(.+?)(?:\s+with\s+(.+))?$/i.exec(timestamp.body);
    return {
      ...base,
      buildPart: built?.[1]?.trim() ?? null,
      targetObject: built?.[2]?.trim() ?? null,
      tool: normaliseWeaponName(built?.[3]) ?? null,
      objectType: built?.[2]?.trim() ?? null,
    };
  }

  if (eventType === "player_placed_object") {
    const placed = /\bplaced\s+(.+?)(?:<([^<>]+)>)?\s*$/i.exec(timestamp.body);
    const placedObject = placed?.[1]?.trim() ?? null;
    const placedClass = placed?.[2]?.trim() ?? null;
    return {
      ...base,
      objectType: placedClass ?? placedObject,
      placedObject,
      placedClass,
    };
  }

  if (eventType === "player_choosing_respawn") {
    return {
      ...base,
      victimName: player?.name ?? null,
      victimId: player?.id ?? null,
      victimPosition: player?.position ?? null,
      victimDead: player?.isDead ?? false,
    };
  }

  return base;
}

function extractPlayerBlocks(line: string): AdmPlayerBlock[] {
  const matches = [...line.matchAll(/Player\s+"([^"]+)"/gi)];
  return matches
    .map((match, index) => {
      const next = matches[index + 1];
      const segment = line.slice(match.index ?? 0, next?.index ?? line.length);
      return parsePlayerBlock(segment);
    })
    .filter((player): player is AdmPlayerBlock => Boolean(player));
}

function parseHitDetails(line: string) {
  const details = /\binto\s+([^(]+)\((\d+)\)\s+for\s+(-?(?:\d+(?:\.\d+)?|\.\d+))\s+damage\s+\(([^)]+)\)(?:\s+with\s+(.+?)\s+from\s+(-?(?:\d+(?:\.\d+)?|\.\d+))\s+meters?)?/i.exec(line);
  return {
    hitZone: details?.[1]?.trim() ?? null,
    hitZoneIndex: numberOrNull(details?.[2]),
    damage: numberOrNull(details?.[3]),
    ammo: details?.[4]?.trim() ?? null,
    weapon: normaliseWeaponName(details?.[5]),
    distance: numberOrNull(details?.[6]),
  };
}

function extractHp(line: string) {
  const match = /\[HP:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\]/i.exec(line);
  return numberOrNull(match?.[1]);
}

function createBaseEvent(
  rawLine: string,
  timestamp: TimestampResult,
  overrides: Partial<ParsedAdmEvent> & { eventType: AdmEventType },
): ParsedAdmEvent {
  return {
    eventType: overrides.eventType,
    admDate: overrides.admDate ?? timestamp.admDate,
    admStartTime: overrides.admStartTime ?? null,
    occurredAt: overrides.occurredAt ?? timestamp.occurredAt,
    playerName: overrides.playerName ?? null,
    playerId: overrides.playerId ?? null,
    victimName: overrides.victimName ?? null,
    victimId: overrides.victimId ?? null,
    killerName: overrides.killerName ?? null,
    killerId: overrides.killerId ?? null,
    attackerName: overrides.attackerName ?? null,
    attackerId: overrides.attackerId ?? null,
    weapon: overrides.weapon ?? null,
    ammo: overrides.ammo ?? null,
    cause: overrides.cause ?? null,
    distance: overrides.distance ?? null,
    damage: overrides.damage ?? null,
    hitZone: overrides.hitZone ?? null,
    hitZoneIndex: overrides.hitZoneIndex ?? null,
    position: overrides.position ?? null,
    victimPosition: overrides.victimPosition ?? null,
    killerPosition: overrides.killerPosition ?? null,
    attackerPosition: overrides.attackerPosition ?? null,
    water: overrides.water ?? null,
    energy: overrides.energy ?? null,
    bleedSources: overrides.bleedSources ?? null,
    action: overrides.action ?? null,
    itemOrWeapon: overrides.itemOrWeapon ?? null,
    objectType: overrides.objectType ?? null,
    buildPart: overrides.buildPart ?? null,
    targetObject: overrides.targetObject ?? null,
    tool: overrides.tool ?? null,
    placedObject: overrides.placedObject ?? null,
    placedClass: overrides.placedClass ?? null,
    isDead: overrides.isDead ?? false,
    victimDead: overrides.victimDead ?? false,
    isPvpKill: overrides.isPvpKill ?? false,
    isCreditedKill: overrides.isCreditedKill ?? false,
    playerCount: overrides.playerCount ?? null,
    hp: overrides.hp ?? null,
    victimHp: overrides.victimHp ?? null,
    explosionType: overrides.explosionType ?? null,
    rawLine,
  };
}

function resolveTimestampDate(admDate: string | undefined, time: string, previousTime: string | undefined) {
  if (!admDate) return null;
  if (!previousTime || time >= previousTime) return admDate;

  const date = new Date(`${admDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return admDate;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function toIsoTimestamp(date: string, time: string) {
  const parsed = new Date(`${date}T${time}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function numberOrNull(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
