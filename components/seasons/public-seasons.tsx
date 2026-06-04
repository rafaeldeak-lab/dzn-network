"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, CalendarDays, ChevronRight, Crown, Medal, ShieldCheck, Swords, Trophy } from "lucide-react";

import { AnimatedBackground } from "@/components/dzn/animated-background";
import { DznLogo } from "@/components/dzn/dzn-logo";
import { fetchJsonWithRetry } from "@/lib/client-fetch";

type SeasonCategory = "deathmatch" | "pvp" | "pve" | "survival" | string;

type PublicSeason = {
  id: string;
  slug: string;
  name: string;
  category: SeasonCategory;
  status: string;
  startsAt: string;
  endsAt: string;
  scoringRules?: Record<string, unknown>;
  lastScoreRefreshAt?: string | null;
  hasScoreSnapshots?: boolean;
  leaderboardState?: "ready" | "waiting_for_first_score_snapshot" | string;
  nextRefreshCopy?: string | null;
};

type SeasonLeaderboardEntry = {
  entryId: string;
  seasonId: string;
  serverId: string;
  serverName: string;
  publicSlug: string | null;
  category: SeasonCategory;
  score: number;
  rank: number | null;
  metrics: Record<string, unknown>;
  lastScoreRefreshAt?: string | null;
};

type SeasonAward = {
  id: string;
  seasonId: string;
  serverId: string;
  serverName: string;
  publicSlug: string | null;
  awardCode: string;
  badgeCode: string | null;
  label: string;
  rank: number | null;
  awardedAt: string;
  metadata: Record<string, unknown>;
};

type SeasonsResponse = {
  ok?: boolean;
  seasons?: PublicSeason[];
  activeSeasons?: PublicSeason[];
  upcomingSeasons?: PublicSeason[];
  completedSeasons?: PublicSeason[];
  error?: string;
  message?: string;
};

type SeasonDetailResponse = {
  ok?: boolean;
  season?: PublicSeason;
  leaderboard?: SeasonLeaderboardEntry[];
  awards?: SeasonAward[];
  error?: string;
  message?: string;
};

type LoadState = "loading" | "loaded" | "error";

const CATEGORY_LABELS: Record<string, string> = {
  deathmatch: "Deathmatch",
  pvp: "PvP",
  pve: "PvE",
  survival: "Survival",
};

const CATEGORY_RULES = [
  "Deathmatch servers compete against Deathmatch servers only.",
  "PvP servers compete against PvP servers only.",
  "PvE servers compete against PvE servers only.",
  "Survival servers compete against Survival servers only.",
];

