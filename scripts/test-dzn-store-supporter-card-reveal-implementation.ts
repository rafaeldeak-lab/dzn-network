import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { onRequest as revealRoute } from "../functions/api/account/supporter-cards/[cardRef]/reveal";
import {
  canRevealDznStorePrivateSupporterCard,
  DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE,
  DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION,
  normalizeDznStoreSupporterCardRevealRef,
  readDznStorePrivateSupporterCardReveal,
} from "../functions/_lib/dzn-store-supporter-card-reveal";
import {
  DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION,
  DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG,
  readDznStoreAccountPurchasesReadModel,
} from "../functions/_lib/dzn-store-account-purchases";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

const ROUTE = "functions/api/account/supporter-cards/[cardRef]/reveal.ts";
const HELPER = "functions/_lib/dzn-store-supporter-card-reveal.ts";
const ACCOUNT_READ_MODEL_HELPER = "functions/_lib/dzn-store-account-purchases.ts";
const ACCOUNT_COMPONENT = "components/store/dzn-store-account-purchases-page.tsx";
const FULFILMENT_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const DOC = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md";
const HANDOFF = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION_HANDOFF.md";
const PREFLIGHT = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md";
const PREFLIGHT_HANDOFF = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT_HANDOFF.md";
const ACCOUNT_UI_DOC = "docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md";
const ACCOUNT_READ_MODEL_DOC = "docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const PACKAGE_JSON = "package.json";
const NOW = new Date("2026-08-31T10:30:00.000Z");

const REVEAL_FLAGS = {
  DZN_STORE_SANDBOX_RUNTIME: "local",
  DZN_STORE_ENABLED: "true",
  DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED: "true",
  [DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG]: "true",
  DZN_STORE_LIVE_CHECKOUT_ENABLED: "false",
  DZN_LIVE_CHECKOUT_ENABLED: "false",
  DZN_EARNED_SPINS_ENABLED: "false",
  DZN_REWARD_WHEEL_ENABLED: "false",
};

const TEST_USER: SessionUser = {
  id: "mock-user",
  discord_id: "mock-discord-user",
  username: "RafaelDeak",
  avatar: null,
};

const SOURCE_CONFIG_FILES = [
  "cloudflare-env.d.ts",
  "wrangler.toml",
  "wrangler.adm-sync.toml",
  "wrangler.auto-update.toml",
] as const;

const FORBIDDEN_ROUTE_PATHS = [
  "functions/api/public/supporter-cards",
  "functions/api/store/supporter-card-reveal.ts",
  "functions/api/store/supporter-cards",
  "functions/api/supporter-cards",
  "functions/api/supporter-card",
  "app/account/supporter-card",
  "app/account/supporter-cards",
  "app/store/supporter-card",
  "app/supporter-card",
  "app/supporter-cards",
  "components/store/supporter-card-reveal.tsx",
  "components/store/dzn-supporter-card-reveal.tsx",
  "components/supporter",
  "components/supporter-card",
  "lib/supporter-card-art.ts",
  "functions/api/wheel",
  "app/wheel",
] as const;

const FORBIDDEN_BODY_VALUES = [
  "order_internal_player",
  "item_internal_player",
  "entitlement_internal_player",
  "card_internal_player",
  "mock-user",
  "mock-discord-user",
  "other-user",
  "other-discord-user",
  "order_internal_hidden_other",
  "item_internal_hidden_other",
  "entitlement_internal_hidden_other",
  "card_internal_hidden_other",
  "DZN-SUP-999999",
  "cs_test_store_player",
  "pi_test_store_player",
  "cus_test_private",
  "evt_store_player",
  "private@example.test",
  "insignia_seed_hash",
  "generated_insignia_json",
  "stripe_checkout_session_id",
  "stripe_payment_intent_id",
  "stripe_customer",
  "payment_method",
  "billing_address",
  "raw_body",
  "provider_payload",
  "operator_notes",
] as const;

async function main() {
  assertFilesExist();
  assertConstantsAndRefValidation();
  assertAccessGates();
  await assertDisabledByDefault();
  await assertRequiresLoginWhenEnabled();
  await assertInvalidReferenceDoesNotQueryD1();
  await assertSuccessfulPrivateReveal();
  await assertHelperSuccessfulPrivateReveal();
  await assertCrossAccountAndProbeDenial();
  await assertUnsafeCardStatesDenied();
  await assertMissingLedgerProofDenied();
  await assertAccountPurchasesReadModelRevealFlag();
  assertRuntimeBoundary();
  assertDocsAndPackageScript();
  console.log("DZN Store Supporter Card private reveal implementation tests passed.");
}

