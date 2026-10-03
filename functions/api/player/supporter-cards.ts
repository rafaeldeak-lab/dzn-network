import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { privateNoStoreHeaders } from "../../_lib/performance";
import {
  configuredStoreLivemode,
  privateSupporterCardsEnabled,
  readPrivateStoreSupporterCards,
} from "../../_lib/store-entitlements";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  const values = env as unknown as Record<string, unknown>;
  if (!privateSupporterCardsEnabled(values)) {
    return json({ ok: false, error: "SUPPORTER_CARDS_UNAVAILABLE" }, { status: 404, headers: privateNoStoreHeaders() });
  }

  const user = await resolveUser(env, request).catch(() => null);
  if (!user) {
    return json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: privateNoStoreHeaders() });
  }

  const livemode = configuredStoreLivemode(values);
  if (livemode === null || !env.DB) {
    return json({ ok: false, error: "SUPPORTER_CARDS_NOT_READY" }, { status: 503, headers: privateNoStoreHeaders() });
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: 204, headers: privateNoStoreHeaders() });
  }

  try {
    const cards = await readPrivateStoreSupporterCards(env.DB, user.id, livemode);
    return json({
      ok: true,
      private: true,
      scope: "current_user",
      cards,
      safety: {
        read_only: true,
        current_user_only: true,
        internal_ids_exposed: false,
        stripe_references_exposed: false,
        payment_details_exposed: false,
        public_profile_changed: false,
        competitive_effect: false,
      },
    }, { headers: privateNoStoreHeaders() });
  } catch {
    return json({ ok: false, error: "SUPPORTER_CARDS_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  const mock = await ensureMockUser(env);
  return { id: mock.userId, discord_id: mock.user.id, username: mock.user.username, avatar: mock.user.avatar };
}
