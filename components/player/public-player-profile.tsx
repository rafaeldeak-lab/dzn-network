"use client";

import { Activity, AlertTriangle, CalendarDays, Crosshair, EyeOff, Gamepad2, Loader2, Radio, Server, ShieldCheck, Sparkles, Trophy, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { publicGameplayPresentation } from "@/lib/public-profile-gameplay";

type FutureSection = { visible: boolean; status: "not_available_yet" | "hidden"; message: string };
type PublicPlayerProfilePayload = {
  ok: true; handle: string; href: string; display_name: string;
  discord_profile: { visible: boolean; connected: boolean; avatar_url: string | null };
  published_at: string | null; updated_at: string | null;
  sections: {
    display_name: { visible: boolean; value: string | null };
    gameplay_summary: { visible: boolean; totals: { kills: number; deaths: number; suicides: number; longest_kill_distance: number; linked_public_servers: number } | null; last_seen_at: string | null };
    featured_server: { visible: boolean; server: { public_slug: string; href: string; server_name: string; server_type: string; platform: string | null; map_name: string | null; kills: number; deaths: number; longest_kill_distance: number; last_seen_at: string | null } | null };
    xp_progress: FutureSection; challenge_progress: FutureSection; calling_cards: FutureSection; award_dates: FutureSection;
  };
  privacy: { public_profile_enabled: true; visible_sections: string[] };
  safety: { public_safe: true; read_only: true; presentation_only: true; private_identifiers_exposed: false; raw_award_evidence_exposed: false };
  fairness_boundary: string[];
};
type ProfileState =
  | { status: "checking" | "no_handle" | "loading" | "not_found" | "error"; data: null; message: string }
  | { status: "ready"; data: PublicPlayerProfilePayload; message: null };

async function requestPublicProfile(handle: string): Promise<ProfileState> {
  const response = await fetch(`/api/public/players/${encodeURIComponent(handle)}`, {
    cache: "no-store", credentials: "omit", headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as Partial<PublicPlayerProfilePayload> & { message?: string } | null;
  if (response.status === 404) return { status: "not_found", data: null, message: payload?.message ?? "This public player profile is hidden or unavailable." };
  if (!response.ok || !payload?.ok) return { status: "error", data: null, message: payload?.message ?? "Public player profile data is unavailable right now." };
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
      if (active) setState({ status: "error", data: null, message: "Public player profile data is unavailable right now." });
    });
    return () => { active = false; };
  }, [initialHandle]);

  return (
    <main className="dzn-public-profile relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <div className="dzn-public-profile__backdrop" aria-hidden="true" />
      <div className="dzn-public-profile__grid" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-7xl px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        {state.status === "checking" || state.status === "loading" ? <LoadingState message={state.message} /> : null}
        {state.status === "no_handle" ? <Shell title="Profile Link Needed"><EmptyHandleState /></Shell> : null}
        {state.status === "not_found" ? <Shell title="Profile Hidden"><UnavailableState message={state.message} /></Shell> : null}
        {state.status === "error" ? <Shell title="Profile Unavailable"><ErrorState message={state.message} /></Shell> : null}
        {state.status === "ready" ? <PublishedProfile data={state.data} /> : null}
      </div>
    </main>
  );
}

