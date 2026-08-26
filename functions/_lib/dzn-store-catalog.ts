export const DZN_STORE_CATALOG_SCHEMA_VERSION = "2026-08-26.store-catalog-draft-v1";
export const DZN_FOUNDING_SUPPORTER_PRODUCT_KEY = "dzn-founding-supporter-pack";

export const DZN_STORE_CATALOG_TABLES = ["store_products", "store_prices"] as const;

export const DZN_STORE_CATALOG_FEATURE_FLAGS = {
  storeEnabled: "DZN_STORE_ENABLED",
  checkoutEnabled: "DZN_STORE_CHECKOUT_ENABLED",
  sandboxCheckoutEnabled: "DZN_STORE_SANDBOX_CHECKOUT_ENABLED",
  webhookFulfilmentEnabled: "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
  supporterCardsEnabled: "DZN_SUPPORTER_CARDS_ENABLED",
  earnedSpinsEnabled: "DZN_EARNED_SPINS_ENABLED",
  rewardWheelEnabled: "DZN_REWARD_WHEEL_ENABLED",
  adminEnabled: "DZN_STORE_ADMIN_ENABLED",
  liveCheckoutEnabled: "DZN_STORE_LIVE_CHECKOUT_ENABLED",
  publicStoreEnabled: "NEXT_PUBLIC_DZN_STORE_ENABLED",
} as const;

export const DZN_STORE_PRODUCT_TYPES = [
  "supporter_pack",
  "profile_theme",
  "calling_card_pack",
  "chat_cosmetic_pack",
  "group_branding_pack",
  "event_presentation_theme",
] as const;

export const DZN_STORE_FULFILMENT_KINDS = [
  "supporter_card",
  "cosmetic_entitlement",
  "profile_frame",
  "chat_badge",
  "theme_pack",
  "event_theme",
] as const;

export const DZN_STORE_DRAFT_STATUSES = ["draft", "review"] as const;
export const DZN_STORE_PRICE_CURRENCIES = ["gbp"] as const;

export const DZN_STORE_DISALLOWED_PAID_OUTCOME_FIELDS = [
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

const PRODUCT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,80}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const MAX_PRODUCT_NAME_LENGTH = 120;
const MAX_PRODUCT_DESCRIPTION_LENGTH = 1000;
const MAX_METADATA_JSON_LENGTH = 8000;
const MAX_PRICE_AMOUNT_MINOR = 1_000_000;

const FORBIDDEN_PAID_BENEFIT_PATTERNS = [
  /\b(?:grant|grants|give|gives|adds|add|award|awards|include|includes|unlock|unlocks)\s+(?:\w+\s+){0,4}(?:spin|spins|xp|rank|ranking|leaderboard|leaderboards|discovery|review score|review-score|reward odds|server wars score|server wars scoring|ctf score|ctf scoring|competitive eligibility|owner setup|server management|nitrado)\b/i,
  /\b(?:boost|boosts|increase|increases|improve|improves|raise|raises)\s+(?:\w+\s+){0,4}(?:rank|ranking|leaderboard|leaderboards|discovery|review score|reward odds|odds|server wars|ctf|score|scoring|eligibility)\b/i,
  /\b(?:buy|purchase|paid|supporter pack|subscription|bundle)\s+(?:\w+\s+){0,5}(?:spin|spins|xp|rank|ranking|leaderboard|discovery|reward odds|competitive eligibility)\b/i,
  /\b(?:cash|gift card|gift cards|physical prize|physical prizes|redeemable|redeem|transferable|tradeable|resellable)\b/i,
] as const;

export type DznStoreProductType = (typeof DZN_STORE_PRODUCT_TYPES)[number];
export type DznStoreFulfilmentKind = (typeof DZN_STORE_FULFILMENT_KINDS)[number];
export type DznStoreDraftStatus = (typeof DZN_STORE_DRAFT_STATUSES)[number];
export type DznStorePriceCurrency = (typeof DZN_STORE_PRICE_CURRENCIES)[number];
export type DznStoreCatalogTable = (typeof DZN_STORE_CATALOG_TABLES)[number];
export type DznStoreOutcomeField = (typeof DZN_STORE_DISALLOWED_PAID_OUTCOME_FIELDS)[number];

