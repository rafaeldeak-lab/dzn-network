import { Award, Check, Crown, LockKeyhole, Palette, Server, ShieldCheck, Sparkles, UserRound } from "lucide-react";

import { BadgeIcon } from "@/components/badges/server-visuals";
import { BADGE_RULE_BY_CODE, type BadgeRule } from "@/lib/badges/rules";
import { toVisualBadge } from "@/lib/badges/visuals";

const SERVER_REWARD_CODES = ["diamond", "verified_server", "death_dealer", "warlord", "king_of_dzn", "winter_champion"] as const;

const ARTWORK_BY_CODE: Partial<Record<(typeof SERVER_REWARD_CODES)[number], string>> = {
  diamond: "/rewards/cabinet/reputation-shield-3d.webp",
  verified_server: "/rewards/cabinet/verified-server-2d.webp",
  death_dealer: "/rewards/cabinet/warlord-medal-3d.webp",
  warlord: "/rewards/cabinet/warlord-medal-3d.webp",
  king_of_dzn: "/rewards/cabinet/season-crown-3d.webp",
  winter_champion: "/rewards/cabinet/season-crown-3d.webp",
};

const INDIVIDUAL_COLLECTION = [
  { title: "Profile identity", detail: "Account-bound profile themes and frames", icon: Palette },
  { title: "Calling cards", detail: "Public profile presentation cosmetics", icon: Award },
  { title: "Chat cosmetics", detail: "Non-competitive visual expression", icon: UserRound },
];

export function RewardsCabinet() {
  const serverRewards = SERVER_REWARD_CODES.map((code) => BADGE_RULE_BY_CODE[code]).filter(Boolean);

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
              <RewardCard key={rule.badgeCode} rule={rule} artwork={ARTWORK_BY_CODE[rule.badgeCode as (typeof SERVER_REWARD_CODES)[number]]} />
            ))}
          </div>
        </div>

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

          <section aria-labelledby="individual-collection" className="relative overflow-hidden border border-amber-300/25 bg-[#100f13] p-5 sm:p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rewards/cabinet/player-compass-2d.webp" alt="" width={384} height={384} className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 object-contain opacity-35" />
            <div className="relative">
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center border border-amber-300/30 bg-amber-300/10 text-amber-100"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></span>
                <div>
                  <p className="text-xs font-black uppercase text-amber-200">Individual collection</p>
                  <h3 id="individual-collection" className="mt-1 text-2xl font-black uppercase">Planned Store rewards</h3>
                </div>
              </div>
              <p className="mt-5 max-w-md text-sm font-semibold leading-6 text-zinc-300">Automatic player medal tracking is not live yet. The public Store has no published catalogue, so none of these account cosmetics can be bought or unlocked today.</p>
              <ul className="mt-5 space-y-3">
                {INDIVIDUAL_COLLECTION.map(({ title, detail, icon: Icon }) => (
                  <li key={title} className="flex items-center gap-3 border-t border-white/10 pt-3">
                    <Icon className="h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
                    <span><strong className="font-black text-white">{title}</strong><span className="block text-sm font-semibold text-zinc-400">{detail}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function RewardCard({ rule, artwork }: { rule: BadgeRule; artwork?: string }) {
  const badge = toVisualBadge({
    key: rule.badgeCode,
    name: rule.name,
    category: rule.category,
    description: rule.requirementDescription,
    permanent: rule.isPermanent,
  });

  return (
    <article className="group relative min-h-[300px] overflow-hidden border border-white/10 bg-[#090e1c] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-4">
        <BadgeIcon badge={badge} size="lg" className="shrink-0" />
        <span className="border border-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-zinc-400">{rewardStatus(rule)}</span>
      </div>
      {artwork ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artwork} alt="" width={384} height={384} className="pointer-events-none absolute bottom-2 right-2 h-40 w-40 object-contain opacity-80 transition duration-300 group-hover:scale-105 group-hover:opacity-100" />
      ) : null}
      <div className="relative mt-8 max-w-[48%] sm:max-w-[68%]">
        <p className="text-xs font-black uppercase text-cyan-200">{rule.category}</p>
        <h4 className="mt-1 text-xl font-black uppercase text-white">{rule.name}</h4>
        <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300">{rule.requirementDescription}</p>
      </div>
      <div className="relative mt-5 max-w-[48%] border-t border-white/10 pt-4 text-xs font-black uppercase text-zinc-400 sm:max-w-none">{rule.requirementLabel}</div>
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
