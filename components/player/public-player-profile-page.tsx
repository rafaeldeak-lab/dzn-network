"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Award,
  BadgeCheck,
  CalendarDays,
  Eye,
  EyeOff,
  Gauge,
  Lock,
  Radar,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { FetchJsonError, fetchJsonWithRetry } from "@/lib/client-fetch";

type PublicPlayerProfilePayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  profile?: {
    handle?: string;
    display_name?: string;
    avatar_initial?: string;
    public_href?: string;
    public_api_href?: string;
  };
  visibility?: {
    mode?: "public_viewer";
    xp?: boolean;
    challenge_progress?: boolean;
    calling_cards?: boolean;
    award_dates?: "month" | "hidden";
    private_identifiers?: "hidden";
    raw_award_evidence?: "hidden";
    exact_award_times?: "hidden";
  };
  sections?: {
    xp?: {
      total_xp?: number;
      profile_level?: number;
      level_label?: string;
      xp_to_next_level?: number;
    } | null;
    challenge_progress?: {
      joined_challenges?: number;
      completed_challenges?: number;
      items?: PublicChallengeProgress[];
    } | null;
    calling_cards?: {
      count?: number;
      items?: PublicCallingCard[];
    } | null;
    timeline?: PublicTimelineItem[];
  };
  fairness?: Record<string, boolean>;
  fetched_at?: string;
};

type PublicCallingCard = {
  code?: string;
  name?: string;
  description?: string | null;
  rarity?: string;
  awarded_label?: string;
};

type PublicChallengeProgress = {
  slug?: string;
  title?: string;
  category?: string;
  status?: "joined" | "completed";
  progress_percent?: number;
  completed_label?: string;
};

type PublicTimelineItem = {
  kind?: "calling_card" | "challenge";
  label?: string;
  detail?: string;
  occurred_label?: string;
};

type ViewState = "loading" | "ready" | "missing" | "error";