function assertFilesExist() {
  for (const path of [
    ROUTE,
    HELPER,
    ACCOUNT_READ_MODEL_HELPER,
    ACCOUNT_COMPONENT,
    FULFILMENT_MIGRATION,
    DOC,
    HANDOFF,
    PREFLIGHT,
    PREFLIGHT_HANDOFF,
    ACCOUNT_UI_DOC,
    ACCOUNT_READ_MODEL_DOC,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertConstantsAndRefValidation() {
  assert.equal(DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE, "/api/account/supporter-cards/[cardRef]/reveal");
  assert.equal(DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION, "2026-08-31.store-supporter-card-private-reveal-v1");
  assert.equal(DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION, "2026-08-31.store-account-purchases-read-model-v2");
  assert.equal(DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG, "DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED");
  assert.equal(normalizeDznStoreSupporterCardRevealRef("DZN-STORE-20260831-ABC123"), "DZN-STORE-20260831-ABC123");
  assert.equal(normalizeDznStoreSupporterCardRevealRef(" dzn-store-20260831-abc123 "), "DZN-STORE-20260831-ABC123");
  for (const value of [
    "card_internal_player",
    "entitlement_internal_player",
    "order_internal_player",
    "item_internal_player",
    "mock-user",
    "mock-discord-user",
    "DZN-SUP-000001",
    "cs_test_store_player",
    "private@example.test",
    "../DZN-STORE-20260831-ABC123",
  ]) {
    assert.equal(normalizeDznStoreSupporterCardRevealRef(value), null, `${value} must not be accepted as a card ref.`);
  }
}

function assertAccessGates() {
  const enabled = canRevealDznStorePrivateSupporterCard(REVEAL_FLAGS);
  assert.equal(enabled.ok, true, "Explicit local/test reveal flag should enable private reveal access.");

  const disabled = canRevealDznStorePrivateSupporterCard({
    ...REVEAL_FLAGS,
    [DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG]: "false",
  });
  assert.equal(disabled.ok, false, "Private reveal must be disabled by default.");
  if (!disabled.ok) {
    assert.equal(disabled.status, 404);
    assert.equal(disabled.code, "STORE_SUPPORTER_CARD_PRIVATE_REVEAL_DISABLED");
  }

  for (const [flag, value, expectedCode] of [
    ["DZN_STORE_ENABLED", "false", "STORE_DISABLED"],
    ["DZN_STORE_SANDBOX_RUNTIME", "", "STORE_SANDBOX_RUNTIME_REQUIRED"],
    ["DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED", "false", "STORE_ACCOUNT_PURCHASES_READ_MODEL_DISABLED"],
    ["DZN_STORE_LIVE_CHECKOUT_ENABLED", "true", "STORE_LIVE_CHECKOUT_BLOCKED"],
    ["DZN_LIVE_CHECKOUT_ENABLED", "true", "STORE_LIVE_CHECKOUT_BLOCKED"],
    ["DZN_EARNED_SPINS_ENABLED", "true", "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED"],
    ["DZN_REWARD_WHEEL_ENABLED", "true", "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED"],
  ] as const) {
    const result = canRevealDznStorePrivateSupporterCard({
      ...REVEAL_FLAGS,
      [flag]: value,
    });
    assert.equal(result.ok, false, `${flag}=${value} should block private reveal.`);
    if (!result.ok) assert.equal(result.code, expectedCode);
  }
}

async function assertDisabledByDefault() {
  const db = seededDb();
  const response = await callRoute({
    DB: db,
    MOCK_AUTH: "true",
    DZN_STORE_SANDBOX_RUNTIME: "local",
    DZN_STORE_ENABLED: "true",
    DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED: "true",
    DZN_LIVE_CHECKOUT_ENABLED: "false",
  } as unknown as Env, "DZN-STORE-20260831-PLAYER01");
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error, "STORE_SUPPORTER_CARD_PRIVATE_REVEAL_DISABLED");
  assert.equal(db.operations.length, 0, "Disabled private reveal must block before D1 access.");
  assertPrivateNoStoreHeaders(response);
}

async function assertRequiresLoginWhenEnabled() {
  const db = seededDb();
  const response = await callRoute({
    DB: db,
    ...REVEAL_FLAGS,
  } as unknown as Env, "DZN-STORE-20260831-PLAYER01");
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error, "Unauthorized");
  assert.equal(db.operations.length, 0, "Missing session should fail before Store ledger reads.");
  assertPrivateNoStoreHeaders(response);
}

async function assertInvalidReferenceDoesNotQueryD1() {
  const db = seededDb();
  const response = await callRoute({
    DB: db,
    MOCK_AUTH: "true",
    ...REVEAL_FLAGS,
  } as unknown as Env, "DZN-SUP-000001");
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error, "STORE_SUPPORTER_CARD_UNAVAILABLE");
  assert.equal(JSON.stringify(body).includes("DZN-SUP-000001"), false, "Serial probes must not be echoed.");
  assert.equal(db.operations.length, 0, "Invalid display refs must fail before D1 access.");
  assertPrivateNoStoreHeaders(response);
}

