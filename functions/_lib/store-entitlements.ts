export type StoreSupporterCard = {
  product_key: string;
  product_name: string;
  granted_at: string;
};

export type PrivateStoreSupporterCard = StoreSupporterCard & {
  order_number: string;
  receipt_number: string;
  receipt_status: "issued";
};

export type PlayerCabinetSupporterCard = StoreSupporterCard & {
  entitlement_key: string;
  publicly_showcased: boolean;
};

export type PlayerCabinetCardsPage = {
  cards: PlayerCabinetSupporterCard[];
  next_cursor: string | null;
  selected_count: number;
};

export type PlayerCabinetCursor = {
  publicly_showcased: 0 | 1;
  granted_at: string;
  entitlement_id: string;
};

export type PlayerCabinetVisibilityResult =
  | { status: "updated"; card: PlayerCabinetSupporterCard }
  | { status: "not_owned" }
  | { status: "showcase_full" };

type PlayerCabinetSupporterCardRow = StoreSupporterCard & {
  entitlement_id: string;
  entitlement_key: string;
  publicly_showcased: number;
};

export const playerCabinetPublicShowcaseLimit = 4;
const playerCabinetPageSize = 24;

export function privateSupporterCardsEnabled(env: Record<string, unknown>) {
  return enabled(env.DZN_STORE_ENABLED)
    && enabled(env.DZN_STORE_COMMERCE_ENABLED)
    && enabled(env.DZN_SUPPORTER_CARDS_PRIVATE_ENABLED);
}

export function configuredStoreLivemode(env: Record<string, unknown>): boolean | null {
  const secret = typeof env.STRIPE_SECRET_KEY === "string" ? env.STRIPE_SECRET_KEY.trim() : "";
  if (secret.startsWith("sk_live_")) return true;
  if (secret.startsWith("sk_test_")) return false;
  return null;
}

export async function readActiveStoreSupporterCards(
  db: D1Database,
  userId: string,
  livemode: boolean,
): Promise<StoreSupporterCard[]> {
  try {
    const result = await db.prepare(`SELECT e.product_key, i.product_name, e.granted_at
      FROM store_commerce_entitlements e
      JOIN store_commerce_order_items i ON i.order_id = e.order_id
      JOIN store_commerce_orders o ON o.id = e.order_id
      WHERE e.purchasing_user_id = ? AND e.status = 'active' AND e.fulfilment_kind = 'supporter_card'
        AND o.livemode = ?
      ORDER BY e.granted_at DESC, e.id DESC LIMIT 12`).bind(userId, livemode ? 1 : 0).all<StoreSupporterCard>();
    return result.results ?? [];
  } catch (error) {
    if (error instanceof Error && /no such table: store_commerce_(?:entitlements|order_items)/i.test(error.message)) return [];
    throw error;
  }
}

export async function readPrivateStoreSupporterCards(
  db: D1Database,
  userId: string,
  livemode: boolean,
): Promise<PrivateStoreSupporterCard[]> {
  const result = await db.prepare(`SELECT e.product_key, i.product_name, e.granted_at,
      o.order_number, r.receipt_number, r.status AS receipt_status
    FROM store_commerce_entitlements e
    JOIN store_commerce_order_items i ON i.order_id = e.order_id
    JOIN store_commerce_orders o ON o.id = e.order_id
    JOIN store_commerce_receipts r ON r.order_id = e.order_id
      AND r.purchasing_user_id = e.purchasing_user_id
    WHERE e.purchasing_user_id = ?
      AND o.purchasing_user_id = ?
      AND e.status = 'active'
      AND e.fulfilment_kind = 'supporter_card'
      AND o.status = 'fulfilled'
      AND o.livemode = ?
      AND r.status = 'issued'
    ORDER BY e.granted_at DESC, e.id DESC
    LIMIT 12`).bind(userId, userId, livemode ? 1 : 0).all<PrivateStoreSupporterCard>();
  return result.results ?? [];
}

