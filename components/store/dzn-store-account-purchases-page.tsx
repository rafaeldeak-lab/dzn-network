"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Clock3,
  Crown,
  Eye,
  History,
  Loader2,
  Lock,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { FetchJsonError, fetchJsonWithRetry } from "@/lib/client-fetch";
import type {
  DznStoreAccountPurchasesErrorPayload,
  DznStoreAccountPurchasesPayload,
  DznStoreEntitlementSummary,
  DznStorePurchaseSummary,
  DznStoreStatusHistoryEntry,
  DznStoreSupporterCardStatus,
} from "@/functions/_lib/dzn-store-account-purchases";
import type {
  DznStoreSupporterCardPrivateRevealErrorPayload,
  DznStoreSupporterCardPrivateRevealPayload,
} from "@/functions/_lib/dzn-store-supporter-card-reveal";

const ACCOUNT_PURCHASES_ENDPOINT = "/api/account/purchases";
const ACCOUNT_PURCHASES_ROUTE = "/account/purchases";
const SUPPORTER_CARD_REVEAL_ENDPOINT_PREFIX = "/api/account/supporter-cards";
const SUPPORTER_CARD_REVEAL_ROUTE = "/api/account/supporter-cards/[cardRef]/reveal";
const SUPPORTER_CARD_ART_BLOCKED_REASON = "card_art_generation_requires_future_approved_slice";
const SUPPORTER_CARD_PUBLIC_REVEAL_BLOCKED_REASON = "public_reveal_requires_future_opt_in_slice";

type AccountPurchasesApiResponse = DznStoreAccountPurchasesPayload | DznStoreAccountPurchasesErrorPayload;
type SupporterCardRevealApiResponse = DznStoreSupporterCardPrivateRevealPayload | DznStoreSupporterCardPrivateRevealErrorPayload;
type LoadState = "loading" | "ready" | "unavailable" | "error";
type RevealLoadState = "idle" | "loading" | "revealed" | "unavailable" | "error";
type SupporterCardRevealState = {
  state: RevealLoadState;
  message: string;
  payload: DznStoreSupporterCardPrivateRevealPayload | null;
};

const boundaryItems = [
  "No live checkout activation",
  "No public Supporter Card reveal or sharing",
  "Private reveal is local/test, current-account only",
  "No webhook replay or operator workflow",
  "No earned spins or reward wheel runtime",
  "No billing, ranking, scoring, XP, event, review, badge, season, Server Wars, CTF, public-profile, or eligibility impact",
] as const;

