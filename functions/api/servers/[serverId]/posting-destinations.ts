import { getSessionUser, requireDb } from "../../../_lib/db";
import {
  classifyDiscordPostingError,
  checkDiscordPostingPermissions,
  getPostingDeliveryMode,
  recordDiscordPostingDeliveryState,
  sendDiscordTestPost,
} from "../../../_lib/discord-posting";
import { ensureAutomationSchema, getAutomationContextForLinkedServer } from "../../../_lib/automation";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { AUTO_POST_TYPES, hasAutoPost } from "../../../_lib/plans";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";
import type { AutoPostType } from "../../../../lib/billing/plans";

type SavePostingDestinationBody = {
  post_type?: string;
  discord_channel_id?: string;
  discord_webhook_url?: string | null;
  enabled?: boolean;
  send_test_post?: boolean;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });
  const access = await requireOwnedServer(env, user.id, linkedServerId);
  if (!access) return json({ error: "Server not found" }, { status: 404 });
  const context = await getAutomationContextForLinkedServer(env, linkedServerId);
  if (!context) return json({ error: "Automation is not ready for this server yet." }, { status: 409 });

  if (request.method === "GET") {
    return json(await getPostingDestinationPayload(env, context.guildId, context.planKey));
  }
  if (request.method !== "POST") return methodNotAllowed();

  const body = await readJson<SavePostingDestinationBody>(request);
  const postType = normalizePostType(body.post_type);
  if (!postType) return json({ error: "Invalid post type" }, { status: 400 });
  if (!hasAutoPost(context.planKey, postType)) {
    return json({ error: "Upgrade required for this Discord auto-post type." }, { status: 403 });
  }
  const channelId = sanitizeDiscordId(body.discord_channel_id);
  if (!channelId) return json({ error: "Discord channel ID is required." }, { status: 400 });
  const existingDestination = await requireDb(env)
    .prepare("SELECT discord_webhook_url FROM server_posting_destinations WHERE guild_id = ? AND post_type = ? LIMIT 1")
    .bind(context.guildId, postType)
    .first<{ discord_webhook_url: string | null }>();
  const rawWebhookUrl = typeof body.discord_webhook_url === "string" ? body.discord_webhook_url.trim() : "";
  const webhookUrl = rawWebhookUrl ? sanitizeWebhookUrl(rawWebhookUrl) : existingDestination?.discord_webhook_url ?? null;
  if (rawWebhookUrl && !webhookUrl) return json({ error: "Invalid Discord webhook URL." }, { status: 400 });
  const permissionCheck = await checkDiscordPostingPermissions(env, {
    discord_channel_id: channelId,
    discord_webhook_url: webhookUrl,
  });
  await ensureAutomationSchema(env);
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO server_posting_destinations (
        id, guild_id, post_type, discord_channel_id, discord_webhook_url, enabled,
        required_feature, min_plan_key, created_by_discord_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, post_type) DO UPDATE SET
        discord_channel_id = excluded.discord_channel_id,
        discord_webhook_url = excluded.discord_webhook_url,
        enabled = excluded.enabled,
        required_feature = excluded.required_feature,
        min_plan_key = excluded.min_plan_key,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      context.guildId,
      postType,
      channelId,
      webhookUrl,
      body.enabled === false ? 0 : 1,
      requiredFeatureForPostType(postType),
      context.planKey,
      user.discord_id,
      now,
      now,
    )
    .run();

  await upsertPostingPermissionWarning(env, {
    guildId: context.guildId,
    postType,
    channelId,
    warning: permissionCheck.warning,
  });

  let testResult: { ok: boolean; mode?: string; error?: string; missing_permissions?: string[] } | null = null;
  if (body.send_test_post === true) {
    const state = await requireDb(env)
      .prepare("SELECT discord_message_id FROM server_posting_state WHERE guild_id = ? AND post_type = ? AND discord_channel_id = ? LIMIT 1")
      .bind(context.guildId, postType, channelId)
      .first<{ discord_message_id: string | null }>();
    if (permissionCheck.mode === "missing_permissions" && !webhookUrl) {
      testResult = {
        ok: false,
        mode: "missing_permissions",
        error: permissionCheck.warning ?? "DZN cannot auto-post in this channel yet.",
        missing_permissions: permissionCheck.missing_permissions,
      };
    } else {
      try {
        const delivery = await sendDiscordTestPost(env, {
          guild_id: context.guildId,
          post_type: postType,
          discord_channel_id: channelId,
          discord_webhook_url: webhookUrl,
        }, state?.discord_message_id ?? null);
        await recordDiscordPostingDeliveryState(env, {
          guild_id: context.guildId,
          post_type: postType,
          discord_channel_id: channelId,
        }, delivery);
        testResult = { ok: true, mode: delivery.mode };
      } catch (error) {
        const classified = classifyDiscordPostingError(error);
        await upsertPostingPermissionWarning(env, {
          guildId: context.guildId,
          postType,
          channelId,
          warning: classified.warning,
        });
        testResult = {
          ok: false,
          mode: classified.mode,
          error: classified.warning ?? "Discord test post failed.",
          missing_permissions: classified.missing_permissions,
        };
      }
    }
  }
  return json({
    ...await getPostingDestinationPayload(env, context.guildId, context.planKey),
    permission_check: permissionCheck,
    test_post: testResult,
  });
};

