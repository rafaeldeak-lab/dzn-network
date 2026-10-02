import { requireDb } from "./db";
import { getAppUrl, stripeFormRequest, stripeGetRequest, stripeId, type StripeEvent } from "./stripe";
import type { Env, SessionUser } from "./types";

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const REQUEST_KEY = /^[A-Za-z0-9_-]{12,128}$/;
const STRIPE_PRICE = /^price_[A-Za-z0-9_]{3,122}$/;
const STRIPE_SESSION = /^cs_(?:test_|live_)?[A-Za-z0-9_]+$/;

type PublicationRow = {
  publication_id: string;
  product_id: string;
  price_id: string;
  stripe_price_id: string;
  stock_mode: "unlimited" | "finite";
  stock_limit: number | null;
  reserved_quantity: number;
  sold_quantity: number;
  lifetime_limit_per_account: number;
  product_key: string;
  name: string;
  description: string;
  product_type: string;
  fulfilment_kind: string;
  unit_amount_minor: number;
};

type OrderRow = {
  id: string;
  order_number: string;
  purchasing_user_id: string;
  publication_id: string;
  request_key: string;
  status: string;
  stripe_mode: "test" | "live";
  livemode: number;
  currency: string;
  total_amount_minor: number;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  reservation_expires_at: string;
};

type CheckoutSession = {
  id: string;
  url: string | null;
  status?: string;
  mode?: string;
  livemode?: boolean;
  client_reference_id?: string | null;
  payment_intent?: string | { id?: string } | null;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  expires_at?: number;
  metadata?: Record<string, string | null> | null;
};

export type StoreCommerceOptions = {
  createCheckout?: (params: Record<string, string | number>, idempotencyKey: string) => Promise<CheckoutSession>;
  retrieveCheckout?: (sessionId: string) => Promise<CheckoutSession>;
  now?: Date;
  createId?: () => string;
};

type StoreStripePrice = { id: string; active?: boolean; currency?: string; unit_amount?: number | null; livemode?: boolean; type?: string };
type StorePublishOptions = { retrievePrice?: (priceId: string) => Promise<StoreStripePrice> };
type ExistingPublication = {
  id: string;
  stripe_price_id: string;
  status: string;
  active: number;
  stock_mode: string;
  stock_limit: number | null;
  lifetime_limit_per_account: number;
};

export function storeCommerceFlags(env: Env) {
  const values = env as unknown as Record<string, unknown>;
  return {
    store: flag(values.DZN_STORE_ENABLED),
    admin: flag(values.DZN_STORE_ADMIN_ENABLED),
    commerce: flag(values.DZN_STORE_COMMERCE_ENABLED),
    publicCatalog: flag(values.DZN_STORE_PUBLIC_ENABLED),
    checkout: flag(values.DZN_STORE_CHECKOUT_ENABLED),
    liveCheckout: flag(values.DZN_STORE_LIVE_CHECKOUT_ENABLED),
  };
}

