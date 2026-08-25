"use client";

import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Crown,
  Lock,
  Radio,
  Server,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
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
  description: string;
  buttonLabel: string;
  highlight: boolean;
  features: string[];
};

const staticPlans: StaticPricingPlan[] = [
  {
    key: "starter",
    name: "Starter",
    badge: "2-day free trial",
    price: "£0 today, then £2/month",
    description: "Start owner setup with one linked DayZ server, public listing tools, basic posting, and fair discovery.",
    buttonLabel: "Start Starter trial",
    highlight: false,
    features: [
      "2-day free trial",
      "Payment method required for checkout",
      "First payment: £2 after the two-day trial",
      "Cancel before trial expiry to pay nothing",
      "1 linked DayZ server",
      "Public server profile",
      "Basic Discord advert posting",
      "Ratings and reviews",
      "No leaderboard or stat advantage",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    badge: "Full DZN Access",
    price: "£10/month",
    description: "Unlock the serious owner toolkit for richer profiles, more automation, stronger publishing, promotion, and analytics.",
    buttonLabel: "Go Pro",
    highlight: true,
    features: [
      "Up to 3 linked DayZ servers",
      "Public/advert publication every 24h",
      "Enhanced server profile presentation",
      "Gallery, banner, and owner announcement tools",
      "More Discord post types and destinations",
      "2 promotion credits per billing period",
      "Advanced owner analytics",
      "No leaderboard or stat advantage",
    ],
  },
];

const comparisonRows = [
  { label: "Owner setup access", starter: { text: "Included", included: true }, pro: { text: "Included", included: true } },
  { label: "Price", starter: { text: "£0 today, then £2/month", included: true }, pro: { text: "£10/month", included: true } },
  { label: "Trial", starter: { text: "2 days", included: true }, pro: { text: "No trial", included: false } },
  { label: "Linked DayZ servers", starter: { text: "1", included: true }, pro: { text: "Up to 3", included: true } },
  { label: "Public listing", starter: { text: "Included", included: true }, pro: { text: "Included", included: true } },
  { label: "Description limit", starter: { text: "500 characters", included: true }, pro: { text: "2,500 characters", included: true } },
  { label: "Gallery images", starter: { text: "Not included", included: false }, pro: { text: "Up to 4 JPEG images", included: true } },
  { label: "Custom banner", starter: { text: "Not included", included: false }, pro: { text: "Included", included: true } },
  { label: "Bump cooldown", starter: { text: "30 days", included: true }, pro: { text: "7 days", included: true } },
  { label: "Discord channels", starter: { text: "1 channel", included: true }, pro: { text: "Multiple post-type channels", included: true } },
  { label: "Discord auto posts", starter: { text: "Basic advert, bump, review", included: true }, pro: { text: "Events, leaderboards, recaps, milestones", included: true } },
  { label: "Embed design", starter: { text: "Standard DZN style", included: true }, pro: { text: "Enhanced Pro style", included: true } },
  { label: "Analytics", starter: { text: "Limited", included: true }, pro: { text: "Advanced owner analytics", included: true } },
  { label: "Owner announcement", starter: { text: "Not included", included: false }, pro: { text: "Included", included: true } },
  { label: "Event promotion", starter: { text: "Locked", included: false }, pro: { text: "Included", included: true } },
  { label: "Featured and spotlight eligibility", starter: { text: "Standard listing", included: true }, pro: { text: "Eligible, not guaranteed", included: true } },
  { label: "Leaderboard/stat advantage", starter: { text: "No paid advantage", included: false }, pro: { text: "No paid advantage", included: false } },
  { label: "Review score advantage", starter: { text: "No paid advantage", included: false }, pro: { text: "No paid advantage", included: false } },
  { label: "Season/crown advantage", starter: { text: "No paid advantage", included: false }, pro: { text: "No paid advantage", included: false } },
] as const;

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
    <main className="min-h-screen bg-[#040712] text-white">
      <section className="mx-auto grid w-full max-w-7xl gap-10 px-5 pb-12 pt-28 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-end lg:px-8">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-black uppercase text-cyan-100">
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            Owner pricing
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-black uppercase leading-tight text-white sm:text-6xl">
            Starter or Pro unlocks server-owner tools.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-300 sm:text-lg">
            Players log in with Discord for free. Payment is only the owner boundary for setup, Nitrado linking, publishing, promotion, analytics, and server-management tools.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="#plans"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-5 py-3 text-sm font-black uppercase text-slate-950 transition hover:bg-cyan-200"
            >
              Compare Plans <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href={DZN_PUBLIC_DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-black uppercase text-white transition hover:bg-white/[0.1]"
            >
              Join Discord
            </a>
          </div>
        </div>

        <div className="rounded-lg border border-white/12 bg-white/[0.055] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <p className="text-xs font-black uppercase text-cyan-100">Owner flow</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {flowSteps.map((step) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="rounded-lg border border-white/10 bg-slate-950/60 p-4">
                  <Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                  <strong className="mt-3 block text-sm font-black uppercase text-white">{step.label}</strong>
                  <small className="mt-1 block text-sm text-zinc-400">{step.detail}</small>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-300">
            Free Discord player access stays separate from this owner setup flow.
          </p>
        </div>
      </section>

      <section id="plans" className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-8 sm:px-6 lg:grid-cols-2 lg:px-8">
        {staticPlans.map((plan) => (
          <article
            key={plan.key}
            className={`rounded-lg border p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] ${
              plan.highlight
                ? "border-cyan-200/35 bg-cyan-300/[0.08]"
                : "border-white/12 bg-white/[0.055]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-cyan-100">{plan.badge}</p>
                <h2 className="mt-2 text-3xl font-black uppercase text-white">{plan.name}</h2>
                <p className="mt-2 text-2xl font-black text-white">{plan.price}</p>
              </div>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-white/15 bg-slate-950/70 text-cyan-200">
                {plan.highlight ? <Crown className="h-6 w-6" aria-hidden="true" /> : <Shield className="h-6 w-6" aria-hidden="true" />}
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-300">{plan.description}</p>
            <ul className="mt-6 grid gap-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm leading-6 text-zinc-200">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <CheckoutButton
              plan={plan}
              checkoutState={planState.get(plan.key)}
              pending={pendingPlan === plan.key}
              disabled={Boolean(pendingPlan && pendingPlan !== plan.key)}
              onClick={() => startCheckout(plan.key)}
            />
          </article>
        ))}
      </section>

      {checkoutError ? (
        <section className="mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-8" role="status" aria-live="polite">
          <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm font-bold text-amber-100">
            {checkoutError}
          </div>
        </section>
      ) : null}

      <section className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-lg border border-white/12 bg-white/[0.045]">
          <div className="grid grid-cols-[minmax(150px,1.2fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)] border-b border-white/10 bg-slate-950/70 text-xs font-black uppercase text-zinc-300">
            <span className="p-4">Feature</span>
            <span className="p-4 text-cyan-100">Starter</span>
            <span className="p-4 text-cyan-100">Pro</span>
          </div>
          {comparisonRows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(150px,1.2fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)] border-b border-white/8 last:border-b-0">
              <span className="p-4 text-sm font-bold text-white">{row.label}</span>
              <ComparisonValue value={row.starter} />
              <ComparisonValue value={row.pro} />
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-8 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <article className="rounded-lg border border-cyan-200/20 bg-cyan-300/[0.07] p-6">
          <Radio className="h-7 w-7 text-cyan-200" aria-hidden="true" />
          <h2 className="mt-4 text-2xl font-black uppercase text-white">Fair competition is fixed policy.</h2>
          <p className="mt-4 text-sm leading-6 text-zinc-300">
            Starter and Pro can change owner presentation and management tools. They must not change leaderboard rank, K/D, score, review results, crowns, badges, season wins, event outcomes, or gameplay statistics.
          </p>
        </article>

        <div className="grid gap-4 sm:grid-cols-2">
          {answers.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.question} className="rounded-lg border border-white/12 bg-white/[0.055] p-5">
                <Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                <h3 className="mt-3 text-base font-black uppercase text-white">{item.question}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-300">{item.answer}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 pb-16 pt-4 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-white/12 bg-slate-950/70 p-5">
          <div className="flex flex-wrap items-center gap-3 text-sm font-black uppercase text-cyan-100">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
            Live checkout remains approval-gated
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
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
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-5 py-3 text-sm font-black uppercase text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300"
      >
        {pending ? "Opening Checkout..." : plan.buttonLabel}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
      {blockedReason ? <p className="mt-3 text-xs font-bold leading-5 text-amber-100">{blockedReason}</p> : null}
    </div>
  );
}

function ComparisonValue({ value }: { value: { text: string; included: boolean } }) {
  const Icon = value.included ? CheckCircle2 : XCircle;
  return (
    <span className={`flex items-start gap-2 p-4 text-sm font-bold ${value.included ? "text-cyan-100" : "text-zinc-400"}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{value.text}</span>
    </span>
  );
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
