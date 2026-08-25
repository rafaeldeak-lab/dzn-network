"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Save,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Zap,
} from "lucide-react";

import { FetchJsonError, fetchJsonWithRetry } from "@/lib/client-fetch";

type ShowcaseMode = "private" | "public" | "hidden";
type PreferencesSaveState = "idle" | "saving" | "saved" | "error";

type ProfileChallengeProgress = {
  id: string;
  slug: string;
  title: string;
  category: string;
  status: "not_joined" | "joined" | "completed" | "abandoned";
  progress_value: number;
  target_value: number;
  progress_percent: number;
  xp_awarded: number;
  reward_xp: number;
  calling_card_code: string | null;
  calling_card_name: string | null;
  calling_card_awarded: string | null;
  joined_at: string | null;
  completed_at: string | null;
};

type ProfileCallingCard = {
  code: string;
  name: string;
  description: string | null;
  rarity: string;
  awarded_at: string;
};

type ProgressionTimelineItem = {
  id: string;
  kind: "calling_card" | "challenge";
  label: string;
  detail: string;
  occurred_at: string | null;
};

type PlayerProfilePayload = {
  ok?: boolean;
  source?: string;
  user?: {
    username?: string;
    avatar?: string | null;
  };
  profile?: {
    display_name?: string;
    avatar_url?: string | null;
    profile_level?: number;
    level_label?: string;
    total_xp?: number;
    xp_to_next_level?: number;
    completed_challenges?: number;
    joined_challenges?: number;
    available_challenges?: number;
    calling_card_count?: number;
    showcase_href?: string;
  };
  privacy?: {
    public_handle?: string | null;
    public_href?: string | null;
    public_api_href?: string | null;
    public_profile_enabled?: boolean;
    persistence?: string;
    settings_href?: string;
    updated_at?: string | null;
    controls?: {
      show_xp?: boolean;
      show_challenge_progress?: boolean;
      show_calling_cards?: boolean;
      show_award_dates?: boolean;
      show_discord_identity?: boolean;
      show_source_details?: boolean;
    };
    public_safe_preview?: {
      exposes_discord_id?: boolean;
      exposes_user_id?: boolean;
      exposes_source_ids?: boolean;
      exposes_raw_evidence?: boolean;
      hides_exact_award_times?: boolean;
    };
  };
  progression?: {
    total_xp?: number;
    available_challenges?: number;
    joined_challenges?: number;
    completed_challenges?: number;
    calling_cards?: ProfileCallingCard[];
    challenge_progress?: ProfileChallengeProgress[];
    timeline?: ProgressionTimelineItem[];
    challenges_href?: string;
  };
  fairness?: Record<string, boolean>;
  fetched_at?: string;
};

type ProfilePrivacyControlsPayload = NonNullable<NonNullable<PlayerProfilePayload["privacy"]>["controls"]>;

type ProfilePrivacySettingsResponse = {
  ok?: boolean;
  privacy?: PlayerProfilePayload["privacy"];
  message?: string;
  fairness?: Record<string, boolean>;
};

const SHOWCASE_MODES: Array<{ key: ShowcaseMode; label: string; detail: string }> = [
  { key: "private", label: "Private", detail: "Full view for you only" },
  { key: "public", label: "Public Preview", detail: "Safe display, no private IDs" },
  { key: "hidden", label: "Hidden Preview", detail: "Simulates profile progression hidden" },
];

