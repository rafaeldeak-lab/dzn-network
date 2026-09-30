export const STORE_CATALOG_SCHEMA_VERSION = "2026-09-30.store-catalog-foundation-v1";

export const STORE_PRODUCT_TYPES = [
  "supporter_pack",
  "profile_theme",
  "calling_card_pack",
  "chat_cosmetic_pack",
  "group_branding_pack",
  "event_presentation_theme",
] as const;

export const STORE_FULFILMENT_KINDS = [
  "supporter_card",
  "cosmetic_entitlement",
  "profile_frame",
  "chat_badge",
  "theme_pack",
  "event_theme",
] as const;

const DRAFT_STATUSES = ["draft", "review"] as const;
const PRODUCT_KEY = /^[a-z0-9][a-z0-9-]{2,80}$/;
const RECORD_ID = /^[A-Za-z0-9_-]{3,128}$/;
const MAX_PRICE_MINOR = 1_000_000;
const OUTCOME_FIELDS = [
  "grantsSpins",
  "grantsXp",
  "grantsRankAdvantage",
  "grantsDiscoveryAdvantage",
  "grantsReviewAdvantage",
  "grantsEventAdvantage",
  "grantsServerWarsAdvantage",
  "grantsCtfAdvantage",
  "grantsOwnerSubscriptionAccess",
  "grantsCompetitiveEligibility",
] as const;

const FORBIDDEN_BENEFIT_COPY = [
  /\b(?:grant|give|award|unlock|buy|purchase)\w*\s+(?:\w+\s+){0,4}(?:spin|spins|xp|rank|ranking|discovery|review score|reward odds|server wars|ctf|owner setup|nitrado|competitive eligibility)\b/i,
  /\b(?:boost|increase|improve|raise)\w*\s+(?:\w+\s+){0,4}(?:rank|ranking|discovery|review score|reward odds|server wars|ctf|score|eligibility)\b/i,
  /\b(?:xp|experience points?|paid spins?|ranking? boost|ranking? advantage|discovery advantage|review score|reward odds|competitive eligibility|owner (?:setup|subscription)|nitrado access|server wars advantage|ctf advantage)\b/i,
  /\b(?:cash|gift cards?|physical prizes?|redeemable|transferable|tradeable|resellable)\b/i,
] as const;

type ProductType = (typeof STORE_PRODUCT_TYPES)[number];
type FulfilmentKind = (typeof STORE_FULFILMENT_KINDS)[number];
type DraftStatus = (typeof DRAFT_STATUSES)[number];

export type StoreCatalogError = { field: string; code: string; message: string };
export type StoreCatalogResult<T> = { ok: true; value: T; errors: [] } | { ok: false; errors: StoreCatalogError[] };

export type StoreProductDraft = {
  productKey: string;
  name: string;
  description: string;
  productType: ProductType;
  fulfilmentKind: FulfilmentKind;
  status: DraftStatus;
  active: false;
  accountBound: true;
  guaranteedPurchase: true;
  noCompetitiveAdvantage: true;
  metadataJson: string;
};

export type StorePriceDraft = {
  productId: string;
  currency: "gbp";
  unitAmountMinor: number;
  minAmountMinor: null;
  allowPayWhatYouWant: false;
  stripePriceId: null;
  status: DraftStatus;
  active: false;
};

export function canManageStoreDrafts(env: Record<string, unknown>, isPlatformOwner: boolean) {
  return isPlatformOwner && flag(env.DZN_STORE_ENABLED) && flag(env.DZN_STORE_ADMIN_ENABLED);
}

export function validateStoreProductDraft(input: unknown): StoreCatalogResult<StoreProductDraft> {
  const value = record(input);
  const errors: StoreCatalogError[] = [];
  const productKey = text(value.productKey)?.toLowerCase().replaceAll("_", "-") ?? "";
  const name = text(value.name) ?? "";
  const description = text(value.description) ?? "";
  const productType = enumValue(value.productType, STORE_PRODUCT_TYPES);
  const fulfilmentKind = enumValue(value.fulfilmentKind, STORE_FULFILMENT_KINDS);
  const status = enumValue(value.status ?? "draft", DRAFT_STATUSES);

  if (!PRODUCT_KEY.test(productKey)) add(errors, "productKey", "INVALID_PRODUCT_KEY", "Use a lowercase product slug between 3 and 81 characters.");
  if (!name || name.length > 120) add(errors, "name", "INVALID_NAME", "Use a product name no longer than 120 characters.");
  if (description.length < 10 || description.length > 1000) add(errors, "description", "INVALID_DESCRIPTION", "Use a description between 10 and 1000 characters.");
  if (!productType) add(errors, "productType", "INVALID_PRODUCT_TYPE", "Choose an approved cosmetic or supporter product type.");
  if (!fulfilmentKind) add(errors, "fulfilmentKind", "INVALID_FULFILMENT_KIND", "Choose an approved account-bound fulfilment kind.");
  if (!status) add(errors, "status", "INVALID_STATUS", "Catalog drafts may only be draft or review.");
  if (flag(value.active)) add(errors, "active", "ACTIVE_BLOCKED", "Catalog entries remain inactive in this foundation release.");

  for (const field of ["accountBound", "guaranteedPurchase", "noCompetitiveAdvantage"] as const) {
    if (value[field] !== undefined && !flag(value[field])) add(errors, field, "REQUIRED_SAFETY_FLAG", `${field} must remain true.`);
  }
  for (const field of OUTCOME_FIELDS) {
    if (flag(value[field])) add(errors, field, "FORBIDDEN_PAID_OUTCOME", `${field} must remain false.`);
  }

  const metadataJson = metadata(value.metadataJson, errors);
  if (metadataJson !== null && containsForbiddenMetadataOutcome(JSON.parse(metadataJson))) {
    add(errors, "metadataJson", "FORBIDDEN_PAID_OUTCOME", "Metadata cannot declare progression, competitive, owner, or redeemable outcomes.");
  }
  const searchable = `${productKey} ${name} ${description} ${metadataJson ?? ""}`;
  if (FORBIDDEN_BENEFIT_COPY.some((pattern) => pattern.test(searchable))) {
    add(errors, "description", "FORBIDDEN_PAID_BENEFIT", "Store products cannot sell progression, competitive, owner, or redeemable benefits.");
  }
  if (!compatible(productType, fulfilmentKind)) add(errors, "fulfilmentKind", "INCOMPATIBLE_FULFILMENT", "The fulfilment kind does not match this product type.");

  if (errors.length || !productType || !fulfilmentKind || !status || metadataJson === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      productKey,
      name,
      description,
      productType,
      fulfilmentKind,
      status,
      active: false,
      accountBound: true,
      guaranteedPurchase: true,
      noCompetitiveAdvantage: true,
      metadataJson,
    },
    errors: [],
  };
}

