import { requireDb } from "./db";
import { listAuthorizedEventCreationHosts, type AuthorizedEventCreationHost } from "./event-hosts";
import { isPlatformCreatorEventAdmin, isPlatformCreatorEventGovernanceConfigured } from "./platform-creator";
import type { Env, SessionUser } from "./types";

export type OwnerEventControlPayload = {
  ok: true;
  creatorEventGovernanceConfigured: boolean;
  creatorEventAdmin: boolean;
  events: OwnerOfficialEventSummary[];
  linkedServers: OwnerEventLinkedServer[];
  hostInventoryAvailable: boolean;
  hostInventoryCount: number;
  warnings: string[];
  generatedAt: string;
};

export type OwnerOfficialEventSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  visibility: string | null;
  category: string | null;
  eventType: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  registeredServers: number;
};

export type OwnerEventLinkedServer = {
  id: string;
  label: string;
  category: string | null;
  status: string | null;
};

export type OwnerEventDraftReviewPayload =
  | {
      ok: true;
      event: OwnerEventDraftReview;
      generatedAt: string;
    }
  | {
      ok: false;
      status: 404 | 503;
      error: string;
      message: string;
    };

export type OwnerEventDraftReview = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  visibility: string;
  category: string | null;
  eventType: string | null;
  startsAt: string | null;
  endsAt: string | null;
  rules: string | null;
  rewards: string | null;
  registeredServers: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type OwnerEventRow = {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  visibility: string | null;
  category: string | null;
  event_type: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  registered_servers: number | null;
};

type OwnerEventDraftRow = OwnerEventRow & {
  description: string | null;
  rules: string | null;
  rewards: string | null;
};

export async function getOwnerEventControlPayload(env: Env, user: SessionUser): Promise<OwnerEventControlPayload> {
  const creatorEventAdmin = isPlatformCreatorEventAdmin(user, env);
  const warnings: string[] = [];
  const events = await readOfficialEvents(env).catch((error) => {
    warnings.push(error instanceof Error ? "official_event_inventory_unavailable" : "official_event_inventory_unknown");
    return [] as OwnerOfficialEventSummary[];
  });
  let linkedServers: OwnerEventLinkedServer[] = [];
  let hostInventoryAvailable = !creatorEventAdmin ? false : true;
  if (creatorEventAdmin) {
    try {
      linkedServers = await readCreatorLinkedServers(env, user);
    } catch {
      hostInventoryAvailable = false;
      warnings.push("event_host_inventory_unavailable");
    }
  }

  return {
    ok: true,
    creatorEventGovernanceConfigured: isPlatformCreatorEventGovernanceConfigured(env),
    creatorEventAdmin,
    events,
    linkedServers,
    hostInventoryAvailable,
    hostInventoryCount: linkedServers.length,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

async function readOfficialEvents(env: Env): Promise<OwnerOfficialEventSummary[]> {
  if (!env.DB) return [];
  const result = await env.DB
    .prepare(
      `SELECT competitive_events.id,
              competitive_events.name,
              competitive_events.slug,
              competitive_events.status,
              competitive_events.visibility,
              competitive_events.category,
              competitive_events.event_type,
              competitive_events.starts_at,
              competitive_events.ends_at,
              competitive_events.created_at,
              competitive_events.updated_at,
              (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers
       FROM competitive_events
       ORDER BY datetime(COALESCE(competitive_events.updated_at, competitive_events.created_at)) DESC
       LIMIT 100`,
    )
    .all<OwnerEventRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status ?? "unknown",
    visibility: row.visibility,
    category: row.category,
    eventType: row.event_type,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    registeredServers: Number(row.registered_servers ?? 0),
  }));
}

async function readCreatorLinkedServers(env: Env, user: SessionUser): Promise<OwnerEventLinkedServer[]> {
  const servers = await listAuthorizedEventCreationHosts(env, user);
  return servers.map((server: AuthorizedEventCreationHost) => ({
    id: String(server.id ?? ""),
    label: String(server.display_name ?? server.server_name ?? server.hostname ?? server.nitrado_service_name ?? server.id ?? "Linked server"),
    category: typeof server.server_category === "string" ? server.server_category : null,
    status: typeof server.status === "string" ? server.status : null,
  })).filter((server) => server.id.length > 0);
}

export async function getOwnerEventDraftReviewPayload(env: Env, slugValue: unknown): Promise<OwnerEventDraftReviewPayload> {
  if (!env.DB) {
    return { ok: false, status: 503, error: "D1_UNAVAILABLE", message: "Event storage is unavailable." };
  }
  const slug = sanitizeEventSlug(slugValue);
  if (!slug) {
    return { ok: false, status: 404, error: "EVENT_NOT_FOUND", message: "Event not found." };
  }
  const row = await requireDb(env)
    .prepare(
      `SELECT competitive_events.id,
              competitive_events.name,
              competitive_events.slug,
              competitive_events.description,
              competitive_events.status,
              competitive_events.visibility,
              competitive_events.category,
              competitive_events.event_type,
              competitive_events.starts_at,
              competitive_events.ends_at,
              competitive_events.rules,
              competitive_events.rewards,
              competitive_events.created_at,
              competitive_events.updated_at,
              (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers
       FROM competitive_events
       WHERE competitive_events.slug = ?
       LIMIT 1`,
    )
    .bind(slug)
    .first<OwnerEventDraftRow>();
  if (!row) {
    return { ok: false, status: 404, error: "EVENT_NOT_FOUND", message: "Event not found." };
  }
  return {
    ok: true,
    event: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      status: row.status ?? "unknown",
      visibility: row.visibility ?? "public",
      category: row.category,
      eventType: row.event_type,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      rules: row.rules,
      rewards: row.rewards,
      registeredServers: Number(row.registered_servers ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    generatedAt: new Date().toISOString(),
  };
}

function sanitizeEventSlug(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