export async function publishStoreProduct(
  env: Env,
  actor: SessionUser,
  input: { productId?: unknown; priceId?: unknown; stripePriceId?: unknown; stockLimit?: unknown; lifetimeLimit?: unknown; publish?: unknown },
  options: StorePublishOptions = {},
) {
  const flags = storeCommerceFlags(env);
  if (!flags.store || !flags.admin || !flags.commerce) return failure(404, "STORE_COMMERCE_DISABLED", "Store commerce management is not enabled.");
  const productId = identifier(input.productId);
  const priceId = identifier(input.priceId);
  const stripePriceId = text(input.stripePriceId);
  const stockLimit = optionalInteger(input.stockLimit, 1, 1_000_000);
  const suppliedLifetimeLimit = input.lifetimeLimit !== undefined && input.lifetimeLimit !== null && input.lifetimeLimit !== "";
  const lifetimeLimit = suppliedLifetimeLimit ? optionalInteger(input.lifetimeLimit, 1, 1000) : 1;
  const active = flag(input.publish);
  if (!productId || !priceId || !stripePriceId || !STRIPE_PRICE.test(stripePriceId) || lifetimeLimit === null) {
    return failure(400, "INVALID_PUBLICATION", "Choose a valid draft, Stripe Price, stock limit, and purchase limit.");
  }
  if (input.stockLimit !== undefined && input.stockLimit !== null && stockLimit === null) {
    return failure(400, "INVALID_STOCK_LIMIT", "Stock must be unlimited or a whole number between 1 and 1000000.");
  }
  const id = `store_publication_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    const draftPrice = await requireDb(env).prepare("SELECT currency, unit_amount_minor FROM store_prices WHERE id = ? AND product_id = ?")
      .bind(priceId, productId).first<{ currency: string; unit_amount_minor: number }>();
    if (!draftPrice) return failure(404, "DRAFT_NOT_FOUND", "The Store draft price could not be found.");
    const retrievePrice = options.retrievePrice ?? ((providerId) => stripeGetRequest<StoreStripePrice>(env, `/prices/${encodeURIComponent(providerId)}`));
    let providerPrice: StoreStripePrice;
    try { providerPrice = await retrievePrice(stripePriceId); }
    catch { return failure(503, "STRIPE_PRICE_UNAVAILABLE", "The Stripe Price could not be verified. Nothing was published."); }
    const key = text((env as unknown as Record<string, unknown>).STRIPE_SECRET_KEY);
    const expectedLive = key?.startsWith("sk_live_") === true;
    if (providerPrice.id !== stripePriceId || providerPrice.active !== true || providerPrice.currency?.toLowerCase() !== draftPrice.currency ||
      providerPrice.unit_amount !== draftPrice.unit_amount_minor || providerPrice.type !== "one_time" || providerPrice.livemode !== expectedLive) {
      return failure(422, "STRIPE_PRICE_MISMATCH", "The Stripe Price must be active, one-time, in GBP, and exactly match the reviewed draft and Stripe mode.");
    }
    const db = requireDb(env);
    const existing = await db.prepare(`SELECT id, stripe_price_id, status, active, stock_mode, stock_limit,
      lifetime_limit_per_account FROM store_catalog_publications WHERE product_id = ? AND price_id = ? LIMIT 1`)
      .bind(productId, priceId).first<ExistingPublication>();
    if (existing) {
      const requestedStockMode = stockLimit === null ? "unlimited" : "finite";
      const sameContract = existing.stripe_price_id === stripePriceId && existing.stock_mode === requestedStockMode
        && existing.stock_limit === stockLimit && existing.lifetime_limit_per_account === lifetimeLimit;
      if (!sameContract) return failure(409, "PUBLICATION_CONTRACT_CHANGED", "The approved publication cannot be changed. Archive it through a separately audited owner action.");
      if (!active || existing.active === 1 || existing.status !== "approved") {
        return failure(409, "PUBLICATION_EXISTS", "That Store publication already exists in its current state.");
      }
      const activated = await db.prepare(`UPDATE store_catalog_publications
        SET status = 'published', active = 1, published_at = ?, updated_at = ?
        WHERE id = ? AND status = 'approved' AND active = 0`)
        .bind(now, now, existing.id).run();
      if (changes(activated) !== 1) return failure(409, "PUBLICATION_STATE_CHANGED", "The publication changed before it could be activated.");
      return { ok: true as const, status: 200 as const,
        publication: { id: existing.id, productId, priceId, active: true, stockLimit, lifetimeLimit } };
    }
    await db.prepare(`INSERT INTO store_catalog_publications (
      id, product_id, price_id, stripe_price_id, status, active, stock_mode, stock_limit,
      lifetime_limit_per_account, published_by_user_id, published_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, productId, priceId, stripePriceId, active ? "published" : "approved", active ? 1 : 0,
        stockLimit === null ? "unlimited" : "finite", stockLimit, lifetimeLimit, actor.id, active ? now : null, now, now).run();
    return { ok: true as const, status: 201 as const, publication: { id, productId, priceId, active, stockLimit, lifetimeLimit } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) return failure(409, "PUBLICATION_EXISTS", "That draft or Stripe Price is already published.");
    return failure(422, "PUBLICATION_REJECTED", "The draft did not satisfy the Store publication safety contract.");
  }
}

export async function listPublishedStore(env: Env) {
  const flags = storeCommerceFlags(env);
  if (!flags.store || !flags.commerce || !flags.publicCatalog) return failure(404, "STORE_NOT_AVAILABLE", "The Store is not open yet.");
  const db = requireDb(env);
  await expireAbandonedStoreOrders(db, new Date());
  const result = await db.prepare(`SELECT
      pub.id AS publication_id, p.product_key, p.name, p.description, p.product_type, p.fulfilment_kind,
      pr.currency, pr.unit_amount_minor, pub.stock_mode, pub.stock_limit, pub.reserved_quantity,
      pub.sold_quantity, pub.lifetime_limit_per_account
    FROM store_catalog_publications pub
    JOIN store_products p ON p.id = pub.product_id
    JOIN store_prices pr ON pr.id = pub.price_id
    WHERE pub.active = 1 AND pub.status = 'published'
      AND (pub.stock_mode = 'unlimited' OR pub.reserved_quantity + pub.sold_quantity < pub.stock_limit)
    ORDER BY pub.published_at DESC, pub.id DESC`).all();
  return { ok: true as const, status: 200 as const, products: result.results ?? [], checkoutEnabled: checkoutAccess(env).ok };
}