export function PlayerProfileProgressionPage() {
  const [payload, setPayload] = useState<PlayerProfilePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [showcaseMode, setShowcaseMode] = useState<ShowcaseMode>("private");
  const [publicProfileEnabled, setPublicProfileEnabled] = useState(false);
  const [showXp, setShowXp] = useState(true);
  const [showChallenges, setShowChallenges] = useState(true);
  const [showCards, setShowCards] = useState(true);
  const [showAwardDates, setShowAwardDates] = useState(false);
  const [savedPreferenceKey, setSavedPreferenceKey] = useState("");
  const [preferencesState, setPreferencesState] = useState<PreferencesSaveState>("idle");
  const [preferencesMessage, setPreferencesMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetchJsonWithRetry<PlayerProfilePayload>("/api/player/profile", {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
      timeoutMs: 12_000,
    })
      .then((data) => {
        if (!active) return;
        const normalized = normalizePayload(data);
        setPayload(normalized);
        applyPrivacyState(normalized.privacy);
        setSavedPreferenceKey(preferenceKeyFromState(normalized.privacy));
        setState("ready");
        setMessage("");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof FetchJsonError && error.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent("/player/profile")}`;
          return;
        }
        setPayload(normalizePayload(null));
        setState("error");
        setMessage(error instanceof Error ? error.message : "Player profile progression could not be loaded right now.");
      });
    return () => {
      active = false;
    };
  }, []);

  const profile = useMemo(() => normalizePayload(payload), [payload]);
  const progression = normalizeProgression(profile.progression);
  const displayName = profile.profile?.display_name ?? profile.user?.username ?? "DZN Player";
  const cards = progression.calling_cards ?? [];
  const challenges = progression.challenge_progress ?? [];
  const timeline = progression.timeline ?? [];
  const publicMode = showcaseMode === "public";
  const hiddenMode = showcaseMode === "hidden";
  const canShowXp = showXp && !hiddenMode;
  const canShowChallenges = showChallenges && !hiddenMode;
  const canShowCards = showCards && !hiddenMode;
  const canShowAwardDates = showAwardDates && !hiddenMode && !publicMode;
  const preferencesDirty = preferenceKeyFromControls({
    publicProfileEnabled,
    showXp,
    showChallenges,
    showCards,
    showAwardDates,
  }) !== savedPreferenceKey;

  function applyPrivacyState(privacy: PlayerProfilePayload["privacy"]) {
    const controls = normalizePrivacyControls(privacy?.controls);
    setPublicProfileEnabled(Boolean(privacy?.public_profile_enabled));
    setShowXp(controls.show_xp);
    setShowChallenges(controls.show_challenge_progress);
    setShowCards(controls.show_calling_cards);
    setShowAwardDates(controls.show_award_dates);
    setPreferencesState("idle");
    setPreferencesMessage("");
  }

  async function savePrivacyPreferences() {
    setPreferencesState("saving");
    setPreferencesMessage("");
    try {
      const response = await fetchJsonWithRetry<ProfilePrivacySettingsResponse>("/api/player/profile-privacy", {
        method: "PATCH",
        cache: "no-store",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        timeoutMs: 12_000,
        body: JSON.stringify({
          public_profile_enabled: publicProfileEnabled,
          controls: {
            show_xp: showXp,
            show_challenge_progress: showChallenges,
            show_calling_cards: showCards,
            show_award_dates: showAwardDates,
          },
        }),
      });
      const normalizedPrivacy = normalizePrivacy(response.privacy);
      setPayload((current) => normalizePayload({
        ...(current ?? {}),
        privacy: normalizedPrivacy,
      }));
      applyPrivacyState(normalizedPrivacy);
      setSavedPreferenceKey(preferenceKeyFromState(normalizedPrivacy));
      setPreferencesState("saved");
      setPreferencesMessage("Profile privacy preferences saved.");
    } catch (error) {
      if (error instanceof FetchJsonError && error.status === 401) {
        window.location.href = `/login?returnTo=${encodeURIComponent("/player/profile")}`;
        return;
      }
      setPreferencesState("error");
      setPreferencesMessage(error instanceof Error ? error.message : "Profile privacy preferences could not be saved.");
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#040711] text-white">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[url('/media/dzn-cinematic-survivor.png')] bg-cover bg-center opacity-22" aria-hidden="true" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.22),transparent_34%),radial-gradient(circle_at_82%_12%,rgba(139,92,246,0.2),transparent_34%),linear-gradient(90deg,rgba(4,7,17,0.98),rgba(4,7,17,0.86),rgba(4,7,17,0.97))]" aria-hidden="true" />
        <div className="relative mx-auto grid min-h-[430px] max-w-7xl content-end gap-6 px-4 pb-8 pt-28 sm:px-6 lg:grid-cols-[1.12fr_0.88fr] lg:px-8">
          <div>
            <p className="inline-flex rounded border border-cyan-300/35 bg-cyan-400/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-50">
              Free player profile
            </p>
            <h1 className="mt-4 max-w-4xl break-words text-4xl font-black uppercase leading-none text-white [overflow-wrap:anywhere] sm:text-6xl">
              Progression Showcase
            </h1>
            <p className="mt-4 max-w-2xl break-words text-sm font-bold leading-6 text-zinc-200 [overflow-wrap:anywhere] sm:text-base">
              Earned XP, challenge progress, and calling cards for {displayName}. This is profile progression only, not a paid-plan boost and not a competitive ranking input.
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
              <Link href="/pricing?intent=owner_setup&returnTo=%2Fsetup" className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-amber-300/35 bg-amber-400/12 px-4 py-3 text-xs font-black uppercase text-amber-50 transition hover:bg-amber-400/18">
                Owner Setup
                <Lock className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <ProfileCard
            avatarUrl={profile.profile?.avatar_url ?? null}
            displayName={displayName}
            level={profile.profile?.profile_level ?? 1}
            levelLabel={profile.profile?.level_label ?? "Foundation Track"}
            totalXp={profile.profile?.total_xp ?? 0}
            completedChallenges={profile.profile?.completed_challenges ?? 0}
            callingCards={profile.profile?.calling_card_count ?? 0}
            hidden={hiddenMode}
          />
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[0.86fr_1.14fr] lg:px-8">
        <aside className="grid content-start gap-5">
          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <PanelHeader icon={<ShieldCheck className="h-5 w-5" />} title="Privacy Display Controls" />
            <p className="mt-3 text-sm font-bold leading-6 text-zinc-400">
              Saved display preferences belong to your player profile. The preview buttons below only change the view on this screen.
            </p>
            <div className="mt-4 rounded border border-cyan-300/20 bg-cyan-400/10 p-3">
              <p className="text-xs font-black uppercase text-cyan-50">
                Public profile visibility: {publicProfileEnabled ? "On" : "Off"}
              </p>
              <p className="mt-1 text-xs font-bold leading-5 text-cyan-50/75">
                Source: {privacySourceLabel(profile.privacy?.persistence)}{profile.privacy?.updated_at ? ` / saved ${formatDateTime(profile.privacy.updated_at)}` : ""}
              </p>
              {publicProfileEnabled && profile.privacy?.public_href ? (
                <Link href={profile.privacy.public_href} className="mt-3 inline-flex min-h-9 items-center justify-center gap-2 rounded bg-cyan-300 px-3 py-2 text-[10px] font-black uppercase text-slate-950 transition hover:bg-cyan-200">
                  View Public Profile
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : publicProfileEnabled ? (
                <p className="mt-3 text-xs font-bold leading-5 text-cyan-50/80">
                  Save preferences to create your public profile link.
                </p>
              ) : null}
            </div>
            <div className="mt-4 grid gap-2">
              {SHOWCASE_MODES.map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setShowcaseMode(mode.key)}
                  className={`flex items-center justify-between gap-3 rounded border px-3 py-3 text-left transition ${showcaseMode === mode.key ? "border-cyan-300/45 bg-cyan-400/12" : "border-white/10 bg-black/24 hover:border-white/20"}`}
                >
                  <span>
                    <span className="block text-xs font-black uppercase text-white">{mode.label}</span>
                    <span className="mt-1 block text-xs font-bold text-zinc-500">{mode.detail}</span>
                  </span>
                  {showcaseMode === mode.key ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-100" /> : <Eye className="h-4 w-4 shrink-0 text-zinc-500" />}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-2">
              <PrivacyToggle label="Allow public profile display" checked={publicProfileEnabled} onChange={setPublicProfileEnabled} />
              <PrivacyToggle label="Show XP" checked={showXp} onChange={setShowXp} />
              <PrivacyToggle label="Show challenge progress" checked={showChallenges} onChange={setShowChallenges} />
              <PrivacyToggle label="Show calling cards" checked={showCards} onChange={setShowCards} />
              <PrivacyToggle label="Show award dates" checked={showAwardDates} onChange={setShowAwardDates} />
            </div>
            <button
              type="button"
              onClick={savePrivacyPreferences}
              disabled={preferencesState === "saving" || !preferencesDirty}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded bg-cyan-400 px-4 py-3 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-zinc-600 disabled:text-zinc-300"
            >
              <Save className="h-4 w-4" />
              {preferencesState === "saving" ? "Saving Preferences" : preferencesDirty ? "Save Preferences" : "Preferences Saved"}
            </button>
            {preferencesMessage ? (
              <p className={`mt-3 text-xs font-bold leading-5 ${preferencesState === "error" ? "text-rose-200" : "text-emerald-200"}`}>
                {preferencesMessage}
              </p>
            ) : null}
            <div className="mt-4 rounded border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs font-bold leading-5 text-emerald-50/88">
              Public-safe display does not expose Discord IDs, user IDs, source IDs, raw evidence, source details, or exact award timestamps.
            </div>
          </section>

          <section className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-4">
            <PanelHeader icon={<Lock className="h-5 w-5" />} title="Fair Progression Boundary" />
            <p className="mt-3 text-sm font-bold leading-6 text-amber-50/88">
              Profile progression is earned player-side only. Earned XP and calling cards stay player-side only. They do not affect paid plans, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, or competitive eligibility.
            </p>
          </section>
        </aside>

        <div className="grid gap-5">
          {state === "loading" ? <LoadingPanel /> : null}
          {state === "error" ? <NoticePanel title="Profile progression unavailable" message={message} /> : null}

          <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <PanelHeader icon={<Zap className="h-5 w-5" />} title={publicMode ? "Public-Safe Summary" : hiddenMode ? "Hidden Preview" : "Earned Profile Summary"} />
            {hiddenMode ? (
              <HiddenPreview />
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {canShowXp ? <ProgressStat label="Earned XP" value={profile.profile?.total_xp ?? 0} tone="amber" /> : null}
                <ProgressStat label="Profile Level" value={profile.profile?.profile_level ?? 1} tone="cyan" />
                {canShowChallenges ? <ProgressStat label="Completed" value={profile.profile?.completed_challenges ?? 0} tone="emerald" /> : null}
                {canShowCards ? <ProgressStat label="Calling Cards" value={profile.profile?.calling_card_count ?? 0} tone="violet" /> : null}
              </div>
            )}
          </section>

          {canShowCards ? (
            <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <PanelHeader icon={<Sparkles className="h-5 w-5" />} title="Calling Card Showcase" />
              {cards.length ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {cards.map((card) => (
                    <CallingCard key={card.code} card={card} showAwardDates={canShowAwardDates} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No calling cards earned yet" body="Calling cards unlock from verified DZN activity, not from paid plans or client-side actions." />
              )}
            </section>
          ) : null}

          {canShowChallenges ? (
            <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <PanelHeader icon={<Trophy className="h-5 w-5" />} title="Challenge Progress" />
              <div className="mt-4 grid gap-3">
                {challenges.length ? challenges.map((challenge) => (
                  <ChallengeProgressCard key={challenge.id} challenge={challenge} showAwardDates={canShowAwardDates} />
                )) : <EmptyState title="No challenges available" body="Challenge progress will appear here after DZN loads the player challenge catalog." />}
              </div>
            </section>
          ) : null}

          {!hiddenMode ? (
            <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <PanelHeader icon={<CalendarDays className="h-5 w-5" />} title="Progression Timeline" />
              {timeline.length ? (
                <div className="mt-4 grid gap-2">
                  {timeline.map((item) => (
                    <TimelineRow key={item.id} item={item} showAwardDates={canShowAwardDates} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No progression timeline yet" body="Verified challenge progress and calling-card awards will build this profile timeline." />
              )}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function ProfileCard({
  avatarUrl,
  displayName,
  level,
  levelLabel,
  totalXp,
  completedChallenges,
  callingCards,
  hidden,
}: {
  avatarUrl: string | null;
  displayName: string;
  level: number;
  levelLabel: string;
  totalXp: number;
  completedChallenges: number;
  callingCards: number;
  hidden: boolean;
}) {
  return (
    <div className="rounded-lg border border-cyan-300/20 bg-black/40 p-5 shadow-[0_0_60px_rgba(34,211,238,0.1)]">
      <div className="flex items-center gap-4">
        <Avatar imageUrl={avatarUrl} name={displayName} hidden={hidden} />
        <div className="min-w-0">
          <p className="break-words text-xl font-black uppercase text-white [overflow-wrap:anywhere]">{hidden ? "Progression Hidden" : displayName}</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-cyan-100">Level {level} / {levelLabel}</p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <MiniProfileStat label="XP" value={hidden ? "-" : formatNumber(totalXp)} />
        <MiniProfileStat label="Complete" value={hidden ? "-" : formatNumber(completedChallenges)} />
        <MiniProfileStat label="Cards" value={hidden ? "-" : formatNumber(callingCards)} />
      </div>
    </div>
  );
}

function Avatar({ imageUrl, name, hidden }: { imageUrl: string | null; name: string; hidden: boolean }) {
  if (!hidden && imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg border border-white/10 object-cover" />
    );
  }
  return (
    <span className="grid h-20 w-20 shrink-0 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-400/12 text-2xl font-black text-cyan-50">
      {hidden ? <EyeOff className="h-8 w-8" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded border border-cyan-300/25 bg-cyan-400/10 text-cyan-100">{icon}</span>
      <h2 className="text-lg font-black uppercase tracking-normal text-white">{title}</h2>
    </div>
  );
}

function PrivacyToggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 rounded border px-3 py-2 ${disabled ? "border-white/10 bg-black/16 text-zinc-600" : "border-white/10 bg-black/24 text-zinc-200"}`}>
      <span className="text-xs font-black uppercase">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-cyan-300"
      />
    </label>
  );
}

