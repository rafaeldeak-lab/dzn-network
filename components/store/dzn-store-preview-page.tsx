import { BadgeCheck, Ban, Crown, Eye, Lock, ShieldCheck, Sparkles, Trophy, WalletCards, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import {
  readDznStorePublicPreviewContract,
  type DznStorePreviewProduct,
} from "@/functions/_lib/dzn-store-catalog";

const contract = readDznStorePublicPreviewContract();

export function DznStorePreviewPage() {
  const supporterProduct = contract.products.find((product) => product.supporterCardPreview);
  const cosmeticProducts = contract.products.filter((product) => !product.supporterCardPreview);

  return (
    <main
      className="dzn-store-page relative min-h-screen overflow-hidden bg-[#02030a] text-white"
      data-dzn-store-preview="read-only"
      data-dzn-store-preview-state={contract.state}
      data-dzn-store-checkout="disabled"
    >
      <DznStoreBackground />

      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-8 px-5 pb-10 pt-28 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-8">
        <div className="max-w-4xl">
          <p className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.16)]">
            <WalletCards className="h-4 w-4" aria-hidden="true" />
            DZN Store Preview Contract
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-black uppercase leading-[0.95] text-white drop-shadow-[0_0_30px_rgba(34,211,238,0.18)] sm:text-6xl lg:text-7xl">
            Guaranteed account-bound cosmetics, never competitive power.
          </h1>
          <p className="mt-5 max-w-3xl text-base font-semibold leading-8 text-slate-200 sm:text-lg">
            This read-only preview defines the future DZN Store browse experience. Products are shown as safe catalog metadata only: no checkout, no orders, no webhook fulfilment, no entitlements, no supporter cards, no spins, and no live payment activation.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <SafetyPill icon={BadgeCheck} label="Guaranteed purchase" />
            <SafetyPill icon={Lock} label="Account-bound" />
            <SafetyPill icon={ShieldCheck} label="No competitive advantage" />
          </div>
        </div>

        <aside className="relative overflow-hidden rounded-lg border border-amber-300/35 bg-amber-300/[0.08] p-5 shadow-[0_0_34px_rgba(251,191,36,0.12)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/75 to-transparent" />
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-amber-200/40 bg-amber-200/15 text-amber-100">
              <Ban className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-100">{contract.statusLabel}</p>
              <h2 className="mt-2 text-xl font-black uppercase text-white">Checkout disabled</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-200">
                Store browsing is a visual and data-contract slice only. Issue #49 and live checkout activation remain untouched.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-2">
            {contract.safetyBoundary.slice(0, 3).map((rule) => (
              <div key={rule} className="flex gap-2 rounded-lg border border-white/10 bg-black/24 p-3 text-sm font-semibold leading-5 text-slate-200">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-6 px-5 pb-12 sm:px-6 lg:grid-cols-[1.08fr_0.92fr] lg:px-8">
        {supporterProduct ? <SupporterCardPreview product={supporterProduct} /> : null}

        <div className="grid gap-5">
          <div className="rounded-lg border border-cyan-300/20 bg-[#07131f]/78 p-5 shadow-[0_0_44px_rgba(34,211,238,0.08)] backdrop-blur">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">Browse contract</p>
            <h2 className="mt-2 text-2xl font-black uppercase text-white">Safe catalog preview</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">
              Every product card must tell players exactly what they would receive before any future payment flow. Nothing on this page can start checkout or grant an item.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300/35 bg-emerald-300/12 px-4 py-3 text-sm font-black uppercase text-emerald-50 transition hover:border-emerald-200/70 hover:bg-emerald-300/20"
                href="/account/purchases"
              >
                <WalletCards className="h-4 w-4" aria-hidden="true" />
                Purchases
              </Link>
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/12 px-4 py-3 text-sm font-black uppercase text-cyan-50 transition hover:border-cyan-200/70 hover:bg-cyan-300/20"
                href="/player"
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                Player hub
              </Link>
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300/35 bg-amber-300/12 px-4 py-3 text-sm font-black uppercase text-amber-50 transition hover:border-amber-200/70 hover:bg-amber-300/20"
                href="/pricing?intent=owner_setup&returnTo=%2Fsetup"
              >
                <Crown className="h-4 w-4" aria-hidden="true" />
                Owner plans
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/34 p-5 backdrop-blur">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">Blocked runtime actions</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {contract.blockedRuntimeActions.map((action) => (
                <div key={action} className="flex items-center gap-2 rounded-lg border border-red-300/20 bg-red-950/22 px-3 py-2 text-xs font-black uppercase text-red-100">
                  <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {action.replace(/_/g, " ")}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-3">
          {cosmeticProducts.map((product) => (
            <ProductPreviewCard key={product.productKey} product={product} />
          ))}
        </div>
      </section>
    </main>
  );
}

function DznStoreBackground() {
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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(168,85,247,0.28),transparent_34%),radial-gradient(circle_at_82%_8%,rgba(34,211,238,0.18),transparent_30%),linear-gradient(180deg,rgba(2,3,10,0.78),rgba(2,3,10,0.92)_54%,#02030a)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(34,211,238,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:80px_80px] opacity-20" />
    </div>
  );
}

function SupporterCardPreview({ product }: { product: DznStorePreviewProduct }) {
  const card = product.supporterCardPreview;
  if (!card) return null;

  return (
    <article className="relative overflow-hidden rounded-lg border border-amber-300/35 bg-[#130b21]/82 p-5 shadow-[0_0_54px_rgba(168,85,247,0.18)] backdrop-blur">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/80 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-100">Supporter Card preview</p>
          <h2 className="mt-2 text-3xl font-black uppercase text-white">{product.name}</h2>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-200">{product.description}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-red-300/35 bg-red-950/28 px-3 py-2 text-xs font-black uppercase text-red-100">
          <Ban className="h-4 w-4" aria-hidden="true" />
          Checkout disabled
        </span>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.88fr]">
        <div className="relative min-h-[290px] overflow-hidden rounded-lg border border-amber-200/35 bg-gradient-to-br from-[#080813] via-[#1b1130] to-[#080813] p-5 shadow-[inset_0_0_42px_rgba(251,191,36,0.12)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(251,191,36,0.34),transparent_30%),radial-gradient(circle_at_78%_80%,rgba(168,85,247,0.28),transparent_36%)]" />
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-lg border border-amber-200/45 bg-amber-200/12 text-amber-100 shadow-[0_0_30px_rgba(251,191,36,0.18)]">
                <Crown className="h-8 w-8" aria-hidden="true" />
              </span>
              <span className="rounded-lg border border-cyan-200/25 bg-cyan-200/10 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-cyan-100">
                Sample only
              </span>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-100">{card.sampleSerial}</p>
              <h3 className="mt-3 text-4xl font-black uppercase leading-none text-white">Rafael DZN</h3>
              <p className="mt-2 text-sm font-black uppercase tracking-[0.18em] text-cyan-100">Supporter since preview date</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {card.themeOptions.map((theme) => (
                  <span key={theme} className="rounded-lg border border-white/12 bg-black/32 px-3 py-2 text-xs font-black uppercase text-slate-100">
                    {theme}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">Exact contents</p>
          <ul className="mt-4 grid gap-2">
            {product.exactContents.map((item) => (
              <li key={item} className="flex gap-2 rounded-lg border border-emerald-300/18 bg-emerald-950/20 p-3 text-sm font-bold leading-5 text-slate-100">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

function ProductPreviewCard({ product }: { product: DznStorePreviewProduct }) {
  return (
    <article className="relative flex min-h-[470px] flex-col overflow-hidden rounded-lg border border-cyan-300/20 bg-[#07131f]/80 p-5 shadow-[0_0_36px_rgba(34,211,238,0.08)] backdrop-blur">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">{product.previewPriceLabel}</p>
          <h3 className="mt-2 text-2xl font-black uppercase text-white">{product.name}</h3>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">{product.strapline}</p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>

      <p className="mt-4 text-sm font-semibold leading-6 text-slate-300">{product.description}</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {product.safetyLabels.map((label) => (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.045] px-2.5 py-1.5 text-[11px] font-black uppercase text-slate-100">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>

      <ul className="mt-5 grid gap-2">
        {product.exactContents.map((item) => (
          <li key={item} className="flex gap-2 text-sm font-semibold leading-5 text-slate-100">
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-5">
        <div className="grid gap-2 border-t border-white/10 pt-4">
          {product.previewNotes.map((note) => (
            <div key={note} className="flex gap-2 text-xs font-semibold leading-5 text-slate-400">
              <Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" aria-hidden="true" />
              <span>{note}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function SafetyPill({ icon: Icon, label }: { icon: typeof Zap; label: string }) {
  return (
    <div className="inline-flex min-h-12 items-center gap-3 rounded-lg border border-white/12 bg-white/[0.055] px-4 py-3 text-sm font-black uppercase text-slate-100 backdrop-blur">
      <Icon className="h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
