import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { commsHistoryFixture } from "./fixtures/comms-history";

type MutableFixture = ReturnType<typeof commsHistoryFixture> & {
  channel: { slug: string; kind: string; name: string; description: string | null; visibility: string };
  access: { public_channel: boolean; private_group_membership_required: boolean; current_user_member_role: string | null };
  available_channels: Array<{ slug: string; kind: string; name: string; description: string | null; visibility: string; current_user_member_role: string | null }>;
};

const base = process.env.DZN_COMMS_QA_BASE ?? "http://127.0.0.1:3100";
const output = path.join(tmpdir(), "dzn-comms-private-groups-qa");

function payload(channel: "global-chat" | "pandora-squad") {
  const fixture = commsHistoryFixture() as unknown as MutableFixture;
  fixture.feature_flags.private_groups_enabled = true;
  fixture.available_channels.push({
    slug: "pandora-squad",
    kind: "private_group",
    name: "Pandora Squad",
    description: "Private squad coordination.",
    visibility: "private_group",
    current_user_member_role: "member",
  });
  if (channel === "pandora-squad") {
    Object.assign(fixture.channel, {
      slug: channel,
      kind: "private_group",
      name: "Pandora Squad",
      description: "Private squad coordination.",
      visibility: "private_group",
    });
    Object.assign(fixture.access, {
      public_channel: false,
      private_group_membership_required: true,
      current_user_member_role: "member",
    });
    fixture.messages[0].id = "private-message";
    fixture.messages[0].body = "PRIVATE-CHANNEL-QA-SENTINEL";
  }
  return fixture;
}

async function main() {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ name: "desktop", width: 1440, height: 960 }, { name: "phone", width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce", serviceWorkers: "block" });
      const page = await context.newPage();
      const errors: string[] = [];
      let privateAccess = true;
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/api/comms/message-history**", async (route) => {
        const url = new URL(route.request().url());
        const channel = url.searchParams.get("channel");
        if (channel === "pandora-squad" && !privateAccess) {
          return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false }) });
        }
        assert.ok(channel === "global-chat" || channel === "pandora-squad");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload(channel)) });
      });

      await page.goto(`${base}/community`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Pandora Squad/i }).click();
      await page.getByRole("heading", { level: 1, name: "Pandora Squad", exact: true }).waitFor();
      await page.getByText("PRIVATE-CHANNEL-QA-SENTINEL", { exact: true }).waitFor();
      assert.equal(await page.locator("main").evaluate((main) => main.scrollWidth <= main.clientWidth), true, `${viewport.name}: no horizontal overflow`);
      await page.screenshot({ path: path.join(output, `${viewport.name}-private.png`), fullPage: true });

      privateAccess = false;
      await page.waitForTimeout(5_500);
      await page.getByRole("heading", { level: 1, name: "Global Chat", exact: true }).waitFor();
      assert.equal(await page.getByText("PRIVATE-CHANNEL-QA-SENTINEL", { exact: true }).count(), 0, `${viewport.name}: revoked private text cleared`);
      assert.deepEqual(errors, [], `${viewport.name}: no browser errors`);
      await page.screenshot({ path: path.join(output, `${viewport.name}-revoked.png`), fullPage: true });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`DZN Comms private-group rendered QA passed. Screenshots: ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