function ProgressStat({ label, value, tone }: { label: string; value: number; tone: "amber" | "cyan" | "emerald" | "violet" }) {
  const toneClass = {
    amber: "border-amber-300/25 bg-amber-400/10 text-amber-50",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-50",
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-50",
    violet: "border-violet-300/25 bg-violet-400/10 text-violet-50",
  }[tone];
  return (
    <div className={`rounded border p-4 ${toneClass}`}>
      <p className="font-mono text-3xl font-black leading-none">{formatNumber(value)}</p>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em]">{label}</p>
    </div>
  );
}

function MiniProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.045] p-3 text-center">
      <p className="font-mono text-xl font-black text-white">{value}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">{label}</p>
    </div>
  );
}

function CallingCard({ card, showAwardDates }: { card: ProfileCallingCard; showAwardDates: boolean }) {
  return (
    <article className="rounded-lg border border-violet-300/24 bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.2),transparent_40%),rgba(0,0,0,0.32)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-black uppercase text-white [overflow-wrap:anywhere]">{card.name}</p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-violet-100">{titleCase(card.rarity)}</p>
        </div>
        <BadgeCheck className="h-5 w-5 shrink-0 text-violet-100" />
      </div>
      {card.description ? <p className="mt-3 text-sm font-bold leading-6 text-zinc-300">{card.description}</p> : null}
      {showAwardDates ? <p className="mt-3 text-xs font-bold text-zinc-500">Earned {formatDateTime(card.awarded_at)}</p> : null}
    </article>
  );
}