export function SeasonsIndexPage() {
  const [payload, setPayload] = useState<SeasonsResponse>({ seasons: [], activeSeasons: [], upcomingSeasons: [], completedSeasons: [] });
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchJsonWithRetry<SeasonsResponse>("/api/seasons", { cache: "no-store", headers: { accept: "application/json" }, timeoutMs: 12_000 })
      .then((data) => {
        if (!active) return;
        setPayload(normalizeSeasonsPayload(data));
        setState("loaded");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Season data could not be loaded.");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const grouped = useMemo(() => groupSeasons(payload), [payload]);

  return (
    <SeasonsShell>
      <SeasonHero
        eyebrow="DZN Seasons"
        title="Server-vs-server seasons"
        text="Time-limited DZN competitions where connected servers compete by category using stored season snapshots."
      />
      <CategorySafetyPanel />
      {state === "error" ? <MessagePanel message={error || "Season data is temporarily unavailable."} /> : null}
      {state === "loading" ? <LoadingCards /> : null}
      {state !== "loading" ? (
        <div className="grid gap-6">
          <SeasonGroup title="Active Seasons" empty="No active seasons are running right now." seasons={grouped.active} />
          <SeasonGroup title="Upcoming Seasons" empty="No upcoming seasons are scheduled yet." seasons={grouped.upcoming} />
          <SeasonGroup title="Completed Seasons" empty="Completed seasons will appear here after results are finalized." seasons={grouped.completed} />
        </div>
      ) : null}
    </SeasonsShell>
  );
}

export function SeasonDetailPage({ slug }: { slug: string }) {
  const [season, setSeason] = useState<PublicSeason | null>(null);
  const [leaderboard, setLeaderboard] = useState<SeasonLeaderboardEntry[]>([]);
  const [awards, setAwards] = useState<SeasonAward[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setState("loading");
      setError("");
      try {
        const [detail, standings] = await Promise.all([
          fetchJsonWithRetry<SeasonDetailResponse>(`/api/seasons/${encodeURIComponent(slug)}`, { cache: "no-store", headers: { accept: "application/json" }, timeoutMs: 12_000 }),
          fetchJsonWithRetry<SeasonDetailResponse>(`/api/seasons/${encodeURIComponent(slug)}/leaderboard`, { cache: "no-store", headers: { accept: "application/json" }, timeoutMs: 12_000 }),
        ]);
        if (!active) return;
        setSeason(detail.season ?? standings.season ?? null);
        setLeaderboard(Array.isArray(standings.leaderboard) ? standings.leaderboard : []);
        setAwards(Array.isArray(detail.awards) ? detail.awards : []);
        setState("loaded");
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Season detail could not be loaded.");
        setState("error");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <SeasonsShell>
      <SeasonHero
        eyebrow={season ? categoryLabel(season.category) : "DZN Season"}
        title={season?.name ?? "Season details"}
        text="Seasons use stored competition snapshots. Existing ADM ingestion and public leaderboards remain unchanged."
      />
      <CategorySafetyPanel compact />
      {state === "error" ? <MessagePanel message={error || "Season detail is temporarily unavailable."} /> : null}
      {state === "loading" ? <LoadingCards /> : null}
      {state === "loaded" && season ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="space-y-6">
            <SeasonOverview season={season} />
            <SeasonWinners awards={awards} leaderboard={leaderboard} />
            <SeasonLeaderboard season={season} leaderboard={leaderboard} />
          </main>
          <aside className="space-y-6">
            <SeasonRules season={season} />
            <SeasonAwards season={season} awards={awards} />
          </aside>
        </div>
      ) : null}
      {state === "loaded" && !season ? <MessagePanel message="Season not found." /> : null}
    </SeasonsShell>
  );
}

function SeasonsShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-6 text-white sm:px-6 lg:px-8">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col">
        <nav className="flex min-h-[104px] items-center justify-between">
          <DznLogo />
          <div className="flex items-center gap-3">
            <Link href="/servers" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white sm:inline-flex">
              Servers
            </Link>
            <Link href="/events" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/35 hover:text-white sm:inline-flex">
              Events
            </Link>
            <Link href="/seasons" className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-black uppercase text-white shadow-[0_0_26px_rgba(139,92,246,0.35)] transition hover:bg-violet-400">
              Seasons
            </Link>
          </div>
        </nav>
        <div className="pb-14">{children}</div>
      </div>
    </main>
  );
}

function SeasonHero({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <section className="py-12">
      <p className="inline-flex rounded-full border border-violet-300/25 bg-violet-400/10 px-3 py-1 text-xs font-black uppercase tracking-normal text-violet-100">
        {eyebrow}
      </p>
      <h1 className="mt-5 max-w-4xl text-4xl font-black uppercase tracking-normal text-white sm:text-6xl">{title}</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-zinc-300">{text}</p>
    </section>
  );
}