export async function createOrResumeStoreCheckout(
  env: Env,
  request: Request,
  user: SessionUser,
  input: { publicationId?: unknown; requestKey?: unknown },
  options: StoreCommerceOptions = {},
) {
  const access = checkoutAccess(env);
  if (!access.ok) return access;
  const publicationId = identifier(input.publicationId);
  const requestKey = text(input.requestKey);
  if (!publicationId || !requestKey || !REQUEST_KEY.test(requestKey)) return failure(400, "INVALID_ORDER_REQUEST", "Choose a valid product and retry key.");
  const db = requireDb(env);
  const now = options.now ?? new Date();
  await expireAbandonedStoreOrders(db, now);
  let order = await db.prepare("SELECT * FROM store_commerce_orders WHERE purchasing_user_id = ? AND request_key = ? LIMIT 1")
    .bind(user.id, requestKey).first<OrderRow>();
  if (order?.stripe_checkout_session_id && order.status === "checkout_ready") return resumeCheckout(env, order, options);
  if (order && order.status !== "checkout_pending") {
    return failure(409, "ORDER_EXPIRED", "That checkout attempt has ended. Start a new checkout for the item.");
  }

  if (!order) {
    const publication = await readPublication(db, publicationId, true);
    if (!publication) return failure(404, "PRODUCT_NOT_AVAILABLE", "That Store item is not currently available.");
    const purchased = await db.prepare(`SELECT COUNT(*) AS total FROM store_commerce_orders
      WHERE purchasing_user_id = ? AND publication_id = ? AND status IN (
        'checkout_pending','checkout_ready','paid','fulfilment_pending','fulfilled','disputed','manual_review'
      )`)
      .bind(user.id, publicationId).first<{ total: number }>();
    if (Number(purchased?.total ?? 0) >= publication.lifetime_limit_per_account) {
      return failure(409, "PURCHASE_LIMIT_REACHED", "This account has already reached the purchase limit for that item.");
    }
    const orderId = `store_order_${createId(options)}`;
    const itemId = `store_item_${createId(options)}`;
    const orderNumber = `DZN-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${createId(options).slice(0, 10).toUpperCase()}`;
    const snapshot = JSON.stringify({ productKey: publication.product_key, name: publication.name,
      productType: publication.product_type, fulfilmentKind: publication.fulfilment_kind,
      publicationId, accountBound: true, noCompetitiveAdvantage: true });
    try {
      const writes = await db.batch([
        db.prepare(`INSERT INTO store_commerce_orders (id, order_number, purchasing_user_id, publication_id,
          request_key, status, stripe_mode, livemode, subtotal_amount_minor, tax_amount_minor,
          total_amount_minor, immutable_item_snapshot_json, reservation_expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'checkout_pending', ?, ?, ?, 0, ?, ?, ?, ?, ?)`)
          .bind(orderId, orderNumber, user.id, publicationId, requestKey, access.mode, access.livemode ? 1 : 0,
            publication.unit_amount_minor, publication.unit_amount_minor, snapshot,
            new Date(now.getTime() + 30 * 60 * 1000).toISOString(), now.toISOString(), now.toISOString()),
        db.prepare(`INSERT INTO store_commerce_order_items (id, order_id, product_id, price_id, product_key,
          product_name, fulfilment_kind, unit_amount_minor, total_amount_minor)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(itemId, orderId, publication.product_id, publication.price_id, publication.product_key,
            publication.name, publication.fulfilment_kind, publication.unit_amount_minor, publication.unit_amount_minor),
      ]);
      if (writes.some((result) => !result.success)) throw new Error("Store order write failed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/sold out/i.test(message)) return failure(409, "PRODUCT_SOLD_OUT", "That Store item has just sold out.");
      if (/purchase limit/i.test(message)) return failure(409, "PURCHASE_LIMIT_REACHED", "This account has already reached the purchase limit for that item.");
      order = await db.prepare("SELECT * FROM store_commerce_orders WHERE purchasing_user_id = ? AND request_key = ? LIMIT 1")
        .bind(user.id, requestKey).first<OrderRow>();
      if (!order) return failure(503, "ORDER_WRITE_FAILED", "The order could not be safely recorded.");
    }
    order = await db.prepare("SELECT * FROM store_commerce_orders WHERE id = ?").bind(orderId).first<OrderRow>();
  }
  if (!order) return failure(503, "ORDER_UNAVAILABLE", "The order could not be loaded.");
  if (order.stripe_mode !== access.mode || Boolean(order.livemode) !== access.livemode) {
    return failure(409, "ORDER_MODE_CHANGED", "This order was prepared for a different Stripe mode and cannot be reused.");
  }
  const publication = await readPublication(db, order.publication_id, false);
  if (!publication) return failure(409, "PRODUCT_PAUSED", "That Store item is no longer available.");
  const appUrl = getAppUrl(env, request);
  const params: Record<string, string | number> = {
    mode: "payment",
    "line_items[0][price]": publication.stripe_price_id,
    "line_items[0][quantity]": 1,
    payment_method_collection: "always",
    "payment_method_types[0]": "card",
    "adaptive_pricing[enabled]": "false",
    client_reference_id: order.id,
    "metadata[dzn_store_order_id]": order.id,
    "metadata[dzn_store_user_id]": user.id,
    "payment_intent_data[metadata][dzn_store_order_id]": order.id,
    "payment_intent_data[metadata][dzn_store_user_id]": user.id,
    success_url: `${appUrl}/store?store=success&order=${encodeURIComponent(order.id)}`,
    cancel_url: `${appUrl}/store?store=cancelled&order=${encodeURIComponent(order.id)}`,
  };
  const createCheckout = options.createCheckout ?? ((body, key) => stripeFormRequest<CheckoutSession>(env, "/checkout/sessions", body, { idempotencyKey: key }));
  let session: CheckoutSession;
  try { session = await createCheckout(params, `dzn-store-${order.id}`); }
  catch { return failure(503, "CHECKOUT_RETRY_REQUIRED", "Checkout could not be confirmed. Retry this order; a duplicate payment will not be created."); }
  const valid = validateCheckoutSession(session, order, access.livemode);
  if (!valid.ok) return valid;
  const updated = await db.prepare(`UPDATE store_commerce_orders SET stripe_checkout_session_id = ?, status = 'checkout_ready',
    checkout_url_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'checkout_pending' AND stripe_checkout_session_id IS NULL`)
    .bind(session.id, new Date((session.expires_at ?? 0) * 1000).toISOString(), now.toISOString(), order.id).run();
  if (changes(updated) !== 1) return failure(503, "CHECKOUT_SAVE_FAILED", "Checkout was created but could not be safely attached. Retry the same order.");
  return checkoutSuccess(order, session);
}

export async function reconcileStoreWebhook(env: Env, event: StripeEvent, rawBody: string) {
  const db = requireDb(env);
  if (!event?.id || !event.type || !event.data?.object) throw new Error("Invalid Store webhook event");
  const existing = await db.prepare("SELECT id FROM store_commerce_events WHERE stripe_event_id = ?").bind(event.id).first();
  if (existing) return { duplicate: true };
  const object = event.data.object;
  const metadata = record(object.metadata);
  const orderId = identifier(metadata.dzn_store_order_id ?? object.client_reference_id);
  const paymentIntentId = stripeId(object.payment_intent);
  const order = orderId
    ? await db.prepare("SELECT * FROM store_commerce_orders WHERE id = ?").bind(orderId).first<OrderRow>()
    : paymentIntentId
      ? await db.prepare("SELECT * FROM store_commerce_orders WHERE stripe_payment_intent_id = ?").bind(paymentIntentId).first<OrderRow>()
      : null;
  const eventLive = event.livemode === true;
  let processingStatus: "processed" | "ignored" | "manual_review" = "ignored";
  const statements = [] as D1PreparedStatement[];
  const now = new Date().toISOString();
  const eventId = `store_event_${crypto.randomUUID()}`;
  if (order && Boolean(order.livemode) !== eventLive) processingStatus = "manual_review";
  else if (order && event.type === "checkout.session.completed" && ["checkout_ready", "expired"].includes(order.status)) {
    const amount = Number(object.amount_total);
    const paymentStatus = text(object.payment_status);
    const sessionId = stripeId(object.id);
    if (sessionId !== order.stripe_checkout_session_id || paymentStatus !== "paid" || amount !== order.total_amount_minor || text(object.currency)?.toLowerCase() !== "gbp") {
      processingStatus = "manual_review";
    } else {
      const publication = await db.prepare(`SELECT stock_mode, stock_limit, reserved_quantity, sold_quantity
        FROM store_catalog_publications WHERE id = ?`).bind(order.publication_id).first<{
          stock_mode: string; stock_limit: number | null; reserved_quantity: number; sold_quantity: number;
        }>();
      const lateStockConflict = order.status === "expired" && publication?.stock_mode === "finite"
        && Number(publication.reserved_quantity) + Number(publication.sold_quantity) >= Number(publication.stock_limit);
      if (lateStockConflict) {
        processingStatus = "manual_review";
        statements.push(db.prepare(`UPDATE store_commerce_orders
          SET status = 'manual_review', stripe_payment_intent_id = ?, paid_at = ?, updated_at = ?
          WHERE id = ? AND status = 'expired'`).bind(stripeId(object.payment_intent), now, now, order.id));
      } else {
        processingStatus = "processed";
        const paymentIntent = stripeId(object.payment_intent);
        const fulfilmentId = `store_fulfilment_${crypto.randomUUID()}`;
        const entitlementKey = `dzn_store_${await orderProductKey(db, order.id)}_${order.id}`;
        statements.push(
          db.prepare(`UPDATE store_commerce_orders SET status = 'fulfilled', stripe_payment_intent_id = ?, paid_at = ?, fulfilled_at = ?, updated_at = ?
            WHERE id = ? AND status IN ('checkout_ready','expired')`).bind(paymentIntent, now, now, now, order.id),
          db.prepare(`INSERT INTO store_commerce_fulfilments (id, order_id, purchasing_user_id, fulfilment_kind,
            status, entitlement_key, granted_at, created_at, updated_at)
            SELECT ?, o.id, o.purchasing_user_id, i.fulfilment_kind, 'completed', ?, ?, ?, ?
            FROM store_commerce_orders o JOIN store_commerce_order_items i ON i.order_id = o.id
            WHERE o.id = ? AND o.status = 'fulfilled' AND o.stripe_payment_intent_id = ?`)
            .bind(fulfilmentId, entitlementKey, now, now, now, order.id, paymentIntent),
          db.prepare(`INSERT INTO store_commerce_entitlements (id, fulfilment_id, order_id, purchasing_user_id,
            product_key, fulfilment_kind, entitlement_key, status, granted_at, created_at, updated_at)
            SELECT ?, ?, o.id, o.purchasing_user_id, i.product_key, i.fulfilment_kind, ?, 'active', ?, ?, ?
            FROM store_commerce_orders o JOIN store_commerce_order_items i ON i.order_id = o.id
            WHERE o.id = ? AND o.status = 'fulfilled' AND o.stripe_payment_intent_id = ?`)
            .bind(`store_entitlement_${crypto.randomUUID()}`, fulfilmentId, entitlementKey, now, now, now, order.id, paymentIntent),
          db.prepare(`INSERT INTO store_commerce_receipts (id, receipt_number, order_id, purchasing_user_id,
            subtotal_amount_minor, tax_amount_minor, total_amount_minor, seller_snapshot_json, issued_at, updated_at)
            SELECT ?, ?, id, purchasing_user_id, subtotal_amount_minor, tax_amount_minor, total_amount_minor, ?, ?, ?
            FROM store_commerce_orders WHERE id = ? AND status = 'fulfilled' AND stripe_payment_intent_id = ?`)
            .bind(`store_receipt_${crypto.randomUUID()}`, `DZN-R-${crypto.randomUUID().slice(0, 12).toUpperCase()}`, sellerSnapshot(env), now, now, order.id, paymentIntent),
        );
      }
    }
  } else if (order && event.type === "checkout.session.expired") {
    processingStatus = "processed";
    statements.push(
      db.prepare("UPDATE store_commerce_orders SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('checkout_pending','checkout_ready')").bind(now, order.id),
    );
  } else if (order && event.type === "charge.dispute.closed" && text(object.status) === "won" && order.status === "disputed") {
    const existingFulfilment = await db.prepare("SELECT id FROM store_commerce_fulfilments WHERE order_id = ?")
      .bind(order.id).first<{ id: string }>();
    const publication = !existingFulfilment
      ? await db.prepare(`SELECT stock_mode, stock_limit, reserved_quantity, sold_quantity
          FROM store_catalog_publications WHERE id = ?`).bind(order.publication_id).first<{
          stock_mode: string; stock_limit: number | null; reserved_quantity: number; sold_quantity: number;
        }>()
      : null;
    const capacityUnavailable = !existingFulfilment && publication?.stock_mode === "finite"
      && Number(publication.reserved_quantity) + Number(publication.sold_quantity) >= Number(publication.stock_limit);
    if (capacityUnavailable) {
      processingStatus = "manual_review";
      statements.push(db.prepare("UPDATE store_commerce_orders SET status = 'manual_review', updated_at = ? WHERE id = ? AND status = 'disputed'").bind(now, order.id));
    } else {
      processingStatus = "processed";
      const paymentIntent = stripeId(object.payment_intent) ?? order.stripe_payment_intent_id;
      const fulfilmentId = existingFulfilment?.id ?? `store_fulfilment_${crypto.randomUUID()}`;
      const entitlementKey = `dzn_store_${await orderProductKey(db, order.id)}_${order.id}`;
      statements.push(
        db.prepare(`UPDATE store_commerce_orders SET status = 'fulfilled', stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?),
          paid_at = COALESCE(paid_at, ?), fulfilled_at = COALESCE(fulfilled_at, ?), updated_at = ?
          WHERE id = ? AND status = 'disputed'`).bind(paymentIntent, now, now, now, order.id),
        db.prepare(`UPDATE store_catalog_publications SET sold_quantity = sold_quantity + 1, updated_at = ?
          WHERE id = ? AND NOT EXISTS (SELECT 1 FROM store_commerce_fulfilments WHERE order_id = ?)
            AND EXISTS (SELECT 1 FROM store_commerce_orders WHERE id = ? AND status = 'fulfilled')`)
          .bind(now, order.publication_id, order.id, order.id),
        db.prepare(`INSERT INTO store_commerce_fulfilments (id, order_id, purchasing_user_id, fulfilment_kind,
          status, entitlement_key, granted_at, created_at, updated_at)
          SELECT ?, o.id, o.purchasing_user_id, i.fulfilment_kind, 'completed', ?, ?, ?, ?
          FROM store_commerce_orders o JOIN store_commerce_order_items i ON i.order_id = o.id
          WHERE o.id = ? AND o.status = 'fulfilled'
            AND NOT EXISTS (SELECT 1 FROM store_commerce_fulfilments WHERE order_id = o.id)`)
          .bind(fulfilmentId, entitlementKey, now, now, now, order.id),
        db.prepare(`INSERT INTO store_commerce_entitlements (id, fulfilment_id, order_id, purchasing_user_id,
          product_key, fulfilment_kind, entitlement_key, status, granted_at, created_at, updated_at)
          SELECT ?, f.id, o.id, o.purchasing_user_id, i.product_key, i.fulfilment_kind, f.entitlement_key, 'active', ?, ?, ?
          FROM store_commerce_orders o JOIN store_commerce_order_items i ON i.order_id = o.id
          JOIN store_commerce_fulfilments f ON f.order_id = o.id
          WHERE o.id = ? AND o.status = 'fulfilled'
            AND NOT EXISTS (SELECT 1 FROM store_commerce_entitlements WHERE order_id = o.id)`)
          .bind(`store_entitlement_${crypto.randomUUID()}`, now, now, now, order.id),
        db.prepare(`INSERT INTO store_commerce_receipts (id, receipt_number, order_id, purchasing_user_id,
          subtotal_amount_minor, tax_amount_minor, total_amount_minor, seller_snapshot_json, issued_at, updated_at)
          SELECT ?, ?, id, purchasing_user_id, subtotal_amount_minor, tax_amount_minor, total_amount_minor, ?, ?, ?
          FROM store_commerce_orders WHERE id = ? AND status = 'fulfilled'
            AND NOT EXISTS (SELECT 1 FROM store_commerce_receipts WHERE order_id = ?)`)
          .bind(`store_receipt_${crypto.randomUUID()}`, `DZN-R-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
            sellerSnapshot(env), now, now, order.id, order.id),
        db.prepare(`UPDATE store_commerce_fulfilments SET status = 'completed', reversed_at = NULL, updated_at = ?
          WHERE order_id = ? AND status = 'reversed'
            AND EXISTS (SELECT 1 FROM store_commerce_orders WHERE id = ? AND status = 'fulfilled')`).bind(now, order.id, order.id),
        db.prepare(`UPDATE store_commerce_entitlements SET status = 'active', reversed_at = NULL, updated_at = ?
          WHERE order_id = ? AND status = 'reversed'
            AND EXISTS (SELECT 1 FROM store_commerce_orders WHERE id = ? AND status = 'fulfilled')`).bind(now, order.id, order.id),
        db.prepare(`UPDATE store_commerce_receipts SET status = 'issued', updated_at = ?
          WHERE order_id = ? AND status = 'void'
            AND EXISTS (SELECT 1 FROM store_commerce_orders WHERE id = ? AND status = 'fulfilled')`).bind(now, order.id, order.id),
      );
    }
  } else if (order && event.type === "charge.dispute.closed" && order.status === "disputed") {
    processingStatus = "processed";
  } else if (order && (event.type === "charge.refunded" || event.type === "charge.dispute.created")) {
    const fullReversal = event.type === "charge.refunded"
      ? object.refunded === true && Number(object.amount_refunded) >= order.total_amount_minor
      : Number(object.amount) >= order.total_amount_minor;
    processingStatus = fullReversal ? "processed" : "manual_review";
    if (!fullReversal) {
      statements.push(db.prepare("UPDATE store_commerce_orders SET status = 'manual_review', updated_at = ? WHERE id = ?").bind(now, order.id));
    } else {
    const nextStatus = event.type === "charge.refunded" ? "refunded" : "disputed";
    statements.push(
      db.prepare(`UPDATE store_commerce_orders SET status = ?, stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?),
        refunded_at = CASE WHEN ? = 'refunded' THEN ? ELSE refunded_at END, updated_at = ? WHERE id = ?`)
        .bind(nextStatus, stripeId(object.payment_intent), nextStatus, now, now, order.id),
      db.prepare("UPDATE store_commerce_fulfilments SET status = 'reversed', reversed_at = ?, updated_at = ? WHERE order_id = ? AND status = 'completed'").bind(now, now, order.id),
      db.prepare("UPDATE store_commerce_entitlements SET status = 'reversed', reversed_at = ?, updated_at = ? WHERE order_id = ? AND status = 'active'").bind(now, now, order.id),
      db.prepare("UPDATE store_commerce_receipts SET status = ?, updated_at = ? WHERE order_id = ?").bind(nextStatus === "refunded" ? "refunded" : "void", now, order.id),
    );
    }
  }
  const safeSummary = JSON.stringify({ eventType: event.type, orderLinked: Boolean(order), livemode: eventLive,
    providerReferences: { session: Boolean(stripeId(object.id)), paymentIntent: Boolean(stripeId(object.payment_intent)) } });
  statements.unshift(db.prepare(`INSERT INTO store_commerce_events (id, stripe_event_id, order_id, event_type, livemode,
    raw_body_sha256, processing_status, safe_summary_json, received_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(eventId, event.id, order?.id ?? null, event.type, eventLive ? 1 : 0, await sha256(rawBody), processingStatus, safeSummary, now, now));
  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    const latePaidSession = order?.status === "expired" && event.type === "checkout.session.completed";
    const publication = latePaidSession
      ? await db.prepare(`SELECT stock_mode, stock_limit, reserved_quantity, sold_quantity
        FROM store_catalog_publications WHERE id = ?`).bind(order.publication_id).first<{
          stock_mode: string; stock_limit: number | null; reserved_quantity: number; sold_quantity: number;
        }>()
      : null;
    const capacityWasTaken = publication?.stock_mode === "finite"
      && Number(publication.reserved_quantity) + Number(publication.sold_quantity) >= Number(publication.stock_limit);
    if (!latePaidSession || !capacityWasTaken) throw error;
    processingStatus = "manual_review";
    const fallback = await db.batch([
      db.prepare(`INSERT INTO store_commerce_events (id, stripe_event_id, order_id, event_type, livemode,
        raw_body_sha256, processing_status, safe_summary_json, received_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(eventId, event.id, order.id, event.type, eventLive ? 1 : 0, await sha256(rawBody), processingStatus, safeSummary, now, now),
      db.prepare(`UPDATE store_commerce_orders
        SET status = 'manual_review', stripe_payment_intent_id = ?, paid_at = ?, updated_at = ?
        WHERE id = ? AND status = 'expired'`).bind(stripeId(object.payment_intent), now, now, order.id),
    ]);
    if (fallback.some((result) => !result.success)) throw error;
    return { duplicate: false, processingStatus };
  }
  if (results.some((result) => !result.success)) throw new Error("Store webhook reconciliation failed");
  return { duplicate: false, processingStatus };
}

