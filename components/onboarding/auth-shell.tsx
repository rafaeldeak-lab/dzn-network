"use client";

import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ChevronRight,
  LockKeyhole,
  LogOut,
  Server,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { clearClientAuthState, logoutAndRedirect } from "./api";

type AuthState = {
  authenticated: boolean;
};

const briefingCards: Array<{ title: string; text: string; icon: LucideIcon }> = [
  {
    title: "Command Authority",
    text: "Verify the Discord server owner/admin and lock access to the correct community.",
    icon: ShieldCheck,
  },
  {
    title: "Nitrado Secure Link",
    text: "Connect your DayZ Nitrado service using Token + Service ID.",
    icon: Server,
  },
  {
    title: "Encrypted Vault",
    text: "Your Nitrado token is encrypted server-side and never shown again.",
    icon: LockKeyhole,
  },
  {
    title: "Live ADM Intelligence",
    text: "DZN detects your DayZ admin logs and prepares the sync engine for player activity, kills, deaths, and rankings.",
    icon: Activity,
  },
];

const particles = [
  { left: "8%", top: "26%", delay: "0s", duration: "8s", color: "violet" },
  { left: "17%", top: "72%", delay: "1.2s", duration: "11s", color: "cyan" },
  { left: "29%", top: "18%", delay: "2.4s", duration: "9s", color: "ember" },
  { left: "42%", top: "62%", delay: "0.8s", duration: "10s", color: "violet" },
  { left: "54%", top: "30%", delay: "1.8s", duration: "12s", color: "cyan" },
  { left: "67%", top: "78%", delay: "2.8s", duration: "9s", color: "ember" },
  { left: "79%", top: "20%", delay: "0.6s", duration: "10s", color: "violet" },
  { left: "88%", top: "58%", delay: "1.6s", duration: "12s", color: "cyan" },
  { left: "93%", top: "36%", delay: "3.2s", duration: "8s", color: "ember" },
  { left: "35%", top: "84%", delay: "2.1s", duration: "13s", color: "violet" },
];

const rainStreaks = Array.from({ length: 18 }, (_, index) => ({
  left: `${(index * 7 + 4) % 100}%`,
  delay: `${(index % 6) * 0.38}s`,
  duration: `${1.8 + (index % 5) * 0.18}s`,
}));

export function AuthShell({
  title,
  description,
  actionLabel = "Login with Discord",
  authStartHref = "/api/auth/discord/start",
  hideNavActions = false,
  resolveAuthMode = false,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  authStartHref?: string;
  hideNavActions?: boolean;
  resolveAuthMode?: boolean;
}) {
  const [startBaseHref, setStartBaseHref] = useState(authStartHref);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    console.log("DZN AUTH RETURN FLOW FIXED");
  }, []);

  useEffect(() => {
    if (!hideNavActions) return;
    console.log("DZN LOGIN HEADER SIMPLIFIED");
  }, [hideNavActions]);

  useEffect(() => {
    if (!resolveAuthMode) return;

    let active = true;
    fetch("/api/auth/mode", { cache: "no-store", credentials: "include" })
      .then((response) => response.json() as Promise<{ mockAuth?: boolean }>)
      .then((data) => {
        if (!active) return;
        setStartBaseHref(data.mockAuth ? "/api/auth/mock/start" : "/api/auth/discord/start");
      })
      .catch(() => null);

    return () => {
      active = false;
    };
  }, [resolveAuthMode]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return { authenticated: false };
        return (await response.json()) as AuthState;
      })
      .then((data) => {
        if (!active) return;
        setAuth(data);
      })
      .catch(() => {
        if (active) setAuth({ authenticated: false });
      })
      .finally(() => {
        if (active) setAuthChecked(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authChecked || !auth?.authenticated) return;

    const path = window.location.pathname;
    const queryReturnTo = safeClientReturnTo(new URLSearchParams(window.location.search).get("returnTo"), path === "/signup" ? "/setup" : "/");
    if (path === "/signup") {
      window.location.href = queryReturnTo;
      return;
    }

    window.location.href = queryReturnTo;
  }, [auth, authChecked]);

  async function signOut() {
    clearClientAuthState();
    await logoutAndRedirect();
  }

  function beginAuth(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    window.location.href = withReturnTo(startBaseHref);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <AuthMissionBackground reduceMotion={Boolean(reduceMotion)} />
      <div className="pointer-events-none absolute inset-0 z-[1] border border-violet-400/25 shadow-[inset_0_0_42px_rgba(139,92,246,0.18)]" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5 sm:px-7 lg:px-10">
        <AuthNav authenticated={Boolean(auth?.authenticated)} hideActions={hideNavActions} onLogout={signOut} />

        <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(440px,0.78fr)] lg:gap-12">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="max-w-2xl"
          >
            <div className="mb-6 inline-flex items-center gap-3 text-xs font-black uppercase tracking-normal text-violet-200">
              <ShieldCheck className="h-5 w-5" />
              Owner Verification
            </div>
            <h1 className="max-w-xl text-5xl font-black uppercase leading-[0.92] text-white drop-shadow-[0_0_30px_rgba(139,92,246,0.25)] sm:text-6xl lg:text-7xl">
              {title}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-zinc-300 sm:text-lg">
              {description}
            </p>
            <a
              href={startBaseHref}
              onClick={beginAuth}
              className="group mt-8 inline-flex h-16 w-full max-w-sm items-center justify-center gap-4 rounded-lg border border-violet-200/40 bg-violet-500 px-6 text-sm font-black uppercase text-white shadow-[0_0_42px_rgba(139,92,246,0.62),inset_0_1px_0_rgba(255,255,255,0.25)] transition hover:border-cyan-200/45 hover:bg-violet-400 hover:shadow-[0_0_58px_rgba(139,92,246,0.82)] sm:w-auto"
            >
              <DiscordIcon />
              {actionLabel}
              <ChevronRight className="h-5 w-5 transition group-hover:translate-x-1" />
            </a>

            <div className="mt-6 flex flex-wrap gap-4 text-[11px] font-black uppercase text-zinc-300">
              <TrustLabel icon={ShieldCheck} label="Secure" />
              <TrustLabel icon={LockKeyhole} label="Encrypted" />
              <TrustLabel icon={Zap} label="Built for DayZ" />
            </div>

            <div className="mt-7 grid max-w-xl gap-3 text-[11px] font-black uppercase tracking-normal text-zinc-400 sm:grid-cols-2">
              <StatusLine label="System Scan" value="Secure" />
              <StatusLine label="DZN Intel Systems" value="Online" />
            </div>
          </motion.div>

          <MissionBriefingPanel />
        </section>

        <div className="flex items-end justify-between pb-2 text-[10px] font-black uppercase tracking-normal text-zinc-500">
          <span>Coords: 035.124 / 066.941</span>
          <span className="hidden sm:block">DZN Secure Network</span>
        </div>
      </div>
    </main>
  );
}

