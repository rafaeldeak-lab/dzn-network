import {
  Boxes,
  CalendarDays,
  Crown,
  Lock,
  Palette,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { OperatorAvatar } from "@/components/operators/operator-avatar";
import { OperatorCard } from "@/components/operators/operator-card";
import { OperatorFairnessNotice } from "@/components/operators/operator-fairness-notice";
import { SiteHeader } from "@/components/site-header";
import { DZN_OPERATOR_CATALOG } from "@/lib/operators/catalog";
import { operatorSlotLabel } from "@/lib/operators/labels";
import { buildOperatorCardPresentation, getDefaultOperatorLoadout } from "@/lib/operators/loadout";
import { OPERATOR_COSMETIC_SLOTS } from "@/lib/operators/types";

type OperatorHubProps = {
  demoMode: boolean;
};

const futureIntegrations = [
  { title: "Seasons", body: "Season spotlights can display an equipped DZN Operator Card without changing seasonal scoring.", icon: CalendarDays },
  { title: "Tournaments", body: "Tournament brackets can show cosmetic identity while eligibility remains based on competition rules.", icon: Trophy },
  { title: "Leaderboards", body: "Winner rows can surface operator presentation without changing rank, score, votes, or seeding.", icon: Crown },
];

export function OperatorHub({ demoMode }: OperatorHubProps) {
  const defaultLoadout = getDefaultOperatorLoadout();
  const presentation = buildOperatorCardPresentation(defaultLoadout);
  const premiumItems = DZN_OPERATOR_CATALOG.items.filter((item) => item.entitlement === "premium").slice(0, 8);

  return (
    <main className="min-h-screen bg-[#02030a] text-zinc-100">
      <SiteHeader active="operators" returnTo="/operators" />
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_12%,rgba(249,115,22,.17),transparent_28%),radial-gradient(circle_at_14%_0%,rgba(34,211,238,.16),transparent_30%),linear-gradient(180deg,#06101d,#02030a)]" />
        <div className="relative mx-auto grid min-h-[calc(100vh-96px)] max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-200">DZN Operators</p>
            <h1 className="mt-4 max-w-4xl text-5xl font-black uppercase leading-[0.95] text-white sm:text-6xl lg:text-7xl">
              DZN Character Studio
            </h1>
            <p className="mt-5 max-w-3xl text-base font-bold leading-7 text-zinc-300">
              Build an original DZN identity for profiles, events, tournaments, winner spotlights, and leaderboard presentation.
              Phase 1 is UI and domain foundation only. Cosmetics do not modify competition outcomes.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/operators/studio" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-5 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100">
                <Palette size={16} aria-hidden="true" />
                Open Studio
              </Link>
              <div className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-emerald-300/22 bg-emerald-300/10 px-4 text-xs font-black uppercase text-emerald-50">
                <ShieldCheck size={16} aria-hidden="true" />
                Competition access unchanged
              </div>
            </div>
            {demoMode ? (
              <p className="mt-4 max-w-2xl rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-xs font-black uppercase text-amber-100">
                Premium demo mode is local preview only - not an active subscription and not production entitlement.
              </p>
            ) : null}
          </div>
          <div className="grid gap-4">
            <OperatorCard presentation={presentation} />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-8 lg:grid-cols-[360px_minmax(0,1fr)]">
        <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Current standard operator</p>
          <h2 className="mt-2 text-2xl font-black uppercase text-white">Signal One</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">
            Every free player keeps one standard DZN operator identity, one starter colourway, one basic pose, one basic frame,
            and one basic background.
          </p>
          <div className="mt-4">
            <OperatorAvatar presentation={presentation} />
          </div>
        </article>

        <div className="grid gap-5">
          <section className="rounded-lg border border-cyan-300/16 bg-cyan-300/[0.045] p-5">
            <div className="flex items-start gap-3">
              <Boxes className="mt-1 shrink-0 text-cyan-200" size={22} aria-hidden="true" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">DZN Operator Loadouts</p>
                <h2 className="mt-1 text-2xl font-black uppercase text-white">Preview slots without competitive state</h2>
                <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">
                  Free users can inspect the standard identity and keep full participation. Premium demo users can locally preview multiple
                  cosmetic loadouts, but browser state is never authoritative entitlement.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <StatusTile icon={Users} label="Free participation" value="Unrestricted" />
              <StatusTile icon={Lock} label="Free customization" value="Locked" />
              <StatusTile icon={Sparkles} label="Premium effect" value="Cosmetic only" />
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">Cosmetic category rail</p>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="DZN Operator Wardrobe categories">
              {OPERATOR_COSMETIC_SLOTS.map((slot) => (
                <span key={slot} className="shrink-0 rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-xs font-black uppercase text-zinc-200">
                  {operatorSlotLabel(slot)}
                </span>
              ))}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">Saved-loadout preview</p>
              <h2 className="mt-2 text-xl font-black uppercase text-white">Standard DZN Operator</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">
                Free users cannot save a custom loadout. Premium demo saves are stored locally under a preview-only key and are removable.
              </p>
              <div className="mt-4 rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-bold text-zinc-300">
                Equipped: {defaultLoadout.displayName}
              </div>
            </article>
            <article className="rounded-lg border border-amber-300/18 bg-amber-300/[0.045] p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">Premium cosmetics showcase</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {premiumItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-white/10 bg-black/24 p-3">
                    <p className="truncate text-xs font-black uppercase text-white">{item.displayName}</p>
                    <p className="mt-1 text-[10px] font-black uppercase text-amber-100">{operatorSlotLabel(item.slot)}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-8">
        <OperatorFairnessNotice />
        <section className="grid gap-4 md:grid-cols-3">
          {futureIntegrations.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                <Icon className="text-cyan-200" size={22} aria-hidden="true" />
                <h2 className="mt-3 text-xl font-black uppercase text-white">{item.title}</h2>
                <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">{item.body}</p>
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}

function StatusTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-3">
      <Icon className="text-cyan-200" size={18} aria-hidden="true" />
      <p className="mt-2 text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-black uppercase text-white">{value}</p>
    </div>
  );
}