export function PublicPlayerProfilePage({ handle }: { handle: string }) {
  const [payload, setPayload] = useState<PublicPlayerProfilePayload | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const routeHandle = currentPublicProfileHandle(handle);
    const encodedHandle = encodeURIComponent(routeHandle);
    fetchJsonWithRetry<PublicPlayerProfilePayload>(`/api/public/player-profiles/${encodedHandle}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      timeoutMs: 12_000,
    })
      .then((data) => {
        if (!active) return;
        if (!data?.ok) {
          setPayload(null);
          setState("missing");
          setMessage(data?.message ?? "That DZN player profile is not public.");
          return;
        }
        setPayload(normalizePayload(data, routeHandle));
        setState("ready");
        setMessage("");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof FetchJsonError && error.status === 404) {
          setPayload(null);
          setState("missing");
          setMessage("That DZN player profile is not public.");
          return;
        }
        setPayload(null);
        setState("error");
        setMessage(error instanceof Error ? error.message : "Public player profile could not be loaded right now.");
      });

    return () => {
      active = false;
    };
  }, [handle]);

  const profile = useMemo(() => normalizePayload(payload, payload?.profile?.handle ?? handle), [payload, handle]);
  const visibility = normalizeVisibility(profile.visibility);
  const xp = profile.sections?.xp ?? null;
  const challenges = profile.sections?.challenge_progress?.items ?? [];
  const cards = profile.sections?.calling_cards?.items ?? [];
  const timeline = profile.sections?.timeline ?? [];
  const displayName = profile.profile?.display_name ?? "DZN Player";
  const avatarInitial = profile.profile?.avatar_initial ?? "D";
  const publicHandle = profile.profile?.handle ?? currentPublicProfileHandle(handle);
  const visibleSectionCount = [visibility.xp, visibility.challenge_progress, visibility.calling_cards, visibility.award_dates === "month"].filter(Boolean).length;
  const completedChallenges = visibility.challenge_progress ? profile.sections?.challenge_progress?.completed_challenges ?? 0 : null;
  const joinedChallenges = visibility.challenge_progress ? profile.sections?.challenge_progress?.joined_challenges ?? 0 : null;
  const publishedCardCount = visibility.calling_cards ? profile.sections?.calling_cards?.count ?? 0 : null;
  const publishedXp = visibility.xp && xp ? xp.total_xp ?? 0 : null;
  const profileLevel = visibility.xp && xp ? xp.profile_level ?? 1 : null;

  if (state === "missing" || state === "error") {
    return (
      <PublicProfileShell>
        <section className="mx-auto grid min-h-[62vh] max-w-3xl content-center px-4 py-28 text-center sm:px-6">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded border border-amber-300/25 bg-amber-400/10 text-amber-100">
            <EyeOff className="h-8 w-8" />
          </span>
          <h1 className="mt-5 break-words text-4xl font-black uppercase leading-none text-white [overflow-wrap:anywhere] sm:text-6xl">
            Profile Not Public
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm font-bold leading-6 text-zinc-300">
            {message || "That DZN player profile is not public."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/player" className="inline-flex min-h-10 items-center justify-center gap-2 rounded bg-cyan-400 px-4 py-3 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300">
              Player Hub
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login?returnTo=%2Fplayer%2Fprofile" className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-white/15 bg-white/8 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-white/12">
              Manage My Profile
              <Lock className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </PublicProfileShell>
    );
  }

  return (
    <PublicProfileShell>
      <section className="dzn-public-profile-hero relative border-b border-white/10">
        <div className="mx-auto grid min-h-[520px] max-w-7xl content-end gap-6 px-4 pb-8 pt-28 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <div className="relative z-10 min-w-0">
            <p className="inline-flex rounded border border-cyan-300/35 bg-cyan-400/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
              Public DZN profile
            </p>
            <h1 className="mt-4 max-w-4xl break-words text-5xl font-black uppercase leading-[0.88] text-white [overflow-wrap:anywhere] sm:text-7xl lg:text-8xl">
              {state === "loading" ? "Loading Player Profile" : displayName}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <ProfileSignalPill icon={Radar} label="Survivor dossier" />
              <ProfileSignalPill icon={Eye} label={`${visibleSectionCount}/4 sections visible`} />
              <ProfileSignalPill icon={ShieldCheck} label="Public view / presentation only" />
            </div>
            <p className="mt-5 max-w-2xl break-words text-sm font-bold leading-6 text-zinc-200 [overflow-wrap:anywhere] sm:text-base">
              Public-safe player progression, showing only the XP, challenge, calling-card, and month-level award sections this player has chosen to display.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/player" className="inline-flex min-h-10 items-center justify-center gap-2 rounded bg-cyan-400 px-4 py-3 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300">
                Player Hub
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/events/challenges" className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-white/15 bg-white/8 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-white/12">
                Challenges
                <Swords className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <section className="dzn-public-profile-identity-card relative z-10 min-w-0 overflow-hidden rounded-lg border border-cyan-300/24 bg-black/54 p-5 shadow-[0_0_80px_rgba(34,211,238,0.14)]">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.82),rgba(168,85,247,0.72),transparent)]" aria-hidden="true" />
            <div className="flex items-center gap-4">
              <span className="dzn-public-profile-avatar grid h-24 w-24 shrink-0 place-items-center rounded-lg border border-cyan-300/30 bg-cyan-400/12 text-4xl font-black text-cyan-50">
                {state === "loading" ? <UserRound className="h-9 w-9" /> : avatarInitial}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">DZN player identity</p>
                <p className="mt-1 break-words text-2xl font-black uppercase leading-none text-white [overflow-wrap:anywhere]">{displayName}</p>
                <p className="mt-2 break-words text-xs font-black uppercase tracking-[0.14em] text-cyan-100 [overflow-wrap:anywhere]">
                  @{publicHandle}
                </p>
                <p className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-amber-100">
                  {xp ? `Level ${formatNumber(xp.profile_level ?? 1)} / ${xp.level_label ?? "Foundation Track"}` : "Profile sections selected by player"}
                </p>
              </div>
            </div>
            <ProfileSignalRail
              xp={publishedXp}
              level={profileLevel}
              completedChallenges={completedChallenges}
              joinedChallenges={joinedChallenges}
              cardCount={publishedCardCount}
            />
          </section>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:px-8">
        <aside className="grid content-start gap-5">
          <section className="dzn-public-profile-panel rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <PanelHeader icon={<ShieldCheck className="h-5 w-5" />} title="Public Visibility" />
            <div className="mt-4 grid gap-2">
              <VisibilityRow label="XP Section" active={visibility.xp} />
              <VisibilityRow label="Challenge Progress" active={visibility.challenge_progress} />
              <VisibilityRow label="Calling Cards" active={visibility.calling_cards} />
              <VisibilityRow label="Award Dates" active={visibility.award_dates === "month"} detail={visibility.award_dates === "month" ? "Month only" : "Hidden"} />
            </div>
            <div className="mt-4 rounded border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs font-bold leading-5 text-emerald-50/88">
              Private identifiers, raw award evidence, source IDs, Discord IDs, internal user IDs, and exact award timestamps are hidden from this public view.
            </div>
          </section>

          <section className="dzn-public-profile-panel rounded-lg border border-amber-300/25 bg-amber-400/10 p-4">
            <PanelHeader icon={<Lock className="h-5 w-5" />} title="Fairness Boundary" />
            <p className="mt-3 text-sm font-bold leading-6 text-amber-50/88">
              Public profile visibility is presentation only. It does not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.
            </p>
          </section>

          <section className="dzn-public-profile-panel rounded-lg border border-violet-300/20 bg-violet-400/10 p-4">
            <PanelHeader icon={<Activity className="h-5 w-5" />} title="Profile Signal" />
            <div className="mt-4 grid gap-2">
              <IntelRow label="Visible sections" value={`${visibleSectionCount}/4`} />
              <IntelRow label="Published XP" value={publishedXp === null ? "Hidden" : formatNumber(publishedXp)} />
              <IntelRow label="Challenge clears" value={completedChallenges === null ? "Hidden" : formatNumber(completedChallenges)} />
              <IntelRow label="Calling cards" value={publishedCardCount === null ? "Hidden" : formatNumber(publishedCardCount)} />
            </div>
          </section>
        </aside>

        <div className="min-w-0 grid gap-5">
          {state === "loading" ? <LoadingPanel /> : null}

          {visibility.xp && xp ? (
            <section className="dzn-public-profile-panel rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <PanelHeader icon={<Zap className="h-5 w-5" />} title="Earned XP" />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <ProgressStat label="Total XP" value={xp.total_xp ?? 0} tone="amber" />
                <ProgressStat label="Level" value={xp.profile_level ?? 1} tone="cyan" />
                <ProgressStat label="XP To Next" value={xp.xp_to_next_level ?? 0} tone="emerald" />
              </div>
            </section>
          ) : state === "loading" ? null : (
            <PublicSectionState
              icon={<Zap className="h-5 w-5" />}
              title={visibility.xp ? "XP Not Earned Yet" : "XP Hidden"}
              body={visibility.xp ? "This player has not published earned XP totals yet." : "This player keeps earned XP totals private on their public DZN profile."}
              hidden={!visibility.xp}
            />
          )}

          {visibility.calling_cards ? (
            <section className="dzn-public-profile-panel rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <PanelHeader icon={<Sparkles className="h-5 w-5" />} title="Calling Cards" />
              {cards.length ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {cards.map((card) => (
                    <CallingCard key={card.code ?? card.name} card={card} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No Public Calling Cards Yet" body="Verified calling cards will appear here when this player earns one and keeps the section visible." />
              )}
            </section>
          ) : state === "loading" ? null : (
            <PublicSectionState
              icon={<Sparkles className="h-5 w-5" />}
              title="Calling Cards Hidden"
              body="This player keeps earned calling cards private on their public DZN profile."
              hidden
            />
          )}

          {visibility.challenge_progress ? (
            <section className="dzn-public-profile-panel rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <PanelHeader icon={<Trophy className="h-5 w-5" />} title="Challenge Progress" />
              {challenges.length ? (
                <div className="mt-4 grid gap-3">
                  {challenges.map((challenge) => (
                    <ChallengeCard key={challenge.slug ?? challenge.title} challenge={challenge} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No Public Challenge Progress Yet" body="Joined and completed challenge progress will appear here when this player earns visible progress." />
              )}
            </section>
          ) : state === "loading" ? null : (
            <PublicSectionState
              icon={<Trophy className="h-5 w-5" />}
              title="Challenge Progress Hidden"
              body="This player keeps joined and completed challenge progress private on their public DZN profile."
              hidden
            />
          )}

          {timeline.length ? (
            <section className="dzn-public-profile-panel rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <PanelHeader icon={<CalendarDays className="h-5 w-5" />} title="Progression Timeline" />
              <div className="mt-4 grid gap-2">
                {timeline.map((item, index) => (
                  <TimelineRow key={`${item.kind ?? "item"}-${item.label ?? index}`} item={item} />
                ))}
              </div>
            </section>
          ) : state === "loading" ? null : (
            <PublicSectionState
              icon={<CalendarDays className="h-5 w-5" />}
              title="Timeline Pending"
              body="The public timeline fills in after this player has visible earned XP, challenges, or calling cards."
              hidden={false}
            />
          )}
        </div>
      </section>
    </PublicProfileShell>
  );
}

function PublicProfileShell({ children }: { children: ReactNode }) {
  return (
    <main className="dzn-public-profile-page relative min-h-screen overflow-x-hidden bg-[#03040d] text-white">
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="dzn-public-profile-bg-layer absolute -inset-8 bg-[url('/media/dzn-pricing-bg-layer.png')] bg-cover bg-center" />
        <div className="dzn-public-profile-survivor-layer absolute -inset-6 bg-[url('/media/dzn-cinematic-survivor.png')] bg-cover bg-center" />
        <div className="dzn-public-profile-fog-layer absolute -inset-8 bg-[url('/media/dzn-pricing-fog-ember-overlay.png')] bg-cover bg-center" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_76%_8%,rgba(168,85,247,0.26),transparent_28%),radial-gradient(circle_at_58%_86%,rgba(245,158,11,0.12),transparent_30%),linear-gradient(90deg,rgba(3,4,13,0.97),rgba(3,4,13,0.72)_46%,rgba(3,4,13,0.94))]" />
        <div className="scanline absolute inset-0 opacity-20" />
      </div>
      <div className="relative z-10">{children}</div>
    </main>
  );
}

function ProfileSignalPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded border border-white/12 bg-black/34 px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-100" />
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
    </span>
  );
}

function ProfileSignalRail({
  xp,
  level,
  completedChallenges,
  joinedChallenges,
  cardCount,
}: {
  xp: number | null;
  level: number | null;
  completedChallenges: number | null;
  joinedChallenges: number | null;
  cardCount: number | null;
}) {
  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-2">
      <SignalTile icon={Gauge} label="XP signal" value={xp === null ? "Hidden" : formatNumber(xp)} tone="amber" />
      <SignalTile icon={Target} label="Profile level" value={level === null ? "Hidden" : formatNumber(level)} tone="cyan" />
      <SignalTile icon={Trophy} label="Challenge record" value={completedChallenges === null ? "Hidden" : `${formatNumber(completedChallenges)} / ${formatNumber(joinedChallenges ?? 0)}`} tone="emerald" />
      <SignalTile icon={Award} label="Calling cards" value={cardCount === null ? "Hidden" : formatNumber(cardCount)} tone="violet" />
    </div>
  );
}

function SignalTile({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: "amber" | "cyan" | "emerald" | "violet" }) {
  const toneClass = {
    amber: "border-amber-300/25 bg-amber-400/10 text-amber-50",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-50",
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-50",
    violet: "border-violet-300/25 bg-violet-400/10 text-violet-50",
  }[tone];
  return (
    <div className={`min-h-[5.25rem] rounded border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-78">{label}</p>
        <Icon className="h-4 w-4 shrink-0" />
      </div>
      <p className="mt-2 break-words font-mono text-2xl font-black leading-none [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded border border-cyan-300/25 bg-cyan-400/10 text-cyan-100">{icon}</span>
      <h2 className="break-words text-lg font-black uppercase tracking-normal text-white [overflow-wrap:anywhere]">{title}</h2>
    </div>
  );
}

