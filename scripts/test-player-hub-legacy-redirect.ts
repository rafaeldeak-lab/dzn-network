import assert from "node:assert/strict";
import test from "node:test";
import { onRequest as middlewareOnRequest } from "../functions/_middleware";

test("the legacy Player Hub URL redirects before sign-in handling and preserves its query", async () => {
  const response = await middlewareOnRequest({
    request: new Request("https://www.dayz-network.com/player-hub?source=legacy"),
    env: {},
    next: async () => new Response("The legacy route should redirect before reaching the next handler.", { status: 599 }),
  } as never);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/player?source=legacy");
});
