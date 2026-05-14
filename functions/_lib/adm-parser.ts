export type AdmPosition = {
  x: number | null;
  y: number | null;
  z: number | null;
};

export type ParsedAdmEvent = {
  eventType:
    | "admin_log_started"
    | "player_connecting"
    | "player_connected"
    | "player_disconnected"
    | "player_placed"
    | "player_killed"
    | "player_died"
    | "player_suicide"
    | "unknown";
  playerName: string | null;
  playerId: string | null;
  victimName: string | null;
  victimId: string | null;
  weapon: string | null;
  distance: number | null;
  position: AdmPosition | null;
  occurredAt: string | null;
  rawLine: string;
};

type AdmPlayerRef = {
  name: string;
  id: string | null;
  position: AdmPosition | null;
};

export function parseAdmLine(rawLine: string): ParsedAdmEvent {
  const line = rawLine.trim();
  const players = extractPlayers(line);
  const primary = players[0] ?? null;
  const occurredAt = extractOccurredAt(line);
  const fallbackPosition = extractPosition(line);

  const base = {
    playerName: primary?.name ?? null,
    playerId: primary?.id ?? null,
    victimName: null,
    victimId: null,
    weapon: null,
    distance: null,
    position: primary?.position ?? fallbackPosition,
    occurredAt,
    rawLine,
  };

  if (/AdminLog started/i.test(line)) {
    return { eventType: "admin_log_started", ...base };
  }

  if (/\bis connecting\b/i.test(line)) {
    return { eventType: "player_connecting", ...base };
  }

  if (/\bis connected\b/i.test(line)) {
    return { eventType: "player_connected", ...base };
  }

  if (/\b(has been disconnected|is disconnected|disconnected)\b/i.test(line)) {
    return { eventType: "player_disconnected", ...base };
  }

  if (/\bplaced\b/i.test(line)) {
    return { eventType: "player_placed", ...base };
  }

  const killedByMatch = /Player\s+"([^"]+)"[\s\S]*?\bkilled by\s+Player\s+"([^"]+)"/i.exec(line);
  if (killedByMatch) {
    const victim = players.find((player) => player.name === killedByMatch[1]) ?? players[0] ?? null;
    const killer = players.find((player) => player.name === killedByMatch[2]) ?? players[1] ?? null;
    return {
      eventType: "player_killed",
      playerName: killer?.name ?? null,
      playerId: killer?.id ?? null,
      victimName: victim?.name ?? null,
      victimId: victim?.id ?? null,
      weapon: extractWeapon(line),
      distance: extractDistance(line),
      position: killer?.position ?? victim?.position ?? fallbackPosition,
      occurredAt,
      rawLine,
    };
  }

  const killedMatch = /Player\s+"([^"]+)"[\s\S]*?\bkilled\s+Player\s+"([^"]+)"/i.exec(line);
  if (killedMatch) {
    const killer = players.find((player) => player.name === killedMatch[1]) ?? players[0] ?? null;
    const victim = players.find((player) => player.name === killedMatch[2]) ?? players[1] ?? null;
    return {
      eventType: "player_killed",
      playerName: killer?.name ?? null,
      playerId: killer?.id ?? null,
      victimName: victim?.name ?? null,
      victimId: victim?.id ?? null,
      weapon: extractWeapon(line),
      distance: extractDistance(line),
      position: killer?.position ?? victim?.position ?? fallbackPosition,
      occurredAt,
      rawLine,
    };
  }

  if (/\b(suicide|committed suicide)\b/i.test(line)) {
    return { eventType: "player_suicide", ...base, victimName: primary?.name ?? null, victimId: primary?.id ?? null };
  }

  if (/\b(died|is dead|has died)\b/i.test(line)) {
    return { eventType: "player_died", ...base, victimName: primary?.name ?? null, victimId: primary?.id ?? null };
  }

  return { eventType: "unknown", ...base };
}

function extractPlayers(line: string): AdmPlayerRef[] {
  const players: AdmPlayerRef[] = [];
  const playerPattern = /Player\s+"([^"]+)"\s*(?:\(([^)]*)\))?/gi;
  let match: RegExpExecArray | null;
  while ((match = playerPattern.exec(line))) {
    const meta = match[2] ?? "";
    players.push({
      name: match[1].trim(),
      id: extractId(meta),
      position: extractPosition(meta),
    });
  }
  return players;
}

function extractId(value: string) {
  const match = /\bid\s*=\s*([^,\s)]+)/i.exec(value);
  return match?.[1]?.trim() ?? null;
}

function extractPosition(value: string): AdmPosition | null {
  const match = /(?:pos(?:ition)?\s*=\s*)?<\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*>/i.exec(value);
  if (!match) return null;
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

function extractWeapon(line: string) {
  const match = /\bwith\s+(.+?)(?:\s+from\s+\d|\s+at\s+\d|$)/i.exec(line);
  return match?.[1]?.trim() ?? null;
}

function extractDistance(line: string) {
  const match = /\bfrom\s+(\d+(?:\.\d+)?)\s*(?:m|meter|meters)?\b/i.exec(line);
  return match ? Number(match[1]) : null;
}

function extractOccurredAt(line: string) {
  const isoMatch = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(line);
  if (!isoMatch) return null;
  const date = new Date(`${isoMatch[1]}T${isoMatch[2]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
