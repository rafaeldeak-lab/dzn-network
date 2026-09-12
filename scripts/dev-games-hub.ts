import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { handleGamesHub } from "../functions/_lib/games-hub";
import { gamesFixture } from "./lib/games-hub-local";

// Loopback-only, disposable synthetic account. Never use production bindings or credentials.
async function main() {
  const fixture = await gamesFixture();
  const root = resolve("out");
  await stat(resolve(root, "games.html"));
  const mime: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4", ".txt": "text/plain", ".ico": "image/x-icon" };
  let origin = "";
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403); res.end(); return; }
      const url = new URL(req.url ?? "/", origin);
      if (url.pathname === "/__local-login") {
        res.writeHead(303, { "Set-Cookie": `${fixture.cookie}; Path=/; HttpOnly; SameSite=Strict`, Location: "/games", "Cache-Control": "no-store" }); res.end(); return;
      }
      if (url.pathname === "/api/games/hub") {
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        const response = await handleGamesHub(new Request(url, { method: req.method, headers: {
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
    console.log(`Local-only synthetic Games Hub: ${origin}/__local-login`);
  });
}
void main();