function CategorySafetyPanel({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`mb-6 rounded-xl border border-cyan-300/18 bg-cyan-400/8 ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-cyan-100" />
        <h2 className="text-sm font-black uppercase text-white">Servers only compete against the same category.</h2>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {CATEGORY_RULES.map((rule) => (
          <div key={rule} className="rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-sm font-bold text-zinc-200">
            {rule}
          </div>
        ))}
      </div>
    </section>
  );
}

function SeasonGroup({ title, seasons, empty }: { title: string; seasons: PublicSeason[]; empty: string }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <Trophy className="h-5 w-5 text-violet-200" />
        <h2 className="text-xl font-black uppercase text-white">{title}</h2>
      </div>
      {seasons.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {seasons.map((season) => <SeasonCard key={season.id} season={season} />)}
        </div>
      ) : (
        <EmptyPanel message={empty} />
      )}
    </section>
  );
}

function SeasonCard({ season }: { season: PublicSeason }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.035] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <StatusPill label={statusLabel(season.status)} />
          <h3 className="mt-4 text-xl font-black uppercase text-white">{season.name}</h3>
        </div>
        <CategoryBadge category={season.category} />
      </div>
      <div className="mt-5 grid gap-2 text-sm font-bold text-zinc-300">
        <InfoLine icon={CalendarDays} label="Starts" value={formatDate(season.startsAt)} />
        <InfoLine icon={Activity} label="Ends" value={formatDate(season.endsAt)} />
        <InfoLine icon={Swords} label="Eligibility" value={`${categoryLabel(season.category)} only`} />
      </div>
      <Link href={`/seasons/${encodeURIComponent(season.slug)}`} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-violet-300/35 bg-violet-500/18 px-4 py-3 text-xs font-black uppercase text-violet-50 transition hover:bg-violet-500/28">
        View season
        <ChevronRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

function SeasonOverview({ season }: { season: PublicSeason }) {
  const waitingForSnapshot = season.leaderboardState === "waiting_for_first_score_snapshot" || season.hasScoreSnapshots === false;
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
      <h2 className="flex items-center gap-3 text-2xl font-black uppercase text-white">
        <Medal className="h-6 w-6 text-violet-200" />
        Season details
      </h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <MetricCard label="Category" value={categoryLabel(season.category)} />
        <MetricCard label="Status" value={statusLabel(season.status)} />
        <MetricCard label="Start" value={formatDate(season.startsAt)} />
        <MetricCard label="End" value={formatDate(season.endsAt)} />
        <MetricCard label="Eligible server type" value={`${categoryLabel(season.category)} servers only`} />
        <MetricCard label="Competition source" value="Stored season snapshots" />
        <MetricCard label="Last score refresh" value={season.lastScoreRefreshAt ? formatDate(season.lastScoreRefreshAt) : "Waiting for first refresh"} />
        <MetricCard label="Leaderboard status" value={waitingForSnapshot ? "Waiting for first score snapshot" : "Snapshot ready"} />
        {season.nextRefreshCopy ? <MetricCard label="Next refresh" value={season.nextRefreshCopy} /> : null}
      </div>
    </section>
  );
}

function SeasonRules({ season }: { season: PublicSeason }) {
  const rules = rulesForSeason(season);
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
      <h2 className="text-sm font-black uppercase text-white">Scoring Rules</h2>
      <div className="mt-4 space-y-3">
        {rules.map((rule) => (
          <div key={rule} className="rounded-lg border border-white/10 bg-black/24 p-3 text-sm font-bold text-zinc-300">
            {rule}
          </div>
        ))}
      </div>
    </section>
  );
}

function SeasonAwards({ season, awards }: { season: PublicSeason; awards: SeasonAward[] }) {
  const champion = awards.find((award) => Number(award.rank) === 1);
  return (
    <section className="rounded-xl border border-amber-300/20 bg-amber-400/8 p-5">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase text-white">
        <Crown className="h-4 w-4 text-amber-200" />
        Rewards
      </h2>
      <div className="mt-4 space-y-3 text-sm font-bold leading-6 text-zinc-300">
        <p>Top season finishers can receive permanent season awards after finalization.</p>
        <p>Champion badge preview: {seasonalBadgePreview(season)}</p>
        {champion?.badgeCode ? (
          <p className="rounded-lg border border-amber-300/20 bg-black/24 px-3 py-2 text-amber-50">
            Awarded champion badge: {champion.label}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SeasonWinners({ awards, leaderboard }: { awards: SeasonAward[]; leaderboard: SeasonLeaderboardEntry[] }) {
  const topAwards = awards.filter((award) => Number(award.rank ?? 0) > 0 && Number(award.rank ?? 0) <= 3);
  const fallbackTop = leaderboard.filter((entry) => Number(entry.rank ?? 0) > 0 && Number(entry.rank ?? 0) <= 3);
  return (
    <section className="rounded-xl border border-amber-300/20 bg-amber-400/8 p-5">
      <h2 className="flex items-center gap-3 text-2xl font-black uppercase text-white">
        <Crown className="h-6 w-6 text-amber-200" />
        Winners & Awards
      </h2>
      {topAwards.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {topAwards.map((award) => (
            <WinnerCard
              key={award.id}
              rank={award.rank}
              serverName={award.serverName}
              publicSlug={award.publicSlug}
              label={award.label}
              badgeCode={award.badgeCode}
            />
          ))}
        </div>
      ) : fallbackTop.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {fallbackTop.map((entry) => (
            <WinnerCard
              key={entry.entryId}
              rank={entry.rank}
              serverName={entry.serverName}
              publicSlug={entry.publicSlug}
              label="Awaiting finalisation"
              badgeCode={null}
            />
          ))}
        </div>
      ) : (
        <EmptyPanel message="Winner awards will appear after this season is finalized." />
      )}
    </section>
  );
}

function WinnerCard({ rank, serverName, publicSlug, label, badgeCode }: { rank: number | null; serverName: string; publicSlug: string | null; label: string; badgeCode: string | null }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/24 p-4">
      <p className="text-xs font-black uppercase text-amber-100">Rank #{rank ?? "-"}</p>
      <p className="mt-2 text-lg font-black text-white">
        {publicSlug ? (
          <Link href={`/servers/profile?slug=${encodeURIComponent(publicSlug)}`} className="transition hover:text-cyan-100">
            {serverName}
          </Link>
        ) : serverName}
      </p>
      <p className="mt-2 text-sm font-bold text-zinc-300">{label}</p>
      {badgeCode ? <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase text-amber-100">{badgeCode.replace(/_/g, " ")}</p> : null}
    </div>
  );
}

function SeasonLeaderboard({ season, leaderboard }: { season: PublicSeason; leaderboard: SeasonLeaderboardEntry[] }) {
  const waitingForSnapshot = season.leaderboardState === "waiting_for_first_score_snapshot" || season.hasScoreSnapshots === false;
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
      <h2 className="flex items-center gap-3 text-2xl font-black uppercase text-white">
        <Trophy className="h-6 w-6 text-violet-200" />
        Season Leaderboard
      </h2>
      {waitingForSnapshot ? (
        <EmptyPanel message="The leaderboard is waiting for its first protected score snapshot." />
      ) : leaderboard.length ? (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-left">
            <thead>
              <tr>
                {["Rank", "Server", "Category", "Score", "Key Metrics"].map((header) => (
                  <th key={header} className="px-3 py-2 text-xs font-black uppercase text-zinc-500">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((entry) => (
                <tr key={entry.entryId} className="rounded-lg bg-black/24">
                  <td className="rounded-l-lg border-y border-l border-white/10 px-3 py-3 text-sm font-black text-violet-200">#{entry.rank ?? "-"}</td>
                  <td className="border-y border-white/10 px-3 py-3 text-sm font-black text-white">
                    {entry.publicSlug ? (
                      <Link href={`/servers/profile?slug=${encodeURIComponent(entry.publicSlug)}`} className="text-cyan-100 transition hover:text-white">
                        {entry.serverName}
                      </Link>
                    ) : entry.serverName}
                  </td>
                  <td className="border-y border-white/10 px-3 py-3"><CategoryBadge category={entry.category} compact /></td>
                  <td className="border-y border-white/10 px-3 py-3 font-mono text-sm font-black text-white">{formatNumber(entry.score)}</td>
                  <td className="rounded-r-lg border-y border-r border-white/10 px-3 py-3 text-xs font-bold text-zinc-300">{metricsSummary(entry.metrics)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyPanel message="No servers have joined yet. The leaderboard is waiting for season entries and score snapshots." />
      )}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-sm font-black text-white">{value}</p>
    </div>
  );
}

function InfoLine({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/24 p-3">
      <span className="inline-flex items-center gap-2 text-xs font-black uppercase text-zinc-500">
        <Icon className="h-4 w-4 text-cyan-200" />
        {label}
      </span>
      <span className="text-right text-xs text-zinc-200">{value}</span>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-100">
      {label}
    </span>
  );
}

function CategoryBadge({ category, compact = false }: { category: SeasonCategory; compact?: boolean }) {
  return (
    <span className={`inline-flex rounded-md border border-cyan-300/25 bg-cyan-400/10 font-black uppercase text-cyan-100 ${compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs"}`}>
      {categoryLabel(category)}
    </span>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5 text-sm font-bold text-zinc-400">
      {message}
    </div>
  );
}

function MessagePanel({ message }: { message: string }) {
  return (
    <div className="mb-6 rounded-xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">
      {message}
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
          <div className="h-5 w-24 animate-pulse rounded bg-white/10" />
          <div className="mt-5 h-8 w-2/3 animate-pulse rounded bg-white/10" />
          <div className="mt-5 h-24 animate-pulse rounded bg-white/10" />
        </div>
      ))}
    </div>
  );
}

