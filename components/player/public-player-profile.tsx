"use client";

import { Activity, AlertTriangle, EyeOff, Loader2, Radio, ShieldCheck, Trophy } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { SiteHeaderAuthState } from "@/components/site-header";

type PublicPlayerProfilePayload = {
  ok: true;
  handle: string;
  href: string;
  display_name: string;
  published_at: string | null;
  updated_at: string | null;
  sections: {
    display_name: { visible: boolean; value: string | null };
    gameplay_summary: {
      visible: boolean;
      totals: {
        kills: number;
        deaths: number;
        suicides: number;
        longest_kill_distance: number;
        linked_public_servers: number;
      } | null;
      last_seen_at: string | null;
    };
    featured_server: {
      visible: boolean;
      server: {
        public_slug: string;
        href: string;
        server_name: string;
        server_type: string;
        platform: string | null;
        map_name: string | null;
        kills: number;
        deaths: number;
        longest_kill_distance: number;
        last_seen_at: string | null;
      } | null;
    };
    xp_progress: FutureSection;
    challenge_progress: FutureSection;
    calling_cards: FutureSection;
    award_dates: FutureSection;
  };
  privacy: {
    public_profile_enabled: true;
    visible_sections: string[];
  };
  safety: {
    public_safe: true;
    read_only: true;
    presentation_only: true;
    private_identifiers_exposed: false;
    raw_award_evidence_exposed: false;
  };
  fairness_boundary: string[];
};

type FutureSection = {
  visible: boolean;
  status: "not_available_yet" | "hidden";
  message: string;
};

type ProfileState =
  | { status: "checking"; data: null; message: string }
  | { status: "no_handle"; data: null; message: string }
  | { status: "loading"; data: null; message: string }
  | { status: "ready"; data: PublicPlayerProfilePayload; message: null }
  | { status: "not_found"; data: null; message: string }
  | { status: "error"; data: null; message: string };

async function requestPublicProfile(handle: string): Promise<ProfileState> {
  const response = await fetch(`/api/public/players/${encodeURIComponent(handle)}`, {
    cache: "no-store",
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as Partial<PublicPlayerProfilePayload> & { message?: string } | null;

  if (response.status === 404) {
    return {
      status: "not_found",
      data: null,
      message: payload?.message ?? "This public player profile is hidden or unavailable.",
    };
  }
  if (!response.ok || !payload?.ok) {
    return {
      status: "error",
      data: null,
      message: payload?.message ?? "Public player profile data is unavailable right now.",
    };
  }

  return { status: "ready", data: payload as PublicPlayerProfilePayload, message: null };
}

export function PublicPlayerProfile({ handle: initialHandle = null }: { handle?: string | null }) {
  const [state, setState] = useState<ProfileState>({ status: "checking", data: null, message: "Checking public profile link." });

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      const handle = normalizeRouteHandle(initialHandle) ?? currentHandleFromPath();
      if (!active) return;
      if (!handle) {
        setState({ status: "no_handle", data: null, message: "This public profile link is missing or invalid." });
        return;
      }

      setState({ status: "loading", data: null, message: "Loading public player profile." });
      const next = await requestPublicProfile(handle);
      if (active) setState(next);
    }).catch(() => {
        if (active) {
          setState({ status: "error", data: null, message: "Public player profile data is unavailable right now." });
        }
      });

    return () => {
      active = false;
    };
  }, [initialHandle]);

  const displayName = state.status === "ready" ? state.data.display_name : "Public Player Profile";
  const returnTo = state.status === "ready" ? state.data.href : "/players";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <SiteHeaderAuthState authenticated={false} checkingAccount={false} navigation={null} returnTo={returnTo} />
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-24"
        style={{ backgroundImage: "linear-gradient(180deg, rgba(2, 3, 10, 0.18), rgba(2, 3, 10, 0.98)), url('/media/dzn-cinematic-survivor.png')" }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_12%,rgba(34,211,238,0.18),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.2),transparent_28%),linear-gradient(rgba(125,211,252,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(168,85,247,0.04)_1px,transparent_1px)] bg-[size:auto,auto,110px_110px,110px_110px]" aria-hidden="true" />

      <section className="relative mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-cyan-300/25 bg-slate-950/82 p-5 shadow-[0_0_42px_rgba(34,211,238,0.1)] backdrop-blur">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-md border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-xs font-black uppercase text-cyan-100">
                <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                Public Safe Profile
              </span>
              <h1 className="mt-5 text-3xl font-black uppercase leading-tight text-white sm:text-4xl lg:text-5xl">{displayName}</h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
                DZN only shows sections this player has opted in to publish. Hidden sections, private identifiers, raw award evidence, payment state, and owner state stay out of this public view.
              </p>
            </div>
            <Link
              href="/player/profile"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-cyan-200/45 bg-cyan-300/12 px-4 text-sm font-black uppercase text-cyan-50 transition hover:border-cyan-100/70 hover:bg-cyan-300/18"
            >
              Manage My Profile
            </Link>
          </div>
        </div>

        {state.status === "checking" ? <LoadingState message={state.message} /> : null}
        {state.status === "no_handle" ? <EmptyHandleState /> : null}
        {state.status === "loading" ? <LoadingState message={state.message} /> : null}
        {state.status === "not_found" ? <UnavailableState message={state.message} /> : null}
        {state.status === "error" ? <ErrorState message={state.message} /> : null}
        {state.status === "ready" ? <PublishedProfile data={state.data} /> : null}
      </section>
    </main>
  );
}

