export const PUBLIC_LISTING_LIMITS = {
  shortDescription: 160,
  description: 1500,
  discordInvite: 200,
  websiteUrl: 300,
  rules: 1000,
  language: 40,
  regionLabel: 80,
} as const;

export const REVIEW_MIN_CHARS = 20;
export const REVIEW_MAX_WORDS = 250;
export const REVIEW_MAX_CHARS = 1500;
export const REVIEW_COOLDOWN_HOURS = 24;

export type PublicListingInput = {
  public_short_description?: unknown;
  public_description?: unknown;
  public_discord_invite?: unknown;
  public_website_url?: unknown;
  public_rules?: unknown;
  public_language?: unknown;
  public_region_label?: unknown;
};

export type ValidatedPublicListing = {
  public_short_description: string | null;
  public_description: string | null;
  public_discord_invite: string | null;
  public_website_url: string | null;
  public_rules: string | null;
  public_language: string | null;
  public_region_label: string | null;
};

export type ReviewInput = {
  rating?: unknown;
  title?: unknown;
  body?: unknown;
};

export type ValidatedReview = {
  rating: number;
  title: string | null;
  body: string;
  status: "approved";
};

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string; reason?: string };

const UNSAFE_LINK_MESSAGE = "That link is not allowed.";
const LISTING_ERROR = "Public listing contains invalid or unsafe content.";
const REVIEW_ERROR = "Your review could not be posted because it contains inappropriate or unsafe language.";

const BLOCKED_REVIEW_PATTERNS = [
  /\b(?:rape|rapist|porn|xxx|sexual\s+(?:assault|abuse))\b/i,
  /\b(?:kill\s+yourself|kys|suicide\s+bait|self\s*harm)\b/i,
  /\b(?:terrorist\s+threat|bomb\s+threat|doxx|doxxing)\b/i,
  /\b(?:nazi|white\s+power|racial\s+slur)\b/i,
  /\b(?:cunt|fag|retard|nonce|pedo|paedo)\b/i,
];

const RUDE_SPAM_PATTERNS = [
  /\b(?:fuck\s+you|piece\s+of\s+shit|shit\s+server|trash\s+admins?)\b/i,
  /\b(?:scam|scammer)\b.*\b(?:discord|server|admin)\b/i,
];

export function validatePublicListingInput(input: PublicListingInput): ValidationResult<ValidatedPublicListing> {
  const shortDescription = cleanOptionalText(input.public_short_description, PUBLIC_LISTING_LIMITS.shortDescription, { stripHtml: true });
  const description = cleanOptionalText(input.public_description, PUBLIC_LISTING_LIMITS.description, { stripHtml: true });
  const rules = cleanOptionalText(input.public_rules, PUBLIC_LISTING_LIMITS.rules, { stripHtml: true });
  const language = cleanOptionalText(input.public_language, PUBLIC_LISTING_LIMITS.language, { stripHtml: true });
  const regionLabel = cleanOptionalText(input.public_region_label, PUBLIC_LISTING_LIMITS.regionLabel, { stripHtml: true });
  const discordInvite = normalizeDiscordInvite(input.public_discord_invite);
  const websiteUrl = normalizeWebsiteUrl(input.public_website_url);
  if (!shortDescription.ok) return { ok: false, error: shortDescription.error, reason: shortDescription.reason };
  if (!description.ok) return { ok: false, error: description.error, reason: description.reason };
  if (!rules.ok) return { ok: false, error: rules.error, reason: rules.reason };
  if (!language.ok) return { ok: false, error: language.error, reason: language.reason };
  if (!regionLabel.ok) return { ok: false, error: regionLabel.error, reason: regionLabel.reason };
  if (!discordInvite.ok) return { ok: false, error: discordInvite.error, reason: discordInvite.reason };
  if (!websiteUrl.ok) return { ok: false, error: websiteUrl.error, reason: websiteUrl.reason };

  return {
    ok: true,
    value: {
      public_short_description: shortDescription.value,
      public_description: description.value,
      public_discord_invite: discordInvite.value,
      public_website_url: websiteUrl.value,
      public_rules: rules.value,
      public_language: language.value,
      public_region_label: regionLabel.value,
    },
  };
}

