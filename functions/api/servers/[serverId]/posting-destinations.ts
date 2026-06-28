import { getSessionUser, requireDb } from "../../../_lib/db";
import {
  classifyDiscordPostingError,
  checkDiscordPostingPermissions,
  getPostingDeliveryMode,
  recordDiscordPostingDeliveryState,
  sendDiscordTestPost,
  verifyDiscordPostingChannel,
} from "../../../_lib/discord-posting";
import { ensureAutomationSchema } from "../../../_lib/automation";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { AUTO_POST_OPTIONS, AUTO_POST_TYPES, getListingLimits, hasListingAutoPost, normalizeListingPlanKey } from "../../../_lib/plans";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";
import type { AutoPostType } from "../../../../lib/billing/plans";

type SavePostingDestinationBody = {
  action?: "save" | "test" | "disable" | "delete";
  channel_id?: string;
  post_types?: string[];
  test_post_type?: string;
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

  if (request.method === "GET") {
    const context = await getPostingContextForRead(env, linkedServerId);
    if (!context) return json({ error: "Automation is not ready for this server yet." }, { status: 409 });
    return json(await getPostingDestinationPayload(env, context));
  }
  if (request.method !== "POST") return methodNotAllowed();

  const context = await getPostingContextForRead(env, linkedServerId);
  if (!context) return json({ error: "Automation is not ready for this server yet." }, { status: 409 });

  const body = await readJson<SavePostingDestinationBody>(request);
  if (body.channel_id || Array.isArray(body.post_types) || body.action) {
    return handleGroupedPostingAction(env, context, user, body);
  }

  const postType = normalizePostType(body.post_type);
  if (!postType) return json({ error: "Invalid post type" }, { status: 400 });
  if (!hasListingAutoPost(context, postType)) {
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
      normalizeListingPlanKey(context) === "pro" ? "pro" : "starter",
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
    ...await getPostingDestinationPayload(env, context),
    permission_check: permissionCheck,
    test_post: testResult,
  });
};

