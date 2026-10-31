/**
 * Disposable browser QA for the real Vault handlers and exported UI.
 * Run after npm run build. No production bindings, credentials or payments.
 * This file is never imported by app/ or functions/.
 */
import { createServer, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getSessionUser } from "../functions/_lib/db";
import { handlePrivateVault, handlePublicPlayerVault, handlePublicServerVault } from "../functions/_lib/vault";
import type { PublicPlayerProfilePayload } from "../functions/_lib/player-public-profiles";
import { GamesLocalD1 } from "./lib/games-hub-local";
import { createVaultLocalFixture, vaultLocalEnv, VAULT_LOCAL } from "./lib/vault-local";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(checkout);

async function main() {
  const db = new GamesLocalD1();
  const d1 = db as unknown as D1Database;
  await createVaultLocalFixture(d1);
  const env = vaultLocalEnv(d1);
  const root = resolve(checkout, "out");
  await stat(resolve(root, "player/cabinet.html"));
  const portArgument = process.argv.indexOf("--port");
  const port = Number(portArgument >= 0 ? process.argv[portArgument + 1] : process.env.PORT ?? process.env.VAULT_PREVIEW_PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("A valid local preview port is required.");
  // The managed preview places this disposable server in its own container.
  // Its explicit QA flag permits the container proxy to reach the fixture;
  // ordinary local development remains loopback-only.
  const managed = process.argv.includes("--managed-preview");
  const mime: Record<string, string> = {
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4", ".txt": "text/plain", ".ico": "image/x-icon",
  };
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      const url = new URL(req.url ?? "/", `http://${host}`);
      const allowedHosts = managed ? ["127.0.0.1", "localhost", "terminal.local"] : ["127.0.0.1", "localhost"];
      if (!allowedHosts.includes(url.hostname)) { res.writeHead(403); res.end(); return; }
      const method = req.method ?? "GET";
      if (url.pathname === "/__local-mobile" && method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Vault narrow layout QA</title><body style="margin:0;padding:20px;background:#1b1b22;color:#eee;font:14px system-ui"><p>Local QA · 390px mobile-width viewport</p><iframe title="Vault mobile width" src="/player/cabinet" width="390" height="844" style="border:1px solid #555;display:block"></iframe></body></html>`);
        return;
      }
      if (url.pathname === "/__local-login" || url.pathname === "/__local-login-other") {
        if (method !== "GET") { res.writeHead(405); res.end(); return; }
        const token = url.pathname.endsWith("-other") ? VAULT_LOCAL.otherToken : VAULT_LOCAL.playerToken;
        res.writeHead(303, { "Set-Cookie": `dzn_session=${token}; Path=/; HttpOnly; SameSite=Strict`, Location: "/player/cabinet", "Cache-Control": "no-store" });
        res.end(); return;
      }
      if (url.pathname === "/__local-logout") {
        res.writeHead(303, { "Set-Cookie": "dzn_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict", Location: "/player/cabinet", "Cache-Control": "no-store" });
        res.end(); return;
      }
      const headers = new Headers();
      for (const name of ["cookie", "origin", "content-type", "content-length", "sec-fetch-site"]) {
        const value = req.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      let body: string | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) { sendJson(res, { ok: false, error: "BODY_TOO_LARGE" }, 413); return; }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString("utf8");
      }
      const request = new Request(url, { method, headers, body });
      if (url.pathname === "/api/auth/me") {
        const user = await getSessionUser(env, request);
        const serverRow = user ? await d1.prepare("SELECT id, server_name, public_slug FROM linked_servers WHERE user_id = ?").bind(user.id).first<{ id: string; server_name: string; public_slug: string }>() : null;
        const linkedServers = serverRow ? [{ ...serverRow, guild_id: "local-guild", guild_name: "Local preview community", nitrado_service_id: "local-service", nitrado_service_name: "Synthetic QA server", server_type: "PVP", tags_json: "[]", region: "EU", status: "live" }] : [];
        sendJson(res, { authenticated: Boolean(user), user, linkedServers, linkedServer: linkedServers[0] ?? null,
          navigation: { effective_plan_key: "free", stored_plan_key: "free", plan_tier: "free", plan_label: "Free", plan_status: "free", linked_server_count: linkedServers.length, linked_server_limit: 1, can_link_more_servers: true, can_use_pro_tools: false, primary_action: { label: "Owner Plans", href: "/pricing", tone: "trial" } },
        }); return;
      }
      if (url.pathname === "/api/dzn-pulse/config") { sendJson(res, { ok: true, dznPulseEnabled: false, discordNotificationsEnabled: false }); return; }
      if (url.pathname === "/api/player/vault") { await sendResponse(res, await handlePrivateVault(request, env, "player")); return; }
      const privateServer = url.pathname.match(/^\/api\/servers\/([^/]+)\/vault$/);
      if (privateServer) { await sendResponse(res, await handlePrivateVault(request, env, "server", decodeURIComponent(privateServer[1]))); return; }
      const publicPlayer = url.pathname.match(/^\/api\/public\/players\/([^/]+)\/vault$/);
      if (publicPlayer) { await sendResponse(res, await handlePublicPlayerVault(request, env, decodeURIComponent(publicPlayer[1]))); return; }
      const publicServer = url.pathname.match(/^\/api\/public\/servers\/([^/]+)\/vault$/);
      if (publicServer) { await sendResponse(res, await handlePublicServerVault(request, env, decodeURIComponent(publicServer[1]))); return; }
      const profile = url.pathname.match(/^\/api\/public\/players\/([^/]+)$/);
      if (profile && method === "GET") {
        const row = await d1.prepare(`SELECT p.handle, u.username FROM player_public_profiles p
          JOIN users u ON u.id = p.user_id JOIN player_profile_privacy_preferences prefs ON prefs.user_id = p.user_id
          WHERE p.handle = ? AND p.status = 'active' AND prefs.public_profile_enabled = 1`)
          .bind(decodeURIComponent(profile[1])).first<{ handle: string; username: string }>();
        sendJson(res, row ? publicProfileFixture(row.handle, row.username) : { ok: false, error: "NOT_FOUND" }, row ? 200 : 404); return;
      }
      if (url.pathname.startsWith("/api/")) { sendJson(res, { ok: false, error: "UNAVAILABLE_IN_LOCAL_VAULT_PREVIEW" }, 404); return; }
      if (!["GET", "HEAD"].includes(method)) { res.writeHead(405); res.end(); return; }
      const pathname = decodeURIComponent(url.pathname);
      const route = /^\/players\/[^/]+\/?$/.test(pathname) ? "/players" : pathname === "/" ? "/player/cabinet" : pathname;
      const file = resolve(root, `.${route}${extname(route) ? "" : ".html"}`);
      if (!file.startsWith(`${root}${sep}`)) { res.writeHead(403); res.end(); return; }
      const segmentFile = file.replace(/(__next\.[^./\\]+)((?:\.[^/\\]+)+)\.txt$/, (_, prefix: string, segments: string) => `${prefix}${segments.replaceAll(".", sep)}.txt`);
      let contents: Buffer | null = null;
      for (const candidate of [file, segmentFile]) {
        if (!candidate.startsWith(`${root}${sep}`)) continue;
        try { contents = await readFile(candidate); break; } catch { /* Try the exported segment path. */ }
      }
      if (!contents) { res.writeHead(404); res.end("Not available in this isolated Vault preview."); return; }
      res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(method === "HEAD" ? undefined : contents);
    } catch (error) {
      console.error("Local Vault preview request failed:", error instanceof Error ? error.message : "Unknown error");
      if (!res.headersSent) sendJson(res, { ok: false, error: "LOCAL_PREVIEW_ERROR" }, 500);
      else res.end();
    }
  });
  server.listen(port, managed ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`Disposable Vault preview ready on port ${port}. Open /__local-login for the synthetic player, or /__local-login-other for isolation checks.`);
  });
  const close = () => server.close(() => { db.sqlite.close(); process.exit(0); });
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function sendResponse(res: ServerResponse, response: Response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function publicProfileFixture(handle: string, name: string): PublicPlayerProfilePayload {
  const hidden = { visible: false, status: "hidden" as const, message: "Hidden in this local preview." };
  return {
    ok: true, handle, href: `/players/${handle}`, display_name: name,
    discord_profile: { visible: false, connected: false, avatar_url: null }, published_at: null, updated_at: null,
    sections: {
      display_name: { visible: true, value: name }, gameplay_summary: { visible: false, totals: null, last_seen_at: null },
      featured_server: { visible: false, server: null }, xp_progress: hidden, challenge_progress: hidden,
      calling_cards: { ...hidden, items: [] }, award_dates: hidden,
    },
    privacy: { public_profile_enabled: true, visible_sections: ["display_name"] },
    safety: { public_safe: true, read_only: true, presentation_only: true, private_identifiers_exposed: false, raw_award_evidence_exposed: false },
    fairness_boundary: ["Synthetic local profile for Vault browser QA."],
  };
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
