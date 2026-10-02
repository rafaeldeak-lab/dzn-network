export type StoreSupporterCard = {
  product_key: string;
  product_name: string;
  granted_at: string;
};

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
