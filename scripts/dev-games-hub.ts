import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { handleGamesTrivia } from "../functions/_lib/games-trivia";
import { handleGamesWordChain } from "../functions/_lib/games-word-chain";
import { handleGamesHideSeek } from "../functions/_lib/games-hide-seek";
import { handleGamesRelayRush } from "../functions/_lib/games-relay-rush";
import { handleGamesCipherGrid } from "../functions/_lib/games-cipher-grid";
import { handleGamesEchoArray } from "../functions/_lib/games-echo-array";
import { handleGamesOutpostRun } from "../functions/_lib/games-outpost-run";
import { handleGamesSignalShift } from "../functions/_lib/games-signal-shift";
import { handleGamesCircuitForge } from "../functions/_lib/games-circuit-forge";
import { handleGamesRangerRange } from "../functions/_lib/games-ranger-range";
import { handleGamesNightRun } from "../functions/_lib/games-night-run";
import { handleCommandCentre } from "../functions/_lib/command-centre";
import { handleSurvivalCommand } from "../functions/_lib/survival-command";
import { gamesFixture } from "./lib/games-hub-local";

// Loopback-only, disposable synthetic account. Never use production bindings or credentials.
async function main() {
  const fixture = await gamesFixture();
  fixture.db.sqlite.exec(await readFile("migrations/0085_games_hub_trivia.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0086_games_hub_word_chain.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0087_games_hub_hide_seek.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0096_games_hub_relay_rush.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0097_games_hub_cipher_grid.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0106_games_hub_cipher_grid_specialist.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0098_games_hub_echo_array.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0099_games_hub_outpost_run.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0100_games_hub_signal_shift.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0101_games_hub_circuit_forge.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0102_games_hub_ranger_range.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0104_games_hub_night_run.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0105_games_hub_night_run_recon.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0110_games_hub_night_run_route_control.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0107_dzn_command_centre.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0108_dzn_survival_command_expeditions.sql", "utf8"));
  fixture.db.sqlite.exec(await readFile("migrations/0109_dzn_survival_command_loadouts.sql", "utf8"));
  fixture.env.DZN_GAMES_TRIVIA_ENABLED = "true";
  fixture.env.DZN_GAMES_WORD_CHAIN_ENABLED = "true";
  fixture.env.DZN_GAMES_HIDE_SEEK_ENABLED = "true";
  fixture.env.DZN_GAMES_RELAY_RUSH_ENABLED = "true";
  fixture.env.DZN_GAMES_CIPHER_GRID_ENABLED = "true";
  fixture.env.DZN_GAMES_CIPHER_GRID_SPECIALIST_ENABLED = "false";
  fixture.env.DZN_GAMES_ECHO_ARRAY_ENABLED = "true";
  fixture.env.DZN_GAMES_OUTPOST_RUN_ENABLED = "true";
  fixture.env.DZN_GAMES_SIGNAL_SHIFT_ENABLED = "true";
  fixture.env.DZN_GAMES_CIRCUIT_FORGE_ENABLED = "true";
  fixture.env.DZN_GAMES_RANGER_RANGE_ENABLED = "true";
  fixture.env.DZN_GAMES_NIGHT_RUN_ENABLED = "true";
  fixture.env.DZN_GAMES_NIGHT_RUN_RECON_ENABLED = "true";
  fixture.env.DZN_GAMES_NIGHT_RUN_ROUTE_CONTROL_ENABLED = "true";
  fixture.env.DZN_COMMAND_CENTRE_ENABLED = "true";
  fixture.env.DZN_SURVIVAL_COMMAND_ENABLED = "true";
  const root = resolve("out");
  await stat(resolve(root, "games.html"));
  const mime: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4", ".txt": "text/plain", ".ico": "image/x-icon" };
  let origin = "";
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403); res.end(); return; }
      const url = new URL(req.url ?? "/", origin);
      if (url.pathname === "/__local-login") {
        res.writeHead(303, { "Set-Cookie": `${fixture.cookie}; Path=/; HttpOnly; SameSite=Strict`, Location: "/games", "Cache-Control": "no-store" }); res.end(); return;
      }
      if (url.pathname === "/__local-command-centre") {
        res.writeHead(303, { "Set-Cookie": `${fixture.cookie}; Path=/; HttpOnly; SameSite=Strict`, Location: "/command-centre", "Cache-Control": "no-store" }); res.end(); return;
      }
      if (url.pathname === "/__local-survival-command") {
        res.writeHead(303, { "Set-Cookie": `${fixture.cookie}; Path=/; HttpOnly; SameSite=Strict`, Location: "/survival-command", "Cache-Control": "no-store" }); res.end(); return;
      }
      if (url.pathname === "/api/auth/me") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ authenticated: true, navigation: { plan_tier: "free", can_link_more_servers: true, primary_action: { label: "Owner Plans", href: "/pricing", tone: "trial" } } })); return;
      }
      if (url.pathname === "/api/dzn-pulse/config") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, dznPulseEnabled: false, discordNotificationsEnabled: false })); return;
      }
      if (["/api/games/hub", "/api/games/trivia", "/api/games/word-chain", "/api/games/hide-seek", "/api/games/relay-rush", "/api/games/cipher-grid", "/api/games/echo-array", "/api/games/outpost-run", "/api/games/signal-shift", "/api/games/circuit-forge", "/api/games/ranger-range", "/api/games/night-run", "/api/player/command-centre", "/api/player/survival-command"].includes(url.pathname)) {
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        const handler = url.pathname.endsWith("/survival-command") ? handleSurvivalCommand
          : url.pathname.endsWith("/command-centre") ? handleCommandCentre
          : url.pathname.endsWith("/trivia") ? handleGamesTrivia
          : url.pathname.endsWith("/word-chain") ? handleGamesWordChain
            : url.pathname.endsWith("/hide-seek") ? handleGamesHideSeek
              : url.pathname.endsWith("/relay-rush") ? handleGamesRelayRush
                : url.pathname.endsWith("/cipher-grid") ? handleGamesCipherGrid
                  : url.pathname.endsWith("/echo-array") ? handleGamesEchoArray : handleGamesHub;
        const responseHandler = url.pathname.endsWith("/outpost-run") ? handleGamesOutpostRun
          : url.pathname.endsWith("/signal-shift") ? handleGamesSignalShift
            : url.pathname.endsWith("/circuit-forge") ? handleGamesCircuitForge
              : url.pathname.endsWith("/ranger-range") ? handleGamesRangerRange
                : url.pathname.endsWith("/night-run") ? handleGamesNightRun : handler;
        const response = await responseHandler(new Request(url, { method: req.method, headers: {
          cookie: req.headers.cookie ?? "", origin: req.headers.origin ?? "", "content-type": req.headers["content-type"] ?? "",
        }, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }), fixture.env);
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (url.pathname.startsWith("/api/")) { res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"authenticated":false}'); return; }
      if (!["GET", "HEAD"].includes(req.method ?? "GET")) { res.writeHead(405); res.end(); return; }
      const pathname = decodeURIComponent(url.pathname);
      const file = resolve(root, `.${pathname === "/" ? "/index" : pathname}${extname(pathname) ? "" : ".html"}`);
      if (!file.startsWith(`${root}${sep}`)) { res.writeHead(403); res.end(); return; }
      // Match the existing Windows-export preview's segment-prefetch resolution.
      const segmentFile = file.replace(/(__next\.[^./\\]+)((?:\.[^/\\]+)+)\.txt$/, (_, prefix: string, segments: string) => `${prefix}${segments.replaceAll(".", sep)}.txt`);
      let contents: Buffer | null = null;
      for (const candidate of [file, segmentFile]) {
        if (!candidate.startsWith(`${root}${sep}`)) continue;
        try { contents = await readFile(candidate); break; } catch { /* Try the equivalent exported segment path. */ }
      }
      if (!contents) { res.writeHead(404); res.end("Not found in this isolated preview."); return; }
      res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : contents);
    } catch { res.writeHead(404); res.end("Not found in this isolated preview."); }
  });
  server.listen(Number(process.env.GAMES_PREVIEW_PORT ?? 0), "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    origin = `http://127.0.0.1:${address.port}`;
    console.log(`Local-only synthetic Games Hub: ${origin}/__local-login, ${origin}/__local-command-centre or ${origin}/__local-survival-command`);
  });
}
void main();
