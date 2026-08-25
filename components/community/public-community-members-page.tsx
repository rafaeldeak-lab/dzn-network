"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, EyeOff, ShieldCheck, UserRound, Users, type LucideIcon } from "lucide-react";

import { AnimatedBackground } from "@/components/dzn/animated-background";
import { FetchJsonError, fetchJsonWithRetry } from "@/lib/client-fetch";

type PublicProfileAttribution = {
  display_name?: string;
  public_handle?: string;
  public_href?: string;
  public_api_href?: string;
};

type PublicCommunityMember = {
  display_name?: string;
  role_label?: string | null;
  member_since_label?: string | null;
  public_profile?: PublicProfileAttribution | null;
};

type PublicCommunityMembersPayload = {
  ok?: boolean;
  error?: string;
  available?: boolean;
  source?: "live" | "not_configured" | "unavailable";
  server?: {
    public_slug?: string;
    server_name?: string;
    href?: string;
  };
  community?: {
    name?: string;
    icon_url?: string | null;
    member_count?: number;
  };
  members?: PublicCommunityMember[];
  message?: string | null;
  fetched_at?: string;
};

type ViewState = "loading" | "ready" | "missing" | "error";

export function PublicCommunityMembersPage({ slug }: { slug: string }) {
  const routeSlug = currentPublicServerCommunitySlug(slug);
  const [payload, setPayload] = useState<PublicCommunityMembersPayload | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    fetchJsonWithRetry<PublicCommunityMembersPayload>(`/api/public/servers/${encodeURIComponent(routeSlug)}/community-members`, {
      cache: "no-store",
      credentials: "include",
      headers: { accept: "application/json" },
      timeoutMs: 12_000,
    })
      .then((data) => {
        if (!active) return;
        if (!data?.ok) {
          setPayload(null);
          setState("missing");
          setMessage(data?.message ?? "That public DZN server was not found.");
          return;
        }
        setPayload(data);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof FetchJsonError && error.status === 404) {
          setPayload(null);
          setState("missing");
          setMessage("That public DZN server was not found.");
          return;
        }
        setPayload(null);
        setState("error");
        setMessage(error instanceof Error ? error.message : "Community members could not be loaded right now.");
      });

    return () => {
      active = false;
    };
  }, [routeSlug]);

  const members = useMemo(
    () => (payload?.members ?? []).map(normalizeMember).filter((member): member is NormalizedMember => Boolean(member)),
    [payload],
  );
  const serverName = displayText(payload?.server?.server_name, "DZN Server");
  const communityName = displayText(payload?.community?.name, serverName);
  const serverHref = normalizeServerHref(payload?.server?.href, routeSlug);
  const unavailable = state === "ready" && !members.length;

  if (state === "missing" || state === "error") {
    return (
      <CommunityDirectoryShell>
        <section className="mx-auto grid min-h-[62vh] max-w-3xl content-center px-4 py-28 text-center sm:px-6">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded border border-amber-300/25 bg-amber-400/10 text-amber-100">
            <EyeOff className="h-8 w-8" />
          </span>
          <h1 className="mt-5 break-words text-4xl font-black uppercase leading-none text-white [overflow-wrap:anywhere] sm:text-6xl">
            Community Not Found
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm font-bold leading-6 text-zinc-300">
            {message || "That public DZN server was not found."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/servers" className="inline-flex min-h-10 items-center justify-center gap-2 rounded bg-cyan-400 px-4 py-3 text-xs font-black uppercase text-slate-950 transition hover:bg-cyan-300">
              Back to servers
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </CommunityDirectoryShell>
    );
  }

  return (
    <CommunityDirectoryShell>
      <section className="relative border-b border-white/10">
        <div className="mx-auto grid min-h-[380px] max-w-7xl content-end gap-6 px-4 pb-8 pt-28 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <div>
            <Link href={serverHref} className="inline-flex items-center gap-2 rounded border border-white/12 bg-white/8 px-3 py-2 text-[10px] font-black uppercase text-zinc-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/10">
              <ArrowLeft className="h-3.5 w-3.5" />
              Server profile
            </Link>
            <p className="mt-5 inline-flex rounded border border-cyan-300/35 bg-cyan-400/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-50">
              Public community
            </p>
            <h1 className="mt-4 max-w-4xl break-words text-4xl font-black uppercase leading-none text-white [overflow-wrap:anywhere] sm:text-6xl">
              {state === "loading" ? "Loading Community" : communityName}
            </h1>
            <p className="mt-4 max-w-2xl text-sm font-bold leading-6 text-zinc-300">
              {state === "loading" ? "Loading visible DZN profiles." : `Visible DZN profiles from ${serverName}.`}
            </p>
          </div>
          <div className="grid gap-3 self-end rounded-lg border border-white/10 bg-black/36 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <HeroMetric label="Visible Members" value={state === "loading" ? "..." : String(members.length)} icon={Users} />
            <HeroMetric label="Link Mode" value="Profile Only" icon={ShieldCheck} />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {state === "loading" ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6 text-center">
            <Users className="mx-auto h-8 w-8 animate-pulse text-cyan-100" />
            <p className="mt-3 text-xs font-black uppercase text-zinc-300">Loading members</p>
          </div>
        ) : unavailable ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-8 text-center">
            <EyeOff className="mx-auto h-10 w-10 text-zinc-400" />
            <h2 className="mt-4 text-2xl font-black uppercase text-white">No Public Members Yet</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-6 text-zinc-400">
              {payload?.message ?? "No public community members are visible yet."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <Link
                key={member.public_profile.public_href}
                href={member.public_profile.public_href}
                aria-label={`View ${member.display_name}'s public DZN profile`}
                className="group rounded-lg border border-white/10 bg-white/[0.045] p-4 transition hover:border-cyan-300/35 hover:bg-cyan-300/10"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded border border-cyan-300/20 bg-cyan-400/10 text-cyan-50">
                    <UserRound className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-black uppercase text-white">{member.display_name}</h2>
                    <p className="mt-1 truncate text-xs font-bold uppercase text-cyan-100">
                      {member.role_label ?? "Community member"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-[10px] font-black uppercase text-zinc-500">
                  <span>{member.member_since_label ? `Since ${member.member_since_label}` : "DZN profile"}</span>
                  <span className="text-cyan-100 transition group-hover:text-white">View profile</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </CommunityDirectoryShell>
  );
}

type NormalizedMember = {
  display_name: string;
  role_label: string | null;
  member_since_label: string | null;
  public_profile: {
    public_handle: string;
    public_href: string;
    public_api_href: string;
  };
};

function CommunityDirectoryShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <AnimatedBackground />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(circle_at_14%_20%,rgba(34,211,238,0.24),transparent_34%),radial-gradient(circle_at_88%_8%,rgba(139,92,246,0.22),transparent_30%)] blur-2xl" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function HeroMetric({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded border border-white/10 bg-black/28 p-3">
      <Icon className="h-5 w-5 text-cyan-100" />
      <p className="mt-3 text-2xl font-black text-white">{value}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">{label}</p>
    </div>
  );
}

