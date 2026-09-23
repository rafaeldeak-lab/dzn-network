import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Bot,
  Check,
  Crown,
  Gamepad2,
  Image as ImageIcon,
  Megaphone,
  Radar,
  Rocket,
  Server,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  X,
} from "lucide-react";

import { PricingCheckout } from "../../components/onboarding/pricing-checkout";
import { PublicContact } from "../../components/site/public-contact";
import { getSubscriptionPlanPublicContracts } from "../../lib/billing/plans";
import { PAYMENT_COPY, PAYMENT_FAQS } from "../../lib/billing/payment-copy";
import { DZN_PUBLIC_DISCORD_INVITE_URL } from "../../lib/public-discord";
import { DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "../../lib/support";

export const metadata: Metadata = {
  title: "DZN Pro | Advanced tools for DayZ server owners",
  description: `${PAYMENT_COPY.player} Compare Starter with DZN Pro: ${PAYMENT_COPY.proPrice}, no trial. Payment method required; monthly renewal until cancelled.`,
  alternates: { canonical: "/pricing" },
};

const plans = getSubscriptionPlanPublicContracts();
const starter = plans.find((plan) => plan.key === "starter")!;
const pro = plans.find((plan) => plan.key === "pro")!;

const proHighlights = [
  { icon: Server, value: "3", label: "linked DayZ servers" },
  { icon: Bot, value: "24", label: "Discord post and feed types" },
  { icon: Rocket, value: "24h", label: "public publishing cadence" },
  { icon: Trophy, value: "8", label: "earned showcase badges" },
] as const;

const proFeatureGroups = [
  {
    icon: BarChart3,
    title: "Advanced server intelligence",
    summary: "Turn imported server activity into owner-ready insights and richer public proof.",
    features: ["Advanced owner analytics where data is available", "Server-specific Advanced Showcase tools", "Event leaderboard detail", "30-minute eligible ADM pull cadence", "30-minute manual refresh cooldown"],
  },
  {
    icon: Megaphone,
    title: "Promotion and discovery",
    summary: "Give each connected server more ways to be found without buying competitive results.",
    features: ["Featured and spotlight rotation eligibility", "Enhanced discovery and priority visibility", "Homepage feature and server spotlight eligibility", "2 promotion credits per billing period", "Public advert publishing every 24 hours", "Organic server bump every 7 days"],
  },
  {
    icon: ImageIcon,
    title: "A stronger public profile",
    summary: "Build a recognisable server presence with more space and original visual assets.",
    features: ["2,500-character server description", "Custom advert banner", "Up to 4 JPEG gallery images", "Advanced Showcase access", "Up to 8 earned badges in the showcase", "Pro profile presentation and frame"],
  },
  {
    icon: BellRing,
    title: "Discord automation suite",
    summary: "Publish server moments, feeds and operational updates through the connected DZN bot.",
    features: ["Fresh-wipe and event announcements", "Leaderboard, longest-kill and weekly recap posts", "Kill, PvE, hit, connection and build feeds", "Server-vs-server and event leaderboard embeds", "Milestone and network-ranking posts", "Admin alerts and admin-log posts"],
  },
  {
    icon: Swords,
    title: "Events and Server Wars",
    summary: "Host community competition while keeping every score and result plan-neutral.",
    features: ["Server Wars challenge-hosting tools", "Event announcements and leaderboard posts", "Server-vs-server progress Discord posts", "Public network-ranking posts", "No paid score, rank or gameplay advantage"],
  },
  {
    icon: Radar,
    title: "Faster owner operations",
    summary: "Run more servers with shorter eligible refresh windows and deeper operational insight.",
    features: ["Up to 3 linked DayZ servers", "5-minute server-status cadence", "10-minute ADM discovery cadence", "Priority refresh capability", "Owner announcements", "Advanced listing analytics"],
  },
] as const;

const comparisonGroups = [
  {
    title: "Server operation",
    rows: [
      ["Linked DayZ servers", "1", "Up to 3"],
      ["Server-status cadence", "7 minutes", "5 minutes"],
      ["ADM discovery cadence", "15 minutes", "10 minutes"],
      ["Eligible ADM pull cadence", "60 minutes", "30 minutes"],
      ["Manual ADM refresh cooldown", "60 minutes", "30 minutes"],
    ],
  },
  {
    title: "Profile and visibility",
    rows: [
      ["Public server profile", "Included", "Enhanced"],
      ["Description length", "500 characters", "2,500 characters"],
      ["Custom advert banner", null, "Included"],
      ["JPEG gallery", null, "Up to 4 images"],
      ["Earned badge showcase", "Up to 3", "Up to 8"],
      ["Featured and spotlight rotation", null, "Eligible, not guaranteed"],
      ["Enhanced discovery", null, "Included"],
      ["Listing analytics", "Limited", "Advanced"],
    ],
  },
  {
    title: "Promotion and Discord",
    rows: [
      ["Public advert publication", "Every 72 hours", "Every 24 hours"],
      ["Organic bump cooldown", "30 days", "7 days"],
      ["Promotion credits", null, "2 per billing period"],
      ["Owner announcements", null, "Included"],
      ["Basic Discord posts", "4 types", "Included"],
      ["Advanced Discord posts and feeds", null, "20 additional types"],
      ["Admin alerts and logs", null, "Included"],
    ],
  },
  {
    title: "Analytics and competition",
    rows: [
      ["Basic stats and leaderboards", "Included", "Included"],
      ["Advanced owner analytics", null, "Included where data is available"],
      ["Event leaderboard detail", null, "Included"],
      ["Network rankings", "Included", "Included"],
      ["Server Wars hosting tools", null, "Included"],
      ["Advanced Showcase global boards", "Included", "Included"],
      ["Paid leaderboard or score advantage", null, null],
    ],
  },
] as const;

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#04070c] pb-16 text-white">
      <section className="relative min-h-[500px] overflow-hidden border-b border-cyan-300/20 bg-[url('/media/server-wars-showdown/server-wars-bg-layer.webp')] bg-cover bg-center">
        <div className="absolute inset-0 bg-[#03060bd9]" aria-hidden="true" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col justify-center px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 border border-amber-300/35 bg-black/55 px-3 py-2 text-xs font-black uppercase text-amber-100">
              <Crown aria-hidden="true" className="h-4 w-4" />
              DZN Pro for server owners
            </div>
            <h1 className="mt-6 text-4xl font-black uppercase leading-[0.95] text-white sm:text-6xl lg:text-7xl">
              Make your server impossible to overlook
            </h1>
            <p className="mt-6 max-w-3xl text-base font-semibold leading-7 text-zinc-200 sm:text-lg">
              Pro combines advanced analytics, richer server profiles, discovery tools, Discord automation and Server Wars hosting for owners who want to grow an active DayZ community.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href="#choose-plan" className="inline-flex min-h-12 items-center justify-center gap-2 bg-amber-300 px-6 text-sm font-black uppercase text-slate-950 transition hover:bg-amber-200">
                See Pro membership <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
              <Link href="/player" className="inline-flex min-h-12 items-center justify-center gap-2 border border-cyan-200/35 bg-black/45 px-6 text-sm font-black uppercase text-cyan-100 transition hover:border-cyan-200/70 hover:bg-cyan-300/10">
                <Gamepad2 aria-hidden="true" className="h-4 w-4" /> Player access is free
              </Link>
            </div>
          </div>
          <div className="mt-10 grid max-w-5xl grid-cols-2 gap-px overflow-hidden border border-white/15 bg-white/15 sm:grid-cols-4">
            {proHighlights.map(({ icon: Icon, value, label }) => (
              <div key={label} className="bg-[#07101ce6] p-4 sm:p-5">
                <Icon aria-hidden="true" className="h-5 w-5 text-cyan-200" />
                <p className="mt-3 text-2xl font-black text-white">{value}</p>
                <p className="mt-1 text-xs font-bold uppercase leading-5 text-zinc-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="pro-tools-title" className="border-b border-white/10 bg-[#07101a] py-14">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-black uppercase text-cyan-200">Everything Pro unlocks</p>
          <h2 id="pro-tools-title" className="mt-2 max-w-3xl text-3xl font-black uppercase text-white sm:text-4xl">More ways to operate, promote and grow</h2>
          <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-zinc-300">Every item below is backed by DZN&apos;s current plan registry. Availability still depends on completed setup, supported logs and the data each feature needs.</p>
          <div className="mt-9 grid gap-x-10 gap-y-9 md:grid-cols-2 xl:grid-cols-3">
            {proFeatureGroups.map(({ icon: Icon, title, summary, features }) => (
              <article key={title} className="border-t border-cyan-300/30 pt-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center border border-cyan-300/30 bg-cyan-300/10 text-cyan-100"><Icon aria-hidden="true" className="h-5 w-5" /></span>
                  <div><h3 className="text-lg font-black uppercase text-white">{title}</h3><p className="mt-2 text-sm font-semibold leading-6 text-zinc-400">{summary}</p></div>
                </div>
                <ul className="mt-5 space-y-3">{features.map((feature) => <li key={feature} className="flex items-start gap-3 text-sm font-semibold leading-5 text-zinc-200"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /><span>{feature}</span></li>)}</ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="choose-plan" aria-labelledby="choose-plan-title" className="scroll-mt-24 py-14">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase text-violet-200">Choose your owner plan</p>
            <h2 id="choose-plan-title" className="mt-2 text-3xl font-black uppercase sm:text-4xl">Start small or run the full DZN toolkit</h2>
            <p className="mt-4 text-sm font-semibold leading-6 text-zinc-300">Players use DZN for free. These subscriptions are for server owners who want connected tracking, publishing and community-growth tools.</p>
          </div>
          <div className="mt-9 grid items-stretch gap-6 lg:grid-cols-[0.82fr_1.18fr]">
            <article className="flex flex-col border border-cyan-200/25 bg-[#08111b] p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase text-cyan-200">Try the owner workflow</p><h3 className="mt-2 text-3xl font-black uppercase">{starter.name}</h3></div><Shield aria-hidden="true" className="h-8 w-8 text-cyan-200" /></div>
              <p className="mt-5 text-4xl font-black">{PAYMENT_COPY.starterPrice}</p>
              <p className="mt-2 text-sm font-bold text-cyan-100">{PAYMENT_COPY.starterOffer}</p>
              <p className="mt-4 text-sm leading-6 text-zinc-400">{PAYMENT_COPY.starterTerms}</p>
              <ul className="my-7 space-y-3 text-sm font-semibold leading-5 text-zinc-200">
                {["1 linked DayZ server", "Public profile and basic stats", "Basic leaderboards", "4 basic Discord post types", "Earned badge showcase up to 3", "Standard listing and search placement"].map((feature) => <li key={feature} className="flex items-start gap-3"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />{feature}</li>)}
              </ul>
              <div className="mt-auto"><PricingCheckout planKey="starter" /></div>
            </article>
            <article className="relative flex flex-col overflow-hidden border border-amber-300/55 bg-[#11100e] p-5 shadow-[0_0_55px_rgba(251,191,36,0.12)] sm:p-8">
              <div className="absolute right-0 top-0 bg-amber-300 px-4 py-2 text-xs font-black uppercase text-slate-950">Recommended</div>
              <div className="flex items-start justify-between gap-4 pr-24"><div><p className="text-xs font-black uppercase text-amber-200">For ambitious communities</p><h3 className="mt-2 text-4xl font-black uppercase">DZN {pro.name}</h3></div><Crown aria-hidden="true" className="hidden h-10 w-10 text-amber-200 sm:block" /></div>
              <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1"><p className="text-5xl font-black">{PAYMENT_COPY.proPrice}</p><p className="pb-1 text-sm font-bold uppercase text-zinc-400">cancel anytime</p></div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-300">{PAYMENT_COPY.proTerms}</p>
              <div className="my-7 grid gap-3 sm:grid-cols-2">
                {["Up to 3 linked servers", "Advanced analytics and stats", "Custom banner and gallery", "24 Discord post and feed types", "Faster eligible sync cadences", "Featured and spotlight eligibility", "Server Wars hosting tools", "2 promotion credits per billing period", "Event and network leaderboards", "Up to 8 earned showcase badges"].map((feature) => <div key={feature} className="flex items-start gap-3 border-b border-white/10 pb-3 text-sm font-bold leading-5 text-white"><Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><span>{feature}</span></div>)}
              </div>
              <div className="mt-auto"><PricingCheckout planKey="pro" /></div>
            </article>
          </div>
          <p className="mt-6 border-y border-white/15 py-5 text-sm leading-6 text-zinc-300">{PAYMENT_COPY.consent} {PAYMENT_COPY.returningStarter}</p>
        </div>
      </section>

      <section aria-labelledby="comparison-title" className="border-y border-white/10 bg-[#07101a] py-14">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-black uppercase text-cyan-200">Full comparison</p>
          <h2 id="comparison-title" className="mt-2 text-3xl font-black uppercase sm:text-4xl">Starter versus Pro</h2>
          <div className="mt-8 space-y-9">
            {comparisonGroups.map((group) => (
              <section key={group.title} aria-labelledby={`comparison-${slugify(group.title)}`}>
                <h3 id={`comparison-${slugify(group.title)}`} className="border-b border-violet-300/30 pb-3 text-lg font-black uppercase text-violet-100">{group.title}</h3>
                <div>
                  <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(150px,0.8fr)_minmax(150px,0.8fr)] gap-4 border-b border-white/10 px-3 py-3 text-xs font-black uppercase text-zinc-500 sm:grid"><span>Feature</span><span>Starter</span><span className="text-amber-200">Pro</span></div>
                  {group.rows.map(([label, starterValue, proValue]) => <FeatureComparisonRow key={label} label={label} starterValue={starterValue} proValue={proValue} />)}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="fairness-title" className="py-14">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div><p className="text-xs font-black uppercase text-emerald-200">Pay for tools, never results</p><h2 id="fairness-title" className="mt-2 text-3xl font-black uppercase">Pro helps you run and promote your server</h2><p className="mt-4 text-sm font-semibold leading-6 text-zinc-300">It never buys kills, ranks, badges, crowns, season wins or a stronger Server Wars score.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Imported statistics use the same formulas", "Leaderboard order stays plan-neutral", "Competitive scoring stays plan-neutral", "Badges and crowns must still be earned", "Feature rotation is eligible, not guaranteed", pro.trackingGuarantee].map((item) => <div key={item} className="flex items-start gap-3 border-l-2 border-emerald-300/45 bg-emerald-300/5 p-4 text-sm font-semibold leading-6 text-zinc-200"><Shield aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />{item}</div>)}
          </div>
        </div>
      </section>

      <section aria-labelledby="billing-answers" className="border-t border-white/10 bg-[#070912] py-14">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
          <h2 id="billing-answers" className="text-3xl font-black uppercase">Payment and trial questions</h2>
          <div className="mt-6 divide-y divide-white/15">{PAYMENT_FAQS.map((faq) => <details key={faq.question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-black"><span>{faq.question}</span><span className="text-cyan-200 transition group-open:rotate-45">+</span></summary><p className="mt-4 max-w-4xl text-sm leading-6 text-zinc-300">{faq.answer}</p></details>)}</div>
          <p className="mt-6 text-sm leading-6 text-zinc-400">Review the amount, currency and billing schedule shown in Stripe before agreeing to pay. For a private billing problem, email DZN support. Do not post card details or invoices in public channels.</p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-sm font-bold text-cyan-200">
            <a href={DZN_SUPPORT_EMAIL_HREF} className="inline-flex min-h-11 items-center underline underline-offset-4">Email {DZN_SUPPORT_EMAIL}</a>
            <a href={DZN_PUBLIC_DISCORD_INVITE_URL} className="inline-flex min-h-11 items-center underline underline-offset-4">DZN community Discord</a>
            <Link href="/terms" className="inline-flex min-h-11 items-center underline underline-offset-4">Terms</Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4">Privacy</Link>
            <Link href="/refunds" className="inline-flex min-h-11 items-center underline underline-offset-4">Cancellations and refunds</Link>
          </div>
          <PublicContact />
        </div>
      </section>
    </main>
  );
}

function FeatureComparisonRow({ label, starterValue, proValue }: { label: string; starterValue: string | null; proValue: string | null }) {
  return <div className="grid gap-3 border-b border-white/10 px-3 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(150px,0.8fr)_minmax(150px,0.8fr)] sm:gap-4"><p className="text-sm font-black text-white">{label}</p><ComparisonValue plan="Starter" value={starterValue} tone="cyan" /><ComparisonValue plan="Pro" value={proValue} tone="amber" /></div>;
}

function ComparisonValue({ plan, value, tone }: { plan: string; value: string | null; tone: "cyan" | "amber" }) {
  const Icon = value ? Check : X;
  return <div className="flex items-start gap-2 text-sm font-semibold leading-5 text-zinc-300"><span className="w-16 shrink-0 text-xs font-black uppercase text-zinc-500 sm:sr-only">{plan}</span><Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${value ? tone === "amber" ? "text-amber-200" : "text-cyan-200" : "text-zinc-600"}`} /><span>{value ?? "Not included"}</span></div>;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