export type DznStoreCatalogEnv = Partial<Record<(typeof DZN_STORE_CATALOG_FEATURE_FLAGS)[keyof typeof DZN_STORE_CATALOG_FEATURE_FLAGS], string>>;

export type DznStoreCatalogFlags = {
  storeEnabled: boolean;
  checkoutEnabled: boolean;
  sandboxCheckoutEnabled: boolean;
  webhookFulfilmentEnabled: boolean;
  supporterCardsEnabled: boolean;
  earnedSpinsEnabled: boolean;
  rewardWheelEnabled: boolean;
  adminEnabled: boolean;
  liveCheckoutEnabled: boolean;
  publicStoreEnabled: boolean;
};

export type DznStoreValidationError = {
  field: string;
  code: string;
  message: string;
};

export type DznStoreValidationResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; errors: DznStoreValidationError[] };

export type DznStoreProductDraft = {
  productKey: string;
  name: string;
  description: string;
  productType: DznStoreProductType;
  fulfilmentKind: DznStoreFulfilmentKind;
  status: DznStoreDraftStatus;
  active: false;
  accountBound: true;
  guaranteedPurchase: true;
  noCompetitiveAdvantage: true;
  metadataJson: string;
};

export type DznStorePriceDraft = {
  productId: string;
  currency: DznStorePriceCurrency;
  unitAmountMinor: number;
  minAmountMinor: null;
  allowPayWhatYouWant: false;
  stripePriceId: null;
  status: DznStoreDraftStatus;
  active: false;
};

export type DznFoundingSupporterDraft = {
  productKey: typeof DZN_FOUNDING_SUPPORTER_PRODUCT_KEY;
  name: "DZN FOUNDING SUPPORTER PACK";
  productType: "supporter_pack";
  fulfilmentKind: "supporter_card";
};

export const DZN_FOUNDING_SUPPORTER_DRAFT_PRODUCT: DznFoundingSupporterDraft = {
  productKey: DZN_FOUNDING_SUPPORTER_PRODUCT_KEY,
  name: "DZN FOUNDING SUPPORTER PACK",
  productType: "supporter_pack",
  fulfilmentKind: "supporter_card",
};

export function readDznStoreCatalogFlags(env: DznStoreCatalogEnv | Record<string, unknown> = {}): DznStoreCatalogFlags {
  return {
    storeEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_STORE_ENABLED),
    checkoutEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_STORE_CHECKOUT_ENABLED),
    sandboxCheckoutEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_STORE_SANDBOX_CHECKOUT_ENABLED),
    webhookFulfilmentEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_STORE_WEBHOOK_FULFILMENT_ENABLED),
    supporterCardsEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_SUPPORTER_CARDS_ENABLED),
    earnedSpinsEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_EARNED_SPINS_ENABLED),
    rewardWheelEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_REWARD_WHEEL_ENABLED),
    adminEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_STORE_ADMIN_ENABLED),
    liveCheckoutEnabled: parseBooleanFlag((env as Record<string, unknown>).DZN_STORE_LIVE_CHECKOUT_ENABLED),
    publicStoreEnabled: parseBooleanFlag((env as Record<string, unknown>).NEXT_PUBLIC_DZN_STORE_ENABLED),
  };
}

export function canValidateDznStoreDrafts(env: DznStoreCatalogEnv | Record<string, unknown> = {}, isDznAdmin: boolean) {
  const flags = readDznStoreCatalogFlags(env);
  return flags.storeEnabled && flags.adminEnabled && isDznAdmin;
}

export function normalizeDznStoreProductType(value: unknown): DznStoreProductType | null {
  return normalizeEnumValue(value, DZN_STORE_PRODUCT_TYPES);
}

export function normalizeDznStoreFulfilmentKind(value: unknown): DznStoreFulfilmentKind | null {
  return normalizeEnumValue(value, DZN_STORE_FULFILMENT_KINDS);
}

export function normalizeDznStoreDraftStatus(value: unknown): DznStoreDraftStatus | null {
  return normalizeEnumValue(value, DZN_STORE_DRAFT_STATUSES);
}