export function validateStorePriceDraft(input: unknown): StoreCatalogResult<StorePriceDraft> {
  const value = record(input);
  const errors: StoreCatalogError[] = [];
  const productId = text(value.productId) ?? "";
  const status = enumValue(value.status ?? "draft", DRAFT_STATUSES);
  const unitAmountMinor = typeof value.unitAmountMinor === "number" ? value.unitAmountMinor : Number.NaN;

  if (!RECORD_ID.test(productId)) add(errors, "productId", "INVALID_PRODUCT_ID", "Reference a local catalog product id.");
  if ((text(value.currency) ?? "gbp").toLowerCase() !== "gbp") add(errors, "currency", "INVALID_CURRENCY", "Initial Store drafts use GBP.");
  if (!Number.isInteger(unitAmountMinor) || unitAmountMinor <= 0 || unitAmountMinor > MAX_PRICE_MINOR) add(errors, "unitAmountMinor", "INVALID_AMOUNT", "Use a positive minor-unit amount no higher than 1000000.");
  if (!status) add(errors, "status", "INVALID_STATUS", "Price drafts may only be draft or review.");
  if (flag(value.active)) add(errors, "active", "ACTIVE_BLOCKED", "Price drafts remain inactive in this foundation release.");
  if (flag(value.allowPayWhatYouWant)) add(errors, "allowPayWhatYouWant", "VARIABLE_PRICE_BLOCKED", "Variable pricing is not part of this release.");
  if (value.minAmountMinor !== null && value.minAmountMinor !== undefined && text(value.minAmountMinor)) add(errors, "minAmountMinor", "MINIMUM_BLOCKED", "Minimum amounts are not part of this release.");
  if (text(value.stripePriceId)) add(errors, "stripePriceId", "STRIPE_BINDING_BLOCKED", "Stripe Price binding requires a separate release.");

  if (errors.length || !status) return { ok: false, errors };
  return { ok: true, value: { productId, currency: "gbp", unitAmountMinor, minAmountMinor: null, allowPayWhatYouWant: false, stripePriceId: null, status, active: false }, errors: [] };
}

function compatible(productType: ProductType | null, fulfilmentKind: FulfilmentKind | null) {
  if (!productType || !fulfilmentKind) return false;
  const allowed: Record<ProductType, readonly FulfilmentKind[]> = {
    supporter_pack: ["supporter_card"],
    profile_theme: ["theme_pack", "profile_frame", "cosmetic_entitlement"],
    calling_card_pack: ["cosmetic_entitlement"],
    chat_cosmetic_pack: ["chat_badge", "cosmetic_entitlement"],
    group_branding_pack: ["cosmetic_entitlement"],
    event_presentation_theme: ["event_theme", "cosmetic_entitlement"],
  };
  return allowed[productType].includes(fulfilmentKind);
}

function metadata(value: unknown, errors: StoreCatalogError[]) {
  const raw = value === undefined || value === null || value === "" ? "{}" : String(value);
  if (raw.length > 8000) { add(errors, "metadataJson", "METADATA_TOO_LARGE", "Metadata must remain below 8000 characters."); return null; }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return JSON.stringify(parsed);
  } catch {
    add(errors, "metadataJson", "INVALID_METADATA", "Metadata must be a JSON object.");
    return null;
  }
}

function containsForbiddenMetadataOutcome(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenMetadataOutcome);
  if (!value || typeof value !== "object") return false;
  const forbiddenKeys = new Set<string>(OUTCOME_FIELDS.map((field) => field.toLowerCase()));
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => forbiddenKeys.has(key.toLowerCase()) || containsForbiddenMetadataOutcome(nested));
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  const normalized = text(value)?.toLowerCase();
  return normalized && (allowed as readonly string[]).includes(normalized) ? normalized as T[number] : null;
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { if (value === null || value === undefined) return null; const normalized = String(value).trim(); return normalized || null; }
function flag(value: unknown) { return value === true || String(value ?? "").trim().toLowerCase() === "true" || String(value ?? "").trim() === "1"; }
function add(errors: StoreCatalogError[], field: string, code: string, message: string) { errors.push({ field, code, message }); }
