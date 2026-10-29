import { Check, Crown, Server, ShieldCheck, Sparkles } from "lucide-react";

import { LockerPreview } from "@/components/store/locker-preview";
import { BADGE_RULE_BY_CODE, type BadgeRule } from "@/lib/badges/rules";
import { getBadgeCabinetArtworkUrl } from "@/lib/badges/visuals";

const SERVER_REWARD_CODES = [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "legendary",
  "verified_server",
  "active_server",
  "death_dealer",
  "long_shot_legend",
  "warlord",
  "trusted_server",
  "veteran",
  "legacy_server",
  "king_of_dzn",
  "winter_champion",
] as const;

const FUTURE_REWARD_CODES = [
  "community_favourite",
  "headhunter",
  "hot_streak",
  "team_player",
  "loot_master",
  "event_champion",
] as const;

export function RewardsCabinet() {
  const serverRewards = SERVER_REWARD_CODES.map((code) => BADGE_RULE_BY_CODE[code]).filter(Boolean);
  const futureRewards = FUTURE_REWARD_CODES.map((code) => BADGE_RULE_BY_CODE[code]).filter(Boolean);

  return (
    <section id="rewards" aria-labelledby="rewards-title" className="border-b border-white/10 bg-[#060a14]">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-5 border-b border-white/10 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase text-violet-200">DZN rewards</p>
            <h2 id="rewards-title" className="mt-1 text-3xl font-black uppercase sm:text-4xl">Rewards Cabinet</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">Built for progress that is visible at a glance. Server awards are earned from verified activity, competition and reputation. Pro changes the presentation, never the result.</p>
          </div>
          <div className="flex items-center gap-3 border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm font-black uppercase text-emerald-100">
            <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />No paid competitive advantage
          </div>
        </div>

        <div className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-cyan-200">Server progression</p>
              <h3 className="mt-1 text-2xl font-black uppercase">Live award paths</h3>
            </div>
            <p className="max-w-xl text-sm font-semibold leading-6 text-zinc-400">These are existing DZN award rules. A crown is held by the current leader; seasonal and threshold rewards remain part of a server record once earned.</p>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {serverRewards.map((rule) => (
              <RewardCard key={rule.badgeCode} rule={rule} />
            ))}
          </div>
        </div>

        <section aria-labelledby="reward-blueprints" className="mt-10 border border-violet-300/20 bg-violet-300/[0.035] p-5 sm:p-6">
          <div className="flex flex-col gap-4 border-b border-violet-200/15 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase text-violet-200">Reward design archive</p>
              <h3 id="reward-blueprints" className="mt-1 text-2xl font-black uppercase">Future award blueprints</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-zinc-300">These designs have real DZN visual assets and documented future rules, but their tracking sources are not live. They cannot be earned, bought, or assigned today.</p>
            </div>
            <span className="w-fit border border-violet-300/30 bg-violet-300/10 px-3 py-2 text-xs font-black uppercase text-violet-100">Concepts, not active rewards</span>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {futureRewards.map((rule) => (
              <RewardCard key={rule.badgeCode} rule={rule} statusOverride="Future rule" />
            ))}
          </div>
        </section>

        <div className="mt-12 grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,0.82fr)]">
          <section aria-labelledby="pro-presentation" className="border border-cyan-300/20 bg-[#080d1a] p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center border border-violet-300/30 bg-violet-300/10 text-violet-100"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
              <div>
                <p className="text-xs font-black uppercase text-violet-200">Pro visual loadout</p>
                <h3 id="pro-presentation" className="mt-1 text-2xl font-black uppercase">Make earned progress look earned</h3>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-zinc-300">A server must earn every badge first. Pro unlocks more room to showcase it, animated treatment, and premium visual choices on the public server presentation.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <PresentationTier title="Starter" accent="border-white/10" values={["Up to 3 showcase badge slots", "Static presentation", "Earned rewards only"]} />
              <PresentationTier title="Pro" accent="border-violet-300/40 bg-violet-300/[0.06]" values={["Up to 8 showcase badge slots", "Badge and frame animation controls", "Expanded frames and theme presentation"]} highlighted />
            </div>
          </section>

          <LockerPreview compact />
        </div>

        <LockerPreview />
      </div>
    </section>
  );
}

function RewardCard({ rule, statusOverride }: { rule: BadgeRule; statusOverride?: string }) {
  const cabinetArtwork = getBadgeCabinetArtworkUrl(rule.badgeCode, rule.category, rule.name);

  return (
    <article className="dzn-reward-card group relative min-h-[320px] overflow-hidden border border-white/10 bg-[#090e1c] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
      <div className="relative z-10 flex items-start justify-between gap-4">
        <span className="border border-cyan-300/25 bg-cyan-300/[0.06] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-cyan-100">Award artwork</span>
        <span className="border border-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-zinc-400">{statusOverride ?? rewardStatus(rule)}</span>
      </div>
      {cabinetArtwork ? (
        <span className="dzn-reward-card__art" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cabinetArtwork} alt="" width={384} height={384} loading="lazy" decoding="async" />
        </span>
      ) : null}
      <div className="dzn-reward-card__copy relative z-10 mt-8">
        <p className="text-xs font-black uppercase text-cyan-200">{rule.category}</p>
        <h4 className="mt-1 text-xl font-black uppercase text-white">{rule.name}</h4>
        <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">{rule.requirementDescription}</p>
      </div>
      <div className="dzn-reward-card__requirement relative z-10 mt-5 border-t border-white/10 pt-4 text-xs font-black uppercase text-zinc-400">{rule.requirementLabel}</div>
    </article>
  );
}

function PresentationTier({ title, accent, values, highlighted = false }: { title: string; accent: string; values: string[]; highlighted?: boolean }) {
  return (
    <div className={`border p-4 ${accent}`}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-lg font-black uppercase">{title}</h4>
        {highlighted ? <Crown className="h-5 w-5 text-amber-200" aria-hidden="true" /> : <Server className="h-5 w-5 text-zinc-400" aria-hidden="true" />}
      </div>
      <ul className="mt-4 space-y-3">
        {values.map((value) => <li key={value} className="flex gap-2 text-sm font-semibold leading-5 text-zinc-300"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />{value}</li>)}
      </ul>
    </div>
  );
}

function rewardStatus(rule: BadgeRule) {
  if (rule.isCrown) return "Current leader";
  if (rule.isSeasonal) return "Season award";
  if (rule.manualOnly) return "DZN awarded";
  return rule.isPermanent ? "Permanent" : "Maintained";
}