export async function listStorePurchases(env: Env, user: SessionUser) {
  const result = await requireDb(env).prepare(`SELECT o.id, o.order_number, o.status, o.currency, o.total_amount_minor,
    o.created_at, o.paid_at, o.fulfilled_at, i.product_name, i.fulfilment_kind,
    r.receipt_number, r.status AS receipt_status, r.issued_at,
    e.entitlement_key, e.status AS entitlement_status, e.granted_at AS entitlement_granted_at
    FROM store_commerce_orders o JOIN store_commerce_order_items i ON i.order_id = o.id
    LEFT JOIN store_commerce_receipts r ON r.order_id = o.id
    LEFT JOIN store_commerce_entitlements e ON e.order_id = o.id
    WHERE o.purchasing_user_id = ? ORDER BY o.created_at DESC LIMIT 100`).bind(user.id).all();
  return { ok: true as const, purchases: result.results ?? [] };
}

async function expireAbandonedStoreOrders(db: D1Database, now: Date) {
  await db.prepare(`UPDATE store_commerce_orders SET status = 'expired', updated_at = ?
    WHERE status IN ('checkout_pending','checkout_ready')
      AND ((status = 'checkout_pending' AND reservation_expires_at <= ?)
        OR (status = 'checkout_ready' AND checkout_url_expires_at IS NOT NULL AND checkout_url_expires_at <= ?))`)
    .bind(now.toISOString(), now.toISOString(), now.toISOString()).run();
}