async function getPostingDestinationPayload(env: Env, guildId: string, planKey: string) {
  await ensureAutomationSchema(env);
  const rows = await requireDb(env)
    .prepare(
      `SELECT post_type, discord_channel_id, discord_webhook_url, enabled, required_feature, min_plan_key, updated_at
       FROM server_posting_destinations
       WHERE guild_id = ?`,
    )
    .bind(guildId)
    .all<{
      post_type: AutoPostType;
      discord_channel_id: string;
      discord_webhook_url?: string | null;
      enabled: number;
      required_feature: string | null;
      min_plan_key: string | null;
      updated_at: string | null;
    }>();
  const stateRows = await requireDb(env)
    .prepare(
      `SELECT post_type, discord_channel_id, last_error, last_posted_at, last_edited_at
       FROM server_posting_state
       WHERE guild_id = ?`,
    )
    .bind(guildId)
    .all<{
      post_type: AutoPostType;
      discord_channel_id: string;
      last_error: string | null;
      last_posted_at: string | null;
      last_edited_at: string | null;
    }>();
  const configured = new Map((rows.results ?? []).map((row) => [row.post_type, row]));
  const states = new Map((stateRows.results ?? []).map((row) => [`${row.post_type}:${row.discord_channel_id}`, row]));
  return {
    post_types: await Promise.all(AUTO_POST_TYPES.map(async (postType) => {
      const row = configured.get(postType);
      const state = row?.discord_channel_id ? states.get(`${postType}:${row.discord_channel_id}`) : undefined;
      let deliveryMode = getPostingDeliveryMode(env, {
        discord_channel_id: row?.discord_channel_id ?? null,
        discord_webhook_url: row?.discord_webhook_url ?? null,
      });
      let permissionMissing: string[] = [];
      let setupWarning = state?.last_error ?? null;
      if (row?.discord_channel_id) {
        const permissionCheck = await checkDiscordPostingPermissions(env, {
          discord_channel_id: row.discord_channel_id,
          discord_webhook_url: row.discord_webhook_url ?? null,
        });
        if (permissionCheck.mode === "bot" || permissionCheck.mode === "webhook" || permissionCheck.mode === "not_configured") {
          deliveryMode = permissionCheck.mode;
        } else {
          deliveryMode = "not_configured";
        }
        permissionMissing = permissionCheck.missing_permissions;
        setupWarning = permissionCheck.ok ? null : state?.last_error ?? permissionCheck.warning;
      }
      const setup = resolvePostingSetup(deliveryMode, row?.discord_channel_id ?? null, Boolean(row?.discord_webhook_url), setupWarning, permissionMissing);
      return {
        post_type: postType,
        allowed: hasAutoPost(planKey, postType),
        locked_message: hasAutoPost(planKey, postType) ? null : lockedMessage(postType),
        discord_channel_id: row?.discord_channel_id ?? null,
        has_webhook_url: Boolean(row?.discord_webhook_url),
        enabled: row ? Number(row.enabled ?? 0) === 1 : false,
        required_feature: row?.required_feature ?? requiredFeatureForPostType(postType),
        min_plan_key: row?.min_plan_key ?? null,
        updated_at: row?.updated_at ?? null,
        delivery_mode: deliveryMode,
        setup_status: setup.status,
        setup_label: setup.label,
        setup_message: setup.message,
        setup_warning: setup.warning,
        missing_permissions: setup.missingPermissions,
        last_error: state?.last_error ?? null,
        last_posted_at: state?.last_posted_at ?? null,
        last_edited_at: state?.last_edited_at ?? null,
      };
    })),
  };
}