function ChallengeProgressCard({ challenge, showAwardDates }: { challenge: ProfileChallengeProgress; showAwardDates: boolean }) {
  const percent = clampPercent(challenge.progress_percent);
  return (
    <article className="rounded-lg border border-white/10 bg-black/28 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-black uppercase text-white [overflow-wrap:anywhere]">{challenge.title}</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-cyan-100">{challenge.category} / {challenge.status.replace("_", " ")}</p>
        </div>
        <span className="rounded border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-black uppercase text-zinc-200">
          {percent}%
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded bg-white/10">
        <span className="block h-full rounded bg-[linear-gradient(90deg,#22d3ee,#8b5cf6)]" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Tag icon={<Zap className="h-3 w-3" />} label={`${formatNumber(challenge.xp_awarded || challenge.reward_xp)} XP`} />
        {challenge.calling_card_name ? <Tag icon={<Sparkles className="h-3 w-3" />} label={challenge.calling_card_name} /> : null}
        {showAwardDates && challenge.completed_at ? <Tag icon={<CalendarDays className="h-3 w-3" />} label={formatDateTime(challenge.completed_at)} /> : null}
      </div>
    </article>
  );
}

function TimelineRow({ item, showAwardDates }: { item: ProgressionTimelineItem; showAwardDates: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded border border-white/10 bg-black/24 p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
        {item.kind === "calling_card" ? <Sparkles className="h-4 w-4" /> : <Swords className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{item.label}</span>
        <span className="mt-1 block text-xs font-bold leading-5 text-zinc-400">{item.detail}</span>
        {showAwardDates && item.occurred_at ? <span className="mt-1 block text-[10px] font-black uppercase text-zinc-600">{formatDateTime(item.occurred_at)}</span> : null}
      </span>
    </div>
  );
}

function Tag({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-black uppercase text-zinc-200">
      <span className="shrink-0 text-cyan-100">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
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

function HiddenPreview() {
  return (
    <div className="mt-4 rounded border border-white/10 bg-black/24 p-6 text-center">
      <EyeOff className="mx-auto h-8 w-8 text-zinc-500" />
      <p className="mt-3 text-lg font-black uppercase text-white">Profile progression hidden</p>
      <p className="mx-auto mt-2 max-w-xl text-sm font-bold leading-6 text-zinc-400">
        This preview hides XP, challenge details, calling cards, exact dates, and private identifiers from public display.
      </p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <section className="grid gap-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-36 animate-pulse rounded-lg border border-white/10 bg-white/[0.045]" />
      ))}
    </section>
  );
}

