import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { getRequestSessionUser } from "../../_lib/owner-access";
import {
  getPlayerChallengesPayload,
  joinPlayerChallenge,
  type PlayerChallengeJoinInput,
} from "../../_lib/player-progression";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

const BODY_LIMIT_BYTES = 2048;

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  if (request.method === "GET") return json(await playerChallengesPayload(env, user));

  const bodyResult = await readBoundedJson<PlayerChallengeJoinInput>(request, BODY_LIMIT_BYTES);
  if (!bodyResult.ok) {
    return json({ ok: false, error: bodyResult.error, message: bodyResult.message }, { status: bodyResult.status });
  }

  const result = await joinPlayerChallenge(env, user, bodyResult.value);
  return json(result.payload, { status: result.status });
};

async function playerChallengesPayload(env: Env, user: SessionUser) {
  return getPlayerChallengesPayload(env, user);
}