async function orderProductKey(db: D1Database, orderId: string) {
  const row = await db.prepare("SELECT product_key FROM store_commerce_order_items WHERE order_id = ?")
    .bind(orderId).first<{ product_key: string }>();
  if (!row?.product_key) throw new Error("Store order item is missing");
  return row.product_key;
}

async function readPublication(db: D1Database, publicationId: string, requireAvailableStock: boolean) {
  return db.prepare(`SELECT pub.id AS publication_id, pub.product_id, pub.price_id, pub.stripe_price_id,
    pub.stock_mode, pub.stock_limit, pub.reserved_quantity, pub.sold_quantity, pub.lifetime_limit_per_account,
    p.product_key, p.name, p.description, p.product_type, p.fulfilment_kind, pr.unit_amount_minor
    FROM store_catalog_publications pub JOIN store_products p ON p.id = pub.product_id
    JOIN store_prices pr ON pr.id = pub.price_id
    WHERE pub.id = ? AND pub.active = 1 AND pub.status = 'published'
      AND (? = 0 OR pub.stock_mode = 'unlimited' OR pub.reserved_quantity + pub.sold_quantity < pub.stock_limit)
    LIMIT 1`).bind(publicationId, requireAvailableStock ? 1 : 0).first<PublicationRow>();
}

