import assert from "node:assert/strict";

import { isProtectedAppPagePath, onRequest } from "../functions/_middleware";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

assert.equal(isProtectedAppPagePath("/owner"), true, "The owner console root must require sign-in.");
assert.equal(isProtectedAppPagePath("/owner/player-game-identity-claims"), true, "Nested owner review pages must require sign-in.");
assert.equal(isProtectedAppPagePath("/ownerless"), false, "Owner-route protection must not capture unrelated public paths.");
assert.equal(isProtectedAppPagePath("/api/owner/player-game-identity-claims"), false, "API authorization must remain owned by its API handlers.");

async function run() {
  for (const [method, pathname, expectedLocation] of [
    ["GET", "/owner/player-game-identity-claims", "/login?returnTo=%2Fowner%2Fplayer-game-identity-claims"],
    ["HEAD", "/owner/player-game-identity-claims?source=shared", "/login?returnTo=%2Fowner%2Fplayer-game-identity-claims%3Fsource%3Dshared"],
    ["GET", "/owner/future-private-page", "/login?returnTo=%2Fowner%2Ffuture-private-page"],
  ] as const) {
    const anonymousResponse = await invoke(new Request(`https://dzn.test${pathname}`, { method }), {} as Env);
    assert.equal(anonymousResponse.status, 302, `A signed-out ${method} visitor must be sent to login before ${pathname} is served.`);
    assert.equal(anonymousResponse.headers.get("location"), expectedLocation);
  }

  const publicResponse = await invoke(new Request("https://dzn.test/pricing"), {} as Env);
  assert.equal(publicResponse.status, 204, "Public pricing must remain outside the authenticated owner-page gate.");
  const ownerApiResponse = await invoke(new Request("https://dzn.test/api/owner/player-game-identity-claims"), {} as Env);
  assert.equal(ownerApiResponse.status, 204, "The page middleware must leave API authorization to the existing API handler.");

  let nextCalled = false;
  const signedInUser: SessionUser = {
    id: "server-owner-user",
    discord_id: "server-owner-discord",
    username: "Server Owner",
    avatar: null,
  };
  const signedInEnv = {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              first: async () => signedInUser,
            };
          },
        };
      },
    },
    SESSION_SECRET: "test-session-secret",
  } as unknown as Env;
  const signedInResponse = await onRequest({
    request: new Request("https://dzn.test/owner/player-game-identity-claims", {
      headers: { cookie: "dzn_session=test-session" },
    }),
    env: signedInEnv,
    params: {},
    data: {},
    waitUntil() {},
    next: async () => {
      nextCalled = true;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(nextCalled, true, "An authenticated server owner must still reach the existing claim-review page and its server-scoped API authorization.");
  assert.equal(signedInResponse.status, 204);
}

async function invoke(request: Request, env: Env) {
  const context: PagesContext = {
    request,
    env,
    params: {},
    data: {},
    waitUntil() {},
    next: async () => new Response(null, { status: 204 }),
  };
  return onRequest(context);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
