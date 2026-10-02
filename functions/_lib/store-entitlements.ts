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

function enabled(value: unknown) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}
