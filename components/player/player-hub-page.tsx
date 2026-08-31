"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Crown,
  ExternalLink,
  Gamepad2,
  Globe2,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import { FetchJsonError, fetchJsonWithRetry } from "@/lib/client-fetch";
import { PublicProfileSharePanel } from "@/components/player/public-profile-share-panel";

type PlayerHubServer = {
  linked_server_id: string;
  public_slug: string | null;
  server_name: string;
  server_type: string | null;
  server_category: string | null;
  platform: string | null;
  map_name: string | null;
  current_players: number | null;
  max_players: number | null;
  public_short_description: string | null;
  public_discord_invite: string | null;
  status: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  saved_at: string | null;
  href: string;
  community_href: string | null;
};

type PlayerHubCommunity = {
  guild_id: string;
  guild_name: string;
  guild_icon_url: string | null;
  matched_servers: PlayerHubServer[];
};

type PlayerHubEvent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  category_label: string | null;
  event_type: string | null;
  event_type_label: string | null;
  status: string | null;
  status_label: string | null;
  starts_at: string | null;
  registered_servers: number;
  total_participants: number;
  href: string;
};

type PlayerHubEntryPoint = {
  key: string;
  label: string;
  href: string;
  description: string;
  owner_entitlement_required?: boolean;
};

type PublicProfileAttribution = {
  display_name: string;
  public_handle: string;
  public_href: string;
  public_api_href: string;
};

type PlayerHubChallenge = {
  id: string;
  slug: string;
  title: string;
  category: string;
  reward?: {
    xp?: number;
    calling_card?: {
      code: string;
      name: string;
      rarity: string;
    } | null;
  };
  player_state?: {
    status?: "not_joined" | "joined" | "completed" | "abandoned";
    progress_percent?: number;
    xp_awarded?: number;
    calling_card_awarded?: string | null;
    public_profile?: PublicProfileAttribution | null;
  };
};

type PlayerHubCallingCard = {
  code: string;
  name: string;
  description: string | null;
  rarity: string;
  awarded_at: string;
};

type PlayerHubProgress = {
  source?: string;
  total_xp?: number;
  available_challenges?: number;
  joined_challenges?: number;
  completed_challenges?: number;
  calling_cards?: PlayerHubCallingCard[];
  recent_challenges?: PlayerHubChallenge[];
  href?: string;
};

type PlayerHubPublicProfile = {
  public_profile_enabled?: boolean;
  public_handle?: string | null;
  public_href?: string | null;
  public_api_href?: string | null;
  settings_href?: string;
};

type PlayerHubProfileAttributionPlacement = {
  key: string;
  label: string;
  description?: string;
  href?: string;
  public_surface?: boolean;
  can_show_public_profile_link?: boolean;
  link_state?: string;
  requires_generated_handle?: boolean;
  requires_unique_user_bridge?: boolean;
  exposes_private_identifiers?: boolean;
  affects_competition?: boolean;
};

type PlayerHubProfileAttributionPreview = {
  public_profile_enabled?: boolean;
  ready?: boolean;
  public_handle?: string | null;
  public_href?: string | null;
  public_api_href?: string | null;
  settings_href?: string;
  placements?: PlayerHubProfileAttributionPlacement[];
  excluded_surfaces?: Array<{ key?: string; label?: string; reason?: string }>;
};

type PlayerHubPayload = {
  ok?: boolean;
  user?: {
    username?: string;
    avatar?: string | null;
  };
  access?: {
    role?: "player";
    can_use_player_surfaces?: boolean;
    owner_setup_href?: string;
    owner_setup_requires_entitlement?: boolean;
  };
  communities?: PlayerHubCommunity[];
  communities_status?: {
    needs_discord_refresh?: boolean;
    matched_guild_count?: number;
    matched_server_count?: number;
    error?: string | null;
  };
  saved_servers?: {
    source?: "saved" | "not_configured" | "unavailable";
    servers?: PlayerHubServer[];
  };
  suggested_servers?: {
    source?: "live" | "display_fallback" | "unavailable";
    servers?: PlayerHubServer[];
  };
  suggested_events?: {
    source?: string;
    events?: PlayerHubEvent[];
    tournaments?: PlayerHubEvent[];
  };
  player_progress?: PlayerHubProgress;
  public_profile?: PlayerHubPublicProfile;
  profile_attribution?: PlayerHubProfileAttributionPreview;
  profile_entry_points?: PlayerHubEntryPoint[];
  fetched_at?: string;
};

