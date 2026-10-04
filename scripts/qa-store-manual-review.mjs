import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const port = 33_000 + (process.pid % 1_000);
const baseUrl = `http://127.0.0.1:${port}`;
const output = path.join(tmpdir(), `dzn-store-review-qa-${Date.now()}`);
await mkdir(output, { recursive: true });

const payload = {
  ok: true,
  items: [{
    id: "order_review_001",
    order_number: "DZN-REVIEW-001",
    status: "manual_review",
    stripe_mode: "test",
    livemode: 0,
    currency: "gbp",
    total_amount_minor: 1200,
    stock_reservation_state: "held",
    created_at: "2026-10-04T09:00:00.000Z",
    updated_at: "2026-10-04T10:00:00.000Z",
    paid_at: null,
    product_key: "founding-supporter",
    product_name: "DZN Founding Supporter Pack",
    fulfilment_kind: "supporter_card",
    customer_username: "Tara.W",
    customer_avatar: null,
    latest_event_type: "checkout.session.completed",
    latest_event_status: "manual_review",
    latest_event_at: "2026-10-04T10:00:00.000Z",
    latest_action: "escalate",
    latest_action_reason: "Payment state needs provider verification before any local state change.",
    latest_action_evidence_category: "payment_state_mismatch",
    latest_action_at: "2026-10-04T10:05:00.000Z",
    action_count: 1,
  }],
  page: { limit: 30, hasMore: false, nextCursor: null },
};

const serverCommand = process.platform === "win32" ? "cmd.exe" : "npm";
const serverArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", `npm run dev -- --hostname 127.0.0.1 --port ${port}`]
  : ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)];
const server = spawn(serverCommand, serverArgs, {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});
let logs = "";
server.stdout.on("data", (chunk) => { logs += chunk.toString(); });
server.stderr.on("data", (chunk) => { logs += chunk.toString(); });

try {
  await waitForServer(`${baseUrl}/owner/store/reconciliation`);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 900, 1000], ["mobile", 390, 844], ["narrow", 320, 760]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      const errors = [];
      let posts = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.route("**/api/owner/store/manual-review?**", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      }));
      await page.route("**/api/owner/store/manual-review", (route) => {
        posts += 1;
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, duplicate: false }) });
      });
      await page.route("**/api/owner/store/manual-review-avatar/**", (route) => route.fulfill({ status: 204, body: "" }));
      await page.goto(`${baseUrl}/owner/store/reconciliation`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByRole("heading", { name: "Store review queue" }).waitFor();
      await page.getByText("DZN-REVIEW-001", { exact: true }).waitFor();
      const result = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        orderCount: [...document.querySelectorAll("h3")].filter((node) => node.textContent === "DZN-REVIEW-001").length,
        hasBoundary: document.body.innerText.includes("Non-financial audit actions only"),
        hasActions: ["Note", "Hold", "Escalate"].every((value) => document.body.innerText.includes(value)),
      }));
      if (result.overflow !== 0 || result.orderCount !== 1 || !result.hasBoundary || !result.hasActions || errors.length) {
        throw new Error(`${name} Store review QA failed: ${JSON.stringify({ result, errors })}`);
      }
      if (name === "desktop") {
        await page.getByLabel("Required operator reason").fill("Waiting for verified provider evidence.");
        await page.getByRole("button", { name: /^hold$/i }).click();
        await page.getByText("Review action recorded in the immutable audit history.", { exact: false }).waitFor();
        if (posts !== 1) throw new Error(`Expected one audit POST, received ${posts}`);
      }
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      console.log(`${name}: ${JSON.stringify(result)}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`Store review screenshots: ${output}`);
} finally {
  await stopServer(server);
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next dev server exited early.\n${logs}`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next dev server did not start.\n${logs}`);
}

async function stopServer(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    return;
  }
  child.kill("SIGTERM");
}