async function assertSuccessfulPrivateReveal() {
  const db = seededDb();
  const response = await callRoute({
    DB: db,
    MOCK_AUTH: "true",
    ...REVEAL_FLAGS,
  } as unknown as Env, "DZN-STORE-20260831-PLAYER01");
  const body = await response.json() as PrivateRevealPayload;
  const text = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.private, true);
  assert.equal(body.cache, "no-store");
  assert.equal(body.scope, "current_user");
  assert.equal(body.route, DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE);
  assert.equal(body.schema_version, DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION);
  assert.equal(body.card.card_ref, "DZN-STORE-20260831-PLAYER01");
  assert.equal(body.card.purchase_ref, "DZN-STORE-20260831-PLAYER01");
  assert.equal(body.card.product_key, "dzn-founding-supporter-pack");
  assert.equal(body.card.card_type, "founding_supporter");
  assert.equal(body.card.card_type_label, "DZN Founding Supporter");
  assert.equal(body.card.status, "active");
  assert.equal(body.card.visibility_state, "visible");
  assert.equal(body.card.serial_number, "DZN-SUP-000001");
  assert.equal(body.card.display_name_snapshot, "RafaelDeak");
  assert.equal(body.card.selected_theme_key, "signal-crown");
  assert.equal(body.card.theme_label, "Signal Crown");
  assert.equal(body.card.card_art.available, false);
  assert.equal(body.card.card_art.reason, "card_art_generation_requires_future_approved_slice");
  assert.equal(body.card.public_reveal.available, false);
  assert.equal(body.card.public_reveal.reason, "public_reveal_requires_future_opt_in_slice");
  assert.equal(body.safety.read_only, true);
  assert.equal(body.safety.current_user_only, true);
  assert.equal(body.safety.raw_internal_ids_returned, false);
  assert.equal(body.safety.raw_discord_ids_returned, false);
  assert.equal(body.safety.stripe_ids_returned, false);
  assert.equal(body.safety.generated_card_art_returned, false);
  assert.equal(body.safety.card_art_generation, false);
  assert.equal(body.safety.public_reveal, false);
  assert.equal(body.safety.sharing_controls, false);
  assert.equal(body.safety.screenshot_export_controls, false);
  assert.equal(body.safety.notifications, false);
  assert.equal(body.safety.live_checkout_enabled, false);
  assert.equal(body.safety.stripe_mutation, false);
  assert.equal(body.safety.cloudflare_config_mutation, false);
  assert.equal(body.safety.production_d1_write, false);
  assert.equal(body.safety.earned_spin_write, false);
  assert.equal(body.safety.reward_wheel_runtime, false);
  assert.equal(body.safety.issue_49_changed, false);
  assert.equal(body.safety.billing_effect, false);
  assert.equal(body.safety.owner_entitlement_effect, false);
  assert.equal(body.safety.server_ownership_effect, false);
  assert.equal(body.safety.ranking_effect, false);
  assert.equal(body.safety.discovery_effect, false);
  assert.equal(body.safety.review_effect, false);
  assert.equal(body.safety.badge_effect, false);
  assert.equal(body.safety.season_effect, false);
  assert.equal(body.safety.event_effect, false);
  assert.equal(body.safety.server_wars_effect, false);
  assert.equal(body.safety.ctf_effect, false);
  assert.equal(body.safety.xp_award_effect, false);
  assert.equal(body.safety.calling_card_award_effect, false);
  assert.equal(body.safety.public_profile_visibility_effect, false);
  assert.equal(body.safety.retained_export_effect, false);
  assert.equal(body.safety.moderation_effect, false);
  assert.equal(body.safety.competitive_eligibility_effect, false);

  for (const forbidden of FORBIDDEN_BODY_VALUES) {
    assert.equal(text.includes(forbidden), false, `Reveal response must not expose ${forbidden}.`);
  }

  assertPrivateNoStoreHeaders(response);
  assert.equal(db.operations.some((operation) => operation.type === "run"), false, "Private reveal must not perform D1 writes.");
  assert.equal(db.operations.length, 1, "Private reveal should use one joined ledger read.");
  assert.doesNotMatch(db.operations[0].sql, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i);
  assert.doesNotMatch(db.operations[0].sql, /\b(?:earned_spins|spin_ledger|wheel_cooldowns|owner_billing_accounts|server_rankings|leaderboards|server_reviews|player_xp|player_calling_card_awards)\b/i);
}

async function assertHelperSuccessfulPrivateReveal() {
  const db = seededDb();
  const result = await readDznStorePrivateSupporterCardReveal({
    DB: db,
    ...REVEAL_FLAGS,
  } as unknown as Env, TEST_USER, "dzn-store-20260831-player01", { now: NOW });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  if (result.body.ok) {
    assert.equal(result.body.generated_at, NOW.toISOString());
    assert.equal(result.body.card.serial_number, "DZN-SUP-000001");
    assert.equal(result.body.card.card_art.available, false);
  }
}

async function assertCrossAccountAndProbeDenial() {
  for (const cardRef of [
    "DZN-STORE-20260831-HIDDEN99",
    "DZN-STORE-20260831-SANDBOX1",
    "DZN-STORE-20260831-MISSING1",
  ]) {
    const db = seededDb();
    const response = await callRoute({
      DB: db,
      MOCK_AUTH: "true",
      ...REVEAL_FLAGS,
    } as unknown as Env, cardRef);
    const body = await response.json() as Record<string, unknown>;
    const text = JSON.stringify(body);

    assert.equal(response.status, 404, `${cardRef} should not be revealable to the current account.`);
    assert.equal(body.error, "STORE_SUPPORTER_CARD_UNAVAILABLE");
    assert.equal(text.includes("DZN-SUP-000001"), false);
    assert.equal(text.includes("DZN-SUP-999999"), false);
    assert.equal(text.includes(cardRef), false, "Missing/cross-account refs must not be echoed.");
    assertPrivateNoStoreHeaders(response);
  }
}

async function assertUnsafeCardStatesDenied() {
  for (const status of ["suspended", "revoked", "manual_review"] as const) {
    const db = seededDb({ cardStatus: status });
    const response = await callRoute({
      DB: db,
      MOCK_AUTH: "true",
      ...REVEAL_FLAGS,
    } as unknown as Env, "DZN-STORE-20260831-PLAYER01");
    const body = await response.json() as Record<string, unknown>;
    const text = JSON.stringify(body);

    assert.equal(response.status, 409, `${status} cards should not reveal serial/art content.`);
    assert.equal(body.error, "STORE_SUPPORTER_CARD_NOT_PRIVATELY_VIEWABLE");
    assert.equal(text.includes("DZN-SUP-000001"), false);
    assertPrivateNoStoreHeaders(response);
  }
}

async function assertMissingLedgerProofDenied() {
  for (const patch of [
    { paymentReceiptCount: 0 },
    { fulfilmentAttemptCount: 0 },
    { orderRefundedAt: "2026-08-31T10:10:00.000Z" },
    { orderRevokedAt: "2026-08-31T10:10:00.000Z" },
    { entitlementStatus: "manual_review" },
    { entitlementSuspendedAt: "2026-08-31T10:10:00.000Z" },
    { entitlementRevokedAt: "2026-08-31T10:10:00.000Z" },
    { cardSuspendedAt: "2026-08-31T10:10:00.000Z" },
    { cardRevokedAt: "2026-08-31T10:10:00.000Z" },
    { grantsXp: 1 },
  ] satisfies Array<Partial<FakeD1Patch>>) {
    const db = seededDb(patch);
    const response = await callRoute({
      DB: db,
      MOCK_AUTH: "true",
      ...REVEAL_FLAGS,
    } as unknown as Env, "DZN-STORE-20260831-PLAYER01");
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 409, `Unsafe ledger patch ${JSON.stringify(patch)} should block reveal.`);
    assert.equal(body.error, "STORE_SUPPORTER_CARD_NOT_PRIVATELY_VIEWABLE");
    assert.equal(JSON.stringify(body).includes("DZN-SUP-000001"), false);
    assertPrivateNoStoreHeaders(response);
  }
}