export function validateDznStoreProductDraft(input: unknown): DznStoreValidationResult<DznStoreProductDraft> {
  const record = asRecord(input);
  const errors: DznStoreValidationError[] = [];

  const productKey = normalizeProductKey(record.productKey);
  if (!productKey || !PRODUCT_KEY_PATTERN.test(productKey)) {
    errors.push(error("productKey", "INVALID_PRODUCT_KEY", "Product keys must be lowercase slugs between 3 and 81 characters."));
  }

  const name = normalizeString(record.name);
  if (!name || name.length > MAX_PRODUCT_NAME_LENGTH) {
    errors.push(error("name", "INVALID_NAME", "Product names must be present and no longer than 120 characters."));
  }

  const description = normalizeString(record.description);
  if (!description || description.length < 10 || description.length > MAX_PRODUCT_DESCRIPTION_LENGTH) {
    errors.push(error("description", "INVALID_DESCRIPTION", "Product descriptions must be between 10 and 1000 characters."));
  }

  const productType = normalizeDznStoreProductType(record.productType);
  if (!productType) {
    errors.push(error("productType", "INVALID_PRODUCT_TYPE", "Product type must be an approved DZN Store cosmetic/supporter family."));
  }

  const fulfilmentKind = normalizeDznStoreFulfilmentKind(record.fulfilmentKind);
  if (!fulfilmentKind) {
    errors.push(error("fulfilmentKind", "INVALID_FULFILMENT_KIND", "Fulfilment kind must be an approved account-bound cosmetic/supporter kind."));
  }

  const status = record.status === undefined || record.status === null || record.status === ""
    ? "draft"
    : normalizeDznStoreDraftStatus(record.status);
  if (!status) {
    errors.push(error("status", "INVALID_DRAFT_STATUS", "Catalog product drafts may only use draft or review status in this slice."));
  }
  const active = parseBooleanFlag(record.active);
  if (active) {
    errors.push(error("active", "CATALOG_DISABLED_BY_DEFAULT", "This slice only permits inactive draft catalog entries."));
  }

  assertRequiredTrue(record.accountBound, "accountBound", errors);
  assertRequiredTrue(record.guaranteedPurchase, "guaranteedPurchase", errors);
  assertRequiredTrue(record.noCompetitiveAdvantage, "noCompetitiveAdvantage", errors);
  assertNoPaidOutcomeFlags(record, errors);

  const metadataJson = normalizeMetadataJson(record.metadataJson, errors);
  const searchableCopy = `${productKey ?? ""} ${name ?? ""} ${description ?? ""} ${metadataJson ?? ""}`;
  for (const pattern of FORBIDDEN_PAID_BENEFIT_PATTERNS) {
    if (pattern.test(searchableCopy)) {
      errors.push(error("description", "FORBIDDEN_PAID_BENEFIT", "Store products cannot sell spins, XP, ranking, discovery, review, event, Server Wars, CTF, owner setup, or redeemable benefits."));
      break;
    }
  }

  if (!isProductFulfilmentCompatible(productType, fulfilmentKind)) {
    errors.push(error("fulfilmentKind", "INCOMPATIBLE_FULFILMENT_KIND", "Fulfilment kind must match the selected product family."));
  }

  if (errors.length > 0 || !productKey || !name || !description || !productType || !fulfilmentKind || !metadataJson || !status) {
    return { ok: false, errors };
  }

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

export function validateDznStorePriceDraft(input: unknown): DznStoreValidationResult<DznStorePriceDraft> {
  const record = asRecord(input);
  const errors: DznStoreValidationError[] = [];

  const productId = normalizeString(record.productId);
  if (!productId || !RECORD_ID_PATTERN.test(productId)) {
    errors.push(error("productId", "INVALID_PRODUCT_ID", "Price drafts must reference a local product id."));
  }

  const currency = normalizeEnumValue(record.currency ?? "gbp", DZN_STORE_PRICE_CURRENCIES);
  if (!currency) {
    errors.push(error("currency", "INVALID_CURRENCY", "Initial DZN Store price drafts must use GBP."));
  }

  const unitAmountMinor = parseInteger(record.unitAmountMinor);
  if (unitAmountMinor === null || unitAmountMinor <= 0 || unitAmountMinor > MAX_PRICE_AMOUNT_MINOR) {
    errors.push(error("unitAmountMinor", "INVALID_AMOUNT", "Price drafts must use a positive minor-unit amount no higher than 1000000."));
  }

  if (parseBooleanFlag(record.active)) {
    errors.push(error("active", "CATALOG_DISABLED_BY_DEFAULT", "This slice only permits inactive draft price entries."));
  }

  if (parseBooleanFlag(record.allowPayWhatYouWant)) {
    errors.push(error("allowPayWhatYouWant", "PAY_WHAT_YOU_WANT_FUTURE_ONLY", "Pay-what-you-want pricing is deliberately reserved for a later approved slice."));
  }

  if (record.minAmountMinor !== null && record.minAmountMinor !== undefined && normalizeString(record.minAmountMinor) !== "") {
    errors.push(error("minAmountMinor", "MIN_AMOUNT_FUTURE_ONLY", "Minimum amounts are reserved for a later pay-what-you-want approval slice."));
  }

  const stripePriceId = normalizeString(record.stripePriceId);
  if (stripePriceId) {
    errors.push(error("stripePriceId", "STRIPE_PRICE_BINDING_BLOCKED", "Draft catalog validation cannot bind Stripe Price ids in this slice."));
  }

  const status = record.status === undefined || record.status === null || record.status === ""
    ? "draft"
    : normalizeDznStoreDraftStatus(record.status);
  if (!status) {
    errors.push(error("status", "INVALID_DRAFT_STATUS", "Catalog price drafts may only use draft or review status in this slice."));
  }

  if (errors.length > 0 || !productId || !currency || unitAmountMinor === null || !status) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      productId,
      currency,
      unitAmountMinor,
      minAmountMinor: null,
      allowPayWhatYouWant: false,
      stripePriceId: null,
      status,
      active: false,
    },
    errors: [],
  };
}