function VisibilityRow({ label, active, detail }: { label: string; active: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/24 px-3 py-2">
      <span className="min-w-0 break-words text-xs font-black uppercase text-zinc-200 [overflow-wrap:anywhere]">{label}</span>
      <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase ${active ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-50" : "border-rose-300/25 bg-rose-400/10 text-rose-100"}`}>
        {detail ?? (active ? "Visible" : "Hidden")}
      </span>
    </div>
  );
}

function IntelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/24 px-3 py-2">
      <span className="min-w-0 break-words text-xs font-black uppercase text-zinc-400 [overflow-wrap:anywhere]">{label}</span>
      <span className="break-words text-right text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

function ProgressStat({ label, value, tone }: { label: string; value: number; tone: "amber" | "cyan" | "emerald" }) {
  const toneClass = {
    amber: "border-amber-300/25 bg-amber-400/10 text-amber-50",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-50",
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-50",
  }[tone];
  return (
    <div className={`rounded border p-4 ${toneClass}`}>
      <p className="font-mono text-3xl font-black leading-none">{formatNumber(value)}</p>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em]">{label}</p>
    </div>
  );
}

function CallingCard({ card }: { card: PublicCallingCard }) {
  return (
    <article className="dzn-public-profile-calling-card rounded-lg border border-violet-300/24 bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.2),transparent_40%),rgba(0,0,0,0.32)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-black uppercase text-white [overflow-wrap:anywhere]">{card.name ?? "Calling Card"}</p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-violet-100">{titleCase(card.rarity ?? "earned")}</p>
        </div>
        <BadgeCheck className="h-5 w-5 shrink-0 text-violet-100" />
      </div>
      {card.description ? <p className="mt-3 text-sm font-bold leading-6 text-zinc-300">{card.description}</p> : null}
      {card.awarded_label ? <p className="mt-3 text-xs font-bold text-zinc-500">Earned {card.awarded_label}</p> : null}
    </article>
  );
}