const defaultEntryPoints: PlayerHubEntryPoint[] = [
  { key: "servers", label: "Servers", href: "/servers", description: "Browse connected communities." },
  { key: "events", label: "Events", href: "/events", description: "Find events and tournaments." },
  { key: "leaderboards", label: "Leaderboards", href: "/leaderboards", description: "Track competitive records." },
  { key: "challenges", label: "Challenges", href: "/events/challenges", description: "Join challenges and track earned XP." },
  { key: "profile", label: "Player Profile", href: "/player/profile", description: "Show earned XP, challenge progress, calling cards and privacy display controls." },
  { key: "pulse", label: "DZN Pulse", href: "/dzn-pulse", description: "Open player notifications." },
  {
    key: "owner_setup",
    label: "Add Server",
    href: "/pricing?intent=owner_setup&returnTo=%2Fsetup",
    description: "Owner setup stays behind Starter or Pro.",
    owner_entitlement_required: true,
  },
];

export function PlayerHubPage() {
  const [payload, setPayload] = useState<PlayerHubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const data = await fetchJsonWithRetry<PlayerHubPayload>("/api/player/hub", {
          cache: "no-store",
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!active) return;
        setPayload(normalizePayload(data));
        setError("");
      } catch (loadError) {
        if (!active) return;
        if (loadError instanceof FetchJsonError && loadError.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent("/player")}`;
          return;
        }
        setPayload(normalizePayload(null));
        setError(loadError instanceof Error ? loadError.message : "Player Hub data could not be loaded right now.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const hub = useMemo(() => normalizePayload(payload), [payload]);
  const username = hub.user?.username || "DZN Player";
  const communities = hub.communities ?? [];
  const savedServers = hub.saved_servers?.servers ?? [];
  const suggestedServers = hub.suggested_servers?.servers ?? [];
  const suggestedEvents = hub.suggested_events?.events ?? [];
  const suggestedTournaments = hub.suggested_events?.tournaments ?? [];
  const playerProgress = normalizePlayerProgress(hub.player_progress);
  const publicProfile = normalizePublicProfile(hub.public_profile);
  const publicCommunityDirectories = uniqueCommunityDirectoryServers([
    ...communities.flatMap((community) => community.matched_servers),
    ...savedServers,
    ...suggestedServers,
  ]).slice(0, 6);
  const profileAttribution = normalizeProfileAttributionPreview(hub.profile_attribution, publicProfile);
  const entryPoints = hub.profile_entry_points?.length ? hub.profile_entry_points : defaultEntryPoints;
  const ownerSetupHref = hub.access?.owner_setup_href ?? "/pricing?intent=owner_setup&returnTo=%2Fsetup";

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#05070f] text-white">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[url('/media/dzn-cinematic-survivor.png')] bg-cover bg-center opacity-24" aria-hidden="true" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,15,0.97),rgba(5,7,15,0.82),rgba(5,7,15,0.96))]" aria-hidden="true" />
        <div className="relative mx-auto grid min-h-[410px] max-w-7xl content-end gap-6 px-4 pb-8 pt-28 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
          <div>
            <p className="inline-flex border border-cyan-300/35 bg-cyan-400/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-50">
              Free player access
            </p>
            <h1 className="mt-4 max-w-4xl break-words text-4xl font-black uppercase leading-none tracking-normal text-white [overflow-wrap:anywhere] sm:text-6xl">
              Player Hub
            </h1>
            <p className="mt-4 max-w-2xl break-words text-sm font-bold leading-6 text-zinc-200 [overflow-wrap:anywhere] sm:text-base">
              Welcome back, {username}. Your Discord login opens player communities, saved servers, events, tournaments, leaderboards and profile entry points without forcing an owner plan.
            </p>
            <div className="mt-5 grid w-full max-w-md grid-cols-1 gap-3 sm:flex sm:max-w-none sm:flex-wrap">
              <Link href="/player/profile" className="inline-flex w-full items-center justify-center gap-2 rounded bg-violet-300 px-4 py-3 text-xs font-black uppercase text-slate-950 transition hover:bg-violet-200 sm:w-auto" data-player-profile-entry="hero-private-profile">
                My Profile
                <UserRound className="h-4 w-4" />
              </Link>
              <Link href="/servers" className="inline-flex w-full items-center justify-center gap-2 rounded bg-cyan-400 px-4 py-3 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300 sm:w-auto">
                Browse Servers
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/events" className="inline-flex w-full items-center justify-center gap-2 rounded border border-white/15 bg-white/8 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-white/12 sm:w-auto">
                Events
                <CalendarDays className="h-4 w-4" />
              </Link>
              <Link href={ownerSetupHref} className="inline-flex w-full items-center justify-center gap-2 rounded border border-amber-300/35 bg-amber-400/12 px-4 py-3 text-xs font-black uppercase text-amber-50 transition hover:bg-amber-400/18 sm:w-auto">
                Add Server
                <Crown className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="grid content-end gap-3 sm:grid-cols-2">
            <HubMetric icon={Users} label="Matched Communities" value={communities.length} tone="cyan" />
            <HubMetric icon={Bookmark} label="Saved Servers" value={savedServers.length} tone="emerald" />
            <HubMetric icon={CalendarDays} label="Suggested Events" value={suggestedEvents.length} tone="amber" />
            <HubMetric icon={Trophy} label="Tournaments" value={suggestedTournaments.length} tone="rose" />
            <HubMetric icon={Sparkles} label="Earned XP" value={playerProgress.total_xp ?? 0} tone="amber" />
            <HubMetric icon={Swords} label="Challenges" value={playerProgress.joined_challenges ?? 0} tone="cyan" />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
        <div className="grid min-w-0 gap-5">
          {error ? <HubNotice title="Player Hub data needs attention" message={error} /> : null}
          {hub.communities_status?.error ? (
            <HubNotice title="Discord refresh needed" message={hub.communities_status.error} />
          ) : null}
          <SectionPanel
            icon={UserRound}
            title="Player Profile Progression Showcase"
            actionHref="/player/profile"
            actionLabel="Open profile"
            emptyTitle=""
            emptyText=""
            hasItems
          >
            <PlayerProfileShowcasePanel progress={playerProgress} />
          </SectionPanel>

          <SectionPanel
            icon={Users}
            title="Matched Discord Communities"
            actionHref="/servers"
            actionLabel="Browse all"
            emptyTitle={loading ? "Matching communities..." : "No matched communities yet"}
            emptyText={loading ? "DZN is checking your Discord communities." : "Your matched DZN communities will appear here after Discord guild matching finds connected servers."}
            hasItems={communities.length > 0}
          >
            <div className="grid gap-3">
              {communities.map((community) => (
                <CommunityCard key={community.guild_id} community={community} />
              ))}
            </div>
          </SectionPanel>

          <SectionPanel
            icon={RadioTower}
            title="Community Member Directories"
            actionHref="/servers"
            actionLabel="Browse servers"
            emptyTitle={loading ? "Finding public directories..." : "No public member directories yet"}
            emptyText={loading ? "DZN is checking matched server communities." : "Public member directories appear only for connected servers with a safe public community page. Hidden players stay hidden until they publish a public profile."}
            hasItems={publicCommunityDirectories.length > 0}
          >
            <CommunityDirectoryGrid servers={publicCommunityDirectories} />
          </SectionPanel>

          <SectionPanel
            icon={Bookmark}
            title="Followed And Saved Servers"
            actionHref="/servers"
            actionLabel="Find servers"
            emptyTitle={loading ? "Loading saved servers..." : "No saved servers yet"}
            emptyText="Servers you follow or save will appear here for quick access."
            hasItems={savedServers.length > 0}
          >
            <ServerGrid servers={savedServers} />
          </SectionPanel>

          <SectionPanel
            icon={RadioTower}
            title="Suggested Servers"
            actionHref="/servers"
            actionLabel="Open servers"
            emptyTitle={loading ? "Loading suggestions..." : "No server suggestions available"}
            emptyText="DZN could not load suggested servers right now."
            hasItems={suggestedServers.length > 0}
          >
            <ServerGrid servers={suggestedServers} />
          </SectionPanel>
        </div>

        <aside className="grid min-w-0 content-start gap-5">
          <PublicProfileSharePanel
            context="hub"
            publicHref={publicProfile.public_href}
            publicProfileEnabled={publicProfile.public_profile_enabled}
          />

          <ProfileAppearanceSummary preview={profileAttribution} />

          <SectionPanel
            icon={CalendarDays}
            title="Suggested Events"
            actionHref="/events"
            actionLabel="All events"
            emptyTitle={loading ? "Loading events..." : "No suggested events yet"}
            emptyText="Event suggestions will appear here as communities publish them."
            hasItems={suggestedEvents.length > 0}
          >
            <EventList events={suggestedEvents} />
          </SectionPanel>

          <SectionPanel
            icon={Trophy}
            title="Tournaments"
            actionHref="/events/tournaments"
            actionLabel="Open tournaments"
            emptyTitle={loading ? "Loading tournaments..." : "No tournament suggestions yet"}
            emptyText="Tournament cards will appear here when public events match the tournament feed."
            hasItems={suggestedTournaments.length > 0}
          >
            <EventList events={suggestedTournaments} />
          </SectionPanel>

          <SectionPanel
            icon={Swords}
            title="Challenges And Progress"
            actionHref={playerProgress.href ?? "/events/challenges"}
            actionLabel="Open challenges"
            emptyTitle=""
            emptyText=""
            hasItems
          >
            <PlayerProgressPanel progress={playerProgress} />
          </SectionPanel>

          <SectionPanel
            icon={UserRound}
            title="Profile Entry Points"
            emptyTitle=""
            emptyText=""
            hasItems
          >
            <div className="grid gap-2">
              {entryPoints.map((entry) => (
                <EntryPointLink key={entry.key} entry={entry} />
              ))}
            </div>
          </SectionPanel>

          <section className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-amber-100" />
              <div>
                <p className="text-sm font-black uppercase text-amber-50">Owner setup boundary</p>
                <p className="mt-2 text-sm font-bold leading-6 text-amber-50/85">
                  Player access is free. Adding, claiming, linking or managing a server still goes through Starter or Pro and remains enforced server-side.
                </p>
                <Link href={ownerSetupHref} className="mt-4 inline-flex items-center gap-2 rounded border border-amber-200/35 bg-amber-300/14 px-3 py-2 text-xs font-black uppercase text-amber-50 transition hover:bg-amber-300/22">
                  Owner Plans
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function HubMetric({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: "cyan" | "emerald" | "amber" | "rose" }) {
  const toneClass = {
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-50",
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-50",
    amber: "border-amber-300/25 bg-amber-400/10 text-amber-50",
    rose: "border-rose-300/25 bg-rose-400/10 text-rose-50",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <Icon className="h-5 w-5" />
      <p className="mt-4 text-3xl font-black leading-none">{value}</p>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em]">{label}</p>
    </div>
  );
}

function HubNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-4 text-amber-50">
      <div className="flex gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 shrink-0" />
        <div>
          <p className="text-sm font-black uppercase">{title}</p>
          <p className="mt-1 text-sm font-bold leading-6 text-amber-50/82">{message}</p>
        </div>
      </div>
    </div>
  );
}

function SectionPanel({
  icon: Icon,
  title,
  actionHref,
  actionLabel,
  emptyTitle,
  emptyText,
  hasItems,
  children,
}: {
  icon: LucideIcon;
  title: string;
  actionHref?: string;
  actionLabel?: string;
  emptyTitle: string;
  emptyText: string;
  hasItems: boolean;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.25)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded border border-white/10 bg-black/24">
            <Icon className="h-5 w-5 text-cyan-100" />
          </span>
          <h2 className="min-w-0 break-words text-lg font-black uppercase tracking-normal text-white [overflow-wrap:anywhere]">{title}</h2>
        </div>
        {actionHref && actionLabel ? (
          <Link href={actionHref} className="inline-flex items-center gap-2 rounded border border-white/12 bg-white/8 px-3 py-2 text-[10px] font-black uppercase text-zinc-100 transition hover:bg-white/12">
            {actionLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      <div className="mt-4">
        {hasItems ? (
          children
        ) : (
          <div className="rounded border border-white/10 bg-black/24 p-4">
            {emptyTitle ? <p className="text-sm font-black uppercase text-white">{emptyTitle}</p> : null}
            {emptyText ? <p className="mt-2 text-sm font-bold leading-6 text-zinc-400">{emptyText}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}

function PlayerProgressPanel({ progress }: { progress: PlayerHubProgress }) {
  const recentChallenges = progress.recent_challenges ?? [];
  const callingCards = progress.calling_cards ?? [];
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <ProgressMiniStat label="XP" value={progress.total_xp ?? 0} />
        <ProgressMiniStat label="Joined" value={progress.joined_challenges ?? 0} />
        <ProgressMiniStat label="Cards" value={callingCards.length} />
      </div>
      <div className="rounded border border-white/10 bg-black/24 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-black uppercase text-white">Recent Challenges</p>
          <span className="text-[10px] font-black uppercase text-cyan-100">{progress.completed_challenges ?? 0} complete</span>
        </div>
        {recentChallenges.length ? (
          <div className="mt-3 grid gap-2">
            {recentChallenges.map((challenge) => (
              <ProgressChallengeRow key={challenge.id} challenge={challenge} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm font-bold leading-6 text-zinc-400">Join a player challenge to start building verified XP and profile progress.</p>
        )}
      </div>
      <div className="rounded border border-white/10 bg-black/24 p-4">
        <p className="text-sm font-black uppercase text-white">Calling Cards</p>
        {callingCards.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {callingCards.slice(0, 6).map((card) => (
              <span key={card.code} className="inline-flex max-w-full items-center gap-1.5 rounded border border-violet-300/25 bg-violet-400/10 px-2.5 py-1.5 text-[10px] font-black uppercase text-violet-50">
                <Sparkles className="h-3 w-3 shrink-0" />
                <span className="truncate">{card.name}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm font-bold leading-6 text-zinc-400">Calling cards awarded from verified DZN activity will appear here. Paid plans do not unlock competitive cards.</p>
        )}
      </div>
    </div>
  );
}

function PlayerProfileShowcasePanel({ progress }: { progress: PlayerHubProgress }) {
  const callingCards = progress.calling_cards ?? [];
  const recentChallenges = progress.recent_challenges ?? [];
  const featuredCards = callingCards.slice(0, 4);
  const featuredChallenges = recentChallenges.slice(0, 2);
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="min-w-0 rounded-lg border border-cyan-300/20 bg-[radial-gradient(circle_at_0%_0%,rgba(34,211,238,0.18),transparent_38%),rgba(0,0,0,0.26)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-100">Earned profile</p>
            <p className="mt-2 break-words text-2xl font-black uppercase leading-tight text-white [overflow-wrap:anywhere]">
              XP, cards and challenge progress
            </p>
          </div>
          <UserRound className="h-7 w-7 shrink-0 text-cyan-100" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <ProgressMiniStat label="XP" value={progress.total_xp ?? 0} />
          <ProgressMiniStat label="Complete" value={progress.completed_challenges ?? 0} />
          <ProgressMiniStat label="Cards" value={callingCards.length} />
        </div>
        <p className="mt-4 text-sm font-bold leading-6 text-zinc-300">
          The profile view adds privacy display controls for XP, challenge progress and calling cards. Profile progression is earned player-side only and paid plans do not improve it.
        </p>
        <Link href="/player/profile" className="mt-4 inline-flex items-center gap-2 rounded bg-cyan-400 px-3 py-2 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300">
          View Showcase
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="grid min-w-0 gap-3">
        <div className="min-w-0 rounded border border-white/10 bg-black/24 p-4">
          <p className="text-sm font-black uppercase text-white">Featured Calling Cards</p>
          {featuredCards.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {featuredCards.map((card) => (
                <span key={card.code} className="inline-flex max-w-full items-center gap-1.5 rounded border border-violet-300/25 bg-violet-400/10 px-2.5 py-1.5 text-[10px] font-black uppercase text-violet-50">
                  <Sparkles className="h-3 w-3 shrink-0" />
                  <span className="truncate">{card.name}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm font-bold leading-6 text-zinc-400">Calling cards appear here after trusted DZN activity awards them.</p>
          )}
        </div>
        <div className="min-w-0 rounded border border-white/10 bg-black/24 p-4">
          <p className="text-sm font-black uppercase text-white">Recent Challenge Progress</p>
          {featuredChallenges.length ? (
            <div className="mt-3 grid gap-2">
              {featuredChallenges.map((challenge) => (
                <ProgressChallengeRow key={challenge.id} challenge={challenge} />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm font-bold leading-6 text-zinc-400">Join free player challenges to build progress for this showcase.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileAppearanceSummary({ preview }: { preview: PlayerHubProfileAttributionPreview }) {
  const placements = Array.isArray(preview.placements) ? preview.placements : [];
  const active = placements.filter((placement) => placement.can_show_public_profile_link).slice(0, 3);
  const excluded = Array.isArray(preview.excluded_surfaces) ? preview.excluded_surfaces : [];
  return (
    <SectionPanel
      icon={RadioTower}
      title="Where My Profile Appears"
      actionHref="/player/profile"
      actionLabel="Manage"
      emptyTitle=""
      emptyText=""
      hasItems
    >
      <div className="grid gap-3">
        <div className="rounded border border-cyan-300/20 bg-cyan-400/10 p-3">
          <p className="text-xs font-black uppercase text-cyan-50">
            {preview.ready ? "Public attribution links enabled" : "Public attribution links hidden"}
          </p>
          <p className="mt-2 text-xs font-bold leading-5 text-cyan-50/75">
            Links appear only from generated handles and trusted user bridges. CTF/event scoring rosters stay out until a dedicated scoring-safe slice.
          </p>
        </div>
        <div className="grid gap-2">
          {(active.length ? active : placements.slice(0, 3)).map((placement) => (
            <div key={placement.key} className="flex items-start justify-between gap-3 rounded border border-white/10 bg-black/24 p-3">
              <span className="min-w-0">
                <span className="block truncate text-xs font-black uppercase text-white">{placement.label}</span>
                <span className="mt-1 block text-[10px] font-black uppercase text-zinc-500">{placement.public_surface ? "Public" : "Private player preview"}</span>
              </span>
              <span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-black uppercase ${placement.can_show_public_profile_link ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-zinc-500/25 bg-zinc-500/10 text-zinc-400"}`}>
                {placement.can_show_public_profile_link ? "Can show" : "Hidden"}
              </span>
            </div>
          ))}
        </div>
        {excluded.length ? (
          <p className="text-xs font-bold leading-5 text-zinc-500">
            Excluded: {excluded.map((surface) => surface.label || surface.key).filter(Boolean).join(", ")}.
          </p>
        ) : null}
      </div>
    </SectionPanel>
  );
}

function ProgressMiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-cyan-300/18 bg-cyan-400/8 p-3">
      <p className="font-mono text-2xl font-black text-cyan-50">{value}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100/80">{label}</p>
    </div>
  );
}

function ProgressChallengeRow({ challenge }: { challenge: PlayerHubChallenge }) {
  const state = challenge.player_state?.status ?? "not_joined";
  const percent = clampPercent(challenge.player_state?.progress_percent ?? 0);
  const publicProfile = normalizePublicProfileAttribution(challenge.player_state?.public_profile);
  return (
    <Link href="/events/challenges" className="block rounded border border-white/10 bg-white/[0.045] p-3 transition hover:border-cyan-300/30 hover:bg-white/[0.07]">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-black uppercase text-white">{challenge.title}</span>
          <span className="mt-1 block truncate text-[10px] font-black uppercase text-zinc-500">{challenge.category} / {state.replace("_", " ")}</span>
          {publicProfile ? (
            <span className="mt-2 inline-flex max-w-full items-center gap-1 rounded border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100">
              <UserRound className="h-3 w-3 shrink-0" />
              <span className="truncate">{publicProfile.display_name}</span>
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs font-black text-cyan-100">{percent}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-white/10">
        <span className="block h-full rounded bg-cyan-300" style={{ width: `${percent}%` }} />
      </div>
    </Link>
  );
}

function CommunityCard({ community }: { community: PlayerHubCommunity }) {
  const firstServers = community.matched_servers.slice(0, 3);
  return (
    <article className="rounded border border-white/10 bg-black/24 p-4">
      <div className="flex items-center gap-3">
        <GuildAvatar name={community.guild_name} imageUrl={community.guild_icon_url} />
        <div className="min-w-0">
          <p className="break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{community.guild_name}</p>
          <p className="mt-1 text-xs font-bold text-zinc-400">
            {community.matched_servers.length} matched {community.matched_servers.length === 1 ? "server" : "servers"}
          </p>
        </div>
      </div>
      {firstServers.length ? (
        <div className="mt-3 grid gap-2">
          {firstServers.map((server) => (
            <InlineServerLink key={server.linked_server_id} server={server} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm font-bold leading-6 text-zinc-400">DZN found the Discord community. Connected servers will appear here when available.</p>
      )}
    </article>
  );
}

function ServerGrid({ servers }: { servers: PlayerHubServer[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {servers.map((server) => (
        <ServerCard key={server.linked_server_id} server={server} />
      ))}
    </div>
  );
}

function ServerCard({ server }: { server: PlayerHubServer }) {
  return (
    <article className="group rounded border border-white/10 bg-black/24 p-4 transition hover:border-cyan-300/35 hover:bg-cyan-400/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{server.server_name}</p>
          <p className="mt-1 text-xs font-bold text-zinc-400">{[server.guild_name, server.platform, server.map_name].filter(Boolean).join(" / ") || "DZN community"}</p>
        </div>
        <Link href={server.href} aria-label={`Open ${server.server_name}`} className="grid h-9 w-9 shrink-0 place-items-center rounded border border-white/10 bg-white/8 text-cyan-100 transition group-hover:bg-cyan-400/14">
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      {server.public_short_description ? (
        <p className="mt-3 line-clamp-2 text-sm font-bold leading-6 text-zinc-300">{server.public_short_description}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <MiniBadge icon={Gamepad2} label={server.server_type ?? server.server_category ?? "Server"} />
        <MiniBadge icon={Users} label={formatPlayers(server)} />
        <MiniBadge icon={Globe2} label={server.status ?? "Pending"} />
      </div>
      {server.community_href ? (
        <Link href={server.community_href} className="mt-4 inline-flex items-center gap-2 rounded border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 transition hover:bg-cyan-400/16">
          Member Directory
          <Users className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </article>
  );
}

function InlineServerLink({ server }: { server: PlayerHubServer }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.045] px-3 py-2 text-sm font-bold text-zinc-200">
      <Link href={server.href} className="min-w-0 flex-1 truncate transition hover:text-white">
        {server.server_name}
      </Link>
      {server.community_href ? (
        <Link href={server.community_href} className="inline-flex shrink-0 items-center gap-1 rounded border border-cyan-300/18 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase text-cyan-100 transition hover:bg-cyan-400/16 hover:text-white">
          Members
          <Users className="h-3 w-3" />
        </Link>
      ) : null}
      <Link href={server.href} aria-label={`Open ${server.server_name}`} className="inline-flex shrink-0 items-center gap-1 text-[10px] font-black uppercase text-cyan-100 transition hover:text-white">
        Open
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function CommunityDirectoryGrid({ servers }: { servers: PlayerHubServer[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {servers.map((server) => (
        <CommunityDirectoryCard key={`${server.linked_server_id}:${server.community_href}`} server={server} />
      ))}
    </div>
  );
}

function CommunityDirectoryCard({ server }: { server: PlayerHubServer }) {
  if (!server.community_href) return null;
  return (
    <Link href={server.community_href} className="group rounded border border-cyan-300/18 bg-cyan-400/8 p-4 transition hover:border-cyan-200/40 hover:bg-cyan-400/12">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{server.guild_name ?? server.server_name}</span>
          <span className="mt-1 block break-words text-xs font-bold text-zinc-400 [overflow-wrap:anywhere]">{server.server_name}</span>
        </span>
        <Users className="h-5 w-5 shrink-0 text-cyan-100 transition group-hover:text-white" />
      </div>
      <p className="mt-3 text-xs font-bold leading-5 text-cyan-50/75">
        Public-safe member rows only. Hidden players stay anonymous until they opt in from their player profile.
      </p>
    </Link>
  );
}

function EventList({ events }: { events: PlayerHubEvent[] }) {
  return (
    <div className="grid gap-3">
      {events.map((event) => (
        <Link key={event.id} href={event.href} className="group rounded border border-white/10 bg-black/24 p-4 transition hover:border-amber-300/35 hover:bg-amber-400/[0.06]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{event.name}</p>
              <p className="mt-1 text-xs font-bold text-zinc-400">{[event.event_type_label, event.category_label, event.status_label].filter(Boolean).join(" / ")}</p>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-amber-100 transition group-hover:translate-x-0.5" />
          </div>
          {event.description ? <p className="mt-3 line-clamp-2 text-sm font-bold leading-6 text-zinc-300">{event.description}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <MiniBadge icon={CalendarDays} label={formatDate(event.starts_at)} />
            <MiniBadge icon={RadioTower} label={`${event.registered_servers} servers`} />
            <MiniBadge icon={Trophy} label={`${event.total_participants} participants`} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function EntryPointLink({ entry }: { entry: PlayerHubEntryPoint }) {
  const Icon = entry.owner_entitlement_required ? Crown : entry.key === "leaderboards" ? Trophy : entry.key === "events" ? CalendarDays : entry.key === "activity" ? Sparkles : UserRound;
  return (
    <Link href={entry.href} className="group flex min-w-0 items-center justify-between gap-3 rounded border border-white/10 bg-black/24 p-3 transition hover:border-cyan-300/30 hover:bg-white/[0.07]">
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-white/10 bg-white/8">
          <Icon className="h-4 w-4 text-cyan-100" />
        </span>
        <span className="min-w-0">
          <span className="block break-words text-sm font-black uppercase text-white [overflow-wrap:anywhere]">{entry.label}</span>
          <span className="mt-1 block break-words text-xs font-bold text-zinc-400 [overflow-wrap:anywhere]">{entry.description}</span>
        </span>
      </span>
      {entry.href.startsWith("http") ? <ExternalLink className="h-4 w-4 shrink-0 text-zinc-300" /> : <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300 transition group-hover:text-white" />}
    </Link>
  );
}

function GuildAvatar({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
    );
  }
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded border border-cyan-300/25 bg-cyan-400/12 text-lg font-black text-cyan-50">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function MiniBadge({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-black uppercase text-zinc-200">
      <Icon className="h-3 w-3 shrink-0 text-cyan-100" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function normalizePayload(value: PlayerHubPayload | null): PlayerHubPayload {
  if (!value || typeof value !== "object") {
    return {
      ok: false,
      communities: [],
      saved_servers: { source: "unavailable", servers: [] },
      suggested_servers: { source: "unavailable", servers: [] },
      suggested_events: { source: "unavailable", events: [], tournaments: [] },
      player_progress: defaultPlayerProgress(),
      profile_entry_points: defaultEntryPoints,
      access: {
        role: "player",
        can_use_player_surfaces: true,
        owner_setup_href: "/pricing?intent=owner_setup&returnTo=%2Fsetup",
        owner_setup_requires_entitlement: true,
      },
    };
  }
  return {
    ...value,
    communities: Array.isArray(value.communities) ? value.communities : [],
    saved_servers: {
      source: value.saved_servers?.source ?? "unavailable",
      servers: Array.isArray(value.saved_servers?.servers) ? value.saved_servers.servers : [],
    },
    suggested_servers: {
      source: value.suggested_servers?.source ?? "unavailable",
      servers: Array.isArray(value.suggested_servers?.servers) ? value.suggested_servers.servers : [],
    },
    suggested_events: {
      source: value.suggested_events?.source ?? "unavailable",
      events: Array.isArray(value.suggested_events?.events) ? value.suggested_events.events : [],
      tournaments: Array.isArray(value.suggested_events?.tournaments) ? value.suggested_events.tournaments : [],
    },
    player_progress: normalizePlayerProgress(value.player_progress),
    public_profile: normalizePublicProfile(value.public_profile),
    profile_attribution: normalizeProfileAttributionPreview(value.profile_attribution, normalizePublicProfile(value.public_profile)),
    profile_entry_points: Array.isArray(value.profile_entry_points) ? value.profile_entry_points : defaultEntryPoints,
    access: {
      role: "player",
      can_use_player_surfaces: true,
      owner_setup_href: value.access?.owner_setup_href ?? "/pricing?intent=owner_setup&returnTo=%2Fsetup",
      owner_setup_requires_entitlement: true,
    },
  };
}

function normalizePublicProfile(value: PlayerHubPublicProfile | undefined): Required<PlayerHubPublicProfile> {
  return {
    public_profile_enabled: Boolean(value?.public_profile_enabled),
    public_handle: typeof value?.public_handle === "string" && value.public_handle ? value.public_handle : null,
    public_href: typeof value?.public_href === "string" && value.public_href ? value.public_href : null,
    public_api_href: typeof value?.public_api_href === "string" && value.public_api_href ? value.public_api_href : null,
    settings_href: typeof value?.settings_href === "string" && value.settings_href ? value.settings_href : "/api/player/profile-privacy",
  };
}

function normalizeProfileAttributionPreview(
  value: PlayerHubProfileAttributionPreview | undefined,
  publicProfile: Required<PlayerHubPublicProfile>,
): Required<PlayerHubProfileAttributionPreview> {
  return {
    public_profile_enabled: typeof value?.public_profile_enabled === "boolean" ? value.public_profile_enabled : publicProfile.public_profile_enabled,
    ready: Boolean(value?.ready && publicProfile.public_profile_enabled && publicProfile.public_href),
    public_handle: nullableString(value?.public_handle ?? publicProfile.public_handle),
    public_href: nullableString(value?.public_href ?? publicProfile.public_href),
    public_api_href: nullableString(value?.public_api_href ?? publicProfile.public_api_href),
    settings_href: nullableString(value?.settings_href ?? publicProfile.settings_href) ?? "/api/player/profile-privacy",
    placements: Array.isArray(value?.placements) ? value.placements.map(normalizeProfileAttributionPlacement).filter(Boolean) as PlayerHubProfileAttributionPlacement[] : [],
    excluded_surfaces: Array.isArray(value?.excluded_surfaces) ? value.excluded_surfaces : [],
  };
}

function normalizeProfileAttributionPlacement(value: unknown): PlayerHubProfileAttributionPlacement | null {
  if (!value || typeof value !== "object") return null;
  const record = value as PlayerHubProfileAttributionPlacement;
  return {
    key: nullableString(record.key) ?? "profile_link_area",
    label: nullableString(record.label) ?? "Profile link area",
    description: nullableString(record.description) ?? undefined,
    href: nullableString(record.href) ?? undefined,
    public_surface: Boolean(record.public_surface),
    can_show_public_profile_link: Boolean(record.can_show_public_profile_link),
    link_state: nullableString(record.link_state) ?? "hidden_until_public_profile",
    requires_generated_handle: record.requires_generated_handle !== false,
    requires_unique_user_bridge: Boolean(record.requires_unique_user_bridge),
    exposes_private_identifiers: false,
    affects_competition: false,
  };
}

function normalizePublicProfileAttribution(value: unknown): PublicProfileAttribution | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const publicHandle = normalizePublicProfileHandle(record.public_handle);
  if (!publicHandle) return null;
  const expectedHref = `/players/${publicHandle}`;
  const expectedApiHref = `/api/public/player-profiles/${publicHandle}`;
  if (!(record.public_href === expectedHref && record.public_api_href === expectedApiHref)) return null;
  return {
    display_name: displayNameOrDefault(record.display_name),
    public_handle: publicHandle,
    public_href: expectedHref,
    public_api_href: expectedApiHref,
  };
}

function uniqueCommunityDirectoryServers(servers: PlayerHubServer[]) {
  const seen = new Set<string>();
  const output: PlayerHubServer[] = [];
  for (const server of servers) {
    if (!server.community_href) continue;
    const key = server.public_slug ?? server.community_href;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(server);
  }
  return output;
}

function normalizePublicProfileHandle(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/.test(text) ? text : null;
}

function displayNameOrDefault(value: unknown) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, 48) || "DZN Player";
}

function defaultPlayerProgress(): PlayerHubProgress {
  return {
    source: "unavailable",
    total_xp: 0,
    available_challenges: 0,
    joined_challenges: 0,
    completed_challenges: 0,
    calling_cards: [],
    recent_challenges: [],
    href: "/events/challenges",
  };
}

function normalizePlayerProgress(value: PlayerHubProgress | undefined): PlayerHubProgress {
  return {
    ...defaultPlayerProgress(),
    ...value,
    total_xp: safeNumber(value?.total_xp),
    available_challenges: safeNumber(value?.available_challenges),
    joined_challenges: safeNumber(value?.joined_challenges),
    completed_challenges: safeNumber(value?.completed_challenges),
    calling_cards: Array.isArray(value?.calling_cards) ? value.calling_cards : [],
    recent_challenges: Array.isArray(value?.recent_challenges) ? value.recent_challenges : [],
    href: typeof value?.href === "string" && value.href ? value.href : "/events/challenges",
  };
}

function formatPlayers(server: PlayerHubServer) {
  if (typeof server.current_players === "number" && typeof server.max_players === "number" && server.max_players > 0) {
    return `${server.current_players}/${server.max_players}`;
  }
  if (typeof server.current_players === "number") return `${server.current_players} online`;
  return "Players pending";
}

function formatDate(value: string | null) {
  if (!value) return "Date pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date pending";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function nullableString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function clampPercent(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}