function NoticePanel({ title, message }: { title: string; message: string }) {
  return (
    <section className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-4 text-amber-50">
      <p className="text-sm font-black uppercase">{title}</p>
      <p className="mt-2 text-sm font-bold leading-6 text-amber-50/85">{message}</p>
    </section>
  );
}

function normalizePayload(value: PlayerProfilePayload | null): PlayerProfilePayload {
  if (!value || typeof value !== "object") {
    return {
      ok: false,
      source: "unavailable",
      user: { username: "DZN Player", avatar: null },
      profile: {
        display_name: "DZN Player",
        avatar_url: null,
        profile_level: 1,
        level_label: "Foundation Track",
        total_xp: 0,
        xp_to_next_level: 100,
        completed_challenges: 0,
        joined_challenges: 0,
        available_challenges: 0,
        calling_card_count: 0,
        showcase_href: "/player/profile",
      },
      privacy: normalizePrivacy(null),
      progression: defaultProgression(),
      fairness: {},
    };
  }
  return {
    ...value,
    privacy: normalizePrivacy(value.privacy),
    progression: normalizeProgression(value.progression),
  };
}

function normalizePrivacy(value: PlayerProfilePayload["privacy"] | null): NonNullable<PlayerProfilePayload["privacy"]> {
  const controls = normalizePrivacyControls(value?.controls);
  return {
    public_handle: typeof value?.public_handle === "string" && value.public_handle ? value.public_handle : null,
    public_href: typeof value?.public_href === "string" && value.public_href ? value.public_href : null,
    public_api_href: typeof value?.public_api_href === "string" && value.public_api_href ? value.public_api_href : null,
    public_profile_enabled: Boolean(value?.public_profile_enabled),
    persistence: typeof value?.persistence === "string" && value.persistence ? value.persistence : "unavailable",
    settings_href: typeof value?.settings_href === "string" && value.settings_href ? value.settings_href : "/api/player/profile-privacy",
    updated_at: typeof value?.updated_at === "string" && value.updated_at ? value.updated_at : null,
    controls,
    public_safe_preview: {
      exposes_discord_id: false,
      exposes_user_id: false,
      exposes_source_ids: false,
      exposes_raw_evidence: false,
      hides_exact_award_times: true,
    },
  };
}