export function validateReviewInput(input: ReviewInput): ValidationResult<ValidatedReview> {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Choose a rating from 1 to 5.", reason: "invalid_rating" };
  }

  const title = cleanOptionalText(input.title, 80, { rejectHtml: true, rejectLinks: true });
  if (!title.ok) return { ok: false, error: REVIEW_ERROR, reason: title.reason };

  const body = cleanRequiredText(input.body, REVIEW_MAX_CHARS, { rejectHtml: true });
  if (!body.ok) return { ok: false, error: body.error, reason: body.reason };
  if (body.value.length < REVIEW_MIN_CHARS) {
    return { ok: false, error: `Review must be at least ${REVIEW_MIN_CHARS} characters.`, reason: "too_short" };
  }

  const words = wordCount(body.value);
  if (words > REVIEW_MAX_WORDS) {
    return { ok: false, error: `Review must be ${REVIEW_MAX_WORDS} words or fewer.`, reason: "too_many_words" };
  }

  const moderation = moderateReviewText(title.value, body.value);
  if (!moderation.ok) return moderation;

  return {
    ok: true,
    value: {
      rating,
      title: title.value,
      body: body.value,
      status: "approved",
    },
  };
}

export function moderateReviewText(title: string | null, body: string): ValidationResult<{ status: "approved" }> {
  const combined = `${title ?? ""}\n${body}`;
  if (containsUnsafeScheme(combined) || containsRawHtml(combined)) {
    return { ok: false, error: REVIEW_ERROR, reason: "unsafe_markup" };
  }
  if (BLOCKED_REVIEW_PATTERNS.some((pattern) => pattern.test(combined)) || RUDE_SPAM_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { ok: false, error: REVIEW_ERROR, reason: "blocked_language" };
  }
  if ((combined.match(/https?:\/\//gi) ?? []).length > 1) {
    return { ok: false, error: REVIEW_ERROR, reason: "excessive_links" };
  }
  if (/(.)\1{6,}/i.test(combined)) {
    return { ok: false, error: REVIEW_ERROR, reason: "repeated_characters" };
  }
  if (hasExcessiveCaps(combined)) {
    return { ok: false, error: REVIEW_ERROR, reason: "excessive_caps" };
  }
  if (hasRepeatedWordSpam(combined)) {
    return { ok: false, error: REVIEW_ERROR, reason: "repeated_words" };
  }
  if (containsPersonalInfoPattern(combined)) {
    return { ok: false, error: REVIEW_ERROR, reason: "personal_info" };
  }

  return { ok: true, value: { status: "approved" } };
}

export function validateReportReason(value: unknown) {
  const reason = cleanOptionalText(value, 220, { stripHtml: true });
  if (!reason.ok) return null;
  return reason.value;
}

export function reviewCooldownUntil(updatedAt: string | null | undefined, now = new Date()) {
  if (!updatedAt) return null;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;
  const until = new Date(date.getTime() + REVIEW_COOLDOWN_HOURS * 60 * 60 * 1000);
  return until.getTime() > now.getTime() ? until.toISOString() : null;
}

function cleanRequiredText(value: unknown, maxLength: number, options: { rejectHtml?: boolean } = {}): ValidationResult<string> {
  if (typeof value !== "string") return { ok: false, error: "Review text is required.", reason: "missing" };
  const cleaned = normalizePlainText(value);
  if (!cleaned) return { ok: false, error: "Review text is required.", reason: "missing" };
  if (cleaned.length > maxLength) return { ok: false, error: `Review must be ${maxLength} characters or fewer.`, reason: "too_long" };
  if (options.rejectHtml && containsRawHtml(cleaned)) return { ok: false, error: REVIEW_ERROR, reason: "raw_html" };
  if (containsUnsafeScheme(cleaned)) return { ok: false, error: REVIEW_ERROR, reason: "unsafe_scheme" };
  return { ok: true, value: cleaned };
}

function cleanOptionalText(value: unknown, maxLength: number, options: { stripHtml?: boolean; rejectHtml?: boolean; rejectLinks?: boolean } = {}): ValidationResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: LISTING_ERROR, reason: "invalid_type" };
  let cleaned = normalizePlainText(value);
  if (!cleaned) return { ok: true, value: null };
  if (containsUnsafeScheme(cleaned)) return { ok: false, error: UNSAFE_LINK_MESSAGE, reason: "unsafe_scheme" };
  if (options.rejectHtml && containsRawHtml(cleaned)) return { ok: false, error: LISTING_ERROR, reason: "raw_html" };
  if (options.rejectLinks && /(?:https?:\/\/|discord\.gg\/|discord(?:app)?\.com\/invite\/)/i.test(cleaned)) {
    return { ok: false, error: LISTING_ERROR, reason: "links_not_allowed" };
  }
  if (options.stripHtml) cleaned = cleaned.replace(/<[^>]*>/g, "").trim();
  if (cleaned.length > maxLength) return { ok: false, error: `Field must be ${maxLength} characters or fewer.`, reason: "too_long" };
  return { ok: true, value: cleaned || null };
}