function checkoutAccess(env: Env) {
  const flags = storeCommerceFlags(env);
  if (!flags.store || !flags.commerce || !flags.publicCatalog || !flags.checkout) return failure(403, "STORE_CHECKOUT_DISABLED", "Store checkout is not open yet.");
  const secret = text((env as unknown as Record<string, unknown>).STRIPE_SECRET_KEY);
  const mode = secret?.startsWith("sk_live_") ? "live" : secret?.startsWith("sk_test_") ? "test" : null;
  if (!mode) return failure(503, "STRIPE_NOT_READY", "Store checkout is not configured.");
  const webhookSecret = text((env as unknown as Record<string, unknown>).STRIPE_STORE_WEBHOOK_SECRET);
  if (!webhookSecret?.startsWith("whsec_")) {
    return failure(503, "STORE_WEBHOOK_NOT_READY", "Store checkout is paused until its payment webhook is configured.");
  }
  if (mode === "live" && (!flags.liveCheckout || !liveStorePrerequisites(env))) {
    return failure(403, "LIVE_CHECKOUT_PAUSED", "Live Store checkout is paused until its seller, webhook, and production URL checks pass.");
  }
  return { ok: true as const, mode, livemode: mode === "live" };
}

async function resumeCheckout(env: Env, order: OrderRow, options: StoreCommerceOptions) {
  const retrieve = options.retrieveCheckout ?? ((id) => stripeGetRequest<CheckoutSession>(env, `/checkout/sessions/${encodeURIComponent(id)}`));
  let session: CheckoutSession;
  try { session = await retrieve(order.stripe_checkout_session_id!); }
  catch { return failure(503, "CHECKOUT_RETRY_REQUIRED", "The existing checkout could not be confirmed. Please retry."); }
  const valid = validateCheckoutSession(session, order, Boolean(order.livemode));
  return valid.ok ? checkoutSuccess(order, session) : valid;
}