function normalizePrivacyControls(value: Partial<ProfilePrivacyControlsPayload> | undefined | null) {
  return {
    show_xp: typeof value?.show_xp === "boolean" ? value.show_xp : true,
    show_challenge_progress: typeof value?.show_challenge_progress === "boolean" ? value.show_challenge_progress : true,
    show_calling_cards: typeof value?.show_calling_cards === "boolean" ? value.show_calling_cards : true,
    show_award_dates: typeof value?.show_award_dates === "boolean" ? value.show_award_dates : false,
    show_discord_identity: false,
    show_source_details: false,
  };
}

function preferenceKeyFromState(privacy: PlayerProfilePayload["privacy"]) {
  const controls = normalizePrivacyControls(privacy?.controls);
  return preferenceKeyFromControls({
    publicProfileEnabled: Boolean(privacy?.public_profile_enabled),
    showXp: controls.show_xp,
    showChallenges: controls.show_challenge_progress,
    showCards: controls.show_calling_cards,
    showAwardDates: controls.show_award_dates,
  });
}

function preferenceKeyFromControls(value: {
  publicProfileEnabled: boolean;
  showXp: boolean;
  showChallenges: boolean;
  showCards: boolean;
  showAwardDates: boolean;
}) {
  return [
    value.publicProfileEnabled ? "public" : "private",
    value.showXp ? "xp" : "no-xp",
    value.showChallenges ? "challenges" : "no-challenges",
    value.showCards ? "cards" : "no-cards",
    value.showAwardDates ? "dates" : "no-dates",
  ].join("|");
}