function AuthNav({
  authenticated,
  hideActions,
  onLogout,
}: {
  authenticated: boolean;
  hideActions: boolean;
  onLogout: () => void;
}) {
  return (
    <nav className={`flex min-h-[104px] items-start gap-4 ${hideActions ? "justify-start" : "justify-between"}`}>
      <DznLogo size="hero" />
      {hideActions ? null : (
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Link href="/servers" className="rounded-lg border border-white/10 bg-black/24 px-4 py-2 text-xs font-black uppercase text-zinc-200 backdrop-blur-xl transition hover:border-cyan-300/35 hover:text-white">
            Servers
          </Link>
          {authenticated ? (
            <>
              <Link href="/dashboard" className="rounded-lg border border-white/10 bg-black/24 px-4 py-2 text-xs font-black uppercase text-zinc-200 backdrop-blur-xl transition hover:border-violet-300/35 hover:text-white">
                Dashboard
              </Link>
              <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/24 px-4 py-2 text-xs font-black uppercase text-zinc-200 backdrop-blur-xl transition hover:border-red-300/35 hover:text-white">
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </>
          ) : (
            <Link href="/login?returnTo=/setup" className="rounded-lg border border-violet-300/35 bg-violet-500/15 px-4 py-2 text-xs font-black uppercase text-violet-50 backdrop-blur-xl transition hover:bg-violet-500/25">
              Add Your Server
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}

function AuthMissionBackground({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/media/dzn-cinematic-survivor.png"
        alt=""
        className={`absolute inset-0 h-full w-full object-cover opacity-58 ${reduceMotion ? "" : "auth-hero-breathe"}`}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(139,92,246,0.18),transparent_25%),radial-gradient(circle_at_74%_42%,rgba(14,165,233,0.16),transparent_28%),linear-gradient(90deg,rgba(2,3,10,0.86)_0%,rgba(2,3,10,0.48)_47%,rgba(2,3,10,0.82)_100%),linear-gradient(180deg,rgba(2,3,10,0.24)_0%,rgba(2,3,10,0.88)_100%)]" />
      <div className="auth-hud-grid absolute inset-0 opacity-35" />
      <div className="scanline absolute inset-0 opacity-25" />
      <span className="fog-layer fog-layer-one" />
      <span className="fog-layer fog-layer-two" />
      <span className="fog-layer fog-layer-three" />
      <span className="ambient-orb ambient-orb-violet left-[46%] top-[16%]" />
      <span className="ambient-orb ambient-orb-cyan bottom-[10%] right-[8%]" />
      {!reduceMotion ? (
        <>
          {particles.map((particle) => (
            <span
              key={`${particle.left}-${particle.top}`}
              className={`auth-spark auth-spark-${particle.color}`}
              style={{
                left: particle.left,
                top: particle.top,
                animationDelay: particle.delay,
                animationDuration: particle.duration,
              } as CSSProperties}
            />
          ))}
          {rainStreaks.map((streak) => (
            <span
              key={`${streak.left}-${streak.delay}`}
              className="auth-rain-streak"
              style={{
                left: streak.left,
                animationDelay: streak.delay,
                animationDuration: streak.duration,
              } as CSSProperties}
            />
          ))}
        </>
      ) : null}
      <div className="auth-radar absolute bottom-[-8rem] left-1/2 h-72 w-72 -translate-x-1/2 rounded-full border border-cyan-300/20" />
    </div>
  );
}

function MissionBriefingPanel() {
  return (
    <motion.aside
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.72, delay: 0.1, ease: "easeOut" }}
      className="glass-surface animated-border rounded-xl p-5 shadow-[0_0_52px_rgba(139,92,246,0.26)] sm:p-6"
    >
      <div className="relative z-10">
        <div className="mb-5 flex items-center gap-4">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-300/70 to-violet-300/15" />
          <h2 className="text-center text-lg font-black uppercase text-violet-200 drop-shadow-[0_0_16px_rgba(167,139,250,0.7)]">
            Mission Briefing
          </h2>
          <span className="h-px flex-1 bg-gradient-to-r from-violet-300/15 via-cyan-300/55 to-transparent" />
        </div>
        <p className="mb-5 text-sm leading-6 text-zinc-300">
          Your server is verified through Discord ownership, secured through Nitrado, and prepared for live ADM intelligence syncing.
        </p>
        <div className="grid gap-3">
          {briefingCards.map((card, index) => (
            <BriefingCard key={card.title} card={card} index={index + 1} />
          ))}
        </div>
      </div>
    </motion.aside>
  );
}

function BriefingCard({ card, index }: { card: { title: string; text: string; icon: LucideIcon }; index: number }) {
  const Icon = card.icon;
  return (
    <div className="group rounded-lg border border-white/10 bg-black/28 p-4 transition hover:border-violet-300/45 hover:bg-violet-500/10 hover:shadow-[0_0_30px_rgba(139,92,246,0.18)]">
      <div className="flex items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-violet-300/30 bg-violet-500/14 text-violet-200 shadow-[0_0_24px_rgba(139,92,246,0.28)]">
          <Icon className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-black text-white">
            {index}. {card.title}
          </h3>
          <p className="mt-1 text-sm leading-6 text-zinc-300">{card.text}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-violet-200/70 transition group-hover:translate-x-1 group-hover:text-cyan-100" />
      </div>
    </div>
  );
}

function TrustLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4 text-violet-300" />
      {label}
    </span>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]" />
      <span>{label}:</span>
      <span className="text-emerald-300">{value}</span>
    </div>
  );
}

function DiscordIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7 fill-current">
      <path d="M18.8 5.1A15.3 15.3 0 0 0 15 4l-.18.33a10.7 10.7 0 0 1 3.36 1.68 11.8 11.8 0 0 0-10.37 0 10.3 10.3 0 0 1 3.36-1.68L11 4a15.4 15.4 0 0 0-3.8 1.1C4.8 8.65 4.12 12.1 4.44 15.5a15.2 15.2 0 0 0 4.67 2.35l.57-.78a7.2 7.2 0 0 1-1.8-.86l.43-.33a10.8 10.8 0 0 0 7.38 0l.43.33a7.4 7.4 0 0 1-1.8.86l.57.78a15.2 15.2 0 0 0 4.67-2.35c.38-3.93-.68-7.35-2.76-10.4ZM9.6 13.42c-.72 0-1.3-.66-1.3-1.47 0-.8.57-1.46 1.3-1.46.72 0 1.32.66 1.3 1.46 0 .81-.58 1.47-1.3 1.47Zm4.8 0c-.72 0-1.3-.66-1.3-1.47 0-.8.58-1.46 1.3-1.46.73 0 1.31.66 1.3 1.46 0 .81-.57 1.47-1.3 1.47Z" />
    </svg>
  );
}

function withReturnTo(startHref: string) {
  if (typeof window === "undefined") return startHref;
  const path = window.location.pathname;
  const fallback = path === "/signup" ? "/setup" : path === "/login" ? "/" : `${path}${window.location.search}${window.location.hash}`;
  const defaultReturnTo = safeClientReturnTo(new URLSearchParams(window.location.search).get("returnTo"), fallback);
  const url = new URL(startHref, window.location.origin);
  url.searchParams.set("returnTo", defaultReturnTo);
  return `${url.pathname}${url.search}`;
}

function safeClientReturnTo(value: string | null, fallback = "/") {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\") || /^\/[a-z][a-z0-9+.-]*:/i.test(trimmed)) return fallback;
  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