function validateCheckoutSession(session: CheckoutSession, order: OrderRow, livemode: boolean) {
  let url: URL;
  try { url = new URL(session.url ?? ""); } catch { return failure(503, "INVALID_CHECKOUT_SESSION", "Stripe returned an invalid checkout session."); }
  if (!STRIPE_SESSION.test(session.id) || session.mode !== "payment" || session.status !== "open" || session.livemode !== livemode ||
    session.client_reference_id !== order.id || session.metadata?.dzn_store_order_id !== order.id ||
    url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password || url.port ||
    !Number.isSafeInteger(session.expires_at) || Number(session.expires_at) <= Math.floor(Date.now() / 1000)) {
    return failure(503, "INVALID_CHECKOUT_SESSION", "Stripe returned a checkout session that did not match this order.");
  }
  return { ok: true as const };
}

function checkoutSuccess(order: OrderRow, session: CheckoutSession) {
  return { ok: true as const, status: 200 as const, order: { id: order.id, orderNumber: order.order_number,
    status: "checkout_ready", totalAmountMinor: order.total_amount_minor, currency: order.currency }, checkout: { url: session.url!, expiresAt: session.expires_at! } };
}

function sellerSnapshot(env: Env) {
  const values = env as unknown as Record<string, unknown>;
  return JSON.stringify({ sellerName: text(values.DZN_BILLING_SELLER_NAME) ?? "DZN Network",
    supportEmail: text(values.DZN_BILLING_SUPPORT_EMAIL) ?? null });
}

