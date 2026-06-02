import { ensureMockUser, getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type LegacySettingsBody = {
  server_category?: unknown;
};

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in to manage this server." }, { status: 401 });
  const serverId = sanitizeLinkedServerId(params.serverId);
  if (!serverId) return json({ ok: false, error: "INVALID_SERVER_ID", message: "Invalid server id." }, { status: 400 });

  try {
    const { readOwnerServerSettings } = await import("../../../_lib/server-settings");
    const result = await readOwnerServerSettings(env, user, serverId);
    return json(result.payload, { status: result.status });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN server settings unavailable", { requestId, serverId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "SETTINGS_UNAVAILABLE",
      errorCode: "SETTINGS_UNAVAILABLE",
      message: "Server settings are temporarily unavailable. Please try again.",
      requestId,
    }, { status: 500 });
  }
};

export const onRequestPatch: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in to update server settings." }, { status: 401 });
  const serverId = sanitizeLinkedServerId(params.serverId);
  if (!serverId) return json({ ok: false, error: "INVALID_SERVER_ID", message: "Invalid server id." }, { status: 400 });

  let result: Awaited<ReturnType<typeof import("../../../_lib/server-settings").updateServerCategory>>;
  try {
    const [{ updateServerCategory }, body] = await Promise.all([
      import("../../../_lib/server-settings"),
      readJson<LegacySettingsBody>(request),
    ]);
    result = await updateServerCategory(env, user, serverId, {
      category: body.server_category,
      source: "owner",
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN legacy server settings update unavailable", { requestId, serverId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "SETTINGS_UNAVAILABLE",
      errorCode: "SETTINGS_UNAVAILABLE",
      message: "Server settings are temporarily unavailable. Please try again.",
      requestId,
    }, { status: 500 });
  }

  if (result.status !== 200 || !("newCategory" in result.payload)) {
    return json(result.payload, { status: result.status });
  }

  const { getServerCategoryLabel } = await import("../../../_lib/server-categories");
  return json({
    ...result.payload,
    ok: true,
    server: {
      id: serverId,
      server_category: result.payload.newCategory,
      server_category_label: getServerCategoryLabel(result.payload.newCategory),
    },
  }, { status: result.status });
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, PATCH, OPTIONS" },
});

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
  return typeof value === "string" && /^[a-zA-Z0-9_-]{6,80}$/.test(value) ? value : "";
}
