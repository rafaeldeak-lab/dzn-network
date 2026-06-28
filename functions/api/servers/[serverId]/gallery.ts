import { getSessionUser, requireDb } from "../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { canUseProFeature, getListingLimits } from "../../../_lib/plans";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type GalleryImageInput = {
  url?: unknown;
  storagePath?: unknown;
  width?: unknown;
  height?: unknown;
  sizeBytes?: unknown;
  mimeType?: unknown;
  sortOrder?: unknown;
};

type NormalizedGalleryImage = {
  url: string;
  storagePath: string | null;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
  sortOrder: number;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET" && request.method !== "PUT") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  await ensureGallerySchema(env);
  const server = await getOwnedServer(env, user, linkedServerId);
  if (!server) return json({ error: "Server not found" }, { status: 404 });

  if (request.method === "GET") {
    const images = await listGalleryImages(env, linkedServerId);
    return json({
      ok: true,
      images,
      listing: getListingLimits(server),
      canPublishGallery: canUseProFeature(server, "gallery_images"),
    });
  }

  if (!canUseProFeature(server, "gallery_images")) {
    return json({ error: "Pro Listing is required to publish gallery images.", code: "PRO_REQUIRED" }, { status: 403 });
  }

  const limits = getListingLimits(server);
  const body = await readJson<{ images?: GalleryImageInput[] }>(request);
  if (!Array.isArray(body.images)) return json({ error: "Images must be an array." }, { status: 400 });
  if (body.images.length > limits.galleryLimit) {
    return json({ error: `Pro Listing supports up to ${limits.galleryLimit} gallery images.`, code: "GALLERY_LIMIT" }, { status: 400 });
  }

  const normalized: NormalizedGalleryImage[] = [];
  for (const [index, image] of body.images.entries()) {
    const parsed = normalizeGalleryImage(image, index, limits);
    if (!parsed) {
      return json({ error: "Gallery images must be HTTPS JPEG files, 16:9, and 2MB or smaller.", code: "INVALID_IMAGE" }, { status: 400 });
    }
    normalized.push(parsed);
  }

  const db = requireDb(env);
  const now = new Date().toISOString();
  await db.prepare("DELETE FROM server_gallery_images WHERE server_id = ?").bind(linkedServerId).run();
  for (const image of normalized) {
    await db.prepare(
      `INSERT INTO server_gallery_images (
        id, server_id, url, storage_path, width, height, size_bytes, mime_type,
        sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      linkedServerId,
      image.url,
      image.storagePath,
      image.width,
      image.height,
      image.sizeBytes,
      image.mimeType,
      image.sortOrder,
      now,
      now,
    ).run();
  }

  return json({ ok: true, images: await listGalleryImages(env, linkedServerId), listing: limits });
};

async function ensureGallerySchema(env: Env) {
  const db = requireDb(env);
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS server_gallery_images (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      url TEXT NOT NULL,
      storage_path TEXT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_gallery_images_server_sort ON server_gallery_images(server_id, sort_order, created_at)").run();
}

async function getOwnedServer(env: Env, user: SessionUser, linkedServerId: string) {
  return requireDb(env).prepare(
    `SELECT linked_servers.id, linked_servers.user_id,
            COALESCE(server_subscriptions.plan_key, 'free') AS plan_key,
            server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
      WHERE linked_servers.id = ?
        AND linked_servers.user_id = ?
        AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
        AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
      LIMIT 1`,
  ).bind(linkedServerId, user.id).first<{ id: string; user_id: string; plan_key: string | null; subscription_status: string | null }>();
}

async function listGalleryImages(env: Env, linkedServerId: string) {
  const rows = await requireDb(env).prepare(
    `SELECT id, url, storage_path, width, height, size_bytes, mime_type, sort_order, created_at, updated_at
       FROM server_gallery_images
      WHERE server_id = ?
      ORDER BY sort_order ASC, created_at ASC`,
  ).bind(linkedServerId).all<Record<string, unknown>>();
  return (rows.results ?? []).map((row) => ({
    id: String(row.id),
    url: String(row.url),
    storagePath: typeof row.storage_path === "string" ? row.storage_path : null,
    width: Number(row.width ?? 0),
    height: Number(row.height ?? 0),
    sizeBytes: Number(row.size_bytes ?? 0),
    mimeType: String(row.mime_type ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  }));
}

function normalizeGalleryImage(image: GalleryImageInput, index: number, limits: ReturnType<typeof getListingLimits>): NormalizedGalleryImage | null {
  const url = sanitizeHttpsUrl(image.url);
  const storagePath = typeof image.storagePath === "string" ? image.storagePath.trim().slice(0, 500) : null;
  const width = Number(image.width);
  const height = Number(image.height);
  const sizeBytes = Number(image.sizeBytes);
  const mimeType = String(image.mimeType ?? "").trim().toLowerCase();
  const sortOrder = Number.isFinite(Number(image.sortOrder)) ? Number(image.sortOrder) : index;
  const aspect = width > 0 && height > 0 ? width / height : 0;
  const expected = limits.galleryRecommendedWidth / limits.galleryRecommendedHeight;
  if (!url || !limits.galleryAllowedMimeTypes.includes(mimeType)) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > limits.galleryMaxFileSizeBytes) return null;
  if (Math.abs(aspect - expected) > 0.025) return null;
  return { url, storagePath, width, height, sizeBytes, mimeType, sortOrder };
}

function sanitizeHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}