async function assertAccountPurchasesReadModelRevealFlag() {
  const disabledDb = seededDb();
  const disabled = await readDznStoreAccountPurchasesReadModel({
    DB: disabledDb,
    ...REVEAL_FLAGS,
    [DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG]: "false",
  } as unknown as Env, TEST_USER, { now: NOW });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.ok, true);
  if (disabled.body.ok) {
    assert.equal(disabled.body.supporter_cards[0].private_reveal_available, false);
    assert.equal(disabled.body.supporter_cards[0].reveal_blocked_reason, "supporter_card_private_reveal_disabled");
    assert.equal(JSON.stringify(disabled.body).includes("DZN-SUP-000001"), false, "Account Purchases list must not expose serials.");
  }

  const enabledDb = seededDb();
  const enabled = await readDznStoreAccountPurchasesReadModel({
    DB: enabledDb,
    ...REVEAL_FLAGS,
  } as unknown as Env, TEST_USER, { now: NOW });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.ok, true);
  if (enabled.body.ok) {
    assert.equal(enabled.body.safety.private_supporter_card_reveal, true);
    assert.equal(enabled.body.supporter_cards[0].private_reveal_available, true);
    assert.equal(enabled.body.supporter_cards[0].reveal_blocked_reason, null);
    assert.equal(JSON.stringify(enabled.body).includes("DZN-SUP-000001"), false, "Read model v2 must still keep serials out of list/status payloads.");
  }
}

function assertRuntimeBoundary() {
  for (const path of FORBIDDEN_ROUTE_PATHS) {
    assert.equal(existsSync(path), false, `${path} must remain out of scope for this private reveal slice.`);
  }

  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  assert.equal(migrationFiles.at(-1), FULFILMENT_MIGRATION, "This private reveal implementation must not add a migration after 0073.");

  for (const path of SOURCE_CONFIG_FILES) {
    if (!existsSync(path)) continue;
    const source = read(path);
    for (const flag of [
      "DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED",
      "DZN_SUPPORTER_CARD_PUBLIC_REVEAL_ENABLED",
      "DZN_SUPPORTER_CARD_ART_GENERATION_ENABLED",
      "DZN_SUPPORTER_CARD_SHARE_ENABLED",
      "DZN_SUPPORTER_CARD_EXPORT_ENABLED",
      "DZN_STORE_LIVE_CHECKOUT_ENABLED=true",
      "DZN_LIVE_CHECKOUT_ENABLED=true",
      "DZN_EARNED_SPINS_ENABLED=true",
      "DZN_REWARD_WHEEL_ENABLED=true",
    ]) {
      assert.equal(source.includes(flag), false, `${path} must not configure ${flag}.`);
    }
  }

  const route = read(ROUTE);
  const helper = read(HELPER);
  for (const source of [route, helper]) {
    assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i, "Private reveal source must be read-only.");
    assert.doesNotMatch(source, /\b(?:checkout\.sessions\.create|stripeFormRequest|stripeGetRequest|fetch\s*\(|\/checkout\/sessions|wrangler)\b/i, "Private reveal source must not call Stripe, network, or Wrangler.");
    assert.doesNotMatch(source, /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(?:earned_spins|spin_ledger|wheel_cooldowns|owner_billing_accounts|owner_plan_entitlements|linked_servers|server_rankings|server_reviews|player_xp|player_calling_card_awards)\b/i, "Private reveal source must not touch protected competitive/billing/player systems.");
  }

  for (const snippet of [
    "supporter_cards.user_id = ?",
    "account_entitlements.user_id = supporter_cards.user_id",
    "store_orders.purchasing_user_id = supporter_cards.user_id",
    "supporter_cards.entitlement_id",
    "supporter_cards.source_order_id",
    "supporter_cards.source_order_item_id",
    "store_payment_events.id = supporter_cards.issued_by_payment_event_id",
    "store_fulfilment_attempts.supporter_card_id = supporter_cards.id",
    "store_order_items.product_key = ?",
    "store_order_items.fulfilment_kind = 'supporter_card'",
  ]) {
    assertIncludes(helper, snippet, `${HELPER} must prove ownership with ledger joins: ${snippet}`);
  }

  const component = read(ACCOUNT_COMPONENT);
  for (const snippet of [
    'const SUPPORTER_CARD_REVEAL_ENDPOINT_PREFIX = "/api/account/supporter-cards";',
    "fetchJsonWithRetry<SupporterCardRevealApiResponse>(revealEndpoint(card)",
    'credentials: "include"',
    'cache: "no-store"',
    'data-public-supporter-card-reveal="blocked"',
    'data-card-art-generation="blocked"',
    'data-sharing-controls="blocked"',
    'data-screenshot-export-controls="blocked"',
    "Reveal private card",
    "card_art_generation_requires_future_approved_slice",
    "public_reveal_requires_future_opt_in_slice",
  ]) {
    assertIncludes(component, snippet, `${ACCOUNT_COMPONENT} should contain private reveal UI contract ${snippet}`);
  }
  for (const forbidden of [
    /\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i,
    /\/api\/store\/orders/i,
    /\/api\/stripe/i,
    /\/api\/billing/i,
    /\/api\/wheel/i,
    /\/api\/admin\/store/i,
    /\bnavigator\.share\b/i,
    /\bnavigator\.clipboard\b/i,
    /\bnavigator\.sendBeacon\b/i,
    /\blocalStorage\b/i,
    /\bsessionStorage\b/i,
    /\banalytics\b/i,
    /\bgtag\b/i,
    /\bposthog\b/i,
    /\btrackEvent\b/i,
    /\bcheckout\.sessions\.create\b/i,
  ]) {
    assert.doesNotMatch(component, forbidden, `${ACCOUNT_COMPONENT} must not contain forbidden UI behavior ${forbidden}.`);
  }
}