export async function readPlayerCabinetSupporterCards(
  db: D1Database,
  userId: string,
  livemode: boolean,
  cursor: PlayerCabinetCursor | null = null,
): Promise<PlayerCabinetCardsPage> {
  const afterCursor = cursor
    ? `AND (
        COALESCE(c.publicly_showcased, 0) < ?
        OR (COALESCE(c.publicly_showcased, 0) = ? AND e.granted_at < ?)
        OR (COALESCE(c.publicly_showcased, 0) = ? AND e.granted_at = ? AND e.id < ?)
      )`
    : "";
  const statements = [
    db.prepare(`SELECT e.id AS entitlement_id, e.product_key, i.product_name, e.granted_at, e.entitlement_key,
      COALESCE(c.publicly_showcased, 0) AS publicly_showcased
    FROM store_commerce_entitlements e
    JOIN store_commerce_order_items i ON i.order_id = e.order_id
    JOIN store_commerce_orders o ON o.id = e.order_id
    LEFT JOIN player_cabinet_showcase_items c
      ON c.user_id = e.purchasing_user_id AND c.entitlement_key = e.entitlement_key
    WHERE e.purchasing_user_id = ?
      AND e.status = 'active'
      AND e.fulfilment_kind = 'supporter_card'
      AND o.status = 'fulfilled'
      AND o.livemode = ?
    ${afterCursor}
    ORDER BY COALESCE(c.publicly_showcased, 0) DESC, e.granted_at DESC, e.id DESC
    LIMIT ?`),
    db.prepare(`SELECT COUNT(*) AS count
      FROM player_cabinet_showcase_items c
      JOIN store_commerce_entitlements e
        ON e.purchasing_user_id = c.user_id AND e.entitlement_key = c.entitlement_key
      JOIN store_commerce_orders o ON o.id = e.order_id
      WHERE c.user_id = ?
        AND c.publicly_showcased = 1
        AND e.status = 'active'
        AND e.fulfilment_kind = 'supporter_card'
        AND o.status = 'fulfilled'
        AND o.livemode = ?`),
  ];
  const cursorBindings = cursor
    ? [cursor.publicly_showcased, cursor.publicly_showcased, cursor.granted_at, cursor.publicly_showcased, cursor.granted_at, cursor.entitlement_id]
    : [];
  const [result, selected] = await Promise.all([
    statements[0].bind(userId, livemode ? 1 : 0, ...cursorBindings, playerCabinetPageSize + 1).all<PlayerCabinetSupporterCardRow>(),
    statements[1].bind(userId, livemode ? 1 : 0).first<{ count: number | null }>(),
  ]);
  const rows = result.results ?? [];
  const pageRows = rows.slice(0, playerCabinetPageSize);
  const cards = pageRows.map((card) => ({
    product_key: card.product_key,
    product_name: card.product_name,
    granted_at: card.granted_at,
    entitlement_key: card.entitlement_key,
    publicly_showcased: card.publicly_showcased === 1,
  }));
  const last = pageRows.at(-1);
  return {
    cards,
    selected_count: Number(selected?.count ?? 0),
    next_cursor: rows.length > playerCabinetPageSize && last
      ? encodePlayerCabinetCursor(last)
      : null,
  };
}

export function parsePlayerCabinetCursor(value: string | null): PlayerCabinetCursor | null {
  if (!value) return null;
  const [publiclyShowcased, grantedAt, entitlementId, ...extra] = value.split("|");
  if (extra.length || (publiclyShowcased !== "0" && publiclyShowcased !== "1")) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(grantedAt)) return null;
  if (!/^[a-z0-9_-]{6,240}$/i.test(entitlementId)) return null;
  return {
    publicly_showcased: publiclyShowcased === "1" ? 1 : 0,
    granted_at: grantedAt,
    entitlement_id: entitlementId,
  };
}

function encodePlayerCabinetCursor(card: PlayerCabinetSupporterCardRow) {
  return `${card.publicly_showcased === 1 ? 1 : 0}|${card.granted_at}|${card.entitlement_id}`;
}