export function DznStoreAccountPurchasesPage() {
  const [payload, setPayload] = useState<AccountPurchasesApiResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    fetchJsonWithRetry<AccountPurchasesApiResponse>(ACCOUNT_PURCHASES_ENDPOINT, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
      timeoutMs: 12_000,
    })
      .then((data) => {
        if (!active) return;
        setPayload(normalizeResponse(data));
        setState("ready");
        setMessage("");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof FetchJsonError && error.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent(ACCOUNT_PURCHASES_ROUTE)}`;
          return;
        }

        const apiBody = error instanceof FetchJsonError ? normalizeResponse(error.body) : null;
        if (apiBody && !isSuccessPayload(apiBody)) {
          setPayload(apiBody);
          setState("unavailable");
          setMessage(apiBody.message);
          return;
        }

        setPayload(null);
        setState("error");
        setMessage(error instanceof Error ? error.message : "DZN Account Purchases could not be loaded right now.");
      });

    return () => {
      active = false;
    };
  }, []);

  const success = isSuccessPayload(payload);
  const errorPayload = payload && !isSuccessPayload(payload) ? payload : null;
  const purchases = success ? payload.purchases : [];
  const entitlements = success ? payload.entitlements : [];
  const supporterCards = success ? payload.supporter_cards : [];
  const accountName = success ? payload.account.display_name : "DZN Player";
  const unavailableMessage = errorPayload ? errorPayload.message : message;
  const generatedAt = success ? formatDateTime(payload.generated_at) : null;

  const summaryCards = useMemo(() => [
    { label: "Purchases", value: String(success ? payload.purchases_count : 0), icon: ReceiptText },
    { label: "Entitlements", value: String(success ? payload.entitlements_count : 0), icon: ShieldCheck },
    { label: "Supporter Cards", value: String(success ? payload.supporter_cards_count : 0), icon: Crown },
  ], [payload, success]);

  return (
    <main
      className="dzn-store-page relative min-h-screen overflow-hidden bg-[#02030a] text-white"
      data-dzn-store-account-purchases-ui="read-only"
      data-dzn-store-account-purchases-endpoint={ACCOUNT_PURCHASES_ENDPOINT}
      data-supporter-card-reveal="private-local-test-guarded"
      data-public-supporter-card-reveal="blocked"
      data-supporter-card-reveal-endpoint-prefix={SUPPORTER_CARD_REVEAL_ENDPOINT_PREFIX}
      data-dzn-store-supporter-card-visual-polish="manual-qa-local-seeded"
      data-store-runtime="read-only-account-ui"
      data-live-checkout="disabled"
      data-production-mutation="none"
      data-store-account-purchases-state={state}
    >
      <DznAccountPurchasesBackground />

      <section className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 pt-28 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="relative overflow-hidden rounded-lg border border-cyan-300/20 bg-[#07131f]/82 p-5 shadow-[0_0_42px_rgba(34,211,238,0.1)] backdrop-blur sm:p-7">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
            <p className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-black uppercase text-cyan-100">
              <WalletCards className="h-4 w-4" aria-hidden="true" />
              Private Account Surface
            </p>
            <h1 className="mt-5 max-w-4xl text-4xl font-black uppercase leading-none text-white sm:text-6xl">
              DZN Account Purchases
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-200 sm:text-lg">
              View the current account&apos;s Store purchase, entitlement, and Supporter Card status from the sanitized read model. Supporter Card serial reveal is limited to a separate local/test private route after current-account ownership proof.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <SafetyPill icon={Lock} label="Private no-store" />
              <SafetyPill icon={ShieldCheck} label="Read-only ledgers" />
              <SafetyPill icon={Eye} label="Private reveal gated" />
            </div>
          </div>

          <aside className="relative overflow-hidden rounded-lg border border-amber-300/30 bg-amber-300/[0.08] p-5 shadow-[0_0_34px_rgba(251,191,36,0.12)] backdrop-blur">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/75 to-transparent" />
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-200/40 bg-amber-200/15 text-amber-100">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-black uppercase text-amber-100">Safety boundary</p>
                <h2 className="mt-2 text-xl font-black uppercase text-white">Status only</h2>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-200">
                  Public card sharing, card-art generation, operator actions, notifications, wheel runtime, and live checkout remain blocked for later approval.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-2">
              {boundaryItems.slice(0, 4).map((item) => (
                <BoundaryRow key={item}>{item}</BoundaryRow>
              ))}
            </div>
          </aside>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/store" className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/12 px-4 py-3 text-sm font-black uppercase text-cyan-50 transition hover:border-cyan-200/70 hover:bg-cyan-300/20">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Store preview
          </Link>
          <Link href="/player" className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.055] px-4 py-3 text-sm font-black uppercase text-slate-100 transition hover:border-white/25 hover:bg-white/[0.09]">
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Player hub
          </Link>
          <Link href="/pricing?intent=owner_setup&returnTo=%2Fsetup" className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300/35 bg-amber-300/12 px-4 py-3 text-sm font-black uppercase text-amber-50 transition hover:border-amber-200/70 hover:bg-amber-300/20">
            <Crown className="h-4 w-4" aria-hidden="true" />
            Owner plans
          </Link>
        </div>

        {state === "loading" ? <LoadingPanel /> : null}
        {state === "error" ? <UnavailablePanel tone="error" message={unavailableMessage} /> : null}
        {state === "unavailable" ? <UnavailablePanel tone="locked" message={unavailableMessage} /> : null}

        {success ? (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-3">
              {summaryCards.map((card) => (
                <SummaryCard key={card.label} {...card} />
              ))}
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div className="grid gap-5">
                <AccountHeader accountName={accountName} generatedAt={generatedAt} />
                <PurchaseList purchases={purchases} />
              </div>
              <div className="grid content-start gap-5">
                <SupporterCardPanel cards={supporterCards} />
                <EntitlementPanel entitlements={entitlements} />
                <FairProgressionBoundaryPanel />
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}

function DznAccountPurchasesBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <Image
        className="dzn-store-bg-layer object-cover"
        src="/media/dzn-pricing-bg-layer.png"
        alt=""
        fill
        priority
        sizes="100vw"
      />
      <Image
        className="dzn-store-fog-layer object-cover"
        src="/media/dzn-pricing-fog-ember-overlay.png"
        alt=""
        fill
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,3,10,0.78),rgba(2,3,10,0.94)_58%,#02030a)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(34,211,238,0.07)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:78px_78px] opacity-20" />
    </div>
  );
}

function AccountHeader({ accountName, generatedAt }: { accountName: string; generatedAt: string | null }) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-cyan-300/18 bg-black/36 p-5 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-cyan-100">Signed-in account</p>
          <h2 className="mt-2 text-2xl font-black uppercase text-white">{accountName}</h2>
          <p className="mt-2 text-sm font-semibold text-slate-300">
            Data source: private sanitized Store ledgers only.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-black uppercase text-emerald-100">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Current user only
        </span>
      </div>
      {generatedAt ? (
        <p className="mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase text-slate-400">
          <Clock3 className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
          Refreshed {generatedAt}
        </p>
      ) : null}
    </section>
  );
}

function PurchaseList({ purchases }: { purchases: DznStorePurchaseSummary[] }) {
  if (!purchases.length) {
    return (
      <EmptyPanel
        icon={ReceiptText}
        title="No Store purchases yet"
        body="When the sandbox read model is enabled and this account has sanitized Store ledger rows, purchase status will appear here."
      />
    );
  }

  return (
    <section className="grid gap-5" aria-label="Private Store purchases">
      {purchases.map((purchase) => (
        <PurchaseCard key={`${purchase.purchase_ref}-${purchase.product.product_key}`} purchase={purchase} />
      ))}
    </section>
  );
}

function PurchaseCard({ purchase }: { purchase: DznStorePurchaseSummary }) {
  return (
    <article className="relative overflow-hidden rounded-lg border border-white/10 bg-[#07131f]/80 p-5 shadow-[0_0_34px_rgba(34,211,238,0.08)] backdrop-blur">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/65 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-cyan-100">{purchase.purchase_ref}</p>
          <h3 className="mt-2 text-2xl font-black uppercase text-white">{purchase.product.name}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
            {purchase.product.quantity} item · {formatMoney(purchase.total_amount_minor, purchase.currency)} · terms {purchase.terms_version}
          </p>
        </div>
        <StatusPill status={purchase.status} />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <LabelState active={purchase.labels.guaranteed_purchase} label="Guaranteed purchase" />
        <LabelState active={purchase.labels.account_bound} label="Account-bound" />
        <LabelState active={purchase.labels.no_competitive_advantage} label="No competitive advantage" />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <StatusBlock
          icon={ReceiptText}
          label="Payment receipt"
          value={purchase.payment_receipt.recorded ? purchase.payment_receipt.processing_status : "Not recorded"}
          detail={purchase.payment_receipt.recorded ? purchase.payment_receipt.event_type : "No sanitized receipt row found"}
        />
        <StatusBlock
          icon={ShieldCheck}
          label="Entitlement"
          value={purchase.entitlement?.status ?? "Not granted"}
          detail={purchase.entitlement?.entitlement_key ?? "No account entitlement row"}
        />
        <StatusBlock
          icon={History}
          label="Fulfilment"
          value={purchase.fulfilment?.status ?? "Not fulfilled"}
          detail={purchase.fulfilment?.event_type ?? "No fulfilment attempt row"}
        />
        <StatusBlock
          icon={Crown}
          label="Supporter Card"
          value={purchase.supporter_card?.status ?? "Not issued"}
          detail={purchase.supporter_card
            ? purchase.supporter_card.private_reveal_available
              ? "Private reveal available in the account panel"
              : "Private reveal disabled or not viewable"
            : "No Supporter Card status row"}
        />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <HistoryList title="Order status history" rows={purchase.order_status_history} />
        <HistoryList title="Entitlement history" rows={purchase.entitlement_status_history} />
      </div>

      {purchase.refund_or_dispute ? (
        <div className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/[0.07] p-4">
          <p className="text-xs font-black uppercase text-amber-100">Refund or dispute audit</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-200">
            {purchase.refund_or_dispute.event_type}: {purchase.refund_or_dispute.local_decision} · {purchase.refund_or_dispute.decision_reason}
          </p>
        </div>
      ) : null}
    </article>
  );
}

function SupporterCardPanel({ cards }: { cards: DznStoreSupporterCardStatus[] }) {
  const [reveals, setReveals] = useState<Record<string, SupporterCardRevealState>>({});

  const revealPrivateCard = (card: DznStoreSupporterCardStatus) => {
    if (!card.private_reveal_available) return;
    const key = card.purchase_ref;
    setReveals((current) => ({
      ...current,
      [key]: { state: "loading", message: "Checking private ownership proof.", payload: null },
    }));

    fetchJsonWithRetry<SupporterCardRevealApiResponse>(revealEndpoint(card), {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
      timeoutMs: 12_000,
    })
      .then((data) => {
        const normalized = normalizeRevealResponse(data);
        if (!normalized || !isRevealSuccessPayload(normalized)) {
          const errorBody = normalized && !isRevealSuccessPayload(normalized) ? normalized : null;
          setReveals((current) => ({
            ...current,
            [key]: {
              state: "unavailable",
              message: errorBody?.message ?? "Private Supporter Card reveal is unavailable.",
              payload: null,
            },
          }));
          return;
        }

        setReveals((current) => ({
          ...current,
          [key]: { state: "revealed", message: "Private Supporter Card revealed for this account.", payload: normalized },
        }));
      })
      .catch((error) => {
        const apiBody = error instanceof FetchJsonError ? normalizeRevealResponse(error.body) : null;
        const message = apiBody && !isRevealSuccessPayload(apiBody)
          ? apiBody.message
          : "Private Supporter Card reveal could not be loaded right now.";
        setReveals((current) => ({
          ...current,
          [key]: { state: "error", message, payload: null },
        }));
      });
  };

  return (
    <section
      className="relative overflow-hidden rounded-lg border border-amber-300/30 bg-[#130b21]/82 p-5 shadow-[0_0_46px_rgba(168,85,247,0.14)] backdrop-blur"
      data-supporter-card-status-panel="private"
      data-supporter-card-reveal="private-local-test-guarded"
      data-supporter-card-visual-polish="manual-qa-local-seeded"
      data-public-supporter-card-reveal="blocked"
      data-supporter-card-reveal-route={SUPPORTER_CARD_REVEAL_ROUTE}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/80 to-transparent" />
      <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full border border-amber-200/12 bg-amber-200/[0.04] blur-3xl" aria-hidden="true" />
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-200/40 bg-amber-200/15 text-amber-100">
          <Crown className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-black uppercase text-amber-100">Supporter Card status</p>
          <h2 className="mt-2 text-xl font-black uppercase text-white">Private Supporter Card reveal</h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-200">
            Serial reveal uses a separate no-store route and only unlocks when local/test flags and current-account ledger ownership proof pass. Card art, public reveal, sharing, downloads, notifications, and live checkout stay blocked.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <RevealBadge label="Current-account proof" tone="cyan" />
            <RevealBadge label="Local/test only" tone="amber" />
            <RevealBadge label="No share/export" tone="red" />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {cards.length ? cards.map((card) => (
          <SupporterCardStatusRow
            key={`${card.purchase_ref}-${card.product_key}`}
            card={card}
            revealState={reveals[card.purchase_ref] ?? { state: "idle", message: "", payload: null }}
            onReveal={() => revealPrivateCard(card)}
          />
        )) : (
          <SupporterCardEmptyState />
        )}
      </div>
    </section>
  );
}

function SupporterCardStatusRow({
  card,
  revealState,
  onReveal,
}: {
  card: DznStoreSupporterCardStatus;
  revealState: SupporterCardRevealState;
  onReveal: () => void;
}) {
  const panelId = `supporter-card-reveal-${card.purchase_ref.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const reveal = revealState.payload;

  return (
    <article className="relative overflow-hidden rounded-lg border border-white/10 bg-black/32 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.22)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-200/0 via-amber-200/55 to-violet-200/0" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_170px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black uppercase text-cyan-100">{card.purchase_ref}</p>
            <StatusPill status={card.status} compact />
          </div>
          <h3 className="mt-3 text-lg font-black uppercase leading-tight text-white">
            DZN Founding Supporter
          </h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
            Private card status is shown from the account read model. The actual serial stays hidden until the private reveal endpoint proves this signed-in account owns the card.
          </p>
        </div>
        <SupporterCardPreviewFrame card={card} reveal={reveal?.card ?? null} />
      </div>
      <dl className="mt-5 grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm">
        <InfoPair label="Theme" value={card.selected_theme_key ?? "Not selected"} />
        <InfoPair label="Visibility" value={card.visibility_state} />
        <InfoPair label="Supporter since" value={formatDateTime(card.supporter_since)} />
        <InfoPair label="Reveal" value={card.private_reveal_available ? "private reveal available" : (card.reveal_blocked_reason ?? "private reveal unavailable").replace(/_/g, " ")} />
      </dl>
      <button
        type="button"
        disabled={!card.private_reveal_available || revealState.state === "loading"}
        aria-controls={panelId}
        aria-expanded={revealState.state === "revealed"}
        aria-disabled={!card.private_reveal_available || revealState.state === "loading"}
        onClick={onReveal}
        className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-black uppercase transition ${
          card.private_reveal_available
            ? "border-amber-200/45 bg-amber-200/15 text-amber-50 hover:border-amber-100/80 hover:bg-amber-200/24"
            : "cursor-not-allowed border-red-300/25 bg-red-950/25 text-red-100 opacity-85"
        }`}
      >
        {revealState.state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : card.private_reveal_available ? <Eye className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
        {revealState.state === "loading" ? "Checking private card" : card.private_reveal_available ? "Reveal private card" : "Private reveal disabled"}
      </button>
      <div id={panelId} className="mt-4" aria-live="polite">
        <RevealStateCallout state={revealState.state} message={revealState.message} />
        {reveal ? (
          <div
            className="relative overflow-hidden rounded-lg border border-amber-200/40 bg-[linear-gradient(135deg,rgba(251,191,36,0.18),rgba(124,58,237,0.16)_52%,rgba(34,211,238,0.12))] p-4 shadow-[0_0_44px_rgba(251,191,36,0.14)]"
            data-supporter-card-private-reveal="current-account-only"
            data-card-art-generation="blocked"
            data-public-reveal="blocked"
            data-sharing-controls="blocked"
            data-screenshot-export-controls="blocked"
          >
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:34px_34px] opacity-20" aria-hidden="true" />
            <div className="relative">
              <p className="text-xs font-black uppercase text-amber-100">Private serial reveal</p>
              <p className="mt-2 break-words text-3xl font-black uppercase tracking-normal text-white [overflow-wrap:anywhere]">{reveal.card.serial_number}</p>
              <p className="mt-2 text-xs font-semibold uppercase text-amber-100/80">
                Shown only after current-account ownership proof. Not public. Not shareable. Not exportable.
              </p>
            </div>
            <dl className="mt-4 grid gap-3 text-sm">
              <InfoPair label="Name" value={reveal.card.display_name_snapshot} />
              <InfoPair label="Status" value={reveal.card.status} />
              <InfoPair label="Theme" value={reveal.card.theme_label} />
              <InfoPair label="Issued" value={formatDateTime(reveal.card.issued_at)} />
              <InfoPair label="Card art" value={formatStatusReason(reveal.card.card_art.reason || SUPPORTER_CARD_ART_BLOCKED_REASON)} />
              <InfoPair label="Public reveal" value={formatStatusReason(reveal.card.public_reveal.reason || SUPPORTER_CARD_PUBLIC_REVEAL_BLOCKED_REASON)} />
            </dl>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SupporterCardPreviewFrame({
  card,
  reveal,
}: {
  card: DznStoreSupporterCardStatus;
  reveal: DznStoreSupporterCardPrivateRevealPayload["card"] | null;
}) {
  return (
    <div
      className="relative min-h-[150px] overflow-hidden rounded-lg border border-amber-200/30 bg-[radial-gradient(circle_at_30%_12%,rgba(251,191,36,0.28),transparent_34%),linear-gradient(135deg,rgba(6,13,24,0.96),rgba(42,18,65,0.88))] p-4"
      data-supporter-card-preview-frame="private-status"
      data-supporter-card-serial-state={reveal ? "revealed-current-account" : "masked-until-reveal"}
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:28px_28px] opacity-20" aria-hidden="true" />
      <div className="relative flex h-full min-h-[118px] flex-col justify-between gap-5">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-amber-200/45 bg-amber-200/14 text-amber-100">
            <Crown className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="rounded border border-cyan-200/28 bg-cyan-300/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">
            Private
          </span>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-amber-100">DZN Founding Supporter</p>
          <p className="mt-1 break-words text-lg font-black uppercase text-white [overflow-wrap:anywhere]">
            {reveal?.serial_number ?? "DZN-SUP-******"}
          </p>
          <p className="mt-1 break-words text-xs font-semibold uppercase text-slate-300 [overflow-wrap:anywhere]">
            {reveal?.display_name_snapshot ?? (card.private_reveal_available ? "Serial hidden until reveal" : "Reveal currently blocked")}
          </p>
        </div>
      </div>
    </div>
  );
}

function SupporterCardEmptyState() {
  return (
    <div
      className="rounded-lg border border-white/10 bg-black/30 p-5"
      data-supporter-card-empty-state="no-current-account-card"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-cyan-200/25 bg-cyan-200/10 text-cyan-100">
          <Crown className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-black uppercase text-cyan-100">No private card yet</p>
          <h3 className="mt-2 text-lg font-black uppercase text-white">No Supporter Card to reveal</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
            When a local/test Store ledger has a fulfilled current-account DZN Founding Supporter Pack, this panel shows its private status first and only reveals the serial after ownership proof.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        <BoundaryRow>No public card page is added.</BoundaryRow>
        <BoundaryRow>No card art, sharing, download, copy-link, screenshot, or export controls are added.</BoundaryRow>
        <BoundaryRow>No live checkout, Store fulfilment change, earned spin, or reward wheel runtime is added.</BoundaryRow>
      </div>
    </div>
  );
}

function RevealStateCallout({ state, message }: { state: RevealLoadState; message: string }) {
  if (state === "idle") return null;

  if (state === "loading") {
    return (
      <div className="mb-4 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.07] p-3 text-sm font-semibold leading-6 text-cyan-50">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking current-account proof.
        </span>
      </div>
    );
  }

  if (state === "revealed") {
    return (
      <div className="mb-4 rounded-lg border border-emerald-300/22 bg-emerald-300/[0.08] p-3 text-sm font-semibold leading-6 text-emerald-50">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {message || "Private Supporter Card revealed for this account."}
        </span>
      </div>
    );
  }

  return (
    <div
      className="mb-4 rounded-lg border border-amber-300/22 bg-amber-300/[0.08] p-3 text-sm font-semibold leading-6 text-amber-50"
      data-supporter-card-reveal-error-state={state}
    >
      <span className="inline-flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {message || "Private Supporter Card reveal is unavailable."}
      </span>
    </div>
  );
}

function RevealBadge({ label, tone }: { label: string; tone: "cyan" | "amber" | "red" }) {
  const className = tone === "cyan"
    ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
    : tone === "amber"
      ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
      : "border-red-300/25 bg-red-950/25 text-red-100";

  return (
    <span className={`inline-flex min-h-8 items-center rounded-lg border px-3 text-[11px] font-black uppercase ${className}`}>
      {label}
    </span>
  );
}

function EntitlementPanel({ entitlements }: { entitlements: DznStoreEntitlementSummary[] }) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-cyan-300/20 bg-[#07131f]/78 p-5 backdrop-blur">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
      <p className="text-xs font-black uppercase text-cyan-100">Account entitlements</p>
      <h2 className="mt-2 text-xl font-black uppercase text-white">Cosmetic status</h2>
      <div className="mt-5 grid gap-3">
        {entitlements.length ? entitlements.map((entitlement) => (
          <article key={`${entitlement.purchase_ref}-${entitlement.entitlement_key}`} className="rounded-lg border border-white/10 bg-black/28 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-white">{entitlement.entitlement_key}</p>
                <p className="mt-1 text-xs font-semibold uppercase text-slate-400">{entitlement.product_key}</p>
              </div>
              <StatusPill status={entitlement.status} compact />
            </div>
            <dl className="mt-4 grid gap-3 text-sm">
              <InfoPair label="Visibility" value={entitlement.visibility_state} />
              <InfoPair label="Granted" value={formatDateTime(entitlement.granted_at)} />
              <InfoPair label="Revoked" value={formatDateTime(entitlement.revoked_at)} />
            </dl>
          </article>
        )) : (
          <p className="rounded-lg border border-white/10 bg-black/26 p-4 text-sm font-semibold leading-6 text-slate-300">
            No account entitlement status is available yet.
          </p>
        )}
      </div>
    </section>
  );
}

function FairProgressionBoundaryPanel() {
  return (
    <section className="relative overflow-hidden rounded-lg border border-emerald-300/20 bg-emerald-950/18 p-5 backdrop-blur">
      <p className="text-xs font-black uppercase text-emerald-100">Fair Progression Boundary</p>
      <h2 className="mt-2 text-xl font-black uppercase text-white">Presentation only</h2>
      <div className="mt-4 grid gap-2">
        {boundaryItems.map((item) => (
          <BoundaryRow key={item}>{item}</BoundaryRow>
        ))}
      </div>
    </section>
  );
}

function LoadingPanel() {
  return (
    <section className="mt-8 rounded-lg border border-cyan-300/18 bg-black/34 p-6 text-center backdrop-blur" aria-busy="true">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-200" aria-hidden="true" />
      <h2 className="mt-4 text-xl font-black uppercase text-white">Loading private purchases</h2>
      <p className="mt-2 text-sm font-semibold text-slate-300">Reading the no-store account endpoint for this signed-in session.</p>
    </section>
  );
}

function UnavailablePanel({ tone, message }: { tone: "locked" | "error"; message: string }) {
  const Icon = tone === "locked" ? Lock : AlertTriangle;
  return (
    <section className="mt-8 rounded-lg border border-amber-300/24 bg-black/42 p-6 backdrop-blur">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-amber-200/35 bg-amber-200/12 text-amber-100">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-black uppercase text-amber-100">{tone === "locked" ? "Disabled by default" : "Unavailable"}</p>
          <h2 className="mt-2 text-2xl font-black uppercase text-white">Account purchases are not available yet</h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-200">
            {message || "The private Account Purchases read model is not enabled for this environment."}
          </p>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-400">
            The page shell is present so reviewers can verify the contract, but it does not create orders, checkout sessions, Supporter Cards, notifications, or payment mutations.
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <article className="rounded-lg border border-white/10 bg-black/36 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black text-white">{value}</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-200/25 bg-cyan-200/10 text-cyan-100">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </article>
  );
}

function StatusBlock({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/26 p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-cyan-200" aria-hidden="true" />
        <p className="text-xs font-black uppercase text-slate-400">{label}</p>
      </div>
      <p className="mt-2 text-sm font-black uppercase text-white">{value}</p>
      <p className="mt-1 break-words text-xs font-semibold leading-5 text-slate-400">{detail}</p>
    </div>
  );
}

function HistoryList({ title, rows }: { title: string; rows: DznStoreStatusHistoryEntry[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <p className="text-xs font-black uppercase text-slate-400">{title}</p>
      {rows.length ? (
        <ol className="mt-3 grid gap-2">
          {rows.map((row, index) => (
            <li key={`${row.status}-${row.reason_code}-${row.created_at ?? index}`} className="text-xs font-semibold leading-5 text-slate-300">
              <span className="font-black uppercase text-white">{row.status}</span> · {row.reason_code} · {formatDateTime(row.created_at)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">No status history rows available.</p>
      )}
    </div>
  );
}

function LabelState({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black uppercase ${active ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : "border-red-300/25 bg-red-950/22 text-red-100"}`}>
      {active ? <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{label}</span>
    </div>
  );
}

function StatusPill({ status, compact = false }: { status: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-black uppercase ${compact ? "text-[11px]" : "text-xs"} ${statusTone(status)}`}>
      <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
      {status.replace(/_/g, " ")}
    </span>
  );
}

function InfoPair({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
      <dt className="text-xs font-black uppercase text-slate-500">{label}</dt>
      <dd className="break-words text-sm font-semibold text-slate-200">{value || "Not available"}</dd>
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/32 p-6 backdrop-blur">
      <Icon className="h-8 w-8 text-cyan-200" aria-hidden="true" />
      <h2 className="mt-4 text-xl font-black uppercase text-white">{title}</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{body}</p>
    </section>
  );
}

function BoundaryRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-white/10 bg-black/24 p-3 text-sm font-semibold leading-5 text-slate-200">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function SafetyPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="inline-flex min-h-12 items-center gap-3 rounded-lg border border-white/12 bg-white/[0.055] px-4 py-3 text-sm font-black uppercase text-slate-100 backdrop-blur">
      <Icon className="h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (["active", "paid", "fulfilled", "processed"].includes(normalized)) {
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  }
  if (["draft", "pending", "checkout_created", "processing", "not_recorded", "not fulfilled", "not granted", "not issued"].includes(normalized)) {
    return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  }
  if (["refunded", "revoked", "suspended", "failed", "disputed"].includes(normalized)) {
    return "border-red-300/25 bg-red-950/25 text-red-100";
  }
  return "border-slate-300/18 bg-slate-300/10 text-slate-100";
}

function formatMoney(amountMinor: number, currency: string) {
  const code = currency.trim().toUpperCase() || "GBP";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(amountMinor / 100);
  } catch {
    return `${amountMinor} ${code}`;
  }
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isSuccessPayload(payload: AccountPurchasesApiResponse | null): payload is DznStoreAccountPurchasesPayload {
  return Boolean(payload && payload.ok === true);
}

function normalizeResponse(value: unknown): AccountPurchasesApiResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<AccountPurchasesApiResponse> & Record<string, unknown>;
  if (record.route !== ACCOUNT_PURCHASES_ENDPOINT) return null;
  if (record.ok === true) return record as DznStoreAccountPurchasesPayload;
  if (record.ok === false) return record as DznStoreAccountPurchasesErrorPayload;
  return null;
}

function formatStatusReason(value: string) {
  return value.replace(/_/g, " ");
}

function revealEndpoint(card: DznStoreSupporterCardStatus) {
  return `${SUPPORTER_CARD_REVEAL_ENDPOINT_PREFIX}/${encodeURIComponent(card.purchase_ref)}/reveal`;
}

function isRevealSuccessPayload(payload: SupporterCardRevealApiResponse | null): payload is DznStoreSupporterCardPrivateRevealPayload {
  return Boolean(payload && payload.ok === true);
}

function normalizeRevealResponse(value: unknown): SupporterCardRevealApiResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<SupporterCardRevealApiResponse> & Record<string, unknown>;
  if (record.route !== SUPPORTER_CARD_REVEAL_ROUTE) return null;
  if (record.ok === true) return record as DznStoreSupporterCardPrivateRevealPayload;
  if (record.ok === false) return record as DznStoreSupporterCardPrivateRevealErrorPayload;
  return null;
}
