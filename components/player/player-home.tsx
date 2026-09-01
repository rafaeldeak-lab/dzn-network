"use client";

import {
  BookmarkCheck,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Crown,
  ExternalLink,
  Loader2,
  LockKeyhole,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { SiteHeaderAuthState } from "@/components/site-header";
import type { AuthResponse } from "@/components/onboarding/types";

type PlayerHomeMode = "home" | "profile";
type PlayerAuthState =
  | { status: "loading"; user: null; navigation: null; linkedServerCount: 0 }
  | { status: "logged_out"; user: null; navigation: null; linkedServerCount: 0 }
  | {
      status: "logged_in";
      user: NonNullable<AuthResponse["user"]>;
      navigation: AuthResponse["navigation"] | null;
      linkedServerCount: number;
    }
  | { status: "error"; user: null; navigation: null; linkedServerCount: 0 };

type PlayerHubState =
  | { status: "idle"; data: null; message: null }
  | { status: "loading"; data: null; message: null }
  | { status: "ready"; data: PlayerHubPayload; message: null }
  | { status: "unauthorized"; data: null; message: string }
  | { status: "error"; data: null; message: string };

type PlayerHubCommunitySource = "player_discord_community_memberships" | "cached_discord_manageable_guilds" | "unavailable";

type CommunityRefreshState =
  | { status: "idle"; message: null; refreshedAt: null; requiresRelogin: false }
  | { status: "refreshing"; message: string; refreshedAt: null; requiresRelogin: false }
  | { status: "success"; message: string; refreshedAt: string | null; requiresRelogin: false }
  | { status: "error"; message: string; refreshedAt: null; requiresRelogin: boolean };

type PlayerHubRequestResult =
  | { status: "ready"; data: PlayerHubPayload }
  | { status: "unauthorized" | "error"; message: string };

type PlayerHubPayload = {
  ok: true;
  generated_at: string;
  account: {
    display_name: string;
    avatar: string | null;
    player_home_href: string;
    private_profile_href: string;
  };
  saved_servers: PlayerHubSavedServer[];
  saved_server_ids: string[];
  matched_communities: PlayerHubCommunity[];
  discord_membership_status: {
    source: PlayerHubCommunitySource;
    last_checked_at: string | null;
    refresh_href: string;
    refresh_method: "POST";
    requires_relogin: boolean;
    private: true;
    presentation_only: true;
    message: string;
  };
  suggested_events: PlayerHubEvent[];
  suggested_event_relevance: {
    private: true;
    presentation_only: true;
    uses_followed_servers: boolean;
    uses_matched_communities: boolean;
    message: string;
  };
  profile_entries: PlayerHubProfileEntry[];
  owner_setup: {
    href: string;
    gated: true;
    requires_entitlement: true;
    label: string;
    description: string;
  };
  sources: {
    saved_servers: "player_saved_servers" | "unavailable";
    matched_communities: PlayerHubCommunitySource;
    suggested_events: "public_competitive_events" | "unavailable";
  };
  fairness_boundary: string[];
};

type PlayerHubSavedServer = {
  linked_server_id: string;
  public_slug: string;
  server_name: string;
  server_type: string;
  guild_name: string | null;
  guild_icon_url: string | null;
  platform: string | null;
  map_name: string | null;
  public_short_description: string | null;
  current_players: number | null;
  max_players: number | null;
  saved_at: string;
};

type PlayerHubCommunityServer = {
  linked_server_id: string;
  public_slug: string;
  server_name: string;
  server_type: string;
  platform: string | null;
  map_name: string | null;
  current_players: number | null;
  max_players: number | null;
};

type PlayerHubCommunity = {
  guild_id: string;
  name: string;
  icon_url: string | null;
  relationship: PlayerHubCommunityRelationship;
  relationship_label: string;
  public_server_count: number;
  matched_servers: PlayerHubCommunityServer[];
};

type PlayerHubCommunityRelationship = "member" | "owner" | "administrator" | "matched";

type PlayerHubEvent = {
  id: string;
  name: string;
  slug: string;
  href: string;
  description: string;
  category: string;
  category_label: string;
  event_type: string;
  event_type_label: string;
  status: string;
  status_label: string;
  starts_at: string | null;
  ends_at: string | null;
  registered_servers: number;
  server_limit: number | null;
  relevance: {
    level: "followed_server" | "matched_community" | "public_network";
    label: string;
    reasons: string[];
    presentation_only: true;
  };
};

type PlayerHubProfileEntry = {
  key: string;
  label: string;
  href: string;
  status: string;
  description: string;
};

type PlayerActionCard = {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  tone: "cyan" | "violet" | "amber" | "emerald";
};

const playerActionCards: PlayerActionCard[] = [
  {
    href: "/servers",
    title: "Server Network",
    description: "Browse public server profiles and save the ones you want to follow.",
    icon: <Radio aria-hidden="true" className="h-5 w-5" />,
    tone: "cyan",
  },
  {
    href: "/events",
    title: "Events",
    description: "Jump into player-facing events and tournament surfaces from one account.",
    icon: <CalendarDays aria-hidden="true" className="h-5 w-5" />,
    tone: "violet",
  },
  {
    href: "/leaderboards",
    title: "Leaderboards",
    description: "View fair public rankings. Player access does not change scores or eligibility.",
    icon: <Trophy aria-hidden="true" className="h-5 w-5" />,
    tone: "amber",
  },
  {
    href: "/player/profile",
    title: "Profile Entry",
    description: "Open your personal player profile area and future privacy/profile controls.",
    icon: <UserRound aria-hidden="true" className="h-5 w-5" />,
    tone: "emerald",
  },
];

const profileStatusCards = [
  "Discord login verifies the player account before this page unlocks.",
  "Saved servers, reviews, challenges, calling cards, and profile visibility remain player-side features.",
  "Competitive leaderboards, event scoring, Server Wars, and eligibility stay independent from profile display choices.",
];

const ownerSetupFallbackHref = "/pricing?intent=owner_setup&returnTo=%2Fsetup";

async function requestPlayerHub(): Promise<PlayerHubRequestResult> {
  const response = await fetch("/api/player/hub", { cache: "no-store", credentials: "include" });
  const payload = (await response.json().catch(() => null)) as Partial<PlayerHubPayload> & { message?: string } | null;

  if (response.status === 401) {
    return {
      status: "unauthorized",
      message: payload?.message ?? "Log in with Discord to open your Player Hub.",
    };
  }
  if (!response.ok || !payload?.ok) {
    return {
      status: "error",
      message: payload?.message ?? "Player Hub data is not available right now.",
    };
  }

  return { status: "ready", data: payload as PlayerHubPayload };
}

export function PlayerHome({ mode }: { mode: PlayerHomeMode }) {
  const returnTo = mode === "profile" ? "/player/profile" : "/player";
  const [authState, setAuthState] = useState<PlayerAuthState>({
    status: "loading",
    user: null,
    navigation: null,
    linkedServerCount: 0,
  });
  const [hubState, setHubState] = useState<PlayerHubState>({
    status: "idle",
    data: null,
    message: null,
  });
  const [communityRefresh, setCommunityRefresh] = useState<CommunityRefreshState>({
    status: "idle",
    message: null,
    refreshedAt: null,
    requiresRelogin: false,
  });
  const hubUserId = authState.status === "logged_in" ? authState.user.id : null;

  useEffect(() => {
    let activeRequest = true;

    fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (!activeRequest) return;
        if (!response.ok) {
          setAuthState({ status: "logged_out", user: null, navigation: null, linkedServerCount: 0 });
          return;
        }

        const payload = (await response.json().catch(() => null)) as AuthResponse | null;
        if (!payload?.authenticated || !payload.user) {
          setAuthState({ status: "logged_out", user: null, navigation: null, linkedServerCount: 0 });
          return;
        }

        setAuthState({
          status: "logged_in",
          user: payload.user,
          navigation: payload.navigation ?? null,
          linkedServerCount: Array.isArray(payload.linkedServers) ? payload.linkedServers.length : payload.linkedServer ? 1 : 0,
        });
      })
      .catch(() => {
        if (activeRequest) setAuthState({ status: "error", user: null, navigation: null, linkedServerCount: 0 });
      });

    return () => {
      activeRequest = false;
    };
  }, []);

  useEffect(() => {
    if (!hubUserId) return;
    let activeRequest = true;

    requestPlayerHub()
      .then((result) => {
        if (!activeRequest) return;
        if (result.status === "ready") {
          setHubState({ status: "ready", data: result.data, message: null });
          return;
        }
        setHubState({ status: result.status, data: null, message: result.message });
      })
      .catch(() => {
        if (activeRequest) {
          setHubState({ status: "error", data: null, message: "Player Hub data is not available right now." });
        }
      });

    return () => {
      activeRequest = false;
    };
  }, [hubUserId]);

  async function refreshCommunityMatches() {
    if (communityRefresh.status === "refreshing") return;

    setCommunityRefresh({
      status: "refreshing",
      message: "Checking Discord memberships for private Player Hub matches.",
      refreshedAt: null,
      requiresRelogin: false,
    });

    try {
      const response = await fetch("/api/player/community-memberships/refresh", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        refreshed_at?: string | null;
        requires_relogin?: boolean;
      } | null;

      if (!response.ok || !payload?.ok) {
        setCommunityRefresh({
          status: "error",
          message: payload?.message ?? "Discord community matching could not be refreshed right now.",
          refreshedAt: null,
          requiresRelogin: Boolean(payload?.requires_relogin || response.status === 401),
        });
        return;
      }

      const nextHub = await requestPlayerHub();
      if (nextHub.status === "ready") {
        setHubState({ status: "ready", data: nextHub.data, message: null });
      } else {
        setHubState({ status: nextHub.status, data: null, message: nextHub.message });
      }

      setCommunityRefresh({
        status: "success",
        message: payload.message ?? "Discord community matching was refreshed for your private Player Hub.",
        refreshedAt: payload.refreshed_at ?? new Date().toISOString(),
        requiresRelogin: false,
      });
    } catch {
      setCommunityRefresh({
        status: "error",
        message: "Discord community matching could not be refreshed right now.",
        refreshedAt: null,
        requiresRelogin: false,
      });
    }
  }

  const profileHandlePreview = useMemo(() => {
    if (authState.status !== "logged_in") return "Player";
    if (hubState.status === "ready") return hubState.data.account.display_name;
    return authState.user.username || "DZN Player";
  }, [authState, hubState]);

  const headerNavigation = authState.status === "logged_in" ? authState.navigation : null;
  const hubData = hubState.status === "ready" ? hubState.data : null;
  const ownerSetupHref = hubData?.owner_setup.href ?? ownerSetupFallbackHref;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <SiteHeaderAuthState
        authenticated={authState.status === "logged_in"}
        checkingAccount={authState.status === "loading"}
        navigation={headerNavigation}
        returnTo={returnTo}
      />

      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-28"
        style={{ backgroundImage: "linear-gradient(180deg, rgba(2, 3, 10, 0.24), rgba(2, 3, 10, 0.98)), url('/media/dzn-cinematic-survivor.png')" }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(34,211,238,0.22),transparent_24%),radial-gradient(circle_at_78%_18%,rgba(168,85,247,0.2),transparent_26%),linear-gradient(rgba(125,211,252,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(168,85,247,0.05)_1px,transparent_1px)] bg-[size:auto,auto,120px_120px,120px_120px]" aria-hidden="true" />

      <section className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-28 pt-8 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="rounded-lg border border-cyan-300/25 bg-slate-950/78 p-5 shadow-[0_0_42px_rgba(34,211,238,0.12)] backdrop-blur">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-md border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-black uppercase text-cyan-100">
                <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                Free Player Access
              </span>
              <span className="inline-flex items-center gap-2 rounded-md border border-violet-300/30 bg-violet-300/10 px-3 py-1 text-xs font-black uppercase text-violet-100">
                <UserRound aria-hidden="true" className="h-4 w-4" />
                Discord Login
              </span>
            </div>

            <div className="mt-6 max-w-3xl">
              <h1 className="text-3xl font-black uppercase leading-tight text-white sm:text-4xl lg:text-5xl">
                {mode === "profile" ? "Personal Player Profile" : "Player Hub"}
              </h1>
              <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-200">
                {mode === "profile"
                  ? "Your private profile entry point keeps personal player tools separate from owner setup, billing, and competitive scoring."
                  : "Your logged-in player home now pulls in followed servers, private Discord membership matches, event suggestions, and profile entry points without needing an owner plan."}
              </p>
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              {authState.status === "logged_in" ? (
                <>
                  {mode === "profile" ? (
                    <Link
                      href="/player"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-cyan-200/60 bg-cyan-300 px-4 text-sm font-black uppercase text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.24)]"
                    >
                      Open Player Hub
                      <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  ) : (
                    <Link
                      href="/player/profile"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-cyan-200/60 bg-cyan-300 px-4 text-sm font-black uppercase text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.24)]"
                    >
                      Open Profile
                      <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  )}
                  <Link
                    href="/servers"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/8 px-4 text-sm font-black uppercase text-white"
                  >
                    Browse Servers
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </>
              ) : (
                <Link
                  href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-cyan-200/60 bg-cyan-300 px-4 text-sm font-black uppercase text-slate-950"
                >
                  Login With Discord
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>

          <aside className="rounded-lg border border-violet-300/25 bg-slate-950/78 p-5 backdrop-blur">
            <p className="text-xs font-black uppercase text-cyan-100">Account State</p>
            {authState.status === "loading" ? (
              <div className="mt-4 rounded-md border border-cyan-300/20 bg-cyan-300/8 p-4 text-sm font-semibold text-slate-200">
                Checking your Discord session...
              </div>
            ) : null}
            {authState.status === "logged_out" || authState.status === "error" ? (
              <div className="mt-4 rounded-md border border-amber-300/30 bg-amber-300/10 p-4">
                <p className="font-black text-white">Login required</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
                  Player pages are free, but DZN still needs Discord login before loading account details.
                </p>
              </div>
            ) : null}
            {authState.status === "logged_in" ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-cyan-300/25 bg-cyan-300/10 p-4">
                  <p className="text-sm font-black text-white">{profileHandlePreview}</p>
                  <p className="mt-1 text-xs font-semibold text-cyan-100">Discord account verified</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="Saved" value={hubMetric(hubData?.saved_servers.length, hubState)} />
                  <MetricTile label="Communities" value={hubMetric(hubData?.matched_communities.length, hubState)} />
                  <MetricTile label="Events" value={hubMetric(hubData?.suggested_events.length, hubState)} />
                  <MetricTile label="Owner Servers" value={String(authState.linkedServerCount)} />
                </div>
              </div>
            ) : null}
          </aside>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {playerActionCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`group rounded-lg border bg-slate-950/78 p-4 backdrop-blur transition hover:-translate-y-0.5 hover:bg-slate-900/88 ${toneClasses(card.tone)}`}
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-white/8 text-white">
                {card.icon}
              </span>
              <span className="mt-4 flex items-center justify-between gap-3">
                <span className="text-base font-black uppercase text-white">{card.title}</span>
                <ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400 transition group-hover:text-cyan-100" />
              </span>
              <span className="mt-2 block text-sm font-semibold leading-6 text-slate-300">{card.description}</span>
            </Link>
          ))}
        </div>

        {authState.status === "logged_in" ? (
          <PlayerHubDataPanels state={hubState} refreshState={communityRefresh} onRefreshCommunityMatches={refreshCommunityMatches} />
        ) : (
          <LoggedOutHubPreview />
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <ProfileEntryPanel state={hubState} />

          <section className="rounded-lg border border-amber-300/25 bg-slate-950/78 p-5 backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-amber-300/35 bg-amber-300/10 text-amber-100">
                <LockKeyhole aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-black uppercase text-white">Owner Setup Stays Gated</h2>
                <p className="text-sm font-semibold text-slate-300">Player pages do not unlock Nitrado, billing, setup, Store, or owner tools.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <BoundaryTile title="Player flow" body="Login, open Player Hub, browse player-facing surfaces with no payment requirement." />
              <BoundaryTile title="Owner flow" body="Server management stays behind pricing, checkout readiness, entitlement checks, and setup gates." />
            </div>
            <Link
              href={ownerSetupHref}
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-amber-300/45 bg-amber-300/12 px-4 text-sm font-black uppercase text-amber-50"
            >
              Owner Pricing
              <Crown aria-hidden="true" className="h-4 w-4" />
            </Link>
          </section>
        </div>
      </section>
    </main>
  );
}

