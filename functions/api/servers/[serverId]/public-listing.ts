import { ensureLinkedServerMetadataColumns, ensureMockUser, getSessionUser, requireDb } from "../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { validatePublicListingInput, type PublicListingInput } from "../../../_lib/review-moderation";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "PATCH") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const body = await readJson<PublicListingInput>(request);
  const listing = validatePublicListingInput(body);
  if (!listing.ok) return json({ error: listing.error }, { status: 400 });

  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  const server = await db
    .prepare(
      `SELECT id, user_id
       FROM linked_servers
       WHERE id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ id: string; user_id: string }>();

  if (!server) return json({ error: "Linked server not found" }, { status: 404 });
  if (server.user_id !== user.id) return json({ error: "Only the server owner can update this listing." }, { status: 403 });

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE linked_servers SET
        public_short_description = ?,
        public_description = ?,
        public_discord_invite = ?,
        public_website_url = ?,
        public_rules = ?,
        public_language = ?,
        public_region_label = ?,
        public_listing_updated_at = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      listing.value.public_short_description,
      listing.value.public_description,
      listing.value.public_discord_invite,
      listing.value.public_website_url,
      listing.value.public_rules,
      listing.value.public_language,
      listing.value.public_region_label,
      now,
      linkedServerId,
    )
    .run();

  console.log("DZN SERVER PUBLIC LISTING READY");
  return json({ ok: true, listing: { ...listing.value, public_listing_updated_at: now } });
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}
