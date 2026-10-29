"use client";

import { ArrowRight, Check, Crown, LockKeyhole, MessageCircle, Palette, ShieldCheck, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

type LockerCollectionKey = "wildcards" | "badges" | "frames" | "identity" | "showcase";

type LockerCollection = {
  key: LockerCollectionKey;
  label: string;
  eyebrow: string;
  title: string;
  detail: string;
};

const LOCKER_COLLECTIONS: LockerCollection[] = [
  {
    key: "wildcards",
    label: "Wildcards",
    eyebrow: "Calling card concepts",
    title: "Wildcard calling cards",
    detail: "A rotating set of profile-card treatments for players who want their public identity to feel more personal. These are visual concepts only until the player cosmetic catalogue is published.",
  },
  {
    key: "badges",
    label: "Badges",
    eyebrow: "3D reward asset library",
    title: "Badge vault previews",
    detail: "High-detail 3D reward art for future award paths and premium public presentation. A visual asset is not an unlock: each design still needs a real achievement rule, tracking source and fulfilment decision.",
  },
  {
    key: "frames",
    label: "Frames",
    eyebrow: "Existing visual library",
    title: "Profile frame collection",
    detail: "A clearer way to browse the DZN frame system already used across public server presentation. Eligibility remains controlled by earned progress, season status, or a future catalogue rule.",
  },
  {
    key: "identity",
    label: "Identity",
    eyebrow: "Profile & chat concepts",
    title: "Identity loadout previews",
    detail: "Account-bound presentation ideas: nameplates, profile accents, calling-card backs and compact chat treatments. None change rank, score, games, access or competition.",
  },
  {
    key: "showcase",
    label: "Showcase",
    eyebrow: "Server visual loadouts",
    title: "Server showcase treatments",
    detail: "A server earns its awards first. Visual loadouts only determine how that earned history is presented on public DZN surfaces.",
  },
];

const WILDCARDS = [
  { title: "Night Watch", label: "Signal black", source: "/store/catalogue/wildcards/night-watch-v1.webp", tone: "from-slate-950/76 via-slate-950/20 to-violet-950/68" },
  { title: "Storm Relay", label: "Violet strike", source: "/store/catalogue/wildcards/storm-relay-v1.webp", tone: "from-indigo-950/72 via-violet-950/15 to-slate-950/74" },
  { title: "Outpost Gold", label: "Lantern line", source: "/store/catalogue/wildcards/outpost-gold-v1.webp", tone: "from-amber-950/74 via-slate-950/20 to-slate-950/76" },
  { title: "Last Signal", label: "Ice light", source: "/store/catalogue/wildcards/last-signal-v1.webp", tone: "from-cyan-950/76 via-slate-950/18 to-indigo-950/74" },
] as const;

const FRAME_PREVIEWS = [
  { key: "diamond", title: "Diamond pulse", detail: "Earned reputation treatment", source: "/frames/diamond-animated.svg", accent: "#67e8f9" },
  { key: "legendary", title: "Legendary core", detail: "Elite visual treatment", source: "/frames/legendary-animated.svg", accent: "#c084fc" },
  { key: "toxic", title: "Toxic zone", detail: "Challenge visual treatment", source: "/frames/toxic-animated.svg", accent: "#84cc16" },
  { key: "fire", title: "Fireline", detail: "Combat visual treatment", source: "/frames/fire-animated.svg", accent: "#ef4444" },
  { key: "ice", title: "Winter signal", detail: "Seasonal visual treatment", source: "/frames/ice-animated.svg", accent: "#93c5fd" },
  { key: "space", title: "Deep space", detail: "Future catalogue concept", source: "/frames/space-animated.svg", accent: "#a78bfa" },
] as const;

const BADGE_PREVIEWS = [
  { key: "apex", title: "Apex reputation", detail: "Prestige reward concept", source: "/store/catalogue/badges/apex-reputation-v1.webp", accent: "border-cyan-300/35 bg-cyan-300/[0.06]", status: "Future rule" },
  { key: "warlord", title: "Warlord forge", detail: "Combat reward concept", source: "/store/catalogue/badges/warlord-v1.webp", accent: "border-orange-300/35 bg-orange-300/[0.06]", status: "Future rule" },
  { key: "crown", title: "Season crown", detail: "Seasonal reward concept", source: "/store/catalogue/badges/season-crown-v1.webp", accent: "border-violet-300/35 bg-violet-300/[0.06]", status: "Future rule" },
  { key: "community", title: "Signal relay", detail: "Community reward concept", source: "/store/catalogue/badges/community-signal-v1.webp", accent: "border-emerald-300/35 bg-emerald-300/[0.06]", status: "Future rule" },
] as const;

const LOADOUTS: ReadonlyArray<{ title: string; detail: string; icon: LucideIcon; accent: string }> = [
  { title: "Recon dossier", detail: "Compact badge stack, signal frame, profile header", icon: Palette, accent: "text-cyan-100 border-cyan-300/30 bg-cyan-300/10" },
  { title: "Season champion", detail: "Seasonal frame, crown slot, event calling card", icon: Crown, accent: "text-amber-100 border-amber-300/30 bg-amber-300/10" },
  { title: "Community relay", detail: "Trust badge, responsive banner, community profile theme", icon: UserRound, accent: "text-emerald-100 border-emerald-300/30 bg-emerald-300/10" },
];

export function LockerPreview({ compact = false }: { compact?: boolean }) {
  const [selectedKey, setSelectedKey] = useState<LockerCollectionKey>("badges");
  const selected = useMemo(() => LOCKER_COLLECTIONS.find((collection) => collection.key === selectedKey) ?? LOCKER_COLLECTIONS[0], [selectedKey]);

  if (compact) {
    return (
      <section aria-labelledby="individual-collection" className="relative overflow-hidden border border-amber-300/25 bg-[#100f13] p-5 sm:p-6">
        <div className="absolute inset-0 opacity-35" style={{ backgroundImage: "linear-gradient(90deg, rgba(16,15,19,0.98), rgba(16,15,19,0.74)), url('/store/catalogue/rewards-locker-preview-v1.webp')", backgroundPosition: "center, right center", backgroundSize: "cover, cover" }} />
        <div className="relative">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center border border-amber-300/30 bg-amber-300/10 text-amber-100"><LockKeyhole className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <p className="text-xs font-black uppercase text-amber-200">Individual collection</p>
              <h3 id="individual-collection" className="mt-1 text-2xl font-black uppercase">The DZN Locker</h3>
            </div>
          </div>
          <p className="mt-5 max-w-md text-sm font-semibold leading-6 text-zinc-200">Preview the upcoming wildcard calling cards, profile frames, identity pieces and visual loadouts before the player catalogue opens.</p>
          <a href="#locker-preview" className="mt-5 inline-flex min-h-11 items-center gap-2 border border-amber-200/45 bg-black/25 px-4 text-sm font-black uppercase text-amber-100 hover:border-amber-100 hover:text-white">Browse locker previews <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
        </div>
      </section>
    );
  }

  return (
    <section id="locker-preview" aria-labelledby="locker-preview-title" className="relative mt-12 overflow-hidden border border-cyan-300/25 bg-[#070b16] shadow-[0_22px_70px_rgba(0,0,0,0.38)]">
      <div className="absolute inset-0 opacity-35" style={{ backgroundImage: "linear-gradient(90deg, rgba(5,8,17,0.98) 0%, rgba(5,8,17,0.88) 48%, rgba(5,8,17,0.35) 100%), url('/store/catalogue/rewards-locker-preview-v1.webp')", backgroundPosition: "center, right center", backgroundSize: "cover, cover" }} />
      <div className="relative p-5 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-5 border-b border-cyan-100/15 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase text-cyan-200">Preview catalogue</p>
            <h3 id="locker-preview-title" className="mt-1 text-3xl font-black uppercase sm:text-4xl">The DZN Locker</h3>
            <p className="mt-3 text-sm font-semibold leading-6 text-zinc-200">A visual catalogue for account cosmetics and public-profile presentation. These previews are not a checkout, item grant or unlock path yet.</p>
          </div>
          <div className="flex items-center gap-2 border border-white/15 bg-black/25 px-3 py-2 text-xs font-black uppercase text-zinc-200"><LockKeyhole className="h-4 w-4 text-cyan-200" aria-hidden="true" />Preview only · no payment</div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="DZN Locker catalogue collections">
          {LOCKER_COLLECTIONS.map((collection) => {
            const isSelected = collection.key === selected.key;
            return <button key={collection.key} id={`locker-tab-${collection.key}`} type="button" role="tab" aria-selected={isSelected} aria-controls="locker-preview-panel" tabIndex={isSelected ? 0 : -1} onClick={() => setSelectedKey(collection.key)} className={`min-h-11 border px-4 text-sm font-black uppercase transition ${isSelected ? "border-cyan-200 bg-cyan-300 text-slate-950" : "border-white/15 bg-black/25 text-zinc-200 hover:border-cyan-200/60 hover:text-white"}`}>{collection.label}</button>;
          })}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <aside className="border border-white/10 bg-[#070b14]/80 p-5">
            <p className="text-xs font-black uppercase text-cyan-200">{selected.eyebrow}</p>
            <h4 className="mt-2 text-2xl font-black uppercase text-white">{selected.title}</h4>
            <p className="mt-4 text-sm font-semibold leading-6 text-zinc-300">{selected.detail}</p>
            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-xs font-black uppercase text-zinc-400">Cataloguing policy</p>
              <ul className="mt-3 space-y-3 text-sm font-semibold leading-5 text-zinc-300">
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />Purely visual; no gameplay, rank, score or event advantage.</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />Every live item will need a published catalogue entry, receipt and fulfilment rule.</li>
                <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />Preview items remain unavailable until that release exists.</li>
              </ul>
            </div>
          </aside>

          <div id="locker-preview-panel" role="tabpanel" aria-labelledby={`locker-tab-${selected.key}`} className="min-w-0">
            {selected.key === "wildcards" ? <WildcardCollection /> : null}
            {selected.key === "badges" ? <BadgeCollection /> : null}
            {selected.key === "frames" ? <FrameCollection /> : null}
            {selected.key === "identity" ? <IdentityCollection /> : null}
            {selected.key === "showcase" ? <ShowcaseCollection /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function BadgeCollection() {
  return <div className="grid gap-4 sm:grid-cols-2">
    {BADGE_PREVIEWS.map((badge) => <article key={badge.key} className={`group relative min-h-64 overflow-hidden border p-5 shadow-[0_18px_35px_rgba(0,0,0,0.24)] ${badge.accent}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,0.12),transparent_44%),linear-gradient(145deg,rgba(8,12,26,0.94),rgba(3,6,13,0.99))]" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3"><span className="border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-zinc-200">3D badge</span><span className="border border-white/10 bg-black/25 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-zinc-400">{badge.status}</span></div>
        <div className="pointer-events-none absolute inset-x-0 top-7 bottom-14 grid place-items-center">
          {/* The source assets are transparent WebP decals; Next image optimisation adds no value to a decorative, lazy-loaded catalogue preview. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badge.source} alt="" width={330} height={330} loading="lazy" decoding="async" className="h-48 w-48 object-contain drop-shadow-[0_22px_22px_rgba(0,0,0,0.55)] transition duration-500 group-hover:scale-105" />
        </div>
        <div className="relative mt-auto border-t border-white/10 pt-3"><h5 className="text-lg font-black uppercase text-white">{badge.title}</h5><p className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-300">{badge.detail} · not grantable</p></div>
      </div>
    </article>)}
  </div>;
}

function WildcardCollection() {
  return <div className="grid gap-4 sm:grid-cols-2">
    {WILDCARDS.map((card) => <article key={card.title} className="relative min-h-52 overflow-hidden border border-violet-200/20 bg-[#0a0e1b] p-5 shadow-[0_18px_35px_rgba(0,0,0,0.24)]">
      <div className={`absolute inset-0 bg-gradient-to-br ${card.tone}`} />
      <div className="absolute inset-0 opacity-90" style={{ backgroundImage: `url('${card.source}')`, backgroundPosition: "center", backgroundSize: "cover" }} />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3"><span className="border border-violet-100/35 bg-black/30 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-violet-100">Wildcard</span><Sparkles className="h-5 w-5 text-violet-100" aria-hidden="true" /></div>
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-100/90">{card.label}</p><h5 className="mt-1 text-2xl font-black uppercase text-white">{card.title}</h5><p className="mt-2 text-xs font-bold uppercase tracking-wide text-zinc-200">Concept preview · account cosmetic</p></div>
      </div>
    </article>)}
  </div>;
}

function FrameCollection() {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {FRAME_PREVIEWS.map((frame) => <article key={frame.key} className="border border-white/10 bg-[#090e1b]/95 p-4">
      <div className="relative mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-full border border-white/10 bg-[radial-gradient(circle_at_35%_24%,#182744,transparent_56%),#060a12]">
        <span className="text-lg font-black tracking-[0.14em] text-white">DZN</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={frame.source} alt="" width={192} height={192} className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover" />
      </div>
      <div className="mt-4 flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: frame.accent }} aria-hidden="true" /><div><h5 className="font-black uppercase text-white">{frame.title}</h5><p className="mt-1 text-xs font-semibold leading-5 text-zinc-400">{frame.detail}</p></div></div>
    </article>)}
  </div>;
}

function IdentityCollection() {
  return <div className="grid gap-4 lg:grid-cols-2">
    <article className="relative overflow-hidden border border-cyan-300/25 bg-[#07121a] p-5">
      <div className="absolute inset-0 opacity-25" style={{ backgroundImage: "linear-gradient(120deg, transparent, rgba(34,211,238,0.35)), url('/store/catalogue/rewards-locker-preview-v1.webp')", backgroundPosition: "center, 81% 48%", backgroundSize: "cover, 190% auto" }} />
      <div className="relative"><p className="text-xs font-black uppercase text-cyan-200">Profile identity</p><div className="mt-5 flex items-center gap-4"><div className="grid h-16 w-16 place-items-center rounded-full border-2 border-cyan-200 bg-slate-950 font-black text-cyan-100">W</div><div><p className="font-black text-white">Wasteland Ranger</p><p className="mt-1 text-xs font-black uppercase text-cyan-200">Signal-borne identity card</p></div></div><div className="mt-5 grid grid-cols-3 gap-2 text-center text-[10px] font-black uppercase"><span className="border border-cyan-300/25 bg-cyan-300/10 px-2 py-2 text-cyan-100">Frame</span><span className="border border-violet-300/25 bg-violet-300/10 px-2 py-2 text-violet-100">Banner</span><span className="border border-amber-300/25 bg-amber-300/10 px-2 py-2 text-amber-100">Accent</span></div></div>
    </article>
    <article className="border border-white/10 bg-[#090e1b] p-5"><p className="text-xs font-black uppercase text-violet-200">Chat presentation</p><div className="mt-5 space-y-3"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-full border border-violet-300/40 bg-violet-300/10 text-xs font-black text-violet-100">D</span><div className="min-w-0"><p className="text-sm font-black text-white">DZN Ranger <span className="ml-1 border border-violet-300/35 px-1.5 py-0.5 text-[9px] uppercase text-violet-100">Preview</span></p><p className="mt-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm font-semibold text-zinc-300">A compact identity treatment that keeps the message first.</p></div></div><div className="flex gap-2 border-t border-white/10 pt-3 text-xs font-black uppercase text-zinc-400"><MessageCircle className="h-4 w-4 text-cyan-200" aria-hidden="true" />No status or moderation advantage</div></div></article>
  </div>;
}

function ShowcaseCollection() {
  return <div className="grid gap-4 lg:grid-cols-3">
    {LOADOUTS.map(({ title, detail, icon: Icon, accent }) => <article key={title} className="border border-white/10 bg-[#090e1b] p-5"><span className={`grid h-11 w-11 place-items-center border ${accent}`}><Icon className="h-5 w-5" aria-hidden="true" /></span><h5 className="mt-5 text-xl font-black uppercase text-white">{title}</h5><p className="mt-2 text-sm font-semibold leading-6 text-zinc-400">{detail}</p><div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-xs font-black uppercase text-zinc-500"><ShieldCheck className="h-4 w-4 text-cyan-200" aria-hidden="true" />Presentation only</div></article>)}
  </div>;
}
