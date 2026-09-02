import { ensureMockUser, getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { reviewPlayerGameIdentityClaim } from "../../../_lib/player-game-identities";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type ReviewBody = {
  action?: unknown;
  review_note?: unknown;
  note?: unknown;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "PATCH") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) {
    return json(
      { ok: false, error: "UNAUTHORIZED", message: "Log in with Discord to review game identity claims." },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }
  if (!isSameOriginMutation(request)) {
    return json(
      { ok: false, error: "FORBIDDEN", message: "Cross-origin game identity claim reviews are not allowed." },
      { status: 403, headers: privateNoStoreHeaders() },
    );
  }

  const bodyResult = await readBoundedJson<ReviewBody>(request, 4096);
  if (!bodyResult.ok) {
    return json(
      { ok: false, error: bodyResult.error, message: bodyResult.message },
      { status: bodyResult.status, headers: privateNoStoreHeaders() },
    );
  }

  const claimId = Array.isArray(params.claimId) ? params.claimId[0] : params.claimId;
  const result = await reviewPlayerGameIdentityClaim(env, user, claimId ?? "", bodyResult.value);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
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

function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