function ChallengeCard({ challenge }: { challenge: PublicChallengeProgress }) {
  const percent = clampPercent(challenge.progress_percent);
  return (
    <article className="dzn-public-profile-challenge-card rounded-lg border border-white/10 bg-black/28 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-black uppercase text-white [overflow-wrap:anywhere]">{challenge.title ?? "DZN Challenge"}</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-cyan-100">{challenge.category ?? "community"} / {(challenge.status ?? "joined").replace("_", " ")}</p>
        </div>
        <span className="rounded border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-black uppercase text-zinc-200">
          {percent}%
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded bg-white/10">
        <span className="block h-full rounded bg-[linear-gradient(90deg,#22d3ee,#8b5cf6)]" style={{ width: `${percent}%` }} />
      </div>
      {challenge.completed_label ? (
        <p className="mt-3 text-xs font-bold text-zinc-500">Completed {challenge.completed_label}</p>
      ) : null}
    </article>
  );
}

function TimelineRow({ item }: { item: PublicTimelineItem }) {
  return (
    <div className="dzn-public-profile-timeline-row flex items-start gap-3 rounded border border-white/10 bg-black/24 p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
        {item.kind === "calling_card" ? <Sparkles className="h-4 w-4" /> : <Swords className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{item.label ?? "DZN Progress"}</span>
        <span className="mt-1 block text-xs font-bold leading-5 text-zinc-400">{item.detail ?? "Verified DZN player progress."}</span>
        {item.occurred_label ? <span className="mt-1 block text-[10px] font-black uppercase text-zinc-600">{item.occurred_label}</span> : null}
      </span>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 rounded border border-white/10 bg-black/24 p-4">
      <p className="text-sm font-black uppercase text-white">{title}</p>
      <p className="mt-2 text-sm font-bold leading-6 text-zinc-400">{body}</p>
    </div>
  );
}

function PublicSectionState({ icon, title, body, hidden }: { icon: ReactNode; title: string; body: string; hidden: boolean }) {
  return (
    <section className={`dzn-public-profile-panel rounded-lg border p-4 ${hidden ? "border-rose-300/18 bg-rose-400/8" : "border-white/10 bg-white/[0.045]"}`}>
      <PanelHeader icon={hidden ? <EyeOff className="h-5 w-5" /> : icon} title={title} />
      <p className={`mt-4 text-sm font-bold leading-6 ${hidden ? "text-rose-50/78" : "text-zinc-400"}`}>{body}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/player" className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-white/12 bg-white/8 px-3 py-2 text-xs font-black uppercase text-white transition hover:bg-white/12">
          Player Hub
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link href="/events/challenges" className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-cyan-300/25 bg-cyan-400/12 px-3 py-2 text-xs font-black uppercase text-cyan-50 transition hover:bg-cyan-400/18">
          Challenges
          <Swords className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function LoadingPanel() {
  return (
    <section className="grid gap-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="dzn-public-profile-panel h-36 animate-pulse rounded-lg border border-white/10 bg-white/[0.045]" />
      ))}
    </section>
  );
}