function normalizeMember(value: PublicCommunityMember): NormalizedMember | null {
  const profile = normalizePublicProfile(value.public_profile);
  if (!profile) return null;
  return {
    display_name: displayText(value.display_name ?? value.public_profile?.display_name, "DZN Player"),
    role_label: nullableDisplayText(value.role_label, 36),
    member_since_label: nullableDisplayText(value.member_since_label, 24),
    public_profile: profile,
  };
}

function normalizePublicProfile(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const publicHandle = normalizePublicProfileHandle(record.public_handle);
  if (!publicHandle) return null;
  const expectedHref = `/players/${publicHandle}`;
  const expectedApiHref = `/api/public/player-profiles/${publicHandle}`;
  if (!(record.public_href === expectedHref && record.public_api_href === expectedApiHref)) return null;
  return {
    public_handle: publicHandle,
    public_href: expectedHref,
    public_api_href: expectedApiHref,
  };
}

function publicServerSlug(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/.test(text) ? text : "preview";
}

function currentPublicServerCommunitySlug(fallback: string) {
  if (typeof window !== "undefined") {
    const match = window.location.pathname.match(/^\/servers\/([^/]+)\/community\/?$/);
    if (match?.[1]) {
      try {
        return publicServerSlug(decodeURIComponent(match[1]));
      } catch {
        return publicServerSlug(match[1]);
      }
    }
  }
  return publicServerSlug(fallback);
}

function normalizeServerHref(value: unknown, fallbackSlug: string) {
  const text = typeof value === "string" ? value.trim() : "";
  const expected = `/servers/profile?slug=${encodeURIComponent(fallbackSlug)}`;
  return text === expected ? text : expected;
}

function normalizePublicProfileHandle(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/.test(text) ? text : null;
}

function displayText(value: unknown, fallback: string) {
  return nullableDisplayText(value, 96) ?? fallback;
}

function nullableDisplayText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, maxLength) || null;
}