function assertDocsAndPackageScript() {
  const checks: Array<[string, string[]]> = [
    [DOC, [
      "# DZN Store Supporter Card Private Reveal Implementation",
      "`GET /api/account/supporter-cards/[cardRef]/reveal`",
      "`DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED`",
      "disabled by default",
      "current authenticated user",
      "Supporter Card serial",
      "No generated card art.",
      "No public Supporter Card reveal.",
      "No sharing, screenshot, download, export, or copy-link controls.",
      "No notification route or notification writes.",
      "No live checkout activation.",
      "No issue #49 change.",
    ]],
    [HANDOFF, [
      "# DZN Store Supporter Card Private Reveal Implementation Handoff",
      "Branch: `codex/dzn-store-supporter-card-private-reveal-implementation-20260831`",
      "Stacked on: `codex/dzn-store-supporter-card-reveal-preflight-20260831`",
      "Protected OneDrive checkout was not modified.",
      "`GET /api/account/supporter-cards/[cardRef]/reveal`",
      "No generated card art.",
      "No public Supporter Card reveal.",
      "No live checkout activation.",
      "No issue #49 change.",
    ]],
    [PREFLIGHT, [
      "The Store private Supporter Card reveal implementation is now delivered separately",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`",
    ]],
    [PREFLIGHT_HANDOFF, [
      "The Store private Supporter Card reveal implementation is now delivered separately",
      "`functions/api/account/supporter-cards/[cardRef]/reveal.ts`",
    ]],
    [ACCOUNT_UI_DOC, [
      "The Store private Supporter Card reveal implementation is now delivered separately",
      "`GET /api/account/supporter-cards/[cardRef]/reveal`",
    ]],
    [ACCOUNT_READ_MODEL_DOC, [
      "The read model v2 can advertise `private_reveal_available: true`",
      "it still does not return Supporter Card serial numbers",
    ]],
    [SAFE_PREFLIGHT, [
      "The DZN Store Supporter Card private reveal implementation is now delivered",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`",
    ]],
    [BACKLOG, [
      "## DZN Store Supporter Card Private Reveal Implementation",
      "Delivered in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md`.",
    ]],
    [MASTER_SPEC, [
      "## DZN Store Supporter Card Private Reveal Implementation Slice",
      "`functions/api/account/supporter-cards/[cardRef]/reveal.ts`",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store Supporter Card private reveal implementation adds `GET /api/account/supporter-cards/[cardRef]/reveal`",
    ]],
    [BILLING_PLANS, [
      "The DZN Store Supporter Card private reveal implementation adds a disabled-by-default private route",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md` adds the disabled-by-default private Supporter Card reveal implementation",
    ]],
  ];

  for (const [path, snippets] of checks) {
    const source = read(path);
    for (const snippet of snippets) {
      assertIncludes(source, snippet, `${path} should contain: ${snippet}`);
    }
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-supporter-card-reveal-implementation"],
    "tsx scripts/test-dzn-store-supporter-card-reveal-implementation.ts",
    "Focused private Supporter Card reveal implementation test should be wired into package scripts.",
  );
  assertIncludes(packageJson.scripts?.test ?? "", "npm run test:dzn-store-supporter-card-reveal-implementation");
}

async function callRoute(env: Env, cardRef: string, method = "GET") {
  const request = new Request(`https://dzn.test/api/account/supporter-cards/${encodeURIComponent(cardRef)}/reveal`, { method });
  return revealRoute({
    request,
    env,
    params: { cardRef },
    waitUntil: () => undefined,
    next: () => Promise.resolve(new Response(null, { status: 404 })),
    data: {},
  } satisfies PagesContext);
}

function assertPrivateNoStoreHeaders(response: Response) {
  assert.match(response.headers.get("cache-control") ?? "", /private/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.match(response.headers.get("vary") ?? "", /Cookie/i);
  assert.equal(response.headers.get("x-dzn-cache"), "BYPASS");
  assert.equal(response.headers.get("x-dzn-store-supporter-card-public-reveal"), response.status === 405 ? null : "blocked");
  assert.equal(response.headers.get("x-dzn-store-live-checkout"), response.status === 405 ? null : "disabled");
  assert.equal(response.headers.get("x-dzn-store-production-mutation"), response.status === 405 ? null : "none");
}

function seededDb(patch: Partial<FakeD1Patch> = {}) {
  const db = new FakeD1Database(patch);
  db.orders.push(
    makeOrder({
      id: "order_internal_player",
      order_number: "DZN-STORE-20260831-PLAYER01",
      purchasing_user_id: "mock-user",
      status: "paid",
      ledger_scope: "local",
      refunded_at: patch.orderRefundedAt ?? null,
      revoked_at: patch.orderRevokedAt ?? null,
    }),
    makeOrder({
      id: "order_internal_hidden_other",
      order_number: "DZN-STORE-20260831-HIDDEN99",
      purchasing_user_id: "other-user",
      purchasing_discord_id_hash: "other-discord-user",
      status: "paid",
      ledger_scope: "local",
    }),
    makeOrder({
      id: "order_internal_wrong_scope",
      order_number: "DZN-STORE-20260831-SANDBOX1",
      purchasing_user_id: "mock-user",
      status: "paid",
      ledger_scope: "sandbox",
    }),
  );
  db.items.push(
    makeItem({ id: "item_internal_player", order_id: "order_internal_player", grants_xp: patch.grantsXp ?? 0 }),
    makeItem({ id: "item_internal_hidden_other", order_id: "order_internal_hidden_other" }),
    makeItem({ id: "item_internal_wrong_scope", order_id: "order_internal_wrong_scope" }),
  );
  db.entitlements.push(
    makeEntitlement({
      id: "entitlement_internal_player",
      user_id: "mock-user",
      source_order_id: "order_internal_player",
      source_order_item_id: "item_internal_player",
      status: patch.entitlementStatus ?? "active",
      suspended_at: patch.entitlementSuspendedAt ?? null,
      revoked_at: patch.entitlementRevokedAt ?? null,
    }),
    makeEntitlement({
      id: "entitlement_internal_hidden_other",
      user_id: "other-user",
      source_order_id: "order_internal_hidden_other",
      source_order_item_id: "item_internal_hidden_other",
    }),
  );
  db.supporterCards.push(
    makeCard({
      id: "card_internal_player",
      user_id: "mock-user",
      entitlement_id: "entitlement_internal_player",
      source_order_id: "order_internal_player",
      source_order_item_id: "item_internal_player",
      serial_number: "DZN-SUP-000001",
      status: patch.cardStatus ?? "active",
      suspended_at: patch.cardSuspendedAt ?? null,
      revoked_at: patch.cardRevokedAt ?? null,
    }),
    makeCard({
      id: "card_internal_hidden_other",
      user_id: "other-user",
      entitlement_id: "entitlement_internal_hidden_other",
      source_order_id: "order_internal_hidden_other",
      source_order_item_id: "item_internal_hidden_other",
      serial_number: "DZN-SUP-999999",
    }),
  );
  db.paymentEvents.push(
    {
      id: "payment_event_internal_player",
      related_order_id: "order_internal_player",
      processing_status: "processed",
      livemode: 0,
    },
    {
      id: "payment_event_internal_hidden_other",
      related_order_id: "order_internal_hidden_other",
      processing_status: "processed",
      livemode: 0,
    },
  );
  db.fulfilmentAttempts.push(
    {
      order_id: "order_internal_player",
      order_item_id: "item_internal_player",
      supporter_card_id: "card_internal_player",
      status: "fulfilled",
      livemode: 0,
    },
    {
      order_id: "order_internal_hidden_other",
      order_item_id: "item_internal_hidden_other",
      supporter_card_id: "card_internal_hidden_other",
      status: "fulfilled",
      livemode: 0,
    },
  );
  return db;
}

function makeOrder(patch: Partial<OrderSeed>): OrderSeed {
  return {
    id: "order_internal_player",
    order_number: "DZN-STORE-20260831-PLAYER01",
    purchasing_user_id: "mock-user",
    purchasing_discord_id_hash: "mock-discord-user",
    status: "paid",
    ledger_scope: "local",
    livemode: 0,
    product_count: 1,
    currency: "gbp",
    subtotal_amount_minor: 1000,
    tax_amount_minor: 0,
    total_amount_minor: 1000,
    selected_theme_key: "signal-crown",
    terms_version: "dzn-store-sandbox-order-v1",
    created_at: "2026-08-31T10:00:00.000Z",
    updated_at: "2026-08-31T10:01:00.000Z",
    paid_at: "2026-08-31T10:00:30.000Z",
    refunded_at: null,
    revoked_at: null,
    ...patch,
  };
}

function makeItem(patch: Partial<ItemSeed>): ItemSeed {
  return {
    id: "item_internal_player",
    order_id: "order_internal_player",
    product_key: "dzn-founding-supporter-pack",
    product_name_snapshot: "DZN FOUNDING SUPPORTER PACK",
    product_type: "supporter_pack",
    fulfilment_kind: "supporter_card",
    quantity: 1,
    unit_amount_minor: 1000,
    tax_amount_minor: 0,
    total_amount_minor: 1000,
    account_bound: 1,
    guaranteed_purchase: 1,
    no_competitive_advantage: 1,
    grants_spins: 0,
    grants_xp: 0,
    grants_rank_advantage: 0,
    grants_discovery_advantage: 0,
    grants_review_advantage: 0,
    grants_event_advantage: 0,
    grants_server_wars_advantage: 0,
    grants_ctf_advantage: 0,
    grants_owner_subscription_access: 0,
    grants_competitive_eligibility: 0,
    ...patch,
  };
}

function makeEntitlement(patch: Partial<EntitlementSeed>): EntitlementSeed {
  return {
    id: "entitlement_internal_player",
    user_id: "mock-user",
    entitlement_key: "dzn_store_dzn-founding-supporter-pack",
    source_order_id: "order_internal_player",
    source_order_item_id: "item_internal_player",
    status: "active",
    visibility_state: "visible",
    livemode: 0,
    suspended_at: null,
    revoked_at: null,
    ...patch,
  };
}

function makeCard(patch: Partial<SupporterCardSeed>): SupporterCardSeed {
  return {
    id: "card_internal_player",
    user_id: "mock-user",
    entitlement_id: "entitlement_internal_player",
    source_order_id: "order_internal_player",
    source_order_item_id: "item_internal_player",
    serial_number: "DZN-SUP-000001",
    card_type: "founding_supporter",
    display_name_snapshot: "RafaelDeak",
    supporter_since: "2026-08-31T10:00:35.000Z",
    selected_theme_key: "signal-crown",
    status: "active",
    visibility_state: "visible",
    issued_by_payment_event_id: "payment_event_internal_player",
    issued_at: "2026-08-31T10:00:35.000Z",
    suspended_at: null,
    revoked_at: null,
    livemode: 0,
    ledger_scope: "local",
    ...patch,
  };
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (!stat.isDirectory()) return [root];
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}

function assertIncludes(source: string, snippet: string, message?: string) {
  assert.equal(source.includes(snippet), true, message ?? `Expected source to include ${snippet}`);
}

type PrivateRevealPayload = {
  ok: true;
  private: true;
  cache: "no-store";
  scope: "current_user";
  route: string;
  schema_version: string;
  card: {
    card_ref: string;
    purchase_ref: string;
    product_key: string;
    product_name: string;
    card_type: string;
    card_type_label: string;
    status: string;
    visibility_state: string;
    serial_number: string;
    display_name_snapshot: string;
    selected_theme_key: string;
    theme_label: string;
    issued_at: string;
    card_art: {
      available: false;
      reason: string;
    };
    public_reveal: {
      available: false;
      reason: string;
    };
  };
  safety: Record<string, boolean>;
};

type SqlOperation = {
  type: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type FakeD1Patch = {
  cardStatus: "active" | "hidden" | "suspended" | "revoked" | "manual_review";
  entitlementStatus: string;
  paymentReceiptCount: number;
  fulfilmentAttemptCount: number;
  orderRefundedAt: string;
  orderRevokedAt: string;
  entitlementSuspendedAt: string;
  entitlementRevokedAt: string;
  cardSuspendedAt: string;
  cardRevokedAt: string;
  grantsXp: 0 | 1;
};

type OrderSeed = {
  id: string;
  order_number: string;
  purchasing_user_id: string;
  purchasing_discord_id_hash: string;
  status: string;
  ledger_scope: "local" | "sandbox";
  livemode: 0;
  product_count: 1;
  currency: "gbp";
  subtotal_amount_minor: number;
  tax_amount_minor: number;
  total_amount_minor: number;
  selected_theme_key: string;
  terms_version: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  revoked_at: string | null;
};

type ItemSeed = {
  id: string;
  order_id: string;
  product_key: string;
  product_name_snapshot: string;
  product_type: string;
  fulfilment_kind: string;
  quantity: 1;
  unit_amount_minor: number;
  tax_amount_minor: number;
  total_amount_minor: number;
  account_bound: 1;
  guaranteed_purchase: 1;
  no_competitive_advantage: 1;
  grants_spins: 0;
  grants_xp: 0 | 1;
  grants_rank_advantage: 0;
  grants_discovery_advantage: 0;
  grants_review_advantage: 0;
  grants_event_advantage: 0;
  grants_server_wars_advantage: 0;
  grants_ctf_advantage: 0;
  grants_owner_subscription_access: 0;
  grants_competitive_eligibility: 0;
};

type EntitlementSeed = {
  id: string;
  user_id: string;
  entitlement_key: string;
  source_order_id: string;
  source_order_item_id: string;
  status: string;
  visibility_state: string;
  livemode: 0;
  suspended_at: string | null;
  revoked_at: string | null;
};

type SupporterCardSeed = {
  id: string;
  user_id: string;
  entitlement_id: string;
  source_order_id: string;
  source_order_item_id: string;
  serial_number: string;
  card_type: "founding_supporter";
  display_name_snapshot: string;
  supporter_since: string;
  selected_theme_key: string;
  status: string;
  visibility_state: string;
  issued_by_payment_event_id: string;
  issued_at: string;
  suspended_at: string | null;
  revoked_at: string | null;
  livemode: 0;
  ledger_scope: "local" | "sandbox";
};

type PaymentEventSeed = {
  id: string;
  related_order_id: string;
  processing_status: string;
  livemode: 0;
};

type FulfilmentAttemptSeed = {
  order_id: string;
  order_item_id: string;
  supporter_card_id: string;
  status: string;
  livemode: 0;
};

class FakeD1Database {
  operations: SqlOperation[] = [];
  orders: OrderSeed[] = [];
  items: ItemSeed[] = [];
  entitlements: EntitlementSeed[] = [];
  supporterCards: SupporterCardSeed[] = [];
  paymentEvents: PaymentEventSeed[] = [];
  fulfilmentAttempts: FulfilmentAttemptSeed[] = [];

  constructor(private readonly patch: Partial<FakeD1Patch> = {}) {}

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  all(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "all", sql, bindings });
    if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(sql)) {
      throw new Error(`Private reveal test blocked write SQL: ${sql}`);
    }
    if (/FROM\s+store_orders/i.test(sql) && /INNER\s+JOIN\s+store_order_items/i.test(sql)) {
      return this.readAccountPurchases(bindings);
    }
    return [];
  }

  first(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "first", sql, bindings });
    if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(sql)) {
      throw new Error(`Private reveal test blocked write SQL: ${sql}`);
    }
    if (/FROM\s+supporter_cards/i.test(sql)) return this.readPrivateReveal(bindings);
    return null;
  }

  run(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "run", sql, bindings });
    throw new Error(`Private reveal test blocked D1 write: ${sql}`);
  }

  private readPrivateReveal(bindings: unknown[]) {
    const ledgerScope = String(bindings[0]);
    const userId = String(bindings[1]);
    const cardLedgerScope = String(bindings[2]);
    const purchaseRef = String(bindings[3]);
    const productKey = String(bindings[4]);
    if (ledgerScope !== cardLedgerScope) return null;
    const order = this.orders.find((candidate) => (
      candidate.purchasing_user_id === userId
      && candidate.order_number === purchaseRef
      && candidate.ledger_scope === ledgerScope
      && candidate.livemode === 0
    ));
    if (!order) return null;
    const item = this.items.find((candidate) => (
      candidate.order_id === order.id
      && candidate.product_key === productKey
      && candidate.fulfilment_kind === "supporter_card"
    ));
    if (!item) return null;
    const entitlement = this.entitlements.find((candidate) => (
      candidate.user_id === userId
      && candidate.source_order_id === order.id
      && candidate.source_order_item_id === item.id
      && candidate.livemode === 0
    ));
    if (!entitlement) return null;
    const card = this.supporterCards.find((candidate) => (
      candidate.user_id === userId
      && candidate.entitlement_id === entitlement.id
      && candidate.source_order_id === order.id
      && candidate.source_order_item_id === item.id
      && candidate.ledger_scope === ledgerScope
      && candidate.livemode === 0
    ));
    if (!card) return null;
    const receiptCount = this.patch.paymentReceiptCount ?? this.paymentEvents.filter((candidate) => (
      candidate.id === card.issued_by_payment_event_id
      && candidate.related_order_id === order.id
      && candidate.processing_status === "processed"
      && candidate.livemode === 0
    )).length;
    const fulfilmentCount = this.patch.fulfilmentAttemptCount ?? this.fulfilmentAttempts.filter((candidate) => (
      candidate.order_id === order.id
      && candidate.order_item_id === item.id
      && candidate.supporter_card_id === card.id
      && ["fulfilled", "duplicate"].includes(candidate.status)
      && candidate.livemode === 0
    )).length;

    return {
      purchase_ref: order.order_number,
      order_status: order.status,
      order_refunded_at: order.refunded_at,
      order_revoked_at: order.revoked_at,
      ledger_scope: order.ledger_scope,
      product_key: item.product_key,
      product_name_snapshot: item.product_name_snapshot,
      product_type: item.product_type,
      fulfilment_kind: item.fulfilment_kind,
      account_bound: item.account_bound,
      guaranteed_purchase: item.guaranteed_purchase,
      no_competitive_advantage: item.no_competitive_advantage,
      grants_spins: item.grants_spins,
      grants_xp: item.grants_xp,
      grants_rank_advantage: item.grants_rank_advantage,
      grants_discovery_advantage: item.grants_discovery_advantage,
      grants_review_advantage: item.grants_review_advantage,
      grants_event_advantage: item.grants_event_advantage,
      grants_server_wars_advantage: item.grants_server_wars_advantage,
      grants_ctf_advantage: item.grants_ctf_advantage,
      grants_owner_subscription_access: item.grants_owner_subscription_access,
      grants_competitive_eligibility: item.grants_competitive_eligibility,
      entitlement_status: entitlement.status,
      entitlement_visibility_state: entitlement.visibility_state,
      entitlement_livemode: entitlement.livemode,
      entitlement_suspended_at: entitlement.suspended_at,
      entitlement_revoked_at: entitlement.revoked_at,
      card_status: card.status,
      card_visibility_state: card.visibility_state,
      card_livemode: card.livemode,
      serial_number: card.serial_number,
      card_type: card.card_type,
      display_name_snapshot: card.display_name_snapshot,
      supporter_since: card.supporter_since,
      selected_theme_key: card.selected_theme_key,
      issued_at: card.issued_at,
      suspended_at: card.suspended_at,
      revoked_at: card.revoked_at,
      payment_receipt_count: receiptCount,
      fulfilment_attempt_count: fulfilmentCount,
    };
  }

  private readAccountPurchases(bindings: unknown[]) {
    const userId = String(bindings[0]);
    const ledgerScope = String(bindings[1]);
    return this.orders
      .filter((order) => order.purchasing_user_id === userId && order.ledger_scope === ledgerScope && order.livemode === 0)
      .flatMap((order) => {
        const item = this.items.find((candidate) => candidate.order_id === order.id);
        if (!item) return [];
        const entitlement = this.entitlements.find((candidate) => candidate.source_order_item_id === item.id && candidate.user_id === order.purchasing_user_id) ?? null;
        const card = this.supporterCards.find((candidate) => candidate.source_order_item_id === item.id && candidate.user_id === order.purchasing_user_id) ?? null;
        return [{
          order_id: order.id,
          order_number: order.order_number,
          order_status: order.status,
          ledger_scope: order.ledger_scope,
          order_livemode: order.livemode,
          product_count: order.product_count,
          currency: order.currency,
          subtotal_amount_minor: order.subtotal_amount_minor,
          tax_amount_minor: order.tax_amount_minor,
          total_amount_minor: order.total_amount_minor,
          selected_theme_key: order.selected_theme_key,
          terms_version: order.terms_version,
          created_at: order.created_at,
          updated_at: order.updated_at,
          paid_at: order.paid_at,
          refunded_at: order.refunded_at,
          revoked_at: order.revoked_at,
          order_item_id: item.id,
          product_key: item.product_key,
          product_name_snapshot: item.product_name_snapshot,
          product_type: item.product_type,
          fulfilment_kind: item.fulfilment_kind,
          quantity: item.quantity,
          unit_amount_minor: item.unit_amount_minor,
          item_tax_amount_minor: item.tax_amount_minor,
          item_total_amount_minor: item.total_amount_minor,
          account_bound: item.account_bound,
          guaranteed_purchase: item.guaranteed_purchase,
          no_competitive_advantage: item.no_competitive_advantage,
          grants_spins: item.grants_spins,
          grants_xp: item.grants_xp,
          grants_rank_advantage: item.grants_rank_advantage,
          grants_discovery_advantage: item.grants_discovery_advantage,
          grants_review_advantage: item.grants_review_advantage,
          grants_event_advantage: item.grants_event_advantage,
          grants_server_wars_advantage: item.grants_server_wars_advantage,
          grants_ctf_advantage: item.grants_ctf_advantage,
          grants_owner_subscription_access: item.grants_owner_subscription_access,
          grants_competitive_eligibility: item.grants_competitive_eligibility,
          entitlement_key: entitlement?.entitlement_key ?? null,
          entitlement_status: entitlement?.status ?? null,
          entitlement_visibility_state: entitlement?.visibility_state ?? null,
          entitlement_granted_at: order.paid_at,
          entitlement_suspended_at: null,
          entitlement_revoked_at: null,
          supporter_card_status: card?.status ?? null,
          supporter_card_visibility_state: card?.visibility_state ?? null,
          supporter_since: card?.supporter_since ?? null,
          supporter_card_theme_key: card?.selected_theme_key ?? null,
          supporter_card_issued_at: card?.issued_at ?? null,
          supporter_card_suspended_at: card?.suspended_at ?? null,
          supporter_card_revoked_at: card?.revoked_at ?? null,
        }];
      });
  }
}

class FakeD1Statement {
  private bindings: unknown[] = [];

  constructor(private readonly db: FakeD1Database, private readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  all<T>() {
    return Promise.resolve({ results: this.db.all(this.sql, this.bindings) as T[] });
  }

  first<T>() {
    return Promise.resolve(this.db.first(this.sql, this.bindings) as T | null);
  }

  run() {
    return Promise.resolve(this.db.run(this.sql, this.bindings));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
