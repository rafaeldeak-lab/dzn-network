"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Crown,
  Gem,
  Image as ImageIcon,
  LineChart,
  Lock,
  Megaphone,
  Radio,
  Server,
  Shield,
  Swords,
  Trophy,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createCheckoutSession, getBillingPlans } from "@/components/onboarding/api";
import type { BillingPlanSummary } from "@/components/onboarding/types";
import { DZN_PUBLIC_DISCORD_INVITE_URL } from "@/lib/public-discord";

type PurchasablePlanKey = "starter" | "pro";

type StaticPricingPlan = {
  key: PurchasablePlanKey;
  name: string;
  badge: string;
  price: string;
  subprice: string;
  description: string;
  buttonLabel: string;
  highlight: boolean;
  artwork: string;
  featureIntro: string;
  features: string[];
};

type ComparisonState = "included" | "excluded";

type ComparisonValueModel = {
  text: string;
  state: ComparisonState;
  detail?: string;
};

type ComparisonRow = {
  label: string;
  starter: ComparisonValueModel;
  pro: ComparisonValueModel;
};

const staticPlans: StaticPricingPlan[] = [
  {
    key: "starter",
    name: "Starter",
    badge: "2-day free trial",
    price: "£0 today",
    subprice: "then £2/month",
    description: "Entry owner access for one DayZ server, public listing basics, reviews, and guarded setup.",
    buttonLabel: "Start Starter trial",
    highlight: false,
    artwork: "/media/dzn-pricing-starter-card.png",
    featureIntro: "Built for trying DZN owner setup safely.",
    features: [
      "2-day free trial",
      "Payment method required for checkout",
      "First payment: £2 after the two-day trial",
      "Cancel before trial expiry to pay nothing",
      "1 linked DayZ server",
      "Public server profile",
      "Basic Discord advert, bump, and review posts",
      "Ratings and reviews",
      "Standard DZN embed design",
      "No leaderboard or stat advantage",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    badge: "Full DZN Access",
    price: "£10/month",
    subprice: "serious owner toolkit",
    description: "The stronger package for owners who want richer profiles, more automation, better publishing, promotion, and analytics.",
    buttonLabel: "Go Pro",
    highlight: true,
    artwork: "/media/dzn-pricing-pro-card.png",
    featureIntro: "Built to make serious communities look active, polished, and easier to manage.",
    features: [
      "Up to 3 linked DayZ servers",
      "Public/advert publication every 24h",
      "Enhanced Pro server profile presentation",
      "Custom advert banner",
      "Gallery with up to 4 JPEG images",
      "Owner announcement tools",
      "Fresh wipe and event promo blocks",
      "Multiple Discord post-type channels",
      "Expanded Discord auto posts",
      "Leaderboard, recap, and milestone posts",
      "Advanced owner analytics",
      "Listing performance signals",
      "Event promotion tools",
      "Featured and spotlight eligibility",
      "Pro visual treatment for listing cards",
      "2 promotion credits per billing period",
      "Server Wars and event-hosting upgrade path",
      "No leaderboard or stat advantage",
    ],
  },
];

const comparisonRows: ComparisonRow[] = [
  { label: "Owner setup access", starter: included("Included"), pro: included("Included") },
  { label: "Price", starter: included("£0 today, then £2/month"), pro: included("£10/month") },
  { label: "Trial", starter: included("2 days"), pro: excluded("No trial") },
  { label: "Linked DayZ servers", starter: included("1"), pro: included("Up to 3") },
  { label: "Public listing", starter: included("Included"), pro: included("Included") },
  { label: "Description limit", starter: included("500 characters"), pro: included("2,500 characters") },
  { label: "Gallery images", starter: excluded("Not included"), pro: included("Up to 4 JPEG images") },
  { label: "Custom banner", starter: excluded("Not included"), pro: included("Included") },
  { label: "Owner announcement", starter: excluded("Not included"), pro: included("Included") },
  { label: "Fresh wipe / event promo", starter: excluded("Locked"), pro: included("Included") },
  { label: "Bump cooldown", starter: included("30 days"), pro: included("7 days") },
  { label: "Discord channels", starter: included("1 channel"), pro: included("Multiple post-type channels") },
  { label: "Discord auto posts", starter: included("Basic advert, bump, review"), pro: included("Events, leaderboards, recaps, milestones") },
  { label: "Embed design", starter: included("Standard DZN style"), pro: included("Enhanced Pro style") },
  { label: "Analytics", starter: included("Limited"), pro: included("Advanced owner analytics") },
  { label: "Promotion credits", starter: excluded("Not included"), pro: included("2 per billing period") },
  { label: "Event promotion", starter: excluded("Locked"), pro: included("Included") },
  { label: "Featured and spotlight eligibility", starter: included("Standard listing only"), pro: included("Eligible, not guaranteed") },
  { label: "Server Wars hosting path", starter: excluded("Upgrade required"), pro: included("Upgrade path included") },
  { label: "Leaderboard/stat advantage", starter: excluded("No paid advantage", "Paid leaderboard boost is never sold"), pro: excluded("No paid advantage", "Paid leaderboard boost is never sold") },
  { label: "Review score advantage", starter: excluded("No paid advantage", "Paid review score boost is never sold"), pro: excluded("No paid advantage", "Paid review score boost is never sold") },
  { label: "Season/crown advantage", starter: excluded("No paid advantage", "Paid season/crown boost is never sold"), pro: excluded("No paid advantage", "Paid season/crown boost is never sold") },
];

const answers = [
  {
    question: "Does Pro affect leaderboard rank?",
    answer: "No. Pro improves presentation, publishing, promotion, Discord automation, and analytics only. Rankings and stats remain gameplay/community results.",
    icon: Trophy,
  },
  {
    question: "Can badges be bought?",
    answer: "No. Earned badges, crowns, reputation awards, event badges, and seasonal badges must be earned before they can be showcased.",
    icon: Shield,
  },
  {
    question: "Do Starter servers still compete?",
    answer: "Yes. Starter owner access can list a server, receive reviews, appear in public discovery, and compete under the same stat rules.",
    icon: Swords,
  },
  {
    question: "What does Pro improve?",
    answer: "Pro improves owner tools: richer profiles, more publishing automation, promotion credits, Discord destinations, analytics, and higher owner limits.",
    icon: BarChart3,
  },
] as const;

const flowSteps = [
  { label: "Login", detail: "Use Discord identity", icon: Users },
  { label: "Choose owner plan", detail: "Starter or Pro", icon: Crown },
  { label: "Checkout", detail: "Guarded by billing safety", icon: Lock },
  { label: "Setup", detail: "Link and manage server", icon: Server },
] as const;

const proValueSignals = [
  { label: "Profiles", value: "banners, gallery, Pro visuals", icon: ImageIcon },
  { label: "Publishing", value: "24h cadence and more channels", icon: Megaphone },
  { label: "Automation", value: "events, recaps, milestones", icon: Zap },
  { label: "Analytics", value: "stronger owner decisions", icon: LineChart },
] as const;

export default function PricingPage() {
  const [billingPlans, setBillingPlans] = useState<BillingPlanSummary[]>([]);
  const [pendingPlan, setPendingPlan] = useState<PurchasablePlanKey | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [returnTo] = useState(() => currentSafeReturnTo());

  useEffect(() => {
    let active = true;
    getBillingPlans()
      .then((response) => {
        if (active) setBillingPlans(response.plans);
      })
      .catch(() => {
        if (active) setBillingPlans([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const planState = useMemo(() => {
    const map = new Map<PurchasablePlanKey, BillingPlanSummary>();
    for (const plan of billingPlans) map.set(plan.plan_key, plan);
    return map;
  }, [billingPlans]);

  async function startCheckout(planKey: PurchasablePlanKey) {
    const configuredPlan = planState.get(planKey);
    if (configuredPlan && !configuredPlan.checkout_enabled) {
      setCheckoutError(configuredPlan.checkout_blocked_reason ?? "Checkout is not available yet.");
      return;
    }

    setCheckoutError("");
    setPendingPlan(planKey);
    try {
      const session = await createCheckoutSession(planKey, returnTo);
      window.location.assign(session.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkout could not be started.";
      if (/Unauthorized|401/i.test(message)) {
        const pricingPath = `/pricing?intent=${planKey}&returnTo=${encodeURIComponent(returnTo)}`;
        window.location.assign(`/login?returnTo=${encodeURIComponent(pricingPath)}`);
        return;
      }
      setCheckoutError(message);
    } finally {
      setPendingPlan(null);
    }
  }

  return (
    <main className="dzn-pricing-page relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <PricingBackground />

      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-8 px-5 pb-8 pt-28 sm:px-6 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-end lg:px-8">
        <div>
          <p className="inline-flex items-center gap-2 rounded-lg border border-amber-300/35 bg-amber-300/12 px-3 py-2 text-xs font-black uppercase text-amber-100 shadow-[0_0_24px_rgba(251,191,36,0.15)]">
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            Owner pricing
          </p>
          <h1 className="mt-5 max-w-5xl text-4xl font-black uppercase leading-[0.94] text-white sm:text-6xl lg:text-7xl">
            Build your DZN owner setup with Starter or go all in with Pro.
          </h1>
          <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-zinc-200 sm:text-lg">
            Players log in with Discord for free. Payment is only the owner boundary for setup, Nitrado linking, publishing, promotion, analytics, and server-management tools.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="#plans"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-amber-300 px-5 py-3 text-sm font-black uppercase text-slate-950 shadow-[0_0_32px_rgba(251,191,36,0.3)] transition hover:bg-amber-200"
            >
              Compare Plans <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href={DZN_PUBLIC_DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-5 py-3 text-sm font-black uppercase text-cyan-50 transition hover:border-cyan-200/60 hover:bg-cyan-300/16"
            >
              Join Discord
            </a>
          </div>
        </div>

        <div className="rounded-lg border border-violet-300/24 bg-slate-950/70 p-5 shadow-[0_22px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl">
          <p className="text-xs font-black uppercase text-violet-100">Owner flow</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {flowSteps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="rounded-lg border border-white/10 bg-black/38 p-4">
                  <Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                  <strong className="mt-3 block text-sm font-black uppercase text-white">{step.label}</strong>
                  <small className="mt-1 block text-sm font-semibold text-zinc-400">{step.detail}</small>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-sm font-semibold leading-6 text-zinc-300">
            Free Discord player access stays separate from this owner setup flow.
          </p>
        </div>
      </section>

      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-5 px-5 py-6 sm:px-6 lg:grid-cols-4 lg:px-8">
        {proValueSignals.map((signal) => {
          const Icon = signal.icon;
          return (
            <article key={signal.label} className="rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.18)] backdrop-blur-xl">
              <Icon className="h-5 w-5 text-amber-200" aria-hidden="true" />
              <h2 className="mt-3 text-sm font-black uppercase text-white">{signal.label}</h2>
              <p className="mt-1 text-xs font-bold uppercase leading-5 text-zinc-400">{signal.value}</p>
            </article>
          );
        })}
      </section>

      <section id="plans" className="relative z-10 mx-auto grid w-full max-w-7xl gap-6 px-5 py-8 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8">
        {staticPlans.map((plan) => (
          <PricingPlanCard
            key={plan.key}
            plan={plan}
            checkoutState={planState.get(plan.key)}
            pending={pendingPlan === plan.key}
            disabled={Boolean(pendingPlan && pendingPlan !== plan.key)}
            onCheckout={() => startCheckout(plan.key)}
          />
        ))}
      </section>

      {checkoutError ? (
        <section className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-8" role="status" aria-live="polite">
          <div className="rounded-lg border border-amber-300/35 bg-amber-300/12 p-4 text-sm font-black text-amber-100">
            {checkoutError}
          </div>
        </section>
      ) : null}

      <section className="relative z-10 mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-amber-100">Clear comparison</p>
            <h2 className="mt-1 text-3xl font-black uppercase text-white">Green ticks show included. Red X marks show what is locked or never sold.</h2>
          </div>
          <span className="w-fit rounded-lg border border-white/10 bg-black/38 px-3 py-2 text-[10px] font-black uppercase text-zinc-300">
            Starter vs Pro
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-white/12 bg-slate-950/72 shadow-[0_26px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(190px,1.1fr)_minmax(210px,0.95fr)_minmax(240px,1.05fr)] border-b border-white/10 bg-black/58 text-xs font-black uppercase text-zinc-300">
              <span className="p-4">Feature</span>
              <span className="border-l border-white/10 p-4 text-cyan-100">Starter</span>
              <span className="border-l border-amber-300/18 bg-amber-300/[0.05] p-4 text-amber-100">Pro</span>
            </div>
            {comparisonRows.map((row) => (
              <div key={row.label} className="grid grid-cols-[minmax(190px,1.1fr)_minmax(210px,0.95fr)_minmax(240px,1.05fr)] border-b border-white/8 last:border-b-0">
                <span className="p-4 text-sm font-black uppercase text-white">{row.label}</span>
                <ComparisonValue value={row.starter} />
                <ComparisonValue value={row.pro} pro />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-5 px-5 py-8 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:px-8">
        <article className="rounded-lg border border-emerald-300/24 bg-emerald-300/[0.075] p-6 shadow-[0_22px_80px_rgba(0,0,0,0.24)] backdrop-blur-xl">
          <Radio className="h-7 w-7 text-emerald-200" aria-hidden="true" />
          <h2 className="mt-4 text-2xl font-black uppercase text-white">Fair competition is fixed policy.</h2>
          <p className="mt-4 text-sm font-semibold leading-6 text-zinc-200">
            Starter and Pro can change owner presentation and management tools. They must not change leaderboard rank, K/D, score, review results, crowns, badges, season wins, event outcomes, or gameplay statistics.
          </p>
        </article>

        <div className="grid gap-4 sm:grid-cols-2">
          {answers.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.question} className="rounded-lg border border-white/12 bg-white/[0.055] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.18)] backdrop-blur-xl">
                <Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                <h3 className="mt-3 text-base font-black uppercase text-white">{item.question}</h3>
                <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">{item.answer}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 pb-16 pt-4 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-amber-300/24 bg-black/58 p-5 shadow-[0_18px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-3 text-sm font-black uppercase text-amber-100">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            Live checkout remains approval-gated
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">
            This page uses the guarded checkout endpoint. Live customer checkout stays paused unless a later approved go-live explicitly enables `DZN_LIVE_CHECKOUT_ENABLED=true`.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-black uppercase text-white">
            Back Home
          </Link>
          <Link href="/login?returnTo=%2Fservers" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-sm font-black uppercase text-cyan-100">
            Free Player Login
          </Link>
        </div>
      </section>
    </main>
  );
}

function PricingBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <Image
        src="/media/dzn-pricing-bg-layer.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="dzn-pricing-bg-layer object-cover"
      />
      <Image
        src="/media/dzn-pricing-fog-ember-overlay.png"
        alt=""
        fill
        sizes="100vw"
        className="dzn-pricing-fog-layer object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,3,10,0.94)_0%,rgba(2,3,10,0.58)_42%,rgba(2,3,10,0.9)_100%),linear-gradient(180deg,rgba(2,3,10,0.42)_0%,rgba(2,3,10,0.95)_82%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/70 to-transparent" />
    </div>
  );
}

function PricingPlanCard({
  plan,
  checkoutState,
  pending,
  disabled,
  onCheckout,
}: {
  plan: StaticPricingPlan;
  checkoutState: BillingPlanSummary | undefined;
  pending: boolean;
  disabled: boolean;
  onCheckout: () => void;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-lg border p-4 shadow-[0_30px_110px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:p-5 ${
        plan.highlight
          ? "border-amber-300/44 bg-[linear-gradient(145deg,rgba(251,191,36,0.16),rgba(5,10,24,0.88)_34%,rgba(24,8,55,0.78))]"
          : "border-cyan-300/28 bg-[linear-gradient(145deg,rgba(14,165,233,0.12),rgba(5,10,24,0.86)_34%,rgba(26,14,54,0.72))]"
      }`}
    >
      <div className="relative aspect-[16/7] overflow-hidden rounded-lg border border-white/12 bg-black/40">
        <Image src={plan.artwork} alt="" fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/10 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-end justify-between gap-2">
          <span className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase ${plan.highlight ? "border-amber-200/42 bg-amber-300/18 text-amber-50" : "border-cyan-200/36 bg-cyan-300/14 text-cyan-50"}`}>
            {plan.badge}
          </span>
          {plan.highlight ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200/45 bg-black/42 px-3 py-2 text-[10px] font-black uppercase text-amber-100">
              <Crown className="h-3.5 w-3.5" aria-hidden="true" />
              Best owner value
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 mt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-4xl font-black uppercase leading-none text-white sm:text-5xl">{plan.name}</h2>
            <p className="mt-3 text-3xl font-black text-white">{plan.price}</p>
            <p className={`mt-1 text-xs font-black uppercase ${plan.highlight ? "text-amber-100" : "text-cyan-100"}`}>{plan.subprice}</p>
          </div>
          <span className={`inline-flex h-14 w-14 items-center justify-center rounded-lg border ${plan.highlight ? "border-amber-200/35 bg-amber-300/15 text-amber-100" : "border-cyan-200/32 bg-cyan-300/12 text-cyan-100"}`}>
            {plan.highlight ? <Gem className="h-7 w-7" aria-hidden="true" /> : <Shield className="h-7 w-7" aria-hidden="true" />}
          </span>
        </div>
        <p className="mt-4 text-sm font-semibold leading-6 text-zinc-300">{plan.description}</p>
        <p className={`mt-5 rounded-lg border px-3 py-2 text-xs font-black uppercase ${plan.highlight ? "border-amber-300/25 bg-amber-300/10 text-amber-100" : "border-cyan-300/22 bg-cyan-300/10 text-cyan-100"}`}>
          {plan.featureIntro}
        </p>
        <ul className={`mt-5 grid gap-2 ${plan.highlight ? "md:grid-cols-2" : ""}`}>
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3 rounded-md border border-white/8 bg-black/24 px-3 py-2 text-sm font-bold leading-6 text-zinc-100">
              <CheckCircle2 className={`mt-1 h-4 w-4 shrink-0 ${plan.highlight ? "text-emerald-300" : "text-cyan-200"}`} aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <CheckoutButton
          plan={plan}
          checkoutState={checkoutState}
          pending={pending}
          disabled={disabled}
          onClick={onCheckout}
        />
      </div>
    </article>
  );
}

function CheckoutButton({
  plan,
  checkoutState,
  pending,
  disabled,
  onClick,
}: {
  plan: StaticPricingPlan;
  checkoutState: BillingPlanSummary | undefined;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const blockedReason = checkoutState?.checkout_enabled === false
    ? checkoutState.checkout_blocked_reason ?? "Checkout is not available yet."
    : "";
  const isDisabled = disabled || pending || Boolean(blockedReason);

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-black uppercase transition disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300 ${
          plan.highlight
            ? "bg-amber-300 text-slate-950 shadow-[0_0_32px_rgba(251,191,36,0.28)] hover:bg-amber-200"
            : "bg-cyan-300 text-slate-950 shadow-[0_0_26px_rgba(34,211,238,0.22)] hover:bg-cyan-200"
        }`}
      >
        {pending ? "Opening Checkout..." : plan.buttonLabel}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
      {blockedReason ? <p className="mt-3 text-xs font-black leading-5 text-amber-100">{blockedReason}</p> : null}
    </div>
  );
}

function ComparisonValue({ value, pro = false }: { value: ComparisonValueModel; pro?: boolean }) {
  const isIncluded = value.state === "included";
  const Icon = isIncluded ? CheckCircle2 : XCircle;
  return (
    <span
      className={`flex items-start gap-3 border-l p-4 text-sm font-black ${
        pro ? "border-amber-300/18 bg-amber-300/[0.035]" : "border-white/10"
      } ${isIncluded ? "text-emerald-100" : "text-red-100"}`}
      aria-label={`${isIncluded ? "Green tick included" : "Red X not included"}: ${value.text}`}
    >
      <Icon
        className={`mt-0.5 h-6 w-6 shrink-0 ${isIncluded ? "text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.7)]" : "text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.65)]"}`}
        aria-hidden="true"
      />
      <span>
        <span className="block">{value.text}</span>
        {value.detail ? <small className="mt-1 block text-xs font-semibold text-zinc-400">{value.detail}</small> : null}
      </span>
    </span>
  );
}

function included(text: string, detail?: string): ComparisonValueModel {
  return { text, detail, state: "included" };
}

function excluded(text: string, detail?: string): ComparisonValueModel {
  return { text, detail, state: "excluded" };
}

function safeReturnTo(value: string | null) {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function currentSafeReturnTo() {
  if (typeof window === "undefined") return "/setup";
  const params = new URLSearchParams(window.location.search);
  return safeReturnTo(params.get("returnTo")) ?? "/setup";
}
