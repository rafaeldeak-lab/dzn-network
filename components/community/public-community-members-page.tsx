"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Award, Copy, EyeOff, Search, ShieldCheck, Sparkles, Trophy, UserRound, Users, type LucideIcon } from "lucide-react";

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
  profile_preview?: PublicProfileDirectoryPreview | null;
};

type PublicProfileDirectoryPreviewHighlight = {
  key?: "xp" | "challenge_progress" | "calling_cards";
  label?: string;
  value?: string;
  detail?: string | null;
};

type PublicProfileDirectoryPreview = {
  source?: string;
  visible_section_count?: number;
  highlights?: PublicProfileDirectoryPreviewHighlight[];
  empty_state?: string;
  privacy?: {
    uses_visible_profile_sections_only?: boolean;
    hidden_sections?: string;
    private_identifiers?: string;
    raw_award_evidence?: string;
    exact_award_times?: string;
  };
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
type DirectorySortMode = "featured" | "name" | "role" | "newest";
type DirectoryGroupMode = "role" | "joined" | "none";

export function PublicCommunityMembersPage({ slug }: { slug: string }) {
  const routeSlug = currentPublicServerCommunitySlug(slug);
  const [payload, setPayload] = useState<PublicCommunityMembersPayload | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortMode, setSortMode] = useState<DirectorySortMode>("featured");
  const [groupMode, setGroupMode] = useState<DirectoryGroupMode>("role");
  const [copied, setCopied] = useState(false);

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
  const communityHref = `/servers/${encodeURIComponent(routeSlug)}/community`;
  const roleOptions = useMemo(() => publicMemberRoleOptions(members), [members]);
  const filteredMembers = useMemo(() => filterPublicCommunityMembers(members, query, roleFilter), [members, query, roleFilter]);
  const sortedMembers = useMemo(() => sortPublicCommunityMembers(filteredMembers, sortMode), [filteredMembers, sortMode]);
  const memberGroups = useMemo(() => groupPublicCommunityMembers(sortedMembers, groupMode), [sortedMembers, groupMode]);
  const directoryInsights = useMemo(() => buildPublicDirectoryInsights(members), [members]);
  const unavailable = state === "ready" && !members.length;
  const noMatchingMembers = state === "ready" && members.length > 0 && filteredMembers.length === 0;

  async function copyCommunityHref() {
    if (typeof window === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(new URL(communityHref, window.location.origin).toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

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
            <div className="grid gap-2 sm:grid-cols-2">
              <DirectorySafetyBadge label="Player opt-in only" icon={ShieldCheck} />
              <DirectorySafetyBadge label="Private rows hidden" icon={EyeOff} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={serverHref} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded border border-white/12 bg-white/8 px-3 py-2 text-[10px] font-black uppercase text-zinc-100 transition hover:bg-white/12">
                Server profile
                <ArrowLeft className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={copyCommunityHref}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded border border-cyan-300/24 bg-cyan-400/10 px-3 py-2 text-[10px] font-black uppercase text-cyan-50 transition hover:bg-cyan-400/16"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
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
              {payload?.message ?? "No public community members are visible yet. Members stay hidden until DZN has a trusted community bridge and the player publishes a public profile handle."}
            </p>
          </div>
        ) : (
          <>
            <DirectoryContextGrid insights={directoryInsights} />
            <DirectoryControls
              query={query}
              roleFilter={roleFilter}
              sortMode={sortMode}
              groupMode={groupMode}
              roleOptions={roleOptions}
              visibleCount={sortedMembers.length}
              totalCount={members.length}
              onQueryChange={setQuery}
              onRoleFilterChange={setRoleFilter}
              onSortModeChange={setSortMode}
              onGroupModeChange={setGroupMode}
            />
            {noMatchingMembers ? (
              <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-8 text-center">
                <Search className="mx-auto h-10 w-10 text-zinc-400" />
                <h2 className="mt-4 text-2xl font-black uppercase text-white">No Matching Public Members</h2>
                <p className="mx-auto mt-3 max-w-xl text-sm font-bold leading-6 text-zinc-400">
                  This view only searches already-public profile rows. Hidden members and raw source records are not searched or exposed.
                </p>
              </div>
            ) : (
              <div className="mt-5 grid gap-6">
                {memberGroups.map((group) => (
                  <section key={group.key}>
                    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase text-cyan-100">Public group</p>
                        <h2 className="mt-1 break-words text-2xl font-black uppercase leading-none text-white [overflow-wrap:anywhere]">
                          {group.label}
                        </h2>
                      </div>
                      <p className="rounded border border-white/10 bg-white/[0.045] px-3 py-2 text-[10px] font-black uppercase text-zinc-300">
                        {group.members.length} visible
                      </p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {group.members.map((member) => (
                        <MemberProfileCard key={member.public_profile.public_href} member={member} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
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
  profile_preview: NormalizedProfilePreview | null;
};

type DirectoryMemberGroup = {
  key: string;
  label: string;
  members: NormalizedMember[];
};

type NormalizedProfilePreview = {
  visible_section_count: number;
  highlights: NormalizedProfilePreviewHighlight[];
};

type NormalizedProfilePreviewHighlight = {
  key: "xp" | "challenge_progress" | "calling_cards";
  label: string;
  value: string;
  detail: string | null;
};

type DirectoryInsight = {
  label: string;
  value: string;
  text: string;
  icon: LucideIcon;
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

function DirectorySafetyBadge({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-2 rounded border border-white/10 bg-white/[0.045] px-3 py-2 text-[10px] font-black uppercase text-zinc-200">
      <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-100" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function DirectoryContextGrid({ insights }: { insights: DirectoryInsight[] }) {
  return (
    <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {insights.map((insight) => {
        const Icon = insight.icon;
        return (
          <article key={insight.label} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <Icon className="h-5 w-5 text-cyan-100" />
            <p className="mt-3 text-2xl font-black uppercase text-white">{insight.value}</p>
            <p className="mt-1 text-[10px] font-black uppercase text-zinc-500">{insight.label}</p>
            <p className="mt-3 text-xs font-bold leading-5 text-zinc-400">{insight.text}</p>
          </article>
        );
      })}
    </section>
  );
}

function DirectoryControls({
  query,
  roleFilter,
  sortMode,
  groupMode,
  roleOptions,
  visibleCount,
  totalCount,
  onQueryChange,
  onRoleFilterChange,
  onSortModeChange,
  onGroupModeChange,
}: {
  query: string;
  roleFilter: string;
  sortMode: DirectorySortMode;
  groupMode: DirectoryGroupMode;
  roleOptions: string[];
  visibleCount: number;
  totalCount: number;
  onQueryChange: (value: string) => void;
  onRoleFilterChange: (value: string) => void;
  onSortModeChange: (value: DirectorySortMode) => void;
  onGroupModeChange: (value: DirectoryGroupMode) => void;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-white">Public member view</p>
          <p className="mt-1 text-xs font-bold text-zinc-500">
            {visibleCount} of {totalCount} visible profiles shown. Sorting and grouping use public rows only.
          </p>
        </div>
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-[minmax(0,1fr)_180px_180px_180px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="h-11 w-full rounded border border-white/10 bg-black/34 px-10 py-2 text-sm font-bold text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/40"
              placeholder="Search public profiles"
            />
          </label>
          <select
            value={roleFilter}
            onChange={(event) => onRoleFilterChange(event.target.value)}
            className="h-11 rounded border border-white/10 bg-black/34 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none transition focus:border-cyan-300/40"
          >
            <option value="all">All roles</option>
            {roleOptions.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
          <select
            value={sortMode}
            onChange={(event) => onSortModeChange(event.target.value as DirectorySortMode)}
            className="h-11 rounded border border-white/10 bg-black/34 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none transition focus:border-cyan-300/40"
          >
            <option value="featured">Featured order</option>
            <option value="name">Name A-Z</option>
            <option value="role">Role label</option>
            <option value="newest">Newest public month</option>
          </select>
          <select
            value={groupMode}
            onChange={(event) => onGroupModeChange(event.target.value as DirectoryGroupMode)}
            className="h-11 rounded border border-white/10 bg-black/34 px-3 py-2 text-xs font-black uppercase text-zinc-100 outline-none transition focus:border-cyan-300/40"
          >
            <option value="role">Group by role</option>
            <option value="joined">Group by joined</option>
            <option value="none">No groups</option>
          </select>
        </div>
      </div>
    </section>
  );
}

function MemberProfileCard({ member }: { member: NormalizedMember }) {
  const roleGroup = publicMemberRoleGroup(member);
  return (
    <Link
      href={member.public_profile.public_href}
      aria-label={`View ${member.display_name}'s public DZN profile`}
      className="group rounded-lg border border-white/10 bg-white/[0.045] p-4 transition hover:border-cyan-300/35 hover:bg-cyan-300/10"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded border border-cyan-300/20 bg-cyan-400/10 text-cyan-50">
          <UserRound className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-black uppercase text-white">{member.display_name}</h3>
          <p className="mt-1 truncate text-xs font-bold uppercase text-cyan-100">
            {member.role_label ?? "Community member"}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 border-t border-white/10 pt-3 text-[10px] font-black uppercase text-zinc-500">
        <div className="flex items-center justify-between gap-3">
          <span>{member.member_since_label ? `Since ${member.member_since_label}` : "DZN profile"}</span>
          <span className="text-cyan-100 transition group-hover:text-white">View profile</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded border border-white/10 bg-black/24 px-2 py-1 text-zinc-300">{roleGroup}</span>
          <span className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-emerald-100">Opt-in public</span>
          <span className="rounded border border-cyan-300/18 bg-cyan-400/10 px-2 py-1 text-cyan-100">@{member.public_profile.public_handle}</span>
        </div>
      </div>
      <ProfilePreviewStrip preview={member.profile_preview} />
    </Link>
  );
}

function ProfilePreviewStrip({ preview }: { preview: NormalizedProfilePreview | null }) {
  const highlights = preview?.highlights ?? [];
  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase text-zinc-500">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-fuchsia-100" />
          <span className="truncate">Published profile preview</span>
        </span>
        <span className="shrink-0 text-cyan-100">
          {highlights.length ? `${highlights.length} visible` : "Public-safe"}
        </span>
      </div>
      {highlights.length ? (
        <div className="mt-3 grid gap-2">
          {highlights.map((highlight) => {
            const Icon = profilePreviewIcon(highlight.key);
            return (
              <div key={highlight.key} className="flex min-w-0 items-start gap-2 text-left">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-100" />
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-black uppercase text-zinc-500">{highlight.label}</p>
                  <p className="mt-0.5 break-words text-sm font-black uppercase leading-tight text-white [overflow-wrap:anywhere]">
                    {highlight.value}
                  </p>
                  {highlight.detail ? (
                    <p className="mt-0.5 break-words text-[11px] font-bold leading-4 text-zinc-400 [overflow-wrap:anywhere]">
                      {highlight.detail}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 flex items-start gap-2 text-[11px] font-bold leading-5 text-zinc-400">
          <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span>Profile sections hidden or not earned yet.</span>
        </p>
      )}
      <p className="mt-3 text-[10px] font-black uppercase leading-4 text-zinc-600">
        Visible sections only. Hidden profile sections stay private.
      </p>
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
    profile_preview: normalizeProfilePreview(value.profile_preview),
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

function normalizeProfilePreview(value: unknown): NormalizedProfilePreview | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const privacy = record.privacy && typeof record.privacy === "object" ? record.privacy as Record<string, unknown> : null;
  if (
    record.source !== "published_profile_sections"
    || privacy?.uses_visible_profile_sections_only !== true
    || privacy.hidden_sections !== "omitted"
    || privacy.private_identifiers !== "hidden"
    || privacy.raw_award_evidence !== "hidden"
    || privacy.exact_award_times !== "hidden"
  ) {
    return null;
  }
  const highlights = Array.isArray(record.highlights)
    ? record.highlights.map(normalizeProfilePreviewHighlight).filter((item): item is NormalizedProfilePreviewHighlight => Boolean(item)).slice(0, 3)
    : [];
  return {
    visible_section_count: highlights.length,
    highlights,
  };
}

function normalizeProfilePreviewHighlight(value: unknown): NormalizedProfilePreviewHighlight | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const key = record.key;
  if (key !== "xp" && key !== "challenge_progress" && key !== "calling_cards") return null;
  const label = nullableDisplayText(record.label, 36);
  const previewValue = nullableDisplayText(record.value, 48);
  if (!label || !previewValue) return null;
  return {
    key,
    label,
    value: previewValue,
    detail: nullableDisplayText(record.detail, 72),
  };
}

function profilePreviewIcon(key: NormalizedProfilePreviewHighlight["key"]): LucideIcon {
  if (key === "xp") return Sparkles;
  if (key === "challenge_progress") return Trophy;
  return Award;
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

function publicMemberRoleOptions(members: NormalizedMember[]) {
  return Array.from(new Set(members.map((member) => member.role_label).filter((role): role is string => Boolean(role))))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 24);
}

function filterPublicCommunityMembers(members: NormalizedMember[], query: string, roleFilter: string) {
  const needle = query.trim().toLowerCase();
  return members.filter((member) => {
    if (roleFilter !== "all" && member.role_label !== roleFilter) return false;
    if (!needle) return true;
    return `${member.display_name} ${member.role_label ?? ""}`.toLowerCase().includes(needle);
  });
}

function sortPublicCommunityMembers(members: NormalizedMember[], sortMode: DirectorySortMode) {
  return members
    .map((member, index) => ({ member, index }))
    .sort((left, right) => {
      if (sortMode === "name") return compareText(left.member.display_name, right.member.display_name) || left.index - right.index;
      if (sortMode === "role") {
        return (
          compareText(left.member.role_label ?? "Community member", right.member.role_label ?? "Community member")
          || compareText(left.member.display_name, right.member.display_name)
          || left.index - right.index
        );
      }
      if (sortMode === "newest") {
        return (
          publicMonthSortValue(right.member.member_since_label) - publicMonthSortValue(left.member.member_since_label)
          || compareText(left.member.display_name, right.member.display_name)
          || left.index - right.index
        );
      }
      return left.index - right.index;
    })
    .map(({ member }) => member);
}

function groupPublicCommunityMembers(members: NormalizedMember[], groupMode: DirectoryGroupMode): DirectoryMemberGroup[] {
  if (groupMode === "none") return [{ key: "all-public-members", label: "All Public Members", members }];

  const groups = new Map<string, DirectoryMemberGroup>();
  for (const member of members) {
    const label = groupMode === "joined" ? member.member_since_label ?? "Profile Only" : publicMemberRoleGroup(member);
    const key = `${groupMode}:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const current = groups.get(key) ?? { key, label, members: [] };
    current.members.push(member);
    groups.set(key, current);
  }

  const rows = Array.from(groups.values());
  if (groupMode === "joined") {
    return rows.sort((left, right) => publicMonthSortValue(right.label) - publicMonthSortValue(left.label) || compareText(left.label, right.label));
  }
  return rows.sort((left, right) => roleGroupRank(left.label) - roleGroupRank(right.label) || compareText(left.label, right.label));
}

function buildPublicDirectoryInsights(members: NormalizedMember[]): DirectoryInsight[] {
  const roleGroups = new Set(members.map(publicMemberRoleGroup));
  const newestMonth = newestPublicMonthLabel(members);
  return [
    {
      label: "Visible profiles",
      value: String(members.length),
      text: "Only opted-in public DZN profiles returned by the directory API.",
      icon: Users,
    },
    {
      label: "Role groups",
      value: String(roleGroups.size || 0),
      text: "Grouped from public role labels, not hidden Discord or import records.",
      icon: UserRound,
    },
    {
      label: "Newest public month",
      value: newestMonth ?? "Public only",
      text: "Month-level context from already-visible member rows.",
      icon: Search,
    },
    {
      label: "Influence",
      value: "None",
      text: "Directory presentation cannot change scoring, billing, rankings, or awards.",
      icon: ShieldCheck,
    },
  ];
}

function publicMemberRoleGroup(member: NormalizedMember) {
  const role = member.role_label?.toLowerCase() ?? "";
  if (/\b(owner|admin|founder|lead|leader|captain|commander|staff|moderator|mod)\b/.test(role)) return "Leadership";
  if (/\b(builder|trader|medic|hunter|scout|raider|pvp|event|organiser|organizer)\b/.test(role)) return "Specialists";
  return "Community";
}

function newestPublicMonthLabel(members: NormalizedMember[]) {
  return members
    .map((member) => member.member_since_label)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => publicMonthSortValue(right) - publicMonthSortValue(left))[0] ?? null;
}

function publicMonthSortValue(value: string | null) {
  if (!value) return -1;
  const parsed = Date.parse(`1 ${value} 00:00:00 UTC`);
  return Number.isFinite(parsed) ? parsed : -1;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "en-GB", { sensitivity: "base" });
}

function roleGroupRank(label: string) {
  if (label === "Leadership") return 0;
  if (label === "Specialists") return 1;
  return 2;
}