function normalizeDiscordInvite(value: unknown): ValidationResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Invalid Discord invite.", reason: "invalid_type" };
  const cleaned = normalizePlainText(value);
  if (!cleaned) return { ok: true, value: null };
  if (cleaned.length > PUBLIC_LISTING_LIMITS.discordInvite || containsUnsafeScheme(cleaned) || containsRawHtml(cleaned)) {
    return { ok: false, error: "Invalid Discord invite.", reason: "invalid_discord_invite" };
  }
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:") return { ok: false, error: "Invalid Discord invite.", reason: "invalid_discord_invite" };
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    if ((host === "discord.gg" || host === "www.discord.gg") && /^\/[a-zA-Z0-9-]{2,64}$/.test(path)) {
      return { ok: true, value: url.toString() };
    }
    if ((host === "discord.com" || host === "www.discord.com") && /^\/invite\/[a-zA-Z0-9-]{2,64}$/.test(path)) {
      return { ok: true, value: url.toString() };
    }
    return { ok: false, error: "Invalid Discord invite.", reason: "invalid_discord_invite" };
  } catch {
    return { ok: false, error: "Invalid Discord invite.", reason: "invalid_discord_invite" };
  }
}

function normalizeWebsiteUrl(value: unknown): ValidationResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Invalid website URL.", reason: "invalid_type" };
  const cleaned = normalizePlainText(value);
  if (!cleaned) return { ok: true, value: null };
  if (cleaned.length > PUBLIC_LISTING_LIMITS.websiteUrl || containsRawHtml(cleaned) || containsUnsafeScheme(cleaned)) {
    return { ok: false, error: "Invalid website URL.", reason: "invalid_website_url" };
  }
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Invalid website URL.", reason: "invalid_scheme" };
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, error: "Invalid website URL.", reason: "invalid_website_url" };
  }
}

function normalizePlainText(value: string) {
  return value
    .replace(/\0/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function containsRawHtml(value: string) {
  return /<\s*\/?\s*[a-z][^>]*>/i.test(value);
}

function containsUnsafeScheme(value: string) {
  return /\b(?:javascript|data|vbscript)\s*:/i.test(value);
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function hasExcessiveCaps(value: string) {
  const letters = value.replace(/[^a-z]/gi, "");
  if (letters.length < 42) return false;
  const upper = letters.replace(/[^A-Z]/g, "");
  return upper.length / letters.length > 0.72;
}

function hasRepeatedWordSpam(value: string) {
  const words = value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  if (words.length < 8) return false;
  for (let index = 0; index <= words.length - 5; index += 1) {
    const slice = words.slice(index, index + 5);
    if (new Set(slice).size <= 2) return true;
  }
  return false;
}

function containsPersonalInfoPattern(value: string) {
  return /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(value) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value);
}