export async function setPlayerCabinetSupporterCardVisibility(
  db: D1Database,
  userId: string,
  livemode: boolean,
  entitlementKey: string,
  publiclyShowcased: boolean,
): Promise<PlayerCabinetVisibilityResult> {
  const owned = await db.prepare(`SELECT e.product_key, i.product_name, e.granted_at, e.entitlement_key
    FROM store_commerce_entitlements e
    JOIN store_commerce_order_items i ON i.order_id = e.order_id
    JOIN store_commerce_orders o ON o.id = e.order_id
    WHERE e.purchasing_user_id = ?
      AND e.entitlement_key = ?
      AND e.status = 'active'
      AND e.fulfilment_kind = 'supporter_card'
      AND o.status = 'fulfilled'
      AND o.livemode = ?
    LIMIT 1`).bind(userId, entitlementKey, livemode ? 1 : 0).first<StoreSupporterCard & { entitlement_key: string }>();
  if (!owned) return { status: "not_owned" };

  const now = new Date().toISOString();
  if (publiclyShowcased) {
    const result = await db.prepare(`INSERT INTO player_cabinet_showcase_items (
      id, user_id, entitlement_key, publicly_showcased, created_at, updated_at
    ) SELECT ?, ?, ?, 1, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM store_commerce_entitlements e
      JOIN store_commerce_orders o ON o.id = e.order_id
      WHERE e.purchasing_user_id = ?
        AND e.entitlement_key = ?
        AND e.status = 'active'
        AND e.fulfilment_kind = 'supporter_card'
        AND o.status = 'fulfilled'
        AND o.livemode = ?
    ) AND (
      EXISTS (
        SELECT 1 FROM player_cabinet_showcase_items
        WHERE user_id = ? AND entitlement_key = ? AND publicly_showcased = 1
      ) OR (
        SELECT COUNT(*) FROM player_cabinet_showcase_items c
        JOIN store_commerce_entitlements e
          ON e.purchasing_user_id = c.user_id AND e.entitlement_key = c.entitlement_key
        JOIN store_commerce_orders o ON o.id = e.order_id
        WHERE c.user_id = ?
          AND c.publicly_showcased = 1
          AND c.entitlement_key <> ?
          AND e.status = 'active'
          AND e.fulfilment_kind = 'supporter_card'
          AND o.status = 'fulfilled'
          AND o.livemode = ?
      ) < ?
    )
    ON CONFLICT(user_id, entitlement_key) DO UPDATE SET
      publicly_showcased = excluded.publicly_showcased,
      updated_at = excluded.updated_at`).bind(
      `player_cabinet_${crypto.randomUUID()}`,
      userId,
      entitlementKey,
      now,
      now,
      userId,
      entitlementKey,
      livemode ? 1 : 0,
      userId,
      entitlementKey,
      userId,
      entitlementKey,
      livemode ? 1 : 0,
      playerCabinetPublicShowcaseLimit,
    ).run();
    if (Number(result.meta.changes ?? 0) < 1) return { status: "showcase_full" };
  } else {
    await db.prepare(`INSERT INTO player_cabinet_showcase_items (
      id, user_id, entitlement_key, publicly_showcased, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, entitlement_key) DO UPDATE SET
      publicly_showcased = excluded.publicly_showcased,
      updated_at = excluded.updated_at`).bind(
    `player_cabinet_${crypto.randomUUID()}`,
    userId,
    entitlementKey,
      0,
    now,
    now,
  ).run();
  }

  return {
    status: "updated",
    card: { ...owned, publicly_showcased: publiclyShowcased },
  };
}

export async function readPublicSelectedStoreSupporterCards(
  db: D1Database,
  userId: string,
  livemode: boolean,
): Promise<StoreSupporterCard[]> {
  try {
    const result = await db.prepare(`SELECT e.product_key, i.product_name, e.granted_at
      FROM player_cabinet_showcase_items c
      JOIN store_commerce_entitlements e
        ON e.purchasing_user_id = c.user_id AND e.entitlement_key = c.entitlement_key
      JOIN store_commerce_order_items i ON i.order_id = e.order_id
      JOIN store_commerce_orders o ON o.id = e.order_id
      WHERE c.user_id = ?
        AND c.publicly_showcased = 1
        AND e.status = 'active'
        AND e.fulfilment_kind = 'supporter_card'
        AND o.status = 'fulfilled'
        AND o.livemode = ?
      ORDER BY c.updated_at DESC, e.granted_at DESC, e.id DESC
      LIMIT ?`).bind(userId, livemode ? 1 : 0, playerCabinetPublicShowcaseLimit).all<StoreSupporterCard>();
    return result.results ?? [];
  } catch (error) {
    if (error instanceof Error && /no such table:\s*player_cabinet_showcase_items/i.test(error.message)) return [];
    throw error;
  }
}

function enabled(value: unknown) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}