export function isProductFulfilmentCompatible(productType: DznStoreProductType | null, fulfilmentKind: DznStoreFulfilmentKind | null) {
  if (!productType || !fulfilmentKind) return false;
  const allowed: Record<DznStoreProductType, DznStoreFulfilmentKind[]> = {
    supporter_pack: ["supporter_card"],
    profile_theme: ["theme_pack", "profile_frame", "cosmetic_entitlement"],
    calling_card_pack: ["cosmetic_entitlement"],
    chat_cosmetic_pack: ["chat_badge", "cosmetic_entitlement"],
    group_branding_pack: ["cosmetic_entitlement"],
    event_presentation_theme: ["event_theme", "cosmetic_entitlement"],
  };
  return allowed[productType].includes(fulfilmentKind);
}

function assertRequiredTrue(recordValue: unknown, field: string, errors: DznStoreValidationError[]) {
  const value = recordValue === undefined ? true : parseBooleanFlag(recordValue);
  if (!value) {
    errors.push(error(field, "REQUIRED_STORE_SAFETY_FLAG", `${field} must be true for DZN Store catalog drafts.`));
  }
}

function assertNoPaidOutcomeFlags(record: Record<string, unknown>, errors: DznStoreValidationError[]) {
  for (const field of DZN_STORE_DISALLOWED_PAID_OUTCOME_FIELDS) {
    if (parseBooleanFlag(record[field])) {
      errors.push(error(field, "FORBIDDEN_PAID_OUTCOME", `${field} must be false for all paid DZN Store catalog drafts.`));
    }
  }
}

function normalizeMetadataJson(value: unknown, errors: DznStoreValidationError[]) {
  const raw = value === undefined || value === null || value === "" ? "{}" : String(value);
  if (raw.length > MAX_METADATA_JSON_LENGTH) {
    errors.push(error("metadataJson", "METADATA_TOO_LARGE", "Product metadata must stay bounded."));
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push(error("metadataJson", "INVALID_METADATA", "Product metadata must be a JSON object."));
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    errors.push(error("metadataJson", "INVALID_METADATA", "Product metadata must be valid JSON."));
    return null;
  }
}

function normalizeProductKey(value: unknown) {
  const normalized = normalizeString(value)?.toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;
  return normalized;
}

function normalizeString(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function parseBooleanFlag(value: unknown) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return String(value).trim().toLowerCase() === "true" || String(value).trim() === "1";
}

function normalizeEnumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return null;
  return (allowed as readonly string[]).includes(normalized) ? normalized as T[number] : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function error(field: string, code: string, message: string): DznStoreValidationError {
  return { field, code, message };
}
