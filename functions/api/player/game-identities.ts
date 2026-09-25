import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { privateNoStoreHeaders } from "../../_lib/performance";
import {
  createPlayerGameIdentityClaim,
  readPlayerGameIdentityReadModel,
} from "../../_lib/player-game-identities";
import { dispatchQueuedOwnerRequestNotifications } from "../../_lib/player-game-identity-owner-notifications";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type ClaimBody = {
  linked_server_id?: unknown;
  server_id?: unknown;
  public_slug?: unknown;
  server_slug?: unknown;
  player_id?: unknown;
  player_reference?: unknown;
  player_name?: unknown;
};

export const onRequest: PagesFunction = async ({ request, env, waitUntil }) => {
  if (request.method === "GET") return handleGet(request, env);
  if (request.method === "POST") return handlePost(request, env, waitUntil);
  return methodNotAllowed();
};

async function handleGet(request: Request, env: Env) {
  const user = await resolveUser(env, request);
  if (!user) {
    return json(
      { ok: false, error: "UNAUTHORIZED", message: "Log in with Discord to view your linked game identities." },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }

  return json(await readPlayerGameIdentityReadModel(env, user), { headers: privateNoStoreHeaders() });
}

async function handlePost(request: Request, env: Env, waitUntil: (promise: Promise<unknown>) => void) {
  const user = await resolveUser(env, request);
  if (!user) {
    return json(
      { ok: false, error: "UNAUTHORIZED", message: "Log in with Discord to request a game identity link." },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }
  if (!isSameOriginMutation(request)) {
    return json(
      { ok: false, error: "FORBIDDEN", message: "Cross-origin game identity link requests are not allowed." },
      { status: 403, headers: privateNoStoreHeaders() },
    );
  }

  const bodyResult = await readBoundedJson<ClaimBody>(request, 4096);
  if (!bodyResult.ok) {
    return json(
      { ok: false, error: bodyResult.error, message: bodyResult.message },
      { status: bodyResult.status, headers: privateNoStoreHeaders() },
    );
  }

  const result = await createPlayerGameIdentityClaim(env, user, bodyResult.value);
  if (result.ok && result.status === 201 && result.owner_delivery_ids?.length) {
    waitUntil(dispatchQueuedOwnerRequestNotifications(env, { deliveryIds: result.owner_delivery_ids, maxJobs: result.owner_delivery_ids.length }));
  }
  if (result.ok && "owner_delivery_ids" in result) {
    const publicResult = { ...result };
    delete publicResult.owner_delivery_ids;
    return json(publicResult, { status: result.status, headers: privateNoStoreHeaders() });
  }
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
}

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

function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