function normalizeSeasonsPayload(payload: SeasonsResponse): SeasonsResponse {
  const seasons = Array.isArray(payload.seasons) ? payload.seasons : [];
  return {
    seasons,
    activeSeasons: Array.isArray(payload.activeSeasons) ? payload.activeSeasons : seasons.filter(isActiveSeason),
    upcomingSeasons: Array.isArray(payload.upcomingSeasons) ? payload.upcomingSeasons : seasons.filter(isUpcomingSeason),
    completedSeasons: Array.isArray(payload.completedSeasons) ? payload.completedSeasons : seasons.filter(isCompletedSeason),
  };
}

function groupSeasons(payload: SeasonsResponse) {
  const seasons = payload.seasons ?? [];
  return {
    active: payload.activeSeasons?.length ? payload.activeSeasons : seasons.filter(isActiveSeason),
    upcoming: payload.upcomingSeasons?.length ? payload.upcomingSeasons : seasons.filter(isUpcomingSeason),
    completed: payload.completedSeasons?.length ? payload.completedSeasons : seasons.filter(isCompletedSeason),
  };
}

function isActiveSeason(season: PublicSeason) {
  return ["live", "active"].includes(String(season.status).toLowerCase());
}

function isUpcomingSeason(season: PublicSeason) {
  return ["registration_open", "upcoming"].includes(String(season.status).toLowerCase());
}

