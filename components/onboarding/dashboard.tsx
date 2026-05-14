"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, LogOut, Server, ShieldCheck, Wrench } from "lucide-react";
import Link from "next/link";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { getMe, logout } from "./api";
import type { AuthResponse, LinkedServer } from "./types";

export function Dashboard() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then(setAuth)
      .catch(() => setAuth({ authenticated: false }))
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    await logout().catch(() => null);
    window.location.href = "/";
  }

  if (loading) {
    return <DashboardFrame><p className="text-zinc-300">Loading dashboard...</p></DashboardFrame>;
  }

  if (!auth?.authenticated) {
    return (
      <DashboardFrame>
        <div className="glass-surface animated-border max-w-2xl rounded-lg p-8 text-center">
          <div className="relative z-10">
            <ShieldCheck className="mx-auto h-12 w-12 text-violet-200" />
            <h1 className="mt-5 text-3xl font-black uppercase text-white">Login required</h1>
            <p className="mt-3 text-zinc-300">Connect Discord to view verified server onboarding progress.</p>
            <Link href="/login" className="mt-6 inline-flex rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white">
              Login with Discord
            </Link>
          </div>
        </div>
      </DashboardFrame>
    );
  }

  const server = auth.linkedServer;
  return (
    <DashboardFrame onLogout={signOut}>
      <div className="mb-8">
        <p className="text-xs font-black uppercase text-violet-200/70">DZN owner console</p>
        <h1 className="mt-2 text-4xl font-black uppercase text-white">Dashboard</h1>
      </div>
      {server ? <ServerDashboard server={server} /> : <EmptyDashboard />}
    </DashboardFrame>
  );
}

function DashboardFrame({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-8 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(139,92,246,0.26),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(14,165,233,0.14),transparent_28%),linear-gradient(180deg,#02030a_0%,#07101f_52%,#02030a_100%)]" />
      <div className="scanline absolute inset-0 opacity-20" />
      <div className="relative z-10 mx-auto max-w-7xl">
        <nav className="mb-8 flex items-center justify-between">
          <DznLogo />
          <div className="flex items-center gap-3">
            <Link href="/setup" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200">
              Setup
            </Link>
            {onLogout ? (
              <button type="button" onClick={onLogout} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200">
                <LogOut className="inline h-4 w-4" /> Logout
              </button>
            ) : null}
          </div>
        </nav>
        {children}
      </div>
    </main>
  );
}

function EmptyDashboard() {
  return (
    <div className="glass-surface animated-border rounded-lg p-8">
      <div className="relative z-10">
        <Server className="h-12 w-12 text-violet-200" />
        <h2 className="mt-5 text-2xl font-black uppercase text-white">No server linked yet</h2>
        <p className="mt-3 max-w-2xl text-zinc-300">
          Finish onboarding to verify your Discord guild, connect Nitrado, and publish your DayZ server.
        </p>
        <Link href="/setup" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white">
          Continue setup
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function ServerDashboard({ server }: { server: LinkedServer }) {
  const tags = useMemo(() => {
    try {
      return JSON.parse(server.tags_json) as string[];
    } catch {
      return [];
    }
  }, [server.tags_json]);

  const normalizedStatus = server.status.toLowerCase();
  const progress = normalizedStatus === "live" ? 100 : normalizedStatus === "error" ? 72 : 84;
  const admConnected = server.adm_status === "Connected" || Number(server.adm_logs_found) === 1;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <section className="glass-surface animated-border rounded-lg p-6">
        <div className="relative z-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {server.guild_icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={server.guild_icon_url} alt="" className="h-16 w-16 rounded-lg" />
              ) : (
                <span className="grid h-16 w-16 place-items-center rounded-lg bg-violet-500/20 text-2xl font-black">
                  {(server.guild_name ?? "D")[0]}
                </span>
              )}
              <div>
                <p className="text-xs font-black uppercase text-violet-200/70">Discord guild</p>
                <h2 className="text-2xl font-black text-white">{server.guild_name ?? server.guild_id}</h2>
              </div>
            </div>
            <Status status={server.status} />
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <Info label="Nitrado DayZ server" value={server.server_name || server.nitrado_service_name} />
            <Info label="Service ID" value={server.nitrado_service_id} />
            <Info label="Server type" value={server.server_type} />
            <Info label="Region" value={server.region ?? "Unknown"} />
            <Info label="ADM Status" value={admConnected ? "Connected" : "Needs review"} />
            <Info label="Latest ADM File" value={server.adm_latest_file ?? "Not detected"} />
            <Info label="Last ADM Check" value={server.adm_last_checked_at ? formatDashboardDate(server.adm_last_checked_at) : "Not checked"} />
          </div>

          <div className="mt-6">
            <p className="text-xs font-black uppercase text-zinc-500">Tags</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.length ? tags.map((tag) => <span key={tag} className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100">{tag}</span>) : <span className="text-sm text-zinc-400">No tags selected</span>}
            </div>
          </div>
        </div>
      </section>

      <aside className="grid gap-5">
        <div className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <Activity className="h-8 w-8 text-emerald-200" />
            <h3 className="mt-4 text-xl font-black uppercase text-white">Setup progress</h3>
            <div className="mt-5 h-2 overflow-hidden rounded-sm bg-white/10">
              <div className="h-full bg-gradient-to-r from-violet-300 to-emerald-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-3 text-sm font-bold text-zinc-300">{progress}% complete</p>
          </div>
        </div>
        <div className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <Wrench className="h-8 w-8 text-violet-200" />
            <h3 className="mt-4 text-xl font-black uppercase text-white">Quick actions</h3>
            <div className="mt-4 grid gap-3">
              <Link href="/setup" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-zinc-100">Edit setup</Link>
              <Link href="/" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-zinc-100">View network</Link>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Status({ status }: { status: LinkedServer["status"] }) {
  const normalizedStatus = status.toLowerCase();
  const className =
    normalizedStatus === "live"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
      : normalizedStatus === "error"
        ? "border-red-300/30 bg-red-400/10 text-red-100"
        : "border-orange-300/30 bg-orange-400/10 text-orange-100";
  return (
    <span className={`rounded-lg border px-4 py-2 text-xs font-black uppercase ${className}`}>
      {normalizedStatus}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <p className="text-xs font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-2 font-bold text-white">{value}</p>
    </div>
  );
}

function formatDashboardDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