async function handleGroupedPostingAction(
  env: Env,
  context: { guildId: string; planKey: string; subscriptionStatus: string },
  user: SessionUser,
  body: SavePostingDestinationBody,
) {
  await ensureAutomationSchema(env);
  const limits = getListingLimits(context);
  const action = body.action ?? "save";
  const channelId = sanitizeDiscordId(body.channel_id ?? body.discord_channel_id);
  if (!channelId) return json({ error: "Discord channel is required." }, { status: 400 });

  if (action === "delete") {
    await requireDb(env)
      .prepare("DELETE FROM server_posting_destinations WHERE guild_id = ? AND discord_channel_id = ?")
      .bind(context.guildId, channelId)
      .run();
    return json(await getPostingDestinationPayload(env, context));
  }

  if (action === "disable") {
    await requireDb(env)
      .prepare("UPDATE server_posting_destinations SET enabled = 0, updated_at = ? WHERE guild_id = ? AND discord_channel_id = ?")
      .bind(new Date().toISOString(), context.guildId, channelId)
      .run();
    return json(await getPostingDestinationPayload(env, context));
  }

  const existingForChannel = await requireDb(env)
    .prepare("SELECT discord_webhook_url FROM server_posting_destinations WHERE guild_id = ? AND discord_channel_id = ? AND discord_webhook_url IS NOT NULL LIMIT 1")
    .bind(context.guildId, channelId)
    .first<{ discord_webhook_url: string | null }>();
  const rawWebhookUrl = typeof body.discord_webhook_url === "string" ? body.discord_webhook_url.trim() : "";
  const webhookUrl = rawWebhookUrl ? sanitizeWebhookUrl(rawWebhookUrl) : existingForChannel?.discord_webhook_url ?? null;
  if (rawWebhookUrl && !webhookUrl) return json({ error: "Invalid Discord webhook URL." }, { status: 400 });

  const permissionCheck = await checkDiscordPostingPermissions(env, {
    discord_channel_id: channelId,
    discord_webhook_url: webhookUrl,
  });
  const verifiedChannel = await verifyDiscordPostingChannel(env, context.guildId, channelId).catch(() => null);
  if (!verifiedChannel && !webhookUrl) {
    return json({
      error: "Choose another channel or add a webhook fallback.",
      permission_check: permissionCheck,
      ...await getPostingDestinationPayload(env, context),
    }, { status: 400 });
  }
  if (permissionCheck.mode === "missing_permissions" && !webhookUrl) {
    return json({
      error: permissionCheck.warning ?? "DZN cannot auto-post in this channel yet.",
      permission_check: permissionCheck,
      ...await getPostingDestinationPayload(env, context),
    }, { status: 400 });
  }

  if (action === "test") {
    const postType = normalizePostType(body.test_post_type ?? body.post_type ?? body.post_types?.[0]);
    if (!postType) return json({ error: "Select a post type to test." }, { status: 400 });
    if (!hasListingAutoPost(context, postType)) return json({ error: "Upgrade required for this Discord auto-post type." }, { status: 403 });
    const testResult = await runPostingTest(env, context.guildId, channelId, postType, webhookUrl, permissionCheck);
    return json({
      ...await getPostingDestinationPayload(env, context),
      permission_check: permissionCheck,
      test_post: testResult,
    });
  }

  const postTypes = normalizePostTypes(body.post_types);
  if (!postTypes.length) return json({ error: "Select at least one auto-post type." }, { status: 400 });
  const locked = postTypes.filter((postType) => !hasListingAutoPost(context, postType));
  if (locked.length > 0) return json({ error: "One or more selected auto-post types are locked by your DZN plan." }, { status: 403 });
  if (limits.discordChannelLimit !== null && await wouldExceedDiscordChannelLimit(env, context.guildId, channelId, limits.discordChannelLimit)) {
    return json({ error: "Free Listing supports one connected Discord auto-post channel. Upgrade to Pro for multiple post-type channels.", code: "CHANNEL_LIMIT" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const db = requireDb(env);
  for (const postType of postTypes) {
    await db
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
        normalizeListingPlanKey(context) === "pro" ? "pro" : "starter",
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
  }

  const placeholders = postTypes.map(() => "?").join(", ");
  await db
    .prepare(`UPDATE server_posting_destinations SET enabled = 0, updated_at = ? WHERE guild_id = ? AND discord_channel_id = ? AND post_type NOT IN (${placeholders})`)
    .bind(now, context.guildId, channelId, ...postTypes)
    .run();

  return json({
    ...await getPostingDestinationPayload(env, context),
    permission_check: permissionCheck,
  });
}

async function runPostingTest(
  env: Env,
  guildId: string,
  channelId: string,
  postType: AutoPostType,
  webhookUrl: string | null,
  permissionCheck: Awaited<ReturnType<typeof checkDiscordPostingPermissions>>,
) {
  const state = await requireDb(env)
    .prepare("SELECT discord_message_id FROM server_posting_state WHERE guild_id = ? AND post_type = ? AND discord_channel_id = ? LIMIT 1")
    .bind(guildId, postType, channelId)
    .first<{ discord_message_id: string | null }>();
  if (permissionCheck.mode === "missing_permissions" && !webhookUrl) {
    return {
      ok: false,
      mode: "missing_permissions",
      error: permissionCheck.warning ?? "DZN cannot auto-post in this channel yet.",
      missing_permissions: permissionCheck.missing_permissions,
    };
  }

  try {
    const delivery = await sendDiscordTestPost(env, {
      guild_id: guildId,
      post_type: postType,
      discord_channel_id: channelId,
      discord_webhook_url: webhookUrl,
    }, state?.discord_message_id ?? null);
    await recordDiscordPostingDeliveryState(env, {
      guild_id: guildId,
      post_type: postType,
      discord_channel_id: channelId,
    }, delivery);
    return { ok: true, mode: delivery.mode };
  } catch (error) {
    const classified = classifyDiscordPostingError(error);
    await upsertPostingPermissionWarning(env, {
      guildId,
      postType,
      channelId,
      warning: classified.warning,
    });
    return {
      ok: false,
      mode: classified.mode,
      error: classified.warning ?? "Discord test post failed.",
      missing_permissions: classified.missing_permissions,
    };
  }
}

async function getPostingDestinationPayload(env: Env, context: { guildId: string; planKey: string; subscriptionStatus: string }) {
  const { guildId } = context;
  const listingPlanKey = normalizeListingPlanKey(context);
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
              , discord_message_id, last_payload_hash, last_dispatch_attempt_at,
                last_dispatch_status, last_dispatch_error
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
      discord_message_id: string | null;
      last_payload_hash: string | null;
      last_dispatch_attempt_at: string | null;
      last_dispatch_status: string | null;
      last_dispatch_error: string | null;
    }>();
  const jobRows = await requireDb(env)
    .prepare(
      `SELECT id, post_type, status, updated_at
       FROM automation_jobs
       WHERE guild_id = ?
         AND job_type = 'discord-post-update'
       ORDER BY updated_at DESC
       LIMIT 40`,
    )
    .bind(guildId)
    .all<{
      id: string;
      post_type: AutoPostType;
      status: string;
      updated_at: string | null;
    }>();
  const configured = new Map((rows.results ?? []).map((row) => [row.post_type, row]));
  const states = new Map((stateRows.results ?? []).map((row) => [`${row.post_type}:${row.discord_channel_id}`, row]));
  const jobsByType = new Map<AutoPostType, Array<{ id: string; status: string; updated_at: string | null }>>();
  for (const row of jobRows.results ?? []) {
    const list = jobsByType.get(row.post_type) ?? [];
    list.push(row);
    jobsByType.set(row.post_type, list);
  }
  const channelNames = new Map((rows.results ?? []).map((row) => [row.discord_channel_id, savedPostingChannel(row.discord_channel_id)]));
  const postTypeSummaries = AUTO_POST_TYPES.map((postType) => {
      const row = configured.get(postType);
      const state = row?.discord_channel_id ? states.get(`${postType}:${row.discord_channel_id}`) : undefined;
      const jobs = jobsByType.get(postType) ?? [];
      let deliveryMode = getPostingDeliveryMode(env, {
        discord_channel_id: row?.discord_channel_id ?? null,
        discord_webhook_url: row?.discord_webhook_url ?? null,
      });
      let permissionMissing: string[] = [];
      const setupWarning = state?.last_error ?? null;
      if (row?.discord_channel_id) {
        permissionMissing = parseMissingPermissions(state?.last_error ?? null);
        if (permissionMissing.length > 0 && !row.discord_webhook_url) {
          deliveryMode = "not_configured";
        }
      }
      const setup = resolvePostingSetup(deliveryMode, row?.discord_channel_id ?? null, Boolean(row?.discord_webhook_url), setupWarning, permissionMissing);
      return {
        post_type: postType,
        allowed: hasListingAutoPost(context, postType),
        locked_message: hasListingAutoPost(context, postType) ? null : lockedMessage(postType),
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
        discord_message_id: state?.discord_message_id ?? null,
        last_payload_hash: state?.last_payload_hash ?? null,
        last_dispatch_attempt_at: state?.last_dispatch_attempt_at ?? null,
        last_dispatch_status: state?.last_dispatch_status ?? (jobs.some((job) => job.status === "queued") ? "queued" : null),
        last_dispatch_error: state?.last_dispatch_error ?? null,
        queued_job_count: jobs.filter((job) => job.status === "queued").length,
        latest_automation_job_id: jobs[0]?.id ?? null,
      };
    });
  const summariesByType = new Map(postTypeSummaries.map((summary) => [summary.post_type, summary]));
  const groupedRows = new Map<string, typeof postTypeSummaries>();
  for (const row of rows.results ?? []) {
    const summary = summariesByType.get(row.post_type);
    if (!summary) continue;
    const list = groupedRows.get(row.discord_channel_id) ?? [];
    list.push(summary);
    groupedRows.set(row.discord_channel_id, list);
  }

  return {
    post_type_options: AUTO_POST_OPTIONS.map((option) => ({
      ...option,
      allowed_by_plan: hasListingAutoPost(context, option.key),
      listing_plan_key: listingPlanKey,
    })),
    post_types: postTypeSummaries,
    setups: [...groupedRows.entries()].map(([channelId, postTypes]) => {
      const channel = channelNames.get(channelId);
      const missingPermissions = [...new Set(postTypes.flatMap((postType) => postType.missing_permissions ?? []))];
      const anyEnabled = postTypes.some((postType) => postType.enabled);
      const anyLocked = postTypes.some((postType) => !postType.allowed);
      const mode = postTypes.some((postType) => postType.delivery_mode === "bot")
        ? "bot"
        : postTypes.some((postType) => postType.delivery_mode === "webhook")
          ? "webhook"
          : "not_configured";
      const setupStatus = missingPermissions.length > 0
        ? "missing_permissions"
        : !anyEnabled
          ? "disabled"
          : anyLocked
            ? "locked_by_plan"
            : postTypes.some((postType) => postType.setup_status === "active")
              ? "active"
              : "setup_needed";
      return {
        channel_id: channelId,
        channel_name: channel?.channel_name ?? "Unknown channel",
        channel_label: channel?.category_name ? `${channel.category_name} / #${channel.channel_name}` : `# ${channel?.channel_name ?? channelId}`,
        posting_mode: mode,
        status: setupStatus,
        missing_permissions: missingPermissions,
        has_webhook_url: postTypes.some((postType) => postType.has_webhook_url),
        last_posted_at: latestString(postTypes.map((postType) => postType.last_posted_at)),
        last_edited_at: latestString(postTypes.map((postType) => postType.last_edited_at)),
        post_types: postTypes.map((postType) => ({
          key: postType.post_type,
          label: labelForPostType(postType.post_type),
          enabled: postType.enabled,
          allowed_by_plan: postType.allowed,
          setup_status: postType.setup_status,
          guild_id: guildId,
          discord_channel_id: channelId,
          discord_message_id: postType.discord_message_id,
          posting_mode: postType.delivery_mode,
          last_payload_hash: postType.last_payload_hash,
          last_posted_at: postType.last_posted_at,
          last_edited_at: postType.last_edited_at,
          last_dispatch_attempt_at: postType.last_dispatch_attempt_at,
          last_dispatch_status: postType.last_dispatch_status,
          last_dispatch_error: postType.last_dispatch_error,
          queued_job_count: postType.queued_job_count,
          latest_automation_job_id: postType.latest_automation_job_id,
        })),
      };
    }),
  };
}

async function getPostingContextForRead(env: Env, linkedServerId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT linked_servers.guild_id,
              COALESCE(server_subscriptions.plan_key, 'free') AS plan_key,
              server_subscriptions.status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ guild_id: string | null; plan_key: string | null; status: string | null }>();
  if (!row?.guild_id) return null;
  return {
    guildId: row.guild_id,
    planKey: row.plan_key ?? "free",
    subscriptionStatus: row.status ?? "inactive",
  };
}

function savedPostingChannel(channelId: string) {
  return {
    channel_id: channelId,
    channel_name: `saved-${channelId.slice(-4)}`,
    category_name: null,
  };
}

async function wouldExceedDiscordChannelLimit(env: Env, guildId: string, nextChannelId: string, limit: number) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT DISTINCT discord_channel_id
         FROM server_posting_destinations
        WHERE guild_id = ?
          AND COALESCE(enabled, 1) = 1
          AND discord_channel_id IS NOT NULL`,
    )
    .bind(guildId)
    .all<{ discord_channel_id: string | null }>();
  const channelIds = new Set((rows.results ?? []).map((row) => row.discord_channel_id).filter((value): value is string => Boolean(value)));
  channelIds.add(nextChannelId);
  return channelIds.size > limit;
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

function normalizePostTypes(value: unknown): AutoPostType[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizePostType).filter((postType): postType is AutoPostType => Boolean(postType)))];
}

function labelForPostType(postType: AutoPostType) {
  return AUTO_POST_OPTIONS.find((option) => option.key === postType)?.label
    ?? postType.replace(/_embed$/, "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function latestString(values: Array<string | null | undefined>) {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return timestamps[0] ?? null;
}

function requiredFeatureForPostType(postType: AutoPostType) {
  if (postType === "basic_status_embed") return "basic_status";
  if (postType === "leaderboard_embed" || postType === "daily_summary_embed") return "leaderboards";
  if (postType === "partner_featured_embed" || postType === "priority_status_embed") return "priority_refresh";
  return "server_vs_server";
}

function lockedMessage(postType: AutoPostType) {
  if (postType === "server_vs_server_embed") return "Upgrade to Pro to auto-post server-vs-server competition updates.";
  if (postType === "partner_featured_embed" || postType === "priority_status_embed") return "Upgrade to Pro to unlock priority Discord posting.";
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
