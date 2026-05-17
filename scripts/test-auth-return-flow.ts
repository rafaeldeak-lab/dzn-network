import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const loginPageSource = readFileSync("app/login/page.tsx", "utf8");
const signupPageSource = readFileSync("app/signup/page.tsx", "utf8");
const authShellSource = readFileSync("components/onboarding/auth-shell.tsx", "utf8");
const loginAuthShellBlock = loginPageSource.slice(
  loginPageSource.indexOf("<AuthShell"),
  loginPageSource.indexOf("/>"),
);
const authNavBlock = authShellSource.slice(
  authShellSource.indexOf("function AuthNav"),
  authShellSource.indexOf("function AuthMissionBackground"),
);

assert.equal(loginPageSource.includes("hideNavActions"), true);
assert.equal(loginAuthShellBlock.includes("Servers"), false);
assert.equal(loginAuthShellBlock.includes("Add Your Server"), false);
assert.equal(authShellSource.includes("DZN LOGIN HEADER SIMPLIFIED"), true);
assert.equal(authShellSource.includes("window.location.href = withReturnTo(startBaseHref);"), true);
assert.equal(authShellSource.includes("url.searchParams.set(\"returnTo\", defaultReturnTo);"), true);
assert.equal(authNavBlock.includes("{hideActions ? null : ("), true);
assert.equal(authNavBlock.includes("Servers"), true);
assert.equal(authNavBlock.includes("Add Your Server"), true);
assert.equal(signupPageSource.includes("hideNavActions"), false);

console.log("Auth return flow tests passed.");