function PublishedProfile({ data }: { data: PublicPlayerProfilePayload }) {
  const totals = data.sections.gameplay_summary.totals;

  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Public Servers" value={totals ? String(totals.linked_public_servers) : "Hidden"} icon={<Radio aria-hidden="true" className="h-5 w-5" />} />
        <MetricCard label="Kills" value={totals ? String(totals.kills) : "Hidden"} icon={<Trophy aria-hidden="true" className="h-5 w-5" />} />
        <MetricCard label="Deaths" value={totals ? String(totals.deaths) : "Hidden"} icon={<Activity aria-hidden="true" className="h-5 w-5" />} />
        <MetricCard label="Longest" value={totals ? formatDistance(totals.longest_kill_distance) : "Hidden"} icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" />} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel title="Gameplay Summary" visible={data.sections.gameplay_summary.visible}>
            {totals ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailTile label="Linked public servers" value={String(totals.linked_public_servers)} />
                <DetailTile label="Last seen" value={formatDate(data.sections.gameplay_summary.last_seen_at)} />
                <DetailTile label="Suicides" value={String(totals.suicides)} />
                <DetailTile label="Longest kill" value={formatDistance(totals.longest_kill_distance)} />
              </div>
            ) : (
              <HiddenCopy />
            )}
          </Panel>

          <Panel title="Featured Server" visible={data.sections.featured_server.visible}>
            {data.sections.featured_server.server ? (
              <Link
                href={data.sections.featured_server.server.href}
                className="block rounded-md border border-cyan-300/20 bg-cyan-300/8 p-4 transition hover:border-cyan-100/55"
              >
                <p className="text-lg font-black uppercase text-white">{data.sections.featured_server.server.server_name}</p>
                <p className="mt-1 text-xs font-bold uppercase text-cyan-100">
                  {data.sections.featured_server.server.server_type} - {data.sections.featured_server.server.platform ?? "Platform TBA"} - {data.sections.featured_server.server.map_name ?? "Map TBA"}
                </p>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">
                  {data.sections.featured_server.server.kills} kills, {data.sections.featured_server.server.deaths} deaths, {formatDistance(data.sections.featured_server.server.longest_kill_distance)} longest.
                </p>
              </Link>
            ) : (
              <HiddenCopy />
            )}
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel title="Published Sections" visible>
            <div className="flex flex-wrap gap-2">
              {data.privacy.visible_sections.length ? data.privacy.visible_sections.map((section) => (
                <span key={section} className="rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">
                  {section.replace(/_/g, " ")}
                </span>
              )) : (
                <span className="text-sm font-semibold text-slate-300">No optional sections are visible.</span>
              )}
            </div>
          </Panel>

          <Panel title="Earned Progression" visible>
            <div className="space-y-3">
              <FutureRow label="XP" section={data.sections.xp_progress} />
              <FutureRow label="Challenges" section={data.sections.challenge_progress} />
              <FutureRow label="Calling Cards" section={data.sections.calling_cards} />
              <FutureRow label="Award Dates" section={data.sections.award_dates} />
            </div>
          </Panel>

          <Panel title="Fair Boundary" visible>
            <ul className="space-y-2">
              {data.fairness_boundary.map((line) => (
                <li key={line} className="text-sm font-semibold leading-6 text-slate-300">{line}</li>
              ))}
            </ul>
          </Panel>
        </aside>
      </section>
    </>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/78 p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">{icon}</span>
        <p className="text-2xl font-black text-white">{value}</p>
      </div>
      <p className="mt-3 text-xs font-black uppercase text-slate-400">{label}</p>
    </div>
  );
}

