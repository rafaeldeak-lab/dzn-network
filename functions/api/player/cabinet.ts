import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { privateNoStoreHeaders } from "../../_lib/performance";
import {
  configuredStoreLivemode,
  privateSupporterCardsEnabled,
  readPlayerCabinetSupporterCards,
  setPlayerCabinetSupporterCardVisibility,
} from "../../_lib/store-entitlements";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type CabinetPatchBody = {
  entitlementKey?: unknown;
  publiclyShowcased?: unknown;
};

export const onRequest: PagesFunction = async ({ env, request }) => {
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "PATCH") return methodNotAllowed();
  const values = env as unknown as Record<string, unknown>;
  if (!privateSupporterCardsEnabled(values)) {
    return json({ ok: false, error: "PLAYER_CABINET_UNAVAILABLE" }, { status: 404, headers: privateNoStoreHeaders() });
  }

  const user = await resolveUser(env, request).catch(() => null);
  if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: privateNoStoreHeaders() });

  const livemode = configuredStoreLivemode(values);
  if (livemode === null || !env.DB) {
    return json({ ok: false, error: "PLAYER_CABINET_NOT_READY" }, { status: 503, headers: privateNoStoreHeaders() });
  }
  if (request.method === "HEAD") return new Response(null, { status: 204, headers: privateNoStoreHeaders() });

  if (request.method === "GET") {
    try {
      const cards = await readPlayerCabinetSupporterCards(env.DB, user.id, livemode);
      return json(cabinetPayload(cards), { headers: privateNoStoreHeaders() });
    } catch {
      return json({ ok: false, error: "PLAYER_CABINET_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
    }
  }

  if (!isSameOriginMutation(request)) {
    return json({ ok: false, error: "FORBIDDEN" }, { status: 403, headers: privateNoStoreHeaders() });
  }
  const body = await readBoundedJson<CabinetPatchBody>(request, 2048);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  const entitlementKey = typeof body.value.entitlementKey === "string" ? body.value.entitlementKey.trim() : "";
  const publiclyShowcased = body.value.publiclyShowcased;
  if (!/^[a-z0-9_-]{6,240}$/.test(entitlementKey) || typeof publiclyShowcased !== "boolean") {
    return json({ ok: false, error: "INVALID_CABINET_SELECTION", message: "Choose a valid owned card and public visibility setting." }, { status: 400, headers: privateNoStoreHeaders() });
  }

  try {
    const result = await setPlayerCabinetSupporterCardVisibility(env.DB, user.id, livemode, entitlementKey, publiclyShowcased);
    if (result.status === "not_owned") {
      return json({ ok: false, error: "CABINET_CARD_NOT_OWNED", message: "That card is not available in this account's cabinet." }, { status: 404, headers: privateNoStoreHeaders() });
    }
    if (result.status === "showcase_full") {
      return json({ ok: false, error: "CABINET_SHOWCASE_LIMIT", message: "Choose up to four cards for your public profile at a time." }, { status: 409, headers: privateNoStoreHeaders() });
    }
    return json({ ok: true, card: result.card, private: true, presentation_only: true, competitive_effect: false }, { headers: privateNoStoreHeaders() });
  } catch {
    return json({ ok: false, error: "PLAYER_CABINET_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
};

function cabinetPayload(cards: Awaited<ReturnType<typeof readPlayerCabinetSupporterCards>>) {
  return {
    ok: true,
    private: true,
    scope: "current_user",
    cards,
    public_showcase_limit: 4,
    message: cards.length
      ? "Your cabinet is private. Choose up to four owned cards to show on your public profile."
      : "Your permanent Store cards will appear here after a confirmed purchase is fulfilled.",
    safety: {
      current_user_only: true,
      payment_details_exposed: false,
      public_profile_changed: false,
      competitive_effect: false,
    },
  };
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  const mock = await ensureMockUser(env);
  return { id: mock.userId, discord_id: mock.user.id, username: mock.user.username, avatar: mock.user.avatar };
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