function PlayerHubDataPanels({
  state,
  refreshState,
  onRefreshCommunityMatches,
}: {
  state: PlayerHubState;
  refreshState: CommunityRefreshState;
  onRefreshCommunityMatches: () => void;
}) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="grid gap-4 xl:grid-cols-3">
        <LoadingPanel title="Followed Servers" icon={<BookmarkCheck aria-hidden="true" className="h-5 w-5" />} />
        <LoadingPanel title="Matched Communities" icon={<Users aria-hidden="true" className="h-5 w-5" />} />
        <LoadingPanel title="Suggested Events" icon={<Sparkles aria-hidden="true" className="h-5 w-5" />} />
      </div>
    );
  }

  if (state.status === "unauthorized" || state.status === "error") {
    return (
      <section className="rounded-lg border border-amber-300/25 bg-slate-950/78 p-5 backdrop-blur">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-amber-300/35 bg-amber-300/10 text-amber-100">
            <CircleAlert aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-black uppercase text-white">Player Hub Data Unavailable</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{state.message}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <FollowedServersPanel servers={state.data.saved_servers} source={state.data.sources.saved_servers} />
      <MatchedCommunitiesPanel
        communities={state.data.matched_communities}
        source={state.data.sources.matched_communities}
        membershipStatus={state.data.discord_membership_status}
        refreshState={refreshState}
        onRefreshCommunityMatches={onRefreshCommunityMatches}
      />
      <SuggestedEventsPanel events={state.data.suggested_events} source={state.data.sources.suggested_events} />
    </div>
  );
}