function isCompletedSeason(season: PublicSeason) {
  return String(season.status).toLowerCase() === "completed";
}

function categoryLabel(category: SeasonCategory) {
  return CATEGORY_LABELS[String(category).toLowerCase()] ?? String(category || "Open");
}

function statusLabel(status: string) {
  return String(status || "pending").replace(/_/g, " ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatNumber(value: number) {
  return Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function rulesForSeason(season: PublicSeason) {
  const category = String(season.category).toLowerCase();
  if (category === "deathmatch") return ["Total kills", "K/D", "Activity"];
  if (category === "pvp") return ["Total kills", "Longest kill when available", "K/D", "Activity"];
  if (category === "pve") return ["Activity", "Survival time when available", "Deaths avoided when available"];
  if (category === "survival") return ["Longest lived when available", "Activity", "Deaths avoided"];
  return ["Stored season score snapshots"];
}

function seasonalBadgePreview(season: PublicSeason) {
  const text = `${season.slug} ${season.name}`.toLowerCase();
  if (text.includes("spring")) return "Spring Champion";
  if (text.includes("summer")) return "Summer Champion";
  if (text.includes("autumn") || text.includes("fall")) return "Autumn Champion";
  if (text.includes("winter")) return "Winter Champion";
  return `${categoryLabel(season.category)} Season Champion`;
}

function metricsSummary(metrics: Record<string, unknown>) {
  const kills = numericMetric(metrics.totalKills);
  const kd = numericMetric(metrics.kd);
  const activity = numericMetric(metrics.activity);
  const uniquePlayers = numericMetric(metrics.uniquePlayers);
  const parts = [
    kills > 0 ? `${formatNumber(kills)} kills` : "",
    kd > 0 ? `${kd.toFixed(2)} K/D` : "",
    activity > 0 ? `${formatNumber(activity)} activity` : "",
    uniquePlayers > 0 ? `${formatNumber(uniquePlayers)} players` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "Waiting for data";
}

function numericMetric(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
