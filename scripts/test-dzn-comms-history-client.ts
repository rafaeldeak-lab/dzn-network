import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMS_HISTORY_MAX_BYTES, loadCommsHistory, parseCommsHistory } from "../components/comms/comms-history-client";
import { commsHistoryFixture } from "./fixtures/comms-history";

const encoder = new TextEncoder();
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const load = (fetcher: typeof fetch, signal = new AbortController().signal, timeoutMs = 250) => loadCommsHistory(signal, { fetcher, timeoutMs });

test("accepts the current Global Chat projection and strips unknown properties at each level", () => {
  const input = commsHistoryFixture();
  Object.assign(input, { secret: "private" }); Object.assign(input.channel, { owner_id: "private" });
  Object.assign(input.messages[0], { author_id: "private", raw_body: "private" });
  const parsed = parseCommsHistory(input);
  assert.equal(parsed.messages[0].body, "Local history fixture");
  assert.equal("secret" in parsed, false); assert.equal("owner_id" in parsed.channel, false);
  assert.equal("author_id" in parsed.messages[0], false); assert.equal("raw_body" in parsed.messages[0], false);
});

for (const [name, mutate] of Object.entries({
  channel: (x: ReturnType<typeof commsHistoryFixture>) => { x.channel.slug = "another-channel"; },
  privateChannel: x => { x.channel.kind = "private_group"; x.channel.visibility = "private_group"; },
  membership: x => { x.access.private_group_membership_required = true; },
  publicAccess: x => { x.access.public_channel = false; },
  sending: x => { x.feature_flags.sending_enabled = true; },
  reactions: x => { x.feature_flags.reactions_enabled = true; },
  routeOff: x => { x.feature_flags.route_enabled = false; },
  unsafe: x => { x.messages[0].public_safe = false; },
  mutable: x => { x.messages[0].read_only = false; },
  expired: x => { x.messages[0].visibility_state = "expired"; },
  duplicateId: x => { x.messages.push({ ...x.messages[0] }); },
  oversizedBody: x => { x.messages[0].body = "x".repeat(2_001); },
  oversizedAuthor: x => { x.messages[0].author_display_name = "x".repeat(61); },
  invalidTime: x => { x.messages[0].created_at = "not a time"; },
  tooManyRows: x => { x.messages = Array.from({ length: 31 }, (_, i) => ({ ...x.messages[0], id: String(i) })); },
  duplicateBoundary: x => { x.fairness_boundary.push(x.fairness_boundary[0]); },
} satisfies Record<string, (input: ReturnType<typeof commsHistoryFixture>) => void>)) {
  test(`rejects ${name}`, () => { const input = commsHistoryFixture(); mutate(input); assert.throws(() => parseCommsHistory(input)); });
}

test("rejects malformed nested collections and primitives without reaching the UI", () => {
  for (const key of ["channel", "access", "messages", "feature_flags", "fairness_boundary"]) {
    for (const value of [null, "invalid", 7, true, {}]) {
      assert.throws(() => parseCommsHistory({ ...commsHistoryFixture(), [key]: value }), `${key}: ${JSON.stringify(value)}`);
    }
  }
  for (const value of [null, false, 12, [], "payload"]) assert.throws(() => parseCommsHistory(value));
});

test("masks non-visible author and body even if the response incorrectly supplies raw text", () => {
  for (const state of ["hidden", "deleted", "quarantined"]) {
    const input = commsHistoryFixture();
    Object.assign(input.messages[0], { visibility_state: state, body: "sensitive text", author_display_name: "sensitive author" });
    const row = parseCommsHistory(input).messages[0];
    assert.equal(row.author_display_name, "DZN Safety"); assert.equal(row.author_role_label, "System");
    assert.doesNotMatch(JSON.stringify(row), /sensitive/);
  }
});

test("accepts full Unicode and worst-case JSON-escaped pages within the bounded contract", async () => {
  for (const character of ["\u4e2d", "\ud800"]) {
    const input = commsHistoryFixture();
    input.messages = Array.from({ length: 30 }, (_, index) => ({ ...input.messages[0],
      id: character.repeat(117) + index, body: character.repeat(2_000),
      author_display_name: character.repeat(60), author_role_label: character.repeat(24) }));
    input.fairness_boundary = Array.from({ length: 8 }, (_, index) => character.repeat(999) + index);
    const bytes = encoder.encode(JSON.stringify(input));
    assert.ok(bytes.byteLength > 128_000); assert.ok(bytes.byteLength < COMMS_HISTORY_MAX_BYTES);
    const loaded = await load(async () => jsonResponse(input));
    assert.equal(loaded.messages.length, 30); assert.equal(loaded.messages[0].body, character.repeat(2_000));
  }
});

test("makes exactly one same-origin GET, no-store with session cookies and cancellation", async () => {
  let requests = 0;
  const result = await load(async (url, options) => {
    requests++; assert.equal(url, "/api/comms/message-history?channel=global-chat&limit=30");
    assert.equal(options?.method, "GET"); assert.equal(options?.cache, "no-store"); assert.equal(options?.credentials, "include");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal instanceof AbortSignal);
    return jsonResponse(commsHistoryFixture());
  });
  assert.equal(requests, 1); assert.equal(result.messages.length, 1);
});

test("refuses auth errors, HTML, invalid JSON and invalid UTF-8", async () => {
  for (const response of [new Response("denied", { status: 401 }), new Response("denied", { status: 403 }), new Response("<html>"),
    new Response("bad", { headers: { "content-type": "application/json" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })]) {
    await assert.rejects(load(async () => response));
  }
});

test("rejects an oversized declared body without consuming the stream", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(load(async () => new Response(body, { headers: { "content-type": "application/json", "content-length": String(COMMS_HISTORY_MAX_BYTES + 1) } })));
  assert.equal(cancelled, true);
});

test("caps actual UTF-8 bytes for chunked responses despite a false small length", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) {
    for (let i = 0; i <= Math.ceil(COMMS_HISTORY_MAX_BYTES / 32_000); i++) controller.enqueue(encoder.encode("\u00e9".repeat(16_000)));
  }, cancel() { cancelled = true; } });
  await assert.rejects(load(async () => new Response(body, { headers: { "content-type": "application/json", "content-length": "1" } })));
  assert.equal(cancelled, true);
});

test("decodes multibyte characters split between chunks", async () => {
  const input = commsHistoryFixture(); input.messages[0].body = "caf\u00e9";
  const bytes = encoder.encode(JSON.stringify(input));
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close();
  } }), { headers: { "content-type": "application/json; charset=utf-8" } });
  assert.equal((await load(async () => response)).messages[0].body, "caf\u00e9");
});

test("times out before headers even when a fetch implementation ignores abort", async () => {
  let signal: AbortSignal | null | undefined;
  await assert.rejects(load(async (_, options) => { signal = options?.signal; return new Promise<Response>(() => undefined); }, undefined, 20));
  assert.equal(signal?.aborted, true);
});

test("times out and cancels a stalled response body after headers", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } });
  await assert.rejects(load(async () => response, undefined, 20));
  assert.equal(cancelled, true);
});

test("unmount abort cancels in-flight reads and already-aborted signals do not fetch", async () => {
  const controller = new AbortController(); let cancelled = false;
  const request = load(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }), controller.signal);
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  await assert.rejects(request); assert.equal(cancelled, true);
  let fetched = false;
  await assert.rejects(load(async () => { fetched = true; return jsonResponse(commsHistoryFixture()); }, controller.signal));
  assert.equal(fetched, false);
});
