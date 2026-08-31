"use client";

import {
  CalendarDays,
  ChevronRight,
  Crown,
  ExternalLink,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Star,
  Trophy,
  UserRound,
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
    description: "Browse public server profiles and find communities without needing an owner plan.",
    icon: <Radio aria-hidden="true" className="h-5 w-5" />,
    tone: "cyan",
  },
  {
    href: "/events",
    title: "Events",
    description: "Jump into player-facing events and future tournament surfaces from one account.",
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

export function PlayerHome({ mode }: { mode: PlayerHomeMode }) {
  const returnTo = mode === "profile" ? "/player/profile" : "/player";
  const [authState, setAuthState] = useState<PlayerAuthState>({
    status: "loading",
    user: null,
    navigation: null,
    linkedServerCount: 0,
  });

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

  const profileHandlePreview = useMemo(() => {
    if (authState.status !== "logged_in") return "Player";
    return authState.user.username || "DZN Player";
  }, [authState]);

  const headerNavigation = authState.status === "logged_in" ? authState.navigation : null;

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
                  : "A logged-in home for players to reach servers, events, leaderboards, saved-server tools, and profile entry points without paying for an owner plan."}
              </p>
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              {authState.status === "logged_in" ? (
                <>
                  <Link
                    href="/player/profile"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-cyan-200/60 bg-cyan-300 px-4 text-sm font-black uppercase text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.24)]"
                  >
                    Open Profile
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
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
                  <MetricTile label="Player Access" value="Free" />
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-lg border border-emerald-300/25 bg-slate-950/78 p-5 backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-emerald-300/35 bg-emerald-300/10 text-emerald-100">
                <Star aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-black uppercase text-white">Player Roadmap Hooks</h2>
                <p className="text-sm font-semibold text-slate-300">The button exists now; these player systems stay separate slices.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              {profileStatusCards.map((copy) => (
                <div key={copy} className="rounded-md border border-white/10 bg-white/6 p-3 text-sm font-semibold leading-6 text-slate-200">
                  {copy}
                </div>
              ))}
            </div>
          </section>

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
              href="/pricing?intent=owner_setup&returnTo=%2Fsetup"
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
