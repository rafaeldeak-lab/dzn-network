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

export type PlayerCabinetVisibilityResult =
  | { status: "updated"; card: PlayerCabinetSupporterCard }
  | { status: "not_owned" }
  | { status: "showcase_full" };

type PlayerCabinetSupporterCardRow = StoreSupporterCard & {
  entitlement_key: string;
  publicly_showcased: number;
};

export const playerCabinetPublicShowcaseLimit = 4;

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
): Promise<PlayerCabinetSupporterCard[]> {
  const result = await db.prepare(`SELECT e.product_key, i.product_name, e.granted_at, e.entitlement_key,
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
    ORDER BY e.granted_at DESC, e.id DESC
    LIMIT 24`).bind(userId, livemode ? 1 : 0).all<PlayerCabinetSupporterCardRow>();
  return (result.results ?? []).map((card) => ({
    product_key: card.product_key,
    product_name: card.product_name,
    granted_at: card.granted_at,
    entitlement_key: card.entitlement_key,
    publicly_showcased: card.publicly_showcased === 1,
  }));
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

  if (publiclyShowcased) {
    const count = await db.prepare(`SELECT COUNT(*) AS count
      FROM player_cabinet_showcase_items c
      JOIN store_commerce_entitlements e
        ON e.purchasing_user_id = c.user_id AND e.entitlement_key = c.entitlement_key
      JOIN store_commerce_orders o ON o.id = e.order_id
      WHERE c.user_id = ?
        AND c.publicly_showcased = 1
        AND c.entitlement_key <> ?
        AND e.status = 'active'
        AND e.fulfilment_kind = 'supporter_card'
        AND o.status = 'fulfilled'
        AND o.livemode = ?`).bind(userId, entitlementKey, livemode ? 1 : 0).first<{ count: number | null }>();
    if (Number(count?.count ?? 0) >= playerCabinetPublicShowcaseLimit) return { status: "showcase_full" };
  }

  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO player_cabinet_showcase_items (
      id, user_id, entitlement_key, publicly_showcased, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, entitlement_key) DO UPDATE SET
      publicly_showcased = excluded.publicly_showcased,
      updated_at = excluded.updated_at`).bind(
    `player_cabinet_${crypto.randomUUID()}`,
    userId,
    entitlementKey,
    publiclyShowcased ? 1 : 0,
    now,
    now,
  ).run();

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