function PublishedProfile({ data }: { data: PublicPlayerProfilePayload }) {
  const gameplay = publicGameplayPresentation(data.sections.gameplay_summary);
  const totals = data.sections.gameplay_summary.totals;
  const kd = totals && totals.deaths > 0 ? (totals.kills / totals.deaths).toFixed(2) : totals?.kills ? totals.kills.toFixed(2) : "--";
  const initial = data.display_name.trim().slice(0, 1).toUpperCase() || "D";
  return (
    <div className="space-y-4">
      <section className="dzn-public-profile__hero relative min-h-[330px] overflow-hidden border border-cyan-300/25 px-5 pb-6 pt-28 shadow-[0_24px_90px_rgba(0,0,0,0.48)] sm:px-7 sm:pb-7 sm:pt-32 lg:min-h-[360px] lg:px-9">
        <div className="dzn-public-profile__hero-media" aria-hidden="true" />
        <div className="dzn-public-profile__hero-scan" aria-hidden="true" />
        <div className="relative z-10 flex h-full flex-col justify-end gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-end">
            <div className="relative shrink-0">
              <div className="dzn-public-profile__avatar-ring h-28 w-28 rounded-full p-[3px] sm:h-36 sm:w-36">
                <div role="img" aria-label={`${data.display_name} Discord avatar`} className="flex h-full w-full items-center justify-center rounded-full border-4 border-[#071120] bg-[#071120] bg-cover bg-center text-4xl font-black text-cyan-100 sm:text-5xl" style={data.discord_profile.avatar_url ? { backgroundImage: `url(${data.discord_profile.avatar_url})` } : undefined}>
                  {data.discord_profile.avatar_url ? <span className="sr-only">{data.display_name}</span> : initial}
                </div>
              </div>
              {data.discord_profile.connected ? <span className="absolute bottom-2 right-2 h-5 w-5 rounded-full border-4 border-[#071120] bg-emerald-400" aria-label="Discord connected" /> : null}
            </div>
            <div className="min-w-0 pb-1">
              <span className="inline-flex items-center gap-2 rounded-md border border-cyan-300/40 bg-[#061728]/90 px-3 py-1 text-[11px] font-black uppercase text-cyan-100"><ShieldCheck aria-hidden="true" className="h-4 w-4" /> Public Safe Profile</span>
              <h1 className="mt-3 break-words text-3xl font-black uppercase leading-tight text-white sm:text-5xl">{data.display_name}</h1>
              <p className="mt-1 text-sm font-bold text-cyan-100">@{data.handle}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold uppercase text-slate-200">
                <span className="inline-flex items-center gap-2"><Gamepad2 aria-hidden="true" className="h-4 w-4 text-cyan-300" /> DZN Player</span>
                <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Discord connected</span>
                <span className="inline-flex items-center gap-2"><CalendarDays aria-hidden="true" className="h-4 w-4 text-violet-300" /> Joined {formatMonthYear(data.published_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex w-full sm:w-auto">
            <Link href="/player/profile" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-violet-300/45 bg-violet-400/15 px-4 text-xs font-black uppercase text-violet-50 transition hover:bg-violet-400/25"><UserRound aria-hidden="true" className="h-4 w-4" /> Manage My Profile</Link>
          </div>
        </div>
      </section>

      <section aria-label="Public gameplay statistics" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Kills" value={gameplay.kills} icon={<Crosshair aria-hidden="true" className="h-5 w-5" />} tone="cyan" />
        <MetricCard label="Deaths" value={gameplay.deaths} icon={<Activity aria-hidden="true" className="h-5 w-5" />} tone="rose" />
        <MetricCard label="K/D ratio" value={gameplay.status === "available" ? kd : "--"} icon={<Radio aria-hidden="true" className="h-5 w-5" />} tone="violet" />
        <MetricCard label="Longest kill" value={gameplay.longest} icon={<Trophy aria-hidden="true" className="h-5 w-5" />} tone="gold" />
        <MetricCard label="Public servers" value={gameplay.publicServers} icon={<Server aria-hidden="true" className="h-5 w-5" />} tone="emerald" />
        <MetricCard label="Last seen" value={gameplay.status === "available" ? formatShortDate(data.sections.gameplay_summary.last_seen_at) : "--"} icon={<CalendarDays aria-hidden="true" className="h-5 w-5" />} tone="blue" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-4">
          <ProfileBand icon={<Activity aria-hidden="true" className="h-5 w-5" />} title="Gameplay Summary" visible={data.sections.gameplay_summary.visible}>
            {gameplay.status !== "hidden" ? gameplay.status === "available" ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <DetailTile label="Linked public servers" value={gameplay.publicServers} />
                <DetailTile label="Suicides" value={gameplay.suicides} />
                <DetailTile label="Last activity" value={formatDate(data.sections.gameplay_summary.last_seen_at)} />
              </div>
            ) : <TruthfulEmpty message={gameplay.message} /> : <HiddenCopy />}
          </ProfileBand>
          <ProfileBand icon={<Server aria-hidden="true" className="h-5 w-5" />} title="Featured Server" visible={data.sections.featured_server.visible}>
            {data.sections.featured_server.server ? (
              <Link href={data.sections.featured_server.server.href} className="group grid gap-4 border-l-2 border-cyan-300 bg-[#06111f]/80 p-4 transition hover:bg-[#081a2c] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div><p className="text-lg font-black uppercase text-white group-hover:text-cyan-100">{data.sections.featured_server.server.server_name}</p><p className="mt-1 text-xs font-bold uppercase text-cyan-200">{data.sections.featured_server.server.server_type} / {data.sections.featured_server.server.platform ?? "Platform TBA"} / {data.sections.featured_server.server.map_name ?? "Map TBA"}</p><p className="mt-3 text-sm font-semibold text-slate-300">{data.sections.featured_server.server.kills} kills / {data.sections.featured_server.server.deaths} deaths / {formatDistance(data.sections.featured_server.server.longest_kill_distance)} longest</p></div>
                <span className="inline-flex min-h-10 items-center justify-center rounded-md border border-cyan-300/40 px-3 text-xs font-black uppercase text-cyan-100">View Server</span>
              </Link>
            ) : <HiddenCopy />}
          </ProfileBand>
          <ProfileBand icon={<Sparkles aria-hidden="true" className="h-5 w-5" />} title="Earned Progression" visible>
            <div className="grid gap-2 sm:grid-cols-2">
              <FutureRow label="XP Progress" section={data.sections.xp_progress} icon={<Activity aria-hidden="true" className="h-5 w-5" />} />
              <FutureRow label="Challenges" section={data.sections.challenge_progress} icon={<Trophy aria-hidden="true" className="h-5 w-5" />} />
              <FutureRow label="Calling Cards" section={data.sections.calling_cards} icon={<Gamepad2 aria-hidden="true" className="h-5 w-5" />} />
              <FutureRow label="Award Dates" section={data.sections.award_dates} icon={<CalendarDays aria-hidden="true" className="h-5 w-5" />} />
            </div>
          </ProfileBand>
        </div>
        <aside className="space-y-4">
          <ProfileBand icon={<ShieldCheck aria-hidden="true" className="h-5 w-5" />} title="Connected Discord" visible={data.discord_profile.visible}>
            <div className="flex items-center gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-indigo-300/35 bg-indigo-400/15 text-lg font-black text-indigo-100">{initial}</div><div className="min-w-0"><p className="truncate font-black text-white">{data.display_name}</p><p className="mt-1 inline-flex items-center gap-2 text-xs font-bold text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Account connected</p></div></div>
          </ProfileBand>
          <ProfileBand icon={<EyeOff aria-hidden="true" className="h-5 w-5" />} title="Published Sections" visible>
            <div className="flex flex-wrap gap-2">{data.privacy.visible_sections.length ? data.privacy.visible_sections.map((section) => <span key={section} className="rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">{section.replace(/_/g, " ")}</span>) : <span className="text-sm font-semibold text-slate-300">No optional sections are visible.</span>}</div>
          </ProfileBand>
          <details className="rounded-lg border border-white/10 bg-[#050b14]/88 p-5 backdrop-blur"><summary className="cursor-pointer text-sm font-black uppercase text-cyan-100">Fair Boundary</summary><ul className="mt-4 space-y-2 border-t border-white/10 pt-4">{data.fairness_boundary.map((line) => <li key={line} className="text-sm font-semibold leading-6 text-slate-300">{line}</li>)}</ul></details>
        </aside>
      </section>
      <footer className="flex flex-col items-center justify-between gap-2 border-t border-cyan-300/15 py-4 text-[10px] font-black uppercase text-slate-500 sm:flex-row"><span>DZN Network / Player Hub</span><span>Play / Explore / Belong</span></footer>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mx-auto mt-12 max-w-3xl rounded-lg border border-cyan-300/20 bg-[#050b14]/90 p-6 backdrop-blur"><p className="text-xs font-black uppercase text-cyan-200">DZN Player Hub</p><h1 className="mt-2 text-3xl font-black uppercase text-white">{title}</h1><div className="mt-6">{children}</div><Link href="/player/profile" className="mt-6 inline-flex min-h-11 items-center rounded-md border border-cyan-300/40 px-4 text-xs font-black uppercase text-cyan-100">Manage My Profile</Link></section>;
}
const metricTones = { cyan: "border-cyan-300/25 text-cyan-200", rose: "border-rose-300/25 text-rose-200", violet: "border-violet-300/25 text-violet-200", gold: "border-amber-300/25 text-amber-200", emerald: "border-emerald-300/25 text-emerald-200", blue: "border-sky-300/25 text-sky-200" };
function MetricCard({ label, value, icon, tone }: { label: string; value: string; icon: ReactNode; tone: keyof typeof metricTones }) {
  return <div className={`min-h-24 rounded-lg border bg-[#050b14]/88 p-3 backdrop-blur ${metricTones[tone]}`}><div className="flex items-center justify-between gap-2"><span>{icon}</span><p className="min-w-0 break-words text-right text-xl font-black text-white">{value}</p></div><p className="mt-3 text-[10px] font-black uppercase text-slate-400">{label}</p></div>;
}
function ProfileBand({ icon, title, visible, children }: { icon: ReactNode; title: string; visible: boolean; children: ReactNode }) {
  return <section className="rounded-lg border border-white/10 bg-[#050b14]/88 p-4 backdrop-blur sm:p-5"><header className="flex items-center justify-between gap-3 border-b border-white/10 pb-3"><h2 className="inline-flex items-center gap-2 text-sm font-black uppercase text-white"><span className="text-cyan-300">{icon}</span>{title}</h2><span className={`text-[10px] font-black uppercase ${visible ? "text-emerald-200" : "text-slate-500"}`}>{visible ? "Visible" : "Hidden"}</span></header><div className="mt-4">{children}</div></section>;
}
function DetailTile({ label, value }: { label: string; value: string }) {
  return <div className="border-l-2 border-violet-400 bg-white/[0.035] p-3"><p className="break-words text-base font-black text-white">{value}</p><p className="mt-1 text-[10px] font-bold uppercase text-slate-400">{label}</p></div>;
}
function FutureRow({ label, section, icon }: { label: string; section: FutureSection; icon: ReactNode }) {
  return <div className="flex min-h-24 gap-3 border border-violet-300/15 bg-violet-300/[0.055] p-3"><span className="mt-0.5 text-violet-200">{icon}</span><div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-black uppercase text-white">{label}</p><span className="text-[9px] font-black uppercase text-violet-200">{section.status.replace(/_/g, " ")}</span></div><p className="mt-2 text-xs font-semibold leading-5 text-slate-400">{section.message}</p></div></div>;
}
function TruthfulEmpty({ message }: { message: string }) { return <p className="border-l-2 border-amber-300 bg-amber-300/8 p-3 text-sm font-semibold leading-6 text-amber-50">{message}</p>; }
function EmptyHandleState() { return <p className="text-sm font-semibold leading-6 text-amber-50">Public player profiles open from a generated handle such as /players/example-handle. Log in to manage your own profile publishing settings.</p>; }
function LoadingState({ message }: { message: string }) { return <section className="mx-auto mt-16 flex max-w-xl items-center justify-center gap-3 rounded-lg border border-cyan-300/25 bg-[#050b14]/90 p-6 text-sm font-semibold text-cyan-100"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />{message}</section>; }
function UnavailableState({ message }: { message: string }) { return <div className="flex items-start gap-3"><EyeOff aria-hidden="true" className="mt-1 h-5 w-5 text-slate-300" /><p className="text-sm font-semibold leading-6 text-slate-300">{message}</p></div>; }
function ErrorState({ message }: { message: string }) { return <div className="flex items-start gap-3"><AlertTriangle aria-hidden="true" className="mt-1 h-5 w-5 text-rose-200" /><p className="text-sm font-semibold leading-6 text-rose-50">{message}</p></div>; }
function HiddenCopy() { return <p className="text-sm font-semibold leading-6 text-slate-300">This section is hidden by the player&apos;s saved profile preferences or has no public-safe data yet.</p>; }
function currentHandleFromPath() { if (typeof window === "undefined") return null; const parts = window.location.pathname.split("/").filter(Boolean); return parts[0] === "players" && parts[1] ? normalizeRouteHandle(parts[1]) : null; }
function normalizeRouteHandle(value: string | null | undefined) { if (!value) return null; const handle = value.toLowerCase(); return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(handle) && !handle.includes("--") ? handle : null; }
function formatDistance(value: number) { return !Number.isFinite(value) || value <= 0 ? "0m" : `${Math.round(value)}m`; }
function formatDate(value: string | null) { const date = value ? safeDate(value) : null; return date ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : "Not available"; }
function formatShortDate(value: string | null) { const date = value ? safeDate(value) : null; return date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date) : "--"; }
function formatMonthYear(value: string | null) { const date = value ? safeDate(value) : null; return date ? new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(date) : "DZN"; }
function safeDate(value: string) { const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`; const date = new Date(normalized); return Number.isNaN(date.getTime()) ? null : date; }