function FollowedServersPanel({ servers, source }: { servers: PlayerHubSavedServer[]; source: PlayerHubPayload["sources"]["saved_servers"] }) {
  return (
    <section className="rounded-lg border border-cyan-300/24 bg-slate-950/78 p-5 backdrop-blur">
      <PanelHeader
        title="Followed Servers"
        body="Your private saved-server list, scoped to your login only."
        icon={<BookmarkCheck aria-hidden="true" className="h-5 w-5" />}
        tone="cyan"
      />
      {source === "unavailable" ? <InlineNotice text="Saved-server storage is not available in this environment yet." /> : null}
      {servers.length ? (
        <ul className="mt-4 divide-y divide-white/10">
          {servers.slice(0, 4).map((server) => (
            <li key={server.linked_server_id} className="py-3 first:pt-0 last:pb-0">
              <Link href={`/servers/profile?slug=${encodeURIComponent(server.public_slug)}`} className="group block">
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-black text-white transition group-hover:text-cyan-100">{server.server_name}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-400">{server.guild_name ?? "DZN server"} - {server.server_type}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition group-hover:text-cyan-100" />
                </span>
                <span className="mt-2 flex flex-wrap gap-2 text-xs font-bold uppercase text-slate-300">
                  <span>{server.platform ?? "Platform TBA"}</span>
                  <span>{server.map_name ?? "Map TBA"}</span>
                  <span>{formatPlayers(server.current_players, server.max_players)}</span>
                </span>
                {server.public_short_description ? (
                  <span className="mt-2 line-clamp-2 block text-sm font-semibold leading-6 text-slate-300">{server.public_short_description}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyList
          title="No followed servers yet"
          body="Save public servers from server cards or profiles and they will appear here."
          href="/servers"
          action="Browse Servers"
        />
      )}
    </section>
  );
}

function MatchedCommunitiesPanel({
  communities,
  source,
  membershipStatus,
  refreshState,
  onRefreshCommunityMatches,
}: {
  communities: PlayerHubCommunity[];
  source: PlayerHubPayload["sources"]["matched_communities"];
  membershipStatus: PlayerHubPayload["discord_membership_status"];
  refreshState: CommunityRefreshState;
  onRefreshCommunityMatches: () => void;
}) {
  const summary = summarizeCommunityMatches(communities);

  return (
    <section className="rounded-lg border border-violet-300/24 bg-slate-950/78 p-5 shadow-[0_0_36px_rgba(168,85,247,0.1)] backdrop-blur">
      <PanelHeader
        title="Matched Communities"
        body="Private Discord membership matches connected to public DZN server profiles. Presentation only."
        icon={<Users aria-hidden="true" className="h-5 w-5" />}
        tone="violet"
      />
      <CommunityRefreshControl
        membershipStatus={membershipStatus}
        refreshState={refreshState}
        onRefreshCommunityMatches={onRefreshCommunityMatches}
      />
      {source === "unavailable" ? <InlineNotice text="Discord community matching is not available in this environment yet." /> : null}
      {communities.length ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <CommunityMetricTile label="Matched" value={String(summary.totalCommunities)} />
            <CommunityMetricTile label="Public Servers" value={String(summary.publicServers)} />
            <CommunityMetricTile label="Owner/Admin" value={String(summary.owners + summary.administrators)} />
          </div>
          <div className="mt-3 grid gap-2 text-xs font-black uppercase text-slate-300 sm:grid-cols-3">
            <span className="rounded-md border border-cyan-300/20 bg-cyan-300/8 px-3 py-2 text-cyan-100">Private To You</span>
            <span className="rounded-md border border-violet-300/20 bg-violet-300/8 px-3 py-2 text-violet-100">Presentation Only</span>
            <span className="rounded-md border border-amber-300/20 bg-amber-300/8 px-3 py-2 text-amber-100">Not Owner Access</span>
          </div>
          <ul className="mt-4 space-y-3">
            {communities.map((community) => {
              const iconUrl = safeDiscordIconUrl(community.icon_url);
              return (
                <li key={community.guild_id} className={`rounded-md border p-3 ${communityToneClasses(community.relationship)}`}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-start gap-3">
                      <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/15 bg-white/8 text-sm font-black uppercase text-white">
                        {iconUrl ? (
                          <span className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${iconUrl})` }} aria-hidden="true" />
                        ) : (
                          initialsFromName(community.name)
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-white">{community.name}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-black uppercase">
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/8 px-2 py-1 text-white">
                            {communityRelationshipIcon(community.relationship)}
                            {community.relationship_label}
                          </span>
                          <span className="rounded-md border border-violet-200/20 bg-violet-300/10 px-2 py-1 text-violet-100">Private Match</span>
                        </span>
                        <span className="mt-2 block text-sm font-semibold leading-6 text-slate-300">{communityRelationshipCopy(community.relationship)}</span>
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md border border-violet-300/30 bg-violet-300/10 px-2 py-1 text-center text-xs font-black uppercase text-violet-100">
                      {community.public_server_count}
                      <span className="block text-[10px] text-slate-400">public</span>
                    </span>
                  </span>
                  {community.matched_servers.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {community.matched_servers.map((server) => (
                        <Link
                          key={server.linked_server_id}
                          href={`/servers/profile?slug=${encodeURIComponent(server.public_slug)}`}
                          className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/6 px-2.5 py-1.5 text-xs font-bold text-slate-200 transition hover:border-violet-200/45 hover:text-white"
                        >
                          <span className="max-w-[13rem] truncate">{server.server_name}</span>
                          <span className="text-slate-500">{server.platform ?? "DZN"}</span>
                          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm font-semibold leading-6 text-slate-400">No public DZN server profile is visible for this private match.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <CommunityMatchEmptyState source={source} />
      )}
    </section>
  );
}

function SuggestedEventsPanel({ events, source }: { events: PlayerHubEvent[]; source: PlayerHubPayload["sources"]["suggested_events"] }) {
  return (
    <section className="rounded-lg border border-amber-300/24 bg-slate-950/78 p-5 backdrop-blur">
      <PanelHeader
        title="Suggested Events"
        body="Private suggestions prioritise followed servers and matched communities without changing scores or eligibility."
        icon={<Sparkles aria-hidden="true" className="h-5 w-5" />}
        tone="amber"
      />
      {source === "unavailable" ? <InlineNotice text="Event storage is not available in this environment yet." /> : null}
      {source !== "unavailable" ? <InlineNotice text="These suggestions are private to your Player Hub and stay presentation-only." /> : null}
      {events.length ? (
        <ul className="mt-4 divide-y divide-white/10">
          {events.map((event) => (
            <li key={event.id} className="py-3 first:pt-0 last:pb-0">
              <Link href={event.href} className="group block">
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-black text-white transition group-hover:text-amber-100">{event.name}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase text-amber-100">{event.status_label}</span>
                      <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[0.68rem] font-black uppercase tracking-normal ${eventRelevanceClasses(event.relevance.level)}`}>
                        {event.relevance.label}
                      </span>
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-slate-500 transition group-hover:text-amber-100" />
                </span>
                <span className="mt-2 flex flex-wrap gap-2 text-xs font-bold uppercase text-slate-300">
                  <span>{event.event_type_label}</span>
                  <span>{event.category_label}</span>
                  <span>{event.server_limit ? `${event.registered_servers}/${event.server_limit} servers` : `${event.registered_servers} servers`}</span>
                </span>
                <span className="mt-2 block text-sm font-semibold text-slate-400">{formatEventTime(event.starts_at)}</span>
                <span className="mt-2 grid gap-1">
                  {event.relevance.reasons.map((reason) => (
                    <span key={reason} className="block text-xs font-semibold leading-5 text-slate-300">
                      {reason}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyList
          title="No suggested events yet"
          body="Upcoming public events and tournaments will appear here as DZN publishes them."
          href="/events"
          action="Open Events"
        />
      )}
    </section>
  );
}

function ProfileEntryPanel({ state }: { state: PlayerHubState }) {
  const entries = state.status === "ready" ? state.data.profile_entries : [];
  return (
    <section className="rounded-lg border border-emerald-300/25 bg-slate-950/78 p-5 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-emerald-300/35 bg-emerald-300/10 text-emerald-100">
          <UserRound aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-black uppercase text-white">Profile Entry Points</h2>
          <p className="text-sm font-semibold text-slate-300">Private player profile paths stay separate from owner setup and paid plans.</p>
        </div>
      </div>
      {entries.length ? (
        <ul className="mt-5 divide-y divide-white/10">
          {entries.map((entry) => (
            <li key={entry.key} className="py-3 first:pt-0 last:pb-0">
              <Link href={entry.href} className="group flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-black uppercase text-white transition group-hover:text-emerald-100">{entry.label}</span>
                  <span className="mt-1 block text-sm font-semibold leading-6 text-slate-300">{entry.description}</span>
                </span>
                <span className="mt-1 inline-flex shrink-0 items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-xs font-black uppercase text-emerald-100">
                  {entry.status.replace(/_/g, " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-5 grid gap-3">
          {profileStatusCards.map((copy) => (
            <div key={copy} className="rounded-md border border-white/10 bg-white/6 p-3 text-sm font-semibold leading-6 text-slate-200">
              {copy}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LoggedOutHubPreview() {
  return (
    <section className="rounded-lg border border-cyan-300/24 bg-slate-950/78 p-5 backdrop-blur">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-cyan-300/35 bg-cyan-300/10 text-cyan-100">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-black uppercase text-white">Free Player Hub</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">
            Log in with Discord to load followed servers, matched communities, suggested events, tournaments, and profile entry points. No owner plan is required.
          </p>
        </div>
      </div>
    </section>
  );
}

function PanelHeader({ title, body, icon, tone }: { title: string; body: string; icon: ReactNode; tone: "cyan" | "violet" | "amber" }) {
  const toneClass = tone === "violet"
    ? "border-violet-300/35 bg-violet-300/10 text-violet-100"
    : tone === "amber"
      ? "border-amber-300/35 bg-amber-300/10 text-amber-100"
      : "border-cyan-300/35 bg-cyan-300/10 text-cyan-100";
  return (
    <div className="flex items-start gap-3">
      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border ${toneClass}`}>
        {icon}
      </span>
      <div>
        <h2 className="text-lg font-black uppercase text-white">{title}</h2>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">{body}</p>
      </div>
    </div>
  );
}

function LoadingPanel({ title, icon }: { title: string; icon: ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/78 p-5 backdrop-blur">
      <PanelHeader title={title} body="Loading private Player Hub data." icon={icon} tone="cyan" />
      <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-300">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Loading
      </div>
    </section>
  );
}

function InlineNotice({ text }: { text: string }) {
  return (
    <p className="mt-4 rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-sm font-semibold leading-6 text-amber-50">
      {text}
    </p>
  );
}

function CommunityRefreshControl({
  membershipStatus,
  refreshState,
  onRefreshCommunityMatches,
}: {
  membershipStatus: PlayerHubPayload["discord_membership_status"];
  refreshState: CommunityRefreshState;
  onRefreshCommunityMatches: () => void;
}) {
  const isRefreshing = refreshState.status === "refreshing";
  const checkedAt = refreshState.refreshedAt ?? membershipStatus.last_checked_at;
  const statusMessage = refreshState.status === "idle" ? membershipStatus.message : refreshState.message;

  return (
    <div className="mt-4 rounded-md border border-violet-300/20 bg-violet-300/8 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-violet-100">Discord Membership Status</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-200">{formatCommunityCheckedAt(checkedAt)}</p>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-400">{statusMessage}</p>
        </div>
        <button
          type="button"
          onClick={onRefreshCommunityMatches}
          disabled={isRefreshing}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-violet-200/35 bg-violet-300/12 px-3 text-xs font-black uppercase text-violet-50 transition hover:border-violet-100/60 hover:bg-violet-300/18 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Refresh private Discord community matches"
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Checking" : "Refresh Matches"}
        </button>
      </div>
      {refreshState.status === "error" ? (
        <div className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-sm font-semibold leading-6 text-amber-50">
          {refreshState.requiresRelogin ? (
            <>
              <span>Discord permissions need refreshing before DZN can refresh private matches.</span>
              <Link href="/login?returnTo=%2Fplayer" className="ml-2 inline-flex font-black uppercase text-white underline decoration-amber-200/50 underline-offset-4">
                Reconnect Discord
              </Link>
            </>
          ) : (
            <span>{refreshState.message}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function EmptyList({ title, body, href, action }: { title: string; body: string; href: string; action: string }) {
  return (
    <div className="mt-5 rounded-md border border-white/10 bg-white/6 p-4">
      <p className="font-black uppercase text-white">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{body}</p>
      <Link href={href} className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/8 px-3 text-xs font-black uppercase text-white">
        {action}
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </Link>
    </div>
  );
}

function CommunityMatchEmptyState({ source }: { source: PlayerHubPayload["sources"]["matched_communities"] }) {
  if (source === "unavailable") {
    return (
      <EmptyList
        title="Community matching offline"
        body="The Player Hub keeps this panel private and read-only when matching data is unavailable. No owner, billing, profile, or competitive data is changed."
        href="/servers"
        action="View Server Network"
      />
    );
  }

  if (source === "cached_discord_manageable_guilds") {
    return (
      <EmptyList
        title="No public DZN matches yet"
        body="DZN checked the older manageable-guild cache and only shows communities when they connect to public server profiles. Your raw Discord guild list is not exposed."
        href="/servers"
        action="View Server Network"
      />
    );
  }

  return (
    <EmptyList
      title="No public DZN matches yet"
      body="DZN only shows private Discord memberships here after they match public DZN server profiles. Hidden, unmatched, and other-user communities stay private."
      href="/servers"
      action="View Server Network"
    />
  );
}

function CommunityMetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-violet-300/18 bg-violet-300/8 px-3 py-2">
      <p className="text-lg font-black text-white">{value}</p>
      <p className="mt-0.5 text-[10px] font-black uppercase text-violet-100">{label}</p>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/6 p-3">
      <p className="text-xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs font-bold uppercase text-slate-400">{label}</p>
    </div>
  );
}

function BoundaryTile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/6 p-4">
      <p className="font-black uppercase text-white">{title}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{body}</p>
    </div>
  );
}

function toneClasses(tone: PlayerActionCard["tone"]) {
  if (tone === "violet") return "border-violet-300/24 hover:border-violet-200/55";
  if (tone === "amber") return "border-amber-300/24 hover:border-amber-200/55";
  if (tone === "emerald") return "border-emerald-300/24 hover:border-emerald-200/55";
  return "border-cyan-300/24 hover:border-cyan-200/55";
}

function summarizeCommunityMatches(communities: PlayerHubCommunity[]) {
  return communities.reduce(
    (summary, community) => {
      summary.totalCommunities += 1;
      summary.publicServers += community.public_server_count;
      if (community.relationship === "owner") summary.owners += 1;
      if (community.relationship === "administrator") summary.administrators += 1;
      if (community.relationship === "member") summary.members += 1;
      return summary;
    },
    { totalCommunities: 0, publicServers: 0, members: 0, administrators: 0, owners: 0 },
  );
}

function communityToneClasses(relationship: PlayerHubCommunityRelationship) {
  if (relationship === "owner") return "border-amber-300/30 bg-amber-300/8 shadow-[inset_0_0_24px_rgba(251,191,36,0.05)]";
  if (relationship === "administrator") return "border-cyan-300/30 bg-cyan-300/8 shadow-[inset_0_0_24px_rgba(34,211,238,0.05)]";
  if (relationship === "member") return "border-violet-300/30 bg-violet-300/8 shadow-[inset_0_0_24px_rgba(168,85,247,0.05)]";
  return "border-white/12 bg-white/6";
}

function communityRelationshipIcon(relationship: PlayerHubCommunityRelationship) {
  if (relationship === "owner") return <Crown aria-hidden="true" className="h-3.5 w-3.5 text-amber-100" />;
  if (relationship === "administrator") return <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-cyan-100" />;
  if (relationship === "member") return <UserRound aria-hidden="true" className="h-3.5 w-3.5 text-violet-100" />;
  return <Users aria-hidden="true" className="h-3.5 w-3.5 text-slate-200" />;
}

function communityRelationshipCopy(relationship: PlayerHubCommunityRelationship) {
  if (relationship === "owner") return "Your Discord account owns this community, but setup still stays behind pricing and entitlement checks.";
  if (relationship === "administrator") return "Your Discord account can manage this community, but this match does not unlock owner tools.";
  if (relationship === "member") return "You are a normal member of this Discord community, matched privately to public DZN servers.";
  return "Matched from safe cached Discord context and shown only inside your private Player Hub.";
}

function eventRelevanceClasses(level: PlayerHubEvent["relevance"]["level"]) {
  if (level === "followed_server") return "border-cyan-300/35 bg-cyan-300/12 text-cyan-100";
  if (level === "matched_community") return "border-violet-300/35 bg-violet-300/12 text-violet-100";
  return "border-white/15 bg-white/8 text-slate-200";
}

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "D";
}

function safeDiscordIconUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.discordapp.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hubMetric(value: number | undefined, state: PlayerHubState) {
  if (typeof value === "number") return String(value);
  if (state.status === "loading" || state.status === "idle") return "...";
  return "0";
}

function formatPlayers(current: number | null, max: number | null) {
  if (current === null && max === null) return "Players TBA";
  if (current !== null && max !== null) return `${current}/${max} players`;
  if (current !== null) return `${current} online`;
  return `${max} slots`;
}

function formatCommunityCheckedAt(value: string | null) {
  if (!value) return "No private Discord membership check recorded yet.";
  const normalizedValue = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "Last checked recently.";
  return `Last checked ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)}`;
}

function formatEventTime(value: string | null) {
  if (!value) return "Schedule TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Schedule TBA";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