function normalizeProgression(value: PlayerProfilePayload["progression"]) {
  return {
    ...defaultProgression(),
    ...value,
    total_xp: safeNumber(value?.total_xp),
    available_challenges: safeNumber(value?.available_challenges),
    joined_challenges: safeNumber(value?.joined_challenges),
    completed_challenges: safeNumber(value?.completed_challenges),
    calling_cards: Array.isArray(value?.calling_cards) ? value.calling_cards : [],
    challenge_progress: Array.isArray(value?.challenge_progress) ? value.challenge_progress : [],
    timeline: Array.isArray(value?.timeline) ? value.timeline : [],
    challenges_href: typeof value?.challenges_href === "string" && value.challenges_href ? value.challenges_href : "/events/challenges",
  };
}

function defaultProgression() {
  return {
    total_xp: 0,
    available_challenges: 0,
    joined_challenges: 0,
    completed_challenges: 0,
    calling_cards: [] as ProfileCallingCard[],
    challenge_progress: [] as ProfileChallengeProgress[],
    timeline: [] as ProgressionTimelineItem[],
    challenges_href: "/events/challenges",
  };
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function clampPercent(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(Math.max(0, Math.trunc(value)));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date pending";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function privacySourceLabel(value: string | undefined) {
  if (value === "saved") return "saved player setting";
  if (value === "default") return "default player setting";
  if (value === "not_configured") return "settings table pending";
  return "settings unavailable";
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Earned";
}
