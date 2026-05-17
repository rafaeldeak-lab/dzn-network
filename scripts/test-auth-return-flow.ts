import assert from "node:assert/strict";

import { safeReturnTo } from "../functions/_lib/oauth";

assert.equal(safeReturnTo(null), "/");
assert.equal(safeReturnTo(""), "/");
assert.equal(safeReturnTo("/", "/setup"), "/");
assert.equal(safeReturnTo("/dashboard"), "/dashboard");
assert.equal(safeReturnTo("/setup"), "/setup");
assert.equal(safeReturnTo("/servers/profile?slug=pandora-dayz"), "/servers/profile?slug=pandora-dayz");
assert.equal(safeReturnTo("https://evil.example/dashboard"), "/");
assert.equal(safeReturnTo("//evil.example/dashboard"), "/");
assert.equal(safeReturnTo("/\\evil"), "/");
assert.equal(safeReturnTo("/javascript:alert(1)"), "/");
assert.equal(safeReturnTo("javascript:alert(1)"), "/");
assert.equal(safeReturnTo("data:text/html,owned"), "/");
assert.equal(safeReturnTo(null, "/setup"), "/setup");
assert.equal(safeReturnTo("https://evil.example/setup", "/setup"), "/setup");

console.log("Auth return flow tests passed.");
