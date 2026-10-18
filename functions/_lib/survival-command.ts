import {
  SURVIVAL_COMMAND_INCIDENTS,
  SURVIVAL_COMMAND_SECTORS,
  SURVIVAL_COMMAND_SECTOR_KEYS,
  deploymentCapacity,
  incidentForSeed,
  isSurvivalCommandApproach,
  isSurvivalCommandSector,
  resolveSurvivalCommandOutcome,
  sectorLockReason,
  validIncidentAction,
  type SurvivalCommandBuildingLevels,
  type SurvivalCommandExpedition,
  type SurvivalCommandHistory,
  type SurvivalCommandPayload,
  type SurvivalCommandSector,
} from "../../lib/survival-command";
import { getSessionUser, requireDb } from "./db";
import { json, methodNotAllowed, readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const SURVIVAL_COMMAND_TABLES = [
  "dzn_command_centre_profiles",
  "dzn_command_centre_buildings",
  "dzn_survival_command_profiles",
  "dzn_survival_command_expeditions",
  "dzn_survival_command_resolution_ledger",
] as const;

type ProfileRow = { established_at: number };
type BuildingRow = { building: keyof SurvivalCommandBuildingLevels; level: number };
type ExpeditionRow = {
  id: string;
  user_id: string;
  request_id: string;
  sector: SurvivalCommandSector;
  approach: "scout" | "balanced" | "breach";
  status: "deployed" | "resolved";
  seed: string;
  deployment_day: string;
  deployment_cost: number;
  started_at: number;
  ready_at: number;
  resolved_at: number | null;
  version: number;
};
type HistoryRow = {
  id: string;
  sector: SurvivalCommandSector;
  approach: "scout" | "balanced" | "breach";
  outcome: SurvivalCommandHistory["outcome"];
  action: string;
  salvage: number;
  intel: number;
  resolved_at: number;
};
type ResourcesRow = { salvage: number; intel: number; resolved: number };
type MutationResult = { meta?: { changes?: number } };

function changes(result: unknown) {
  return (result as MutationResult | null)?.meta?.changes ?? 0;
}

function dayKey(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

async function schemaIsReady(db: D1Database) {
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN (${SURVIVAL_COMMAND_TABLES.map(() => "?").join(", ")})`).bind(...SURVIVAL_COMMAND_TABLES).all<{ name: string }>();
  const names = new Set((rows.results ?? []).map(row => row.name));
  return SURVIVAL_COMMAND_TABLES.every(table => names.has(table));
}

async function readBuildingLevels(db: D1Database, userId: string): Promise<SurvivalCommandBuildingLevels | null> {
  const rows = await db.prepare(`SELECT building, level FROM dzn_command_centre_buildings WHERE user_id = ?
    AND building IN ('headquarters', 'workshop', 'watchtower', 'communications')`).bind(userId).all<BuildingRow>();
  const byBuilding = new Map((rows.results ?? []).map(row => [row.building, row.level]));
  if (byBuilding.size !== 4) return null;
  return {
    headquarters: byBuilding.get("headquarters") ?? 0,
    workshop: byBuilding.get("workshop") ?? 0,
    watchtower: byBuilding.get("watchtower") ?? 0,
    communications: byBuilding.get("communications") ?? 0,
  };
}

function visibleExpedition(row: ExpeditionRow, now: number): SurvivalCommandExpedition {
  const ready = now >= row.ready_at;
  const incidentKey = ready ? incidentForSeed(row.seed) : null;
  const incident = incidentKey ? SURVIVAL_COMMAND_INCIDENTS[incidentKey] : null;
  return {
    id: row.id,
    sector: row.sector,
    approach: row.approach,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    version: row.version,
    state: ready ? "ready" : "in-transit",
    incident: incident ? { key: incidentKey!, title: incident.title, detail: incident.detail, actions: incident.actions } : null,
  };
}

async function readPayload(db: D1Database, user: SessionUser, now: number): Promise<SurvivalCommandPayload> {
  const [profile, buildings, resources, used, active, history] = await Promise.all([
    db.prepare("SELECT established_at FROM dzn_survival_command_profiles WHERE user_id = ?").bind(user.id).first<ProfileRow>(),
    readBuildingLevels(db, user.id),
    db.prepare(`SELECT COALESCE(SUM(salvage), 0) AS salvage, COALESCE(SUM(intel), 0) AS intel,
      COUNT(*) AS resolved FROM dzn_survival_command_resolution_ledger WHERE user_id = ?`).bind(user.id).first<ResourcesRow>(),
    db.prepare("SELECT COALESCE(SUM(deployment_cost), 0) AS count FROM dzn_survival_command_expeditions WHERE user_id = ? AND deployment_day = ?")
      .bind(user.id, dayKey(now)).first<{ count: number }>(),
    db.prepare(`SELECT id, user_id, request_id, sector, approach, status, seed, deployment_day, deployment_cost, started_at, ready_at, resolved_at, version
      FROM dzn_survival_command_expeditions WHERE user_id = ? AND status = 'deployed' ORDER BY started_at DESC LIMIT 1`).bind(user.id).first<ExpeditionRow>(),
    db.prepare(`SELECT expedition.id, expedition.sector, expedition.approach, ledger.outcome, ledger.action, ledger.salvage, ledger.intel, ledger.resolved_at
      FROM dzn_survival_command_expeditions AS expedition
      JOIN dzn_survival_command_resolution_ledger AS ledger ON ledger.expedition_id = expedition.id
      WHERE expedition.user_id = ? ORDER BY ledger.resolved_at DESC, ledger.id DESC LIMIT 5`).bind(user.id).all<HistoryRow>(),
  ]);
  const sectors = SURVIVAL_COMMAND_SECTOR_KEYS.map(key => {
    const sector = SURVIVAL_COMMAND_SECTORS[key];
    const lockReason = sectorLockReason(key, buildings);
    return {
      key,
      name: sector.name,
      coordinate: sector.coordinate,
      briefing: sector.briefing,
      deploymentCost: sector.deploymentCost,
      durationMs: sector.durationMs,
      reward: { salvage: sector.reward.salvage, intel: sector.reward.intel },
      unlocked: !lockReason,
      lockReason,
    };
  });
  return {
    serverTime: now,
    profile: profile ? { establishedAt: profile.established_at } : null,
    resources: { salvage: resources?.salvage ?? 0, intel: resources?.intel ?? 0, resolvedExpeditions: resources?.resolved ?? 0 },
    deployment: { used: used?.count ?? 0, capacity: deploymentCapacity(buildings), dayKey: dayKey(now) },
    buildings,
    sectors,
    expedition: active ? visibleExpedition(active, now) : null,
    history: (history.results ?? []).map(row => ({
      id: row.id,
      sector: row.sector,
      approach: row.approach,
      outcome: row.outcome,
      action: row.action,
      salvage: row.salvage,
      intel: row.intel,
      resolvedAt: row.resolved_at,
    })),
  };
}

async function establish(db: D1Database, userId: string, now: number) {
  const commandCentre = await db.prepare("SELECT user_id FROM dzn_command_centre_profiles WHERE user_id = ?").bind(userId).first();
  if (!commandCentre) return { error: "Establish your Command Centre before opening sector operations.", status: 409 } as const;
  await db.prepare(`INSERT INTO dzn_survival_command_profiles (user_id, established_at, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING`).bind(userId, now, now).run();
  return { error: null, status: 200 } as const;
}

async function deploy(db: D1Database, user: SessionUser, body: Record<string, unknown>, now: number) {
  if (!isSurvivalCommandSector(body.sector) || !isSurvivalCommandApproach(body.approach) || !isRequestId(body.requestId)) {
    return { error: "Choose a sector, field route and valid deployment request before dispatching.", status: 400 } as const;
  }
  const [profile, buildings] = await Promise.all([
    db.prepare("SELECT user_id FROM dzn_survival_command_profiles WHERE user_id = ?").bind(user.id).first(),
    readBuildingLevels(db, user.id),
  ]);
  if (!profile || !buildings) return { error: "Establish the Command Centre and Sector Operations before dispatching a team.", status: 409 } as const;
  const lockReason = sectorLockReason(body.sector, buildings);
  if (lockReason) return { error: lockReason, status: 409 } as const;
  const existing = await db.prepare("SELECT id, status FROM dzn_survival_command_expeditions WHERE user_id = ? AND request_id = ?")
    .bind(user.id, body.requestId).first<{ id: string; status: ExpeditionRow["status"] }>();
  if (existing?.status === "deployed") return { error: null, status: 200 } as const;
  if (existing) return { error: "That deployment request is already closed. Create a new field order.", status: 409 } as const;
  const sector = SURVIVAL_COMMAND_SECTORS[body.sector];
  const id = crypto.randomUUID();
  const seed = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const currentDay = dayKey(now);
  const result = await db.prepare(`INSERT OR IGNORE INTO dzn_survival_command_expeditions
    (id, user_id, request_id, sector, approach, status, seed, deployment_day, deployment_cost, started_at, ready_at, version)
    SELECT ?, ?, ?, ?, ?, 'deployed', ?, ?, ?, ?, ?, 0
    WHERE EXISTS (SELECT 1 FROM dzn_survival_command_profiles WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM dzn_survival_command_expeditions WHERE user_id = ? AND status = 'deployed')
      AND (SELECT COALESCE(SUM(deployment_cost), 0) FROM dzn_survival_command_expeditions WHERE user_id = ? AND deployment_day = ?) + ? <= ?`)
    .bind(id, user.id, body.requestId, body.sector, body.approach, seed, currentDay, sector.deploymentCost, now, now + sector.durationMs,
      user.id, user.id, user.id, currentDay, sector.deploymentCost, deploymentCapacity(buildings)).run();
  if (changes(result)) return { error: null, status: 200 } as const;
  const active = await db.prepare("SELECT id FROM dzn_survival_command_expeditions WHERE user_id = ? AND status = 'deployed'").bind(user.id).first();
  if (active) return { error: "Resolve the active sector operation before sending another field team.", status: 409 } as const;
  return { error: "Daily deployment capacity has been reached. Improve the Comms Array to increase field coordination.", status: 409 } as const;
}

async function resolve(db: D1Database, user: SessionUser, body: Record<string, unknown>, now: number) {
  if (typeof body.expeditionId !== "string" || !isRequestId(body.requestId) || !Number.isInteger(body.version)) {
    return { error: "Use the current sector dossier before resolving this operation.", status: 400 } as const;
  }
  const row = await db.prepare(`SELECT id, user_id, request_id, sector, approach, status, seed, deployment_day, deployment_cost, started_at, ready_at, resolved_at, version
    FROM dzn_survival_command_expeditions WHERE id = ? AND user_id = ?`).bind(body.expeditionId, user.id).first<ExpeditionRow>();
  if (!row) return { error: "That sector operation is no longer available to this account.", status: 404 } as const;
  const existing = await db.prepare("SELECT id, expedition_id FROM dzn_survival_command_resolution_ledger WHERE user_id = ? AND request_id = ?")
    .bind(user.id, body.requestId).first<{ id: string; expedition_id: string }>();
  if (existing?.expedition_id === row.id) return { error: null, status: 200 } as const;
  if (existing) return { error: "That field decision request is already attached to another operation.", status: 409 } as const;
  if (row.status !== "deployed" || row.version !== body.version || row.ready_at > now) {
    return { error: "This operation is not ready or has changed. Refresh the sector board before continuing.", status: 409 } as const;
  }
  const incident = incidentForSeed(row.seed);
  if (!validIncidentAction(incident, body.decision)) return { error: "Choose one of the available field decisions.", status: 400 } as const;
  const buildings = await readBuildingLevels(db, user.id);
  if (!buildings) return { error: "Command Centre records are unavailable. The expedition has not been changed.", status: 409 } as const;
  const outcome = resolveSurvivalCommandOutcome({ seed: row.seed, sector: row.sector, approach: row.approach, action: body.decision, buildings });
  const ledgerId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO dzn_survival_command_resolution_ledger
      (id, user_id, expedition_id, request_id, action, outcome, salvage, intel, outcome_fingerprint, resolved_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM dzn_survival_command_expeditions
        WHERE id = ? AND user_id = ? AND status = 'deployed' AND version = ? AND ready_at <= ?)`)
      .bind(ledgerId, user.id, row.id, body.requestId, body.decision, outcome.outcome, outcome.salvage, outcome.intel, outcome.fingerprint, now,
        row.id, user.id, row.version, now),
    db.prepare(`UPDATE dzn_survival_command_expeditions SET status = 'resolved', resolved_at = ?, version = version + 1
      WHERE id = ? AND user_id = ? AND status = 'deployed' AND version = ? AND ready_at <= ?
        AND EXISTS (SELECT 1 FROM dzn_survival_command_resolution_ledger WHERE id = ? AND expedition_id = ? AND user_id = ?)`)
      .bind(now, row.id, user.id, row.version, now, ledgerId, row.id, user.id),
  ]);
  if (!changes(results[1])) return { error: "This operation changed before the decision was recorded. Refresh the sector board.", status: 409 } as const;
  return { error: null, status: 200 } as const;
}

