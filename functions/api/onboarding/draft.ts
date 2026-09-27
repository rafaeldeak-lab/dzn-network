import { getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { normalizeTags, validateServerType } from "../../_lib/onboarding";
import { validatePublicListingInput, type PublicListingInput } from "../../_lib/review-moderation";
import { normalizeServerCategory } from "../../_lib/server-categories";
import type { Env, PagesFunction } from "../../_lib/types";

type DraftBody = PublicListingInput & {
  currentStep?: unknown;
  discordGuildId?: unknown;
  serverType?: unknown;
  server_category?: unknown;
  tags?: unknown;
  linkedServerId?: unknown;
  nitradoServiceId?: unknown;
  directServiceValidated?: unknown;
};

type DraftRow = {
  current_step: number;
  completion_percent: number;
  discord_guild_id: string | null;
  server_type: string | null;
  server_category: string | null;
  tags_json: string | null;
  public_short_description: string | null;
  public_description: string | null;
  public_discord_invite: string | null;
  public_website_url: string | null;
  public_rules: string | null;
  public_language: string | null;
  public_region_label: string | null;
  linked_server_id: string | null;
  nitrado_service_id: string | null;
  direct_service_validated: number;
  updated_at: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  if (!await hasDraftSchema(env)) {
    return request.method === "GET"
      ? json({ ok: true, available: false, draft: null }, { headers: privateHeaders() })
      : json({ error: "Setup draft saving is not available yet." }, { status: 503, headers: privateHeaders() });
  }

  if (request.method === "GET") {
    const row = await requireDb(env).prepare(
      `SELECT current_step, completion_percent, discord_guild_id, server_type, server_category, tags_json,
              public_short_description, public_description, public_discord_invite, public_website_url,
              public_rules, public_language, public_region_label, linked_server_id, nitrado_service_id,
              direct_service_validated, updated_at
       FROM onboarding_drafts
       WHERE user_id = ?
       LIMIT 1`,
    ).bind(user.id).first<DraftRow>();
    return json({ ok: true, available: true, draft: row ? serializeDraft(row) : null }, { headers: privateHeaders() });
  }

  if (request.method === "DELETE") {
    await requireDb(env).prepare("DELETE FROM onboarding_drafts WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true, cleared: true }, { headers: privateHeaders() });
  }

  if (request.method !== "PUT") return methodNotAllowed();
  const body = await readJson<DraftBody>(request);
  const currentStep = normalizeStep(body.currentStep);
  const discordGuildId = optionalIdentifier(body.discordGuildId, 32);
  const linkedServerId = optionalIdentifier(body.linkedServerId, 80);
  const nitradoServiceId = optionalIdentifier(body.nitradoServiceId, 80);
  const serverType = typeof body.serverType === "string" && validateServerType(body.serverType) ? body.serverType : null;
  const serverCategory = typeof body.server_category === "string" && body.server_category.trim()
    ? normalizeServerCategory(body.server_category)
    : null;
  const listing = validatePublicListingInput(body);
  if (!listing.ok) return json({ error: listing.error }, { status: 400, headers: privateHeaders() });
  if (body.server_category && !serverCategory) {
    return json({ error: "Invalid server category" }, { status: 400, headers: privateHeaders() });
  }

  const db = requireDb(env);
  if (discordGuildId) {
    const ownedGuild = await db.prepare(
      "SELECT 1 AS owned FROM discord_guilds WHERE guild_id = ? AND owner_user_id = ? LIMIT 1",
    ).bind(discordGuildId, user.id).first<{ owned: number }>();
    if (!ownedGuild) return json({ error: "Discord server is not available to this account." }, { status: 403, headers: privateHeaders() });
  }
  if (linkedServerId) {
    const ownedServer = await db.prepare(
      "SELECT 1 AS owned FROM linked_servers WHERE id = ? AND user_id = ? LIMIT 1",
    ).bind(linkedServerId, user.id).first<{ owned: number }>();
    if (!ownedServer) return json({ error: "Linked server is not available to this account." }, { status: 403, headers: privateHeaders() });
  }

  const completionPercent = currentStep === 6 ? 86 : Math.round((currentStep / 7) * 100);
  await db.prepare(
    `INSERT INTO onboarding_drafts (
       user_id, current_step, completion_percent, discord_guild_id, server_type, server_category, tags_json,
       public_short_description, public_description, public_discord_invite, public_website_url,
       public_rules, public_language, public_region_label, linked_server_id, nitrado_service_id,
       direct_service_validated, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       current_step = excluded.current_step,
       completion_percent = excluded.completion_percent,
       discord_guild_id = excluded.discord_guild_id,
       server_type = excluded.server_type,
       server_category = excluded.server_category,
       tags_json = excluded.tags_json,
       public_short_description = excluded.public_short_description,
       public_description = excluded.public_description,
       public_discord_invite = excluded.public_discord_invite,
       public_website_url = excluded.public_website_url,
       public_rules = excluded.public_rules,
       public_language = excluded.public_language,
       public_region_label = excluded.public_region_label,
       linked_server_id = excluded.linked_server_id,
       nitrado_service_id = excluded.nitrado_service_id,
       direct_service_validated = excluded.direct_service_validated,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    user.id,
    currentStep,
    completionPercent,
    discordGuildId,
    serverType,
    serverCategory,
    JSON.stringify(normalizeTags(body.tags)),
    listing.value.public_short_description,
    listing.value.public_description,
    listing.value.public_discord_invite,
    listing.value.public_website_url,
    listing.value.public_rules,
    listing.value.public_language,
    listing.value.public_region_label,
    linkedServerId,
    nitradoServiceId,
    body.directServiceValidated === true ? 1 : 0,
  ).run();

  const saved = await db.prepare(
    `SELECT current_step, completion_percent, discord_guild_id, server_type, server_category, tags_json,
            public_short_description, public_description, public_discord_invite, public_website_url,
            public_rules, public_language, public_region_label, linked_server_id, nitrado_service_id,
            direct_service_validated, updated_at
     FROM onboarding_drafts WHERE user_id = ? LIMIT 1`,
  ).bind(user.id).first<DraftRow>();
  return json({ ok: true, available: true, draft: saved ? serializeDraft(saved) : null }, { headers: privateHeaders() });
};

async function hasDraftSchema(env: Env) {
  const row = await requireDb(env).prepare(
    "SELECT 1 AS ready FROM sqlite_master WHERE type = 'table' AND name = 'onboarding_drafts' LIMIT 1",
  ).first<{ ready: number }>();
  return row?.ready === 1;
}

function serializeDraft(row: DraftRow) {
  return {
    currentStep: normalizeStep(row.current_step),
    completionPercent: Math.max(0, Math.min(100, Number(row.completion_percent) || 0)),
    discordGuildId: row.discord_guild_id,
    serverType: row.server_type,
    serverCategory: row.server_category,
    tags: parseTags(row.tags_json),
    publicListing: {
      public_short_description: row.public_short_description ?? "",
      public_description: row.public_description ?? "",
      public_discord_invite: row.public_discord_invite ?? "",
      public_website_url: row.public_website_url ?? "",
      public_rules: row.public_rules ?? "",
      public_language: row.public_language ?? "",
      public_region_label: row.public_region_label ?? "",
    },
    linkedServerId: row.linked_server_id,
    nitradoServiceId: row.nitrado_service_id,
    directServiceValidated: row.direct_service_validated === 1,
    updatedAt: row.updated_at,
  };
}

function parseTags(value: string | null) {
  try {
    return normalizeTags(JSON.parse(value ?? "[]"));
  } catch {
    return [];
  }
}

function normalizeStep(value: unknown) {
  const step = Number(value);
  return Number.isInteger(step) ? Math.max(0, Math.min(6, step)) : 0;
}

function optionalIdentifier(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !/^[a-zA-Z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function privateHeaders() {
  return { "cache-control": "no-store, private", "x-content-type-options": "nosniff" };
}
