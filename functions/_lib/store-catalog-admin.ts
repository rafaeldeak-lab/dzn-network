import { requireDb } from "./db";
import {
  canManageStoreDrafts,
  validateStorePriceDraft,
  validateStoreProductDraft,
} from "./store-catalog-foundation";
import type { Env, SessionUser } from "./types";

type StoreDraftInput = {
  product?: unknown;
  price?: unknown;
};

type StoreProductRow = {
  id: string;
  product_key: string;
  name: string;
  description: string;
  product_type: string;
  fulfilment_kind: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type StorePriceRow = {
  id: string;
  product_id: string;
  currency: string;
  unit_amount_minor: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

export function storeDraftAdminEnabled(env: Env) {
  return canManageStoreDrafts(env as unknown as Record<string, unknown>, true);
}

export async function listStoreCatalogDrafts(env: Env) {
  try {
    const db = requireDb(env);
    const [productsResult, pricesResult] = await db.batch([
      db.prepare(`SELECT id, product_key, name, description, product_type, fulfilment_kind,
        status, created_at, updated_at
        FROM store_products
        WHERE active = 0 AND status IN ('draft', 'review')
        ORDER BY created_at DESC, id DESC
        LIMIT 200`),
      db.prepare(`SELECT id, product_id, currency, unit_amount_minor, status,
        effective_from, effective_to, created_at
        FROM store_prices
        WHERE active = 0 AND stripe_price_id IS NULL AND status IN ('draft', 'review')
        ORDER BY created_at DESC, id DESC
        LIMIT 400`),
    ]);
    if (!productsResult.success || !pricesResult.success) return unavailable();
    return {
      ok: true as const,
      status: 200 as const,
      products: (productsResult.results ?? []) as StoreProductRow[],
      prices: (pricesResult.results ?? []) as StorePriceRow[],
    };
  } catch {
    return unavailable();
  }
}

export async function createStoreCatalogDraft(env: Env, actor: SessionUser, input: StoreDraftInput) {
  const product = validateStoreProductDraft(input?.product);
  if (!product.ok) return invalid("product", product.errors);

  const productId = `store_product_${crypto.randomUUID()}`;
  const priceInput = input?.price && typeof input.price === "object" && !Array.isArray(input.price)
    ? input.price as Record<string, unknown>
    : {};
  const price = validateStorePriceDraft({ ...priceInput, productId });
  if (!price.ok) return invalid("price", price.errors);

  const priceId = `store_price_${crypto.randomUUID()}`;
  try {
    const db = requireDb(env);
    const results = await db.batch([
      db.prepare(`INSERT INTO store_products (
        id, product_key, name, description, product_type, fulfilment_kind, status,
        active, account_bound, guaranteed_purchase, no_competitive_advantage,
        metadata_json, created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1, 1, '{}', ?, ?)`)
        .bind(
          productId,
          product.value.productKey,
          product.value.name,
          product.value.description,
          product.value.productType,
          product.value.fulfilmentKind,
          product.value.status,
          actor.id,
          actor.id,
        ),
      db.prepare(`INSERT INTO store_prices (
        id, product_id, currency, unit_amount_minor, min_amount_minor,
        allow_pay_what_you_want, stripe_price_id, status, active, created_by_user_id
      ) VALUES (?, ?, 'gbp', ?, NULL, 0, NULL, ?, 0, ?)`)
        .bind(priceId, productId, price.value.unitAmountMinor, price.value.status, actor.id),
    ]);
    if (results.length !== 2 || results.some((result) => !result.success || Number(result.meta.changes ?? 0) !== 1)) {
      return unavailable();
    }
    return {
      ok: true as const,
      status: 201 as const,
      product: { id: productId, ...product.value },
      price: { id: priceId, ...price.value },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique constraint failed:\s*store_products\.product_key/i.test(message)) {
      return { ok: false as const, status: 409 as const, error: "PRODUCT_KEY_EXISTS", message: "That Store product key already exists." };
    }
    return unavailable();
  }
}

function invalid(scope: "product" | "price", errors: unknown[]) {
  return { ok: false as const, status: 400 as const, error: "INVALID_STORE_DRAFT", scope, errors };
}

function unavailable() {
  return {
    ok: false as const,
    status: 503 as const,
    error: "STORE_DRAFTS_UNAVAILABLE",
    message: "Store draft management is not available in this environment yet.",
  };
}