export async function handleSurvivalCommand(request: Request, env: Env): Promise<Response> {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "This request must come from DZN Network." }, 403);
  }
  try {
    const user = await getSessionUser(env, request);
    if (!user) return reply({ error: "Sign in with Discord to access Survival Command." }, 401);
    if (env.DZN_SURVIVAL_COMMAND_ENABLED !== "true" || env.DZN_COMMAND_CENTRE_ENABLED !== "true") {
      return reply({ error: "Survival Command is not open on this environment yet." }, 503);
    }
    const db = requireDb(env);
    if (!(await schemaIsReady(db))) return reply({ error: "Survival Command is preparing secure expedition storage. Try again shortly." }, 503);
    const now = Date.now();
    if (request.method === "GET") return reply(await readPayload(db, user, now));
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 2048);
    if (!parsed.ok) return reply({ error: "Invalid Survival Command request." }, parsed.status);
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid Survival Command request." }, 400);
    const result = body.action === "initialize" ? await establish(db, user.id, now)
      : body.action === "deploy" ? await deploy(db, user, body, now)
        : body.action === "resolve" ? await resolve(db, user, body, now)
          : { error: "Unknown Survival Command action.", status: 400 };
    if (result.error) return reply({ error: result.error }, result.status);
    return reply(await readPayload(db, user, now));
  } catch {
    return reply({ error: "Survival Command is temporarily unavailable. Stored expedition progress has not been reset." }, 503);
  }
}
