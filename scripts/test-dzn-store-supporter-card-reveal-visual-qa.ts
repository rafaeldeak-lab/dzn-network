import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const ACCOUNT_COMPONENT = "components/store/dzn-store-account-purchases-page.tsx";
const COMMS_SHELL = "components/community/dzn-comms-visual-shell.tsx";
const DOC = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_VISUAL_QA.md";
const HANDOFF = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_VISUAL_QA_HANDOFF.md";
const ARTIFACT_README = "docs/artifacts/dzn-store-supporter-card-reveal-visual-qa/README.md";
const ARTIFACT_JSON = "docs/artifacts/dzn-store-supporter-card-reveal-visual-qa/supporter-card-reveal-visual-qa.json";
const IMPLEMENTATION_DOC = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md";
const IMPLEMENTATION_HANDOFF = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION_HANDOFF.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const COMMS_VISUAL_TEST = "scripts/test-dzn-comms-visual-shell.ts";
const PACKAGE_JSON = "package.json";

const FORBIDDEN_ACCOUNT_UI_PATTERNS = [
  /\bmethod\s*:\s*["']POST["']/i,
  /\bmethod\s*:\s*["']PUT["']/i,
  /\bmethod\s*:\s*["']PATCH["']/i,
  /\bmethod\s*:\s*["']DELETE["']/i,
  /\/api\/store\/orders/i,
  /\/api\/stripe/i,
  /\/api\/billing/i,
  /\/api\/wheel/i,
  /\/api\/admin\/store/i,
  /checkout\.sessions\.create/i,
  /stripeFormRequest/i,
  /stripeGetRequest/i,
  /\bSTRIPE_SECRET_KEY\b/i,
  /\bSTRIPE_WEBHOOK_SECRET\b/i,
  /\bnavigator\.share\b/i,
  /\bnavigator\.clipboard\b/i,
  /\bnavigator\.sendBeacon\b/i,
  /\blocalStorage\b/i,
  /\bsessionStorage\b/i,
  /\banalytics\b/i,
  /\bgtag\b/i,
  /\bposthog\b/i,
  /\btrackEvent\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+/i,
  /\bDELETE\s+FROM\b/i,
  /\bCREATE\s+TABLE\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bwrangler\b/i,
] as const;

const FORBIDDEN_COMMS_RUNTIME_PATTERNS = [
  /\bfetch\s*\(/i,
  /fetchJsonWithRetry/i,
  /XMLHttpRequest/i,
  /new\s+WebSocket/i,
  /WebSocketPair/i,
  /EventSource/i,
  /BroadcastChannel/i,
  /localStorage/i,
  /sessionStorage/i,
  /navigator\.sendBeacon/i,
  /navigator\.clipboard/i,
  /navigator\.share/i,
  /\/api\//i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bCREATE\s+(?:TABLE|INDEX)\b/i,
  /openai\.responses/i,
  /chat\.completions/i,
  /createEmbedding/i,
  /vectorize/i,
] as const;

const REQUIRED_ACCOUNT_SNIPPETS = [
  "data-dzn-store-supporter-card-visual-polish=\"manual-qa-local-seeded\"",
  "data-supporter-card-visual-polish=\"manual-qa-local-seeded\"",
  "Private Supporter Card reveal",
  "DZN Founding Supporter",
  "DZN-SUP-******",
  "Current-account proof",
  "Local/test only",
  "No share/export",
  "data-supporter-card-preview-frame=\"private-status\"",
  "data-supporter-card-serial-state={reveal ? \"revealed-current-account\" : \"masked-until-reveal\"}",
  "data-supporter-card-empty-state=\"no-current-account-card\"",
  "Checking current-account proof.",
  "data-supporter-card-reveal-error-state={state}",
  "Private serial reveal",
  "Shown only after current-account ownership proof.",
  "data-card-art-generation=\"blocked\"",
  "data-public-reveal=\"blocked\"",
  "data-sharing-controls=\"blocked\"",
  "data-screenshot-export-controls=\"blocked\"",
] as const;

const REQUIRED_COMMS_SNIPPETS = [
  "data-dzn-comms-reactions=\"emoji-static-preview\"",
  "data-dzn-comms-reaction=\"emoji-static-preview\"",
  "emoji: \"\\u{1F680}\"",
  "emoji: \"\\u{1F44B}\"",
  "emoji: \"\\u{1F49C}\"",
  "emoji: \"\\u{1F3C6}\"",
  "emoji: \"\\u{1F525}\"",
  "emoji: \"\\u{1F3AF}\"",
  "emoji: \"\\u{1F44D}\"",
  "aria-label={`${reaction.label} reaction, ${reaction.count}`}",
] as const;

main();

function main() {
  assertFilesExist();
  assertAccountRevealVisualContract();
  assertDznCommsEmojiReactionContract();
  assertDocsAndArtifact();
  assertPackageScript();
  console.log("DZN Store Supporter Card reveal visual QA tests passed.");
}

function assertFilesExist() {
  for (const path of [
    ACCOUNT_COMPONENT,
    COMMS_SHELL,
    DOC,
    HANDOFF,
    ARTIFACT_README,
    ARTIFACT_JSON,
    IMPLEMENTATION_DOC,
    IMPLEMENTATION_HANDOFF,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    COMMS_VISUAL_TEST,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertAccountRevealVisualContract() {
  const source = read(ACCOUNT_COMPONENT);
  for (const snippet of REQUIRED_ACCOUNT_SNIPPETS) {
    assertIncludes(source, snippet, `${ACCOUNT_COMPONENT} should include ${snippet}.`);
  }

  assert.equal(
    source.includes("fetchJsonWithRetry<AccountPurchasesApiResponse>(ACCOUNT_PURCHASES_ENDPOINT"),
    true,
    "Account page should still fetch the private Account Purchases read model.",
  );
  assert.equal(
    source.includes("fetchJsonWithRetry<SupporterCardRevealApiResponse>(revealEndpoint(card)"),
    true,
    "Account page should still use only the approved private reveal endpoint.",
  );
  assert.equal(source.includes('credentials: "include"'), true, "Account page should include session credentials.");
  assert.equal(source.includes('cache: "no-store"'), true, "Account page should use no-store private reads.");
  assert.equal(source.includes("public_reveal_available"), false, "UI should not branch on future public reveal availability.");
  assert.equal(source.includes("DZN-SUP-000001"), false, "UI source must not bake in an example unmasked serial.");

  for (const pattern of FORBIDDEN_ACCOUNT_UI_PATTERNS) {
    assert.doesNotMatch(source, pattern, `${ACCOUNT_COMPONENT} must remain read-only and must not match ${pattern}.`);
  }
}

function assertDznCommsEmojiReactionContract() {
  const shell = read(COMMS_SHELL);
  for (const snippet of REQUIRED_COMMS_SNIPPETS) {
    assertIncludes(shell, snippet, `${COMMS_SHELL} should include ${snippet}.`);
  }
  assert.equal(shell.includes("{reaction.label} {reaction.count}"), false, "DZN Comms reactions should not render text labels plus counts.");

  for (const pattern of FORBIDDEN_COMMS_RUNTIME_PATTERNS) {
    assert.doesNotMatch(shell, pattern, `${COMMS_SHELL} must remain static local UI and must not match ${pattern}.`);
  }

  const visualTest = read(COMMS_VISUAL_TEST);
  assertIncludes(visualTest, "data-dzn-comms-reactions");
  assertIncludes(visualTest, "Reaction chips should render emoji plus count");
}

function assertDocsAndArtifact() {
  const docs = [
    read(DOC),
    read(HANDOFF),
    read(IMPLEMENTATION_DOC),
    read(IMPLEMENTATION_HANDOFF),
    read(BACKLOG),
    read(MASTER_SPEC),
    read(PUBLIC_ACCESS_POLICY),
    read(BILLING_PLANS),
    read(STRIPE_LIVE_CHECKLIST),
    read(ARTIFACT_README),
  ].join("\n");

  for (const snippet of [
    "DZN Store Supporter Card Reveal Visual QA",
    "visual and local QA slice only",
    "`/account/purchases`",
    "`GET /api/account/supporter-cards/[cardRef]/reveal`",
    "masked `DZN-SUP-******`",
    "No generated card art.",
    "No public Supporter Card reveal.",
    "No sharing controls.",
    "No screenshot, download, export, print, or copy-link controls.",
    "No live checkout activation.",
    "No earned-spin ledger.",
    "No reward wheel runtime.",
    "No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, webhook endpoint, or API mutation.",
    "No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.",
    "No Nitrado, Discord, analytics, tracking, AI provider credentials, vector stores, or metered model calls.",
    "No issue #49 change.",
    "static DZN Comms visual shell reaction chips",
    "actual emoji plus count",
    "personal player page/nav access polish slice",
  ]) {
    assertIncludes(docs, snippet, `Docs should include ${snippet}.`);
  }

  const artifact = JSON.parse(read(ARTIFACT_JSON)) as {
    artifact?: string;
    version?: string;
    scope?: string;
    contains_production_data?: boolean;
    contains_raw_internal_ids?: boolean;
    contains_discord_ids?: boolean;
    contains_stripe_ids?: boolean;
    contains_payment_method_data?: boolean;
    contains_billing_address?: boolean;
    contains_provider_payloads?: boolean;
    contains_operator_notes?: boolean;
    serial_redaction?: string;
    blocked_runtime?: Record<string, boolean>;
    seeded_states?: Array<Record<string, unknown>>;
  };

  assert.equal(artifact.artifact, "dzn-store-supporter-card-reveal-visual-qa");
  assert.equal(artifact.scope, "local_test_seeded_preview_only");
  assert.equal(artifact.contains_production_data, false);
  assert.equal(artifact.contains_raw_internal_ids, false);
  assert.equal(artifact.contains_discord_ids, false);
  assert.equal(artifact.contains_stripe_ids, false);
  assert.equal(artifact.contains_payment_method_data, false);
  assert.equal(artifact.contains_billing_address, false);
  assert.equal(artifact.contains_provider_payloads, false);
  assert.equal(artifact.contains_operator_notes, false);
  assert.equal(artifact.serial_redaction, "masked_until_current_account_private_reveal_success");
  assert.equal(statSync(ARTIFACT_JSON).size < 20_000, true, "Seeded QA artifact should stay bounded.");

  for (const [key, expected] of Object.entries({
    card_art_generation: false,
    public_reveal: false,
    sharing_controls: false,
    screenshot_export_controls: false,
    notifications: false,
    live_checkout: false,
    earned_spins: false,
    reward_wheel: false,
    stripe_mutation: false,
    cloudflare_mutation: false,
    production_d1_write: false,
    issue_49_change: false,
  })) {
    assert.equal(artifact.blocked_runtime?.[key], expected, `Artifact should keep ${key} blocked.`);
  }

  const stateNames = new Set((artifact.seeded_states ?? []).map((state) => state.state));
  for (const stateName of [
    "read_model_disabled",
    "no_store_purchases",
    "private_card_status_masked",
    "private_card_revealed_current_account",
    "private_reveal_unavailable",
    "cross_account_denied",
  ]) {
    assert.equal(stateNames.has(stateName), true, `Artifact should include ${stateName}.`);
  }

  const masked = (artifact.seeded_states ?? []).find((state) => state.state === "private_card_status_masked");
  assert.equal(masked?.masked_serial, "DZN-SUP-******", "Masked preview state should not expose the serial.");
  assert.equal(masked?.serial_visible, false, "Masked preview state should keep serial hidden.");

  const revealed = (artifact.seeded_states ?? []).find((state) => state.state === "private_card_revealed_current_account");
  assert.equal(revealed?.serial_number, "DZN-SUP-000001", "Reveal evidence may contain only the fake local QA serial.");
  assert.equal(revealed?.serial_visible, true, "Reveal evidence should document the private current-account reveal state.");

  const denied = (artifact.seeded_states ?? []).find((state) => state.state === "cross_account_denied");
  assert.equal(denied?.serial_visible, false, "Cross-account denied state must not show a serial.");
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-supporter-card-reveal-visual-qa"],
    "tsx scripts/test-dzn-store-supporter-card-reveal-visual-qa.ts",
    "Focused visual QA test should be wired into package scripts.",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-supporter-card-reveal-visual-qa",
    "Full npm test should include the visual QA guard.",
  );
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}

function assertIncludes(source: string, snippet: string, message?: string) {
  assert.equal(source.includes(snippet), true, message ?? `Expected source to include ${snippet}`);
}