function normalizePayload(value: PublicPlayerProfilePayload | null, handle: string): PublicPlayerProfilePayload {
  if (!value || typeof value !== "object" || !value.ok) {
    return {
      ok: false,
      profile: {
        handle,
        display_name: "DZN Player",
        avatar_initial: "D",
        public_href: `/players/${encodeURIComponent(handle)}`,
        public_api_href: `/api/public/player-profiles/${encodeURIComponent(handle)}`,
      },
      visibility: normalizeVisibility(null),
      sections: {
        xp: null,
        challenge_progress: null,
        calling_cards: null,
        timeline: [],
      },
      fairness: {},
    };
  }
  return {
    ...value,
    visibility: normalizeVisibility(value.visibility),
    sections: {
      xp: value.sections?.xp ?? null,
      challenge_progress: value.sections?.challenge_progress ?? null,
      calling_cards: value.sections?.calling_cards ?? null,
      timeline: Array.isArray(value.sections?.timeline) ? value.sections.timeline : [],
    },
  };
}

function currentPublicProfileHandle(fallback: string) {
  if (typeof window === "undefined") return fallback;
  const match = window.location.pathname.match(/^\/players\/([^/?#]+)/);
  if (!match?.[1]) return fallback;
  try {
    return decodeURIComponent(match[1]) || fallback;
  } catch {
    return fallback;
  }
}

function normalizeVisibility(value: PublicPlayerProfilePayload["visibility"] | null | undefined) {
  return {
    mode: "public_viewer" as const,
    xp: Boolean(value?.xp),
    challenge_progress: Boolean(value?.challenge_progress),
    calling_cards: Boolean(value?.calling_cards),
    award_dates: value?.award_dates === "month" ? "month" as const : "hidden" as const,
    private_identifiers: "hidden" as const,
    raw_award_evidence: "hidden" as const,
    exact_award_times: "hidden" as const,
  };
}

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat().format(Math.max(0, Math.trunc(Number(value) || 0)));
}

function clampPercent(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Earned";
}
