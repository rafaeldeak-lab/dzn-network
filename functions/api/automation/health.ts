import { requireDznAdmin } from "../../_lib/admin";
import { getAutomationHealth } from "../../_lib/automation";
import { json } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const admin = await requireDznAdmin(env, request);
  if (!admin) return json({ error: "Forbidden" }, { status: 403 });
  return json(await getAutomationHealth(env));
};

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, OPTIONS" },
});

export const onRequestPost: PagesFunction = () => json(
  { error: "Method not allowed", allowed: ["GET"] },
  { status: 405, headers: { Allow: "GET" } },
);