function liveStorePrerequisites(env: Env) {
  const values = env as unknown as Record<string, unknown>;
  const webhookSecret = text(values.STRIPE_STORE_WEBHOOK_SECRET);
  const sellerName = text(values.DZN_BILLING_SELLER_NAME);
  const supportEmail = text(values.DZN_BILLING_SUPPORT_EMAIL);
  const appUrl = text(values.DZN_APP_URL ?? values.NEXT_PUBLIC_APP_URL);
  if (!webhookSecret?.startsWith("whsec_") || !sellerName || !supportEmail || !appUrl) return false;
  try {
    const url = new URL(appUrl);
    return url.protocol === "https:" && url.hostname === "dayz-network.com" && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function failure(status: 400 | 403 | 404 | 409 | 422 | 503, error: string, message: string) {
  return { ok: false as const, status, error, message };
}
function createId(options: StoreCommerceOptions) { return options.createId ? options.createId() : crypto.randomUUID(); }
function identifier(value: unknown) { const item = text(value); return item && ID.test(item) ? item : null; }
function text(value: unknown) { if (typeof value !== "string") return null; const item = value.trim(); return item || null; }
function flag(value: unknown) { return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase()); }
function optionalInteger(value: unknown, min: number, max: number) { if (value === undefined || value === null || value === "") return null; const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : null; }
function changes(result: D1Result) { return Number(result.meta?.changes ?? result.meta?.rows_written ?? 0); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
async function sha256(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