async function requireOwnedServer(env: Env, userId: string, linkedServerId: string) {
  return requireDb(env)
    .prepare("SELECT id FROM linked_servers WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(linkedServerId, userId)
    .first<{ id: string }>();
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  return null;
}

function normalizePostType(value: unknown): AutoPostType | null {
  return AUTO_POST_TYPES.includes(value as AutoPostType) ? value as AutoPostType : null;
}

function requiredFeatureForPostType(postType: AutoPostType) {
  if (postType === "basic_status_embed") return "basic_status";
  if (postType === "leaderboard_embed" || postType === "daily_summary_embed") return "leaderboards";
  if (postType === "partner_featured_embed" || postType === "priority_status_embed") return "priority_refresh";
  return "server_vs_server";
}

function lockedMessage(postType: AutoPostType) {
  if (postType === "server_vs_server_embed") return "Upgrade to DZN Network to auto-post server-vs-server competition updates.";
  if (postType === "partner_featured_embed" || postType === "priority_status_embed") return "Upgrade to DZN Partner to unlock priority Discord posting.";
  return "Upgrade your DZN plan to unlock this Discord auto-post.";
}

function resolvePostingSetup(deliveryMode: string, channelId: string | null, hasWebhook: boolean, lastError: string | null, checkedMissingPermissions: string[] = []) {
  const missingPermissions = checkedMissingPermissions.length > 0 ? checkedMissingPermissions : parseMissingPermissions(lastError);
  if (missingPermissions.length > 0 || lastError?.startsWith("DZN cannot auto-post here yet")) {
    return {
      status: "missing_permissions",
      label: "MISSING PERMISSIONS",
      message: "DZN cannot auto-post in this channel yet. Please give the bot View Channel, Send Messages, Embed Links, and Read Message History permissions.",
      warning: lastError,
      missingPermissions: missingPermissions.length > 0 ? missingPermissions : ["View Channel", "Send Messages", "Embed Links", "Read Message History"],
    };
  }
  if (lastError) {
    return {
      status: "setup_needed",
      label: "SETUP NEEDED",
      message: "DZN could not verify this auto-post destination yet. Send a test post or update the channel/webhook settings.",
      warning: lastError,
      missingPermissions: [],
    };
  }
  if (deliveryMode === "bot") {
    return {
      status: "active",
      label: "ACTIVE",
      message: "DZN will auto-post and edit this embed using the bot in the selected channel.",
      warning: null,
      missingPermissions: [],
    };
  }
  if (deliveryMode === "webhook") {
    return {
      status: "active",
      label: "ACTIVE",
      message: "DZN will auto-post using the saved webhook fallback.",
      warning: null,
      missingPermissions: [],
    };
  }
  const warning = channelId && !hasWebhook
    ? "DZN bot mode is not available yet. Check DISCORD_BOT_TOKEN in Cloudflare Pages or add a webhook fallback."
    : "Add a channel ID for bot posting or provide a webhook fallback.";
  return {
    status: "setup_needed",
    label: "SETUP NEEDED",
    message: "Add a Discord channel ID for bot mode or a webhook fallback, then send a test post.",
    warning: lastError ?? warning,
    missingPermissions: [],
  };
}

function parseMissingPermissions(value: string | null) {
  if (!value) return [];
  const match = value.match(/Missing:\s*([^.]*)\./i);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((permission) => permission.trim())
    .filter(Boolean);
}

async function upsertPostingPermissionWarning(env: Env, input: {
  guildId: string;
  postType: AutoPostType;
  channelId: string;
  warning: string | null;
}) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO server_posting_state (
        id, guild_id, post_type, discord_channel_id, discord_message_id, last_posted_at,
        last_edited_at, last_payload_hash, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
      ON CONFLICT(guild_id, post_type, discord_channel_id) DO UPDATE SET
        last_error = excluded.last_error,
        updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), input.guildId, input.postType, input.channelId, input.warning, now, now)
    .run();
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function sanitizeDiscordId(value: unknown) {
  return typeof value === "string" && /^\d{8,32}$/.test(value) ? value : null;
}

function sanitizeWebhookUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "discord.com" && url.pathname.includes("/webhooks/")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