function Panel({ title, visible, children }: { title: string; visible: boolean; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/78 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-black uppercase text-white">{title}</h2>
        <span className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[10px] font-black uppercase ${
          visible ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" : "border-slate-500/35 bg-slate-500/10 text-slate-300"
        }`}>
          {visible ? <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" /> : <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />}
          {visible ? "Visible" : "Hidden"}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/6 p-3">
      <p className="text-lg font-black text-white">{value}</p>
      <p className="mt-1 text-xs font-bold uppercase text-slate-400">{label}</p>
    </div>
  );
}

function FutureRow({ label, section }: { label: string; section: FutureSection }) {
  return (
    <div className="rounded-md border border-violet-300/18 bg-violet-300/8 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-black uppercase text-white">{label}</p>
        <span className="text-[10px] font-black uppercase text-violet-100">{section.status.replace(/_/g, " ")}</span>
      </div>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{section.message}</p>
    </div>
  );
}

function EmptyHandleState() {
  return (
    <section className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-5">
      <h2 className="text-lg font-black uppercase text-white">Profile Link Needed</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-amber-50">
        Public player profiles open from a generated handle such as /players/example-handle. Log in to manage your own profile publishing settings.
      </p>
    </section>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <section className="flex items-center gap-3 rounded-lg border border-cyan-300/25 bg-slate-950/78 p-5 text-sm font-semibold text-cyan-100">
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
      {message}
    </section>
  );
}

function UnavailableState({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-slate-500/30 bg-slate-950/78 p-5">
      <div className="flex items-start gap-3">
        <EyeOff aria-hidden="true" className="mt-1 h-5 w-5 text-slate-300" />
        <div>
          <h2 className="text-lg font-black uppercase text-white">Profile Hidden</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{message}</p>
        </div>
      </div>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-1 h-5 w-5 text-rose-100" />
        <div>
          <h2 className="text-lg font-black uppercase text-white">Profile Unavailable</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-rose-50">{message}</p>
        </div>
      </div>
    </section>
  );
}

function HiddenCopy() {
  return <p className="text-sm font-semibold leading-6 text-slate-300">This section is hidden by the player&apos;s saved profile preferences or has no public-safe data yet.</p>;
}

function currentHandleFromPath() {
  if (typeof window === "undefined") return null;
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "players" || !parts[1]) return null;
  return normalizeRouteHandle(parts[1]);
}

function normalizeRouteHandle(value: string | null | undefined) {
  if (!value) return null;
  const handle = value.toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(handle) && !handle.includes("--") ? handle : null;
}

function formatDistance(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0m";
  return `${Math.round(value)}m`;
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const normalizedValue = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
