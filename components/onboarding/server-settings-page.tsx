"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  Gamepad2,
  Globe2,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Skull,
  Swords,
  Tags,
  Text,
  X,
} from "lucide-react";
import Link from "next/link";

import { DznLogo } from "@/components/dzn/dzn-logo";
import { clearClientAuthState, getMe, logoutAndRedirect } from "./api";
import type { LinkedServer } from "./types";

type CategoryValue = "pvp" | "deathmatch" | "pve" | "pvp_pve";
type ListingVisibility = "public" | "hidden";

type SettingsResponse = {
  ok: true;
  server: {
    id: string;
    name: string;
    status: string | null;
    publicSlug: string | null;
    currentCategory: CategoryValue | null;
    currentCategoryLabel: string;
    description: string;
    visibility: ListingVisibility;
    listingUpdatedAt: string | null;
    lastUpdatedAt: string | null;
    categoryChangedAt: string | null;
    categoryEffectiveAt: string | null;
    setupComplete: boolean;
  };
  availableCategories: Array<{
    value: CategoryValue;
    label: string;
    description: string;
    selected: boolean;
    locked: boolean;
  }>;
  allowedTags: string[];
  currentTags: string[];
  plan: {
    plan_key: string;
    subscription_status: string;
    policy_group: "trial_free" | "pro_partner";
  };
  categoryPolicy: {
    cooldownDays: number;
    monthlyLimit: number;
    firstSetupGraceHours: number;
    fairnessNote: string;
  };
  categoryStatus: {
    currentCategory: CategoryValue | null;
    currentCategoryLabel: string;
    cooldownUntil: string | null;
    nextAllowedChangeAt: string | null;
    monthlyChangesUsed: number;
    monthlyLimit: number;
    graceAvailable: boolean;
    eventLock: {
      locked: boolean;
      reason: string | null;
      eventName?: string | null;
      startsAt?: string | null;
    };
    categoryEffectiveAt: string | null;
    appliesAfterNextAdmSync: boolean;
  };
  editState: {
    setupComplete: boolean;
    canEditCategory: boolean;
    canEditTags: boolean;
    canEditDescription: boolean;
    canEditVisibility: boolean;
    tagsCooldownUntil: string | null;
    tagEditsUsedLast7Days: number;
    visibilityEditsUsedToday: number;
  };
  setupPageUrl: string;
  publicPageUrl: string;
};

type SaveState = {
  area: "category" | "tags" | "listing" | null;
  message: string | null;
  error: string | null;
};

const CATEGORY_ICON: Record<CategoryValue, React.ReactNode> = {
  pvp: <Swords className="h-5 w-5" />,
  deathmatch: <Skull className="h-5 w-5" />,
  pve: <ShieldCheck className="h-5 w-5" />,
  pvp_pve: <Gamepad2 className="h-5 w-5" />,
};

export function ServerSettingsPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [servers, setServers] = useState<LinkedServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ area: null, message: null, error: null });
  const [selectedCategory, setSelectedCategory] = useState<CategoryValue | "">("");
  const [confirmingCategory, setConfirmingCategory] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ListingVisibility>("public");

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const requestedServerId = params.get("serverId") ?? "";
    getMe()
      .then((auth) => {
        if (!active) return;
        const linkedServers = auth.linkedServers ?? (auth.linkedServer ? [auth.linkedServer] : []);
        setServers(linkedServers);
        setSelectedServerId(requestedServerId || linkedServers[0]?.id || "");
        if (linkedServers.length === 0) setLoading(false);
        setAuthChecked(true);
      })
      .catch(() => {
        if (!active) return;
        setAuthError(true);
        setAuthChecked(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedServerId) {
      return;
    }
    let active = true;
    fetch(`/api/servers/${encodeURIComponent(selectedServerId)}/settings`, {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `Request failed: ${response.status}`);
        return data as SettingsResponse;
      })
      .then((data) => {
        if (!active) return;
        setSettings(data);
        setSelectedCategory(data.server.currentCategory ?? "");
        setSelectedTags(data.currentTags);
        setDescription(data.server.description ?? "");
        setVisibility(data.server.visibility);
        setSaveState({ area: null, message: null, error: null });
      })
      .catch((error) => {
        if (!active) return;
        setSaveState({ area: null, message: null, error: error instanceof Error ? error.message : "Unable to load server settings." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedServerId]);

  useEffect(() => {
    if (!settings) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("focus") === "category") {
      window.requestAnimationFrame(() => document.getElementById("category")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }, [settings]);

  const selectedServer = useMemo(() => servers.find((server) => server.id === selectedServerId) ?? null, [servers, selectedServerId]);
  const selectedCategoryOption = settings?.availableCategories.find((category) => category.value === selectedCategory) ?? null;
  const categoryChanged = Boolean(settings && selectedCategory && selectedCategory !== settings.server.currentCategory);
  const descriptionChanged = Boolean(settings && description !== (settings.server.description ?? ""));
  const visibilityChanged = Boolean(settings && visibility !== settings.server.visibility);
  const tagsChanged = Boolean(settings && JSON.stringify(selectedTags) !== JSON.stringify(settings.currentTags));

  async function saveCategory() {
    if (!settings || !selectedCategory) return;
    setSaveState({ area: "category", message: null, error: null });
    try {
      const result = await postJson(`/api/servers/${encodeURIComponent(settings.server.id)}/settings/category`, { category: selectedCategory });
      setSaveState({ area: null, message: result.message ?? "Category updated.", error: null });
      setConfirmingCategory(false);
      await reloadSettings(settings.server.id);
    } catch (error) {
      setSaveState({ area: null, message: null, error: error instanceof Error ? error.message : "Unable to save category." });
    }
  }

  async function saveTags() {
    if (!settings) return;
    setSaveState({ area: "tags", message: null, error: null });
    try {
      const result = await postJson(`/api/servers/${encodeURIComponent(settings.server.id)}/settings/tags`, { tags: selectedTags });
      setSaveState({ area: null, message: result.message ?? "Tags updated.", error: null });
      await reloadSettings(settings.server.id);
    } catch (error) {
      setSaveState({ area: null, message: null, error: error instanceof Error ? error.message : "Unable to save tags." });
    }
  }

  async function saveListing() {
    if (!settings) return;
    setSaveState({ area: "listing", message: null, error: null });
    try {
      const result = await postJson(`/api/servers/${encodeURIComponent(settings.server.id)}/settings/listing`, { description, visibility });
      setSaveState({ area: null, message: result.message ?? "Public listing updated.", error: null });
      await reloadSettings(settings.server.id);
    } catch (error) {
      setSaveState({ area: null, message: null, error: error instanceof Error ? error.message : "Unable to save listing." });
    }
  }

  async function reloadSettings(serverId: string) {
    const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/settings`, {
      cache: "no-store",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Request failed: ${response.status}`);
    const next = data as SettingsResponse;
    setSettings(next);
    setSelectedCategory(next.server.currentCategory ?? "");
    setSelectedTags(next.currentTags);
    setDescription(next.server.description ?? "");
    setVisibility(next.server.visibility);
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) => {
      if (current.includes(tag)) return current.filter((value) => value !== tag);
      if (current.length >= 8) return current;
      return [...current, tag];
    });
  }

  if (!authChecked || loading) {
    return <LoadingScreen />;
  }

  if (authError) {
    return <LoginRequired />;
  }

  if (!selectedServerId || !selectedServer) {
    return (
      <PageShell onLogout={signOut}>
        <section className="glass-surface animated-border rounded-lg p-6">
          <div className="relative z-10">
            <p className="text-xs font-black uppercase text-violet-200/75">Server Settings</p>
            <h1 className="mt-2 text-3xl font-black text-white">No connected server found</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">Connect Discord and Nitrado from setup before editing public listing settings.</p>
            <Link href="/setup" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white">
              Open Setup Page <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </PageShell>
    );
  }

  if (!settings) {
    return (
      <PageShell onLogout={signOut}>
        <section className="glass-surface animated-border rounded-lg p-6">
          <div className="relative z-10">
            <p className="text-xs font-black uppercase text-red-200/75">Server Settings</p>
            <h1 className="mt-2 text-3xl font-black text-white">Settings unavailable</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">{saveState.error ?? "DZN could not load this server settings page."}</p>
          </div>
        </section>
      </PageShell>
    );
  }

  const categoryLocked = !settings.editState.canEditCategory && categoryChanged;
  const setupUrl = settings.setupPageUrl;

  return (
    <PageShell onLogout={signOut}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-100">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <label className="relative grid min-w-[260px] gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
          <span className="text-[9px] font-black uppercase text-zinc-500">Selected Server</span>
          <select
            value={selectedServerId}
            onChange={(event) => {
              setLoading(true);
              setSelectedServerId(event.target.value);
            }}
            className="appearance-none bg-transparent pr-8 text-sm font-black text-white outline-none"
          >
            {servers.map((server) => (
              <option key={server.id} value={server.id} className="bg-[#080b16] text-white">
                {server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="glass-surface animated-border rounded-lg p-5">
        <div className="relative z-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="text-xs font-black uppercase text-violet-200/75">Server Settings</p>
            <h1 className="mt-2 text-3xl font-black tracking-normal text-white">{settings.server.name}</h1>
            <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-zinc-300">
              Manage how your server appears across DZN. Category changes affect matchmaking, public listing, and category leaderboards.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusChip tone={settings.server.visibility === "public" ? "emerald" : "zinc"} icon={settings.server.visibility === "public" ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}>
                {settings.server.visibility === "public" ? "Public Listing Active" : "Hidden"}
              </StatusChip>
              <StatusChip tone="violet" icon={<Gamepad2 className="h-3.5 w-3.5" />}>{settings.categoryStatus.currentCategoryLabel}</StatusChip>
              <StatusChip tone="cyan" icon={<ShieldCheck className="h-3.5 w-3.5" />}>{formatPlan(settings.plan.plan_key)}</StatusChip>
              <StatusChip tone={settings.categoryStatus.cooldownUntil ? "amber" : "emerald"} icon={<Clock3 className="h-3.5 w-3.5" />}>
                {settings.categoryStatus.cooldownUntil ? "Cooldown Active" : "Category Editable"}
              </StatusChip>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Link href={setupUrl} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-100">
              <Settings className="h-4 w-4" />
              Open Setup Page
            </Link>
            <Link href={settings.publicPageUrl} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50">
              <Globe2 className="h-4 w-4" />
              View Public Page
            </Link>
          </div>
        </div>
      </section>

      {saveState.message || saveState.error ? (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-bold ${saveState.error ? "border-red-300/25 bg-red-400/10 text-red-50" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"}`}>
          {saveState.error ?? saveState.message}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section id="category" className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <SectionTitle icon={<Gamepad2 className="h-5 w-5" />} title="Public Category" />
            <p className="mt-2 text-sm leading-6 text-zinc-300">Choose one canonical category for public listing, matchmaking, and category leaderboards.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {settings.availableCategories.map((category) => {
                const selected = selectedCategory === category.value;
                const unavailable = Boolean(settings.categoryStatus.cooldownUntil || settings.categoryStatus.eventLock.locked) && !category.selected;
                return (
                  <button
                    key={category.value}
                    type="button"
                    disabled={unavailable}
                    onClick={() => setSelectedCategory(category.value)}
                    className={`min-h-[152px] rounded-lg border p-4 text-left transition ${selected ? "border-violet-300/55 bg-violet-500/18 shadow-[0_0_28px_rgba(139,92,246,0.16)]" : "border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]"} ${unavailable ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <span className={`grid h-10 w-10 place-items-center rounded-lg border ${selected ? "border-violet-200/45 bg-violet-300/16 text-violet-50" : "border-white/10 bg-black/24 text-zinc-200"}`}>
                      {CATEGORY_ICON[category.value]}
                    </span>
                    <span className="mt-3 block text-lg font-black text-white">{category.label}</span>
                    <span className="mt-2 block text-sm leading-6 text-zinc-300">{category.description}</span>
                    {unavailable ? <span className="mt-3 inline-flex text-xs font-black uppercase text-amber-100">Locked by policy</span> : null}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={!categoryChanged || categoryLocked || saveState.area === "category"}
              onClick={() => setConfirmingCategory(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {saveState.area === "category" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Category
            </button>
          </div>
        </section>

        <section className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <SectionTitle icon={<Clock3 className="h-5 w-5" />} title="Category Change Status" />
            <div className="mt-4 grid gap-3">
              <InfoRow label="Current category" value={settings.categoryStatus.currentCategoryLabel} />
              <InfoRow label="Selected category" value={selectedCategoryOption?.label ?? "Not selected"} />
              <InfoRow label="Category cooldown" value={`${settings.categoryPolicy.cooldownDays} days`} />
              <InfoRow label="Next allowed change" value={settings.categoryStatus.nextAllowedChangeAt ? formatDate(settings.categoryStatus.nextAllowedChangeAt) : "Available now"} />
              <InfoRow label="Monthly changes used" value={`${settings.categoryStatus.monthlyChangesUsed} of ${settings.categoryStatus.monthlyLimit}`} />
              <InfoRow label="Effective date/time" value={settings.categoryStatus.categoryEffectiveAt ? formatDate(settings.categoryStatus.categoryEffectiveAt) : "After save"} />
              <InfoRow label="Leaderboard timing" value="After next successful ADM sync" />
            </div>
            <div className={`mt-4 rounded-lg border px-3 py-3 text-sm font-bold leading-6 ${settings.categoryStatus.eventLock.locked ? "border-amber-300/25 bg-amber-400/10 text-amber-50" : settings.categoryStatus.graceAvailable ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-50" : "border-white/10 bg-black/24 text-zinc-300"}`}>
              {settings.categoryStatus.eventLock.locked
                ? settings.categoryStatus.eventLock.reason
                : settings.categoryStatus.graceAvailable
                  ? "You have 1 setup correction available for the next 24 hours."
                  : settings.categoryPolicy.fairnessNote}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <section className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <SectionTitle icon={<Tags className="h-5 w-5" />} title="Public Tags" />
            <p className="mt-2 text-sm leading-6 text-zinc-300">Select up to 8 listing tags. Tags do not affect category leaderboards.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {settings.allowedTags.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={!active && selectedTags.length >= 8}
                    onClick={() => toggleTag(tag)}
                    className={`rounded-lg border px-3 py-2 text-xs font-black uppercase transition ${active ? "border-cyan-300/45 bg-cyan-300/14 text-cyan-50" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/20"} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!tagsChanged || !settings.editState.canEditTags || saveState.area === "tags"}
                onClick={saveTags}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-4 py-3 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {saveState.area === "tags" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Tags
              </button>
              <span className="text-xs font-bold text-zinc-400">{selectedTags.length}/8 active tags. {settings.editState.tagsCooldownUntil ? `Next edit ${formatDate(settings.editState.tagsCooldownUntil)}.` : `${settings.editState.tagEditsUsedLast7Days}/5 edits used this week.`}</span>
            </div>
          </div>
        </section>

        <section className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <SectionTitle icon={<Text className="h-5 w-5" />} title="Public Description" />
            <label className="mt-4 block">
              <span className="text-[10px] font-black uppercase text-zinc-400">Listing Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                rows={7}
                placeholder="Describe your community, server rules, and what makes it worth joining."
                className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/32 px-3 py-3 text-sm font-bold leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-300/45"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs font-bold text-zinc-500">
              <span>40 to 500 characters. HTML is sanitized.</span>
              <span>{description.length}/500</span>
            </div>
            <button
              type="button"
              disabled={!descriptionChanged || !settings.editState.canEditDescription || saveState.area === "listing"}
              onClick={saveListing}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/10 px-4 py-3 text-xs font-black uppercase text-violet-50 transition hover:border-violet-300/45 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {saveState.area === "listing" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Description
            </button>
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <section className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <SectionTitle icon={<Globe2 className="h-5 w-5" />} title="Listing Visibility" />
            <p className="mt-2 text-sm leading-6 text-zinc-300">Hidden servers keep ADM sync running but do not appear in public listings.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setVisibility("public")} className={`rounded-lg border p-4 text-left transition ${visibility === "public" ? "border-emerald-300/45 bg-emerald-400/12" : "border-white/10 bg-white/[0.04]"}`}>
                <Eye className="h-5 w-5 text-emerald-100" />
                <span className="mt-2 block text-sm font-black text-white">Public</span>
                <span className="mt-1 block text-xs leading-5 text-zinc-400">Show in DZN browsing and public profiles.</span>
              </button>
              <button type="button" onClick={() => setVisibility("hidden")} className={`rounded-lg border p-4 text-left transition ${visibility === "hidden" ? "border-zinc-300/35 bg-zinc-400/10" : "border-white/10 bg-white/[0.04]"}`}>
                <EyeOff className="h-5 w-5 text-zinc-100" />
                <span className="mt-2 block text-sm font-black text-white">Hidden</span>
                <span className="mt-1 block text-xs leading-5 text-zinc-400">Sync continues without public discovery.</span>
              </button>
            </div>
            <button
              type="button"
              disabled={!visibilityChanged || !settings.editState.canEditVisibility || saveState.area === "listing"}
              onClick={saveListing}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-xs font-black uppercase text-emerald-50 transition hover:border-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {saveState.area === "listing" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Visibility
            </button>
          </div>
        </section>

        <section className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <SectionTitle icon={<LockKeyhole className="h-5 w-5" />} title="Advanced Setup" />
            <p className="mt-2 text-sm leading-6 text-zinc-300">Need to update Discord, bot install, Nitrado token, or service ID? Open Setup.</p>
            <Link href="/setup" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase text-zinc-100">
              <Settings className="h-4 w-4" />
              Open Setup Page
            </Link>
            <div className="mt-5 rounded-lg border border-white/10 bg-black/24 p-3">
              <p className="text-xs font-black uppercase text-zinc-300">Plan Fairness</p>
              <p className="mt-2 text-sm leading-6 text-zinc-400">Your plan controls server limits and premium listing tools. Category cooldowns protect fair competition and cannot be bypassed by upgrading.</p>
            </div>
          </div>
        </section>
      </div>

      {confirmingCategory && selectedCategoryOption ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-white/10 bg-[#070b16] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.65)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-violet-200/75">Confirm Category</p>
                <h2 className="mt-2 text-2xl font-black text-white">Change server category?</h2>
              </div>
              <button type="button" onClick={() => setConfirmingCategory(false)} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              Changing category affects public listing, matchmaking, events, and category leaderboards. Your all-time stats stay saved, but category ranking updates after the next successful ADM sync.
            </p>
            <div className="mt-4 grid gap-2">
              <InfoRow label="Current category" value={settings.categoryStatus.currentCategoryLabel} />
              <InfoRow label="New category" value={selectedCategoryOption.label} />
              <InfoRow label="Effective time" value="Immediately for listing, after next ADM sync for competitive category ranking" />
              <InfoRow label="Next allowed change" value={settings.categoryStatus.nextAllowedChangeAt ? formatDate(settings.categoryStatus.nextAllowedChangeAt) : `${settings.categoryPolicy.cooldownDays} days after save`} />
              <InfoRow label="Monthly changes used" value={`${settings.categoryStatus.monthlyChangesUsed} of ${settings.categoryStatus.monthlyLimit}`} />
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setConfirmingCategory(false)} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase text-zinc-100">Cancel</button>
              <button type="button" disabled={saveState.area === "category"} onClick={saveCategory} className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-55">
                {saveState.area === "category" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm Category Change
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

function PageShell({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(34,211,238,0.1),transparent_26%),radial-gradient(circle_at_84%_16%,rgba(139,92,246,0.12),transparent_28%)]" />
      <div className="relative z-10 mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <DznLogo compact />
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/servers" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200">View Network</Link>
            <Link href="/setup" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200">Setup</Link>
            <button type="button" onClick={onLogout} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black uppercase text-zinc-200">
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

function LoadingScreen() {
  return (
    <PageShell onLogout={signOut}>
      <section className="glass-surface animated-border rounded-lg p-6">
        <div className="relative z-10 flex items-center gap-3">
          <RefreshCw className="h-5 w-5 animate-spin text-violet-100" />
          <p className="text-sm font-black uppercase text-zinc-200">Loading server settings</p>
        </div>
      </section>
    </PageShell>
  );
}

function LoginRequired() {
  return (
    <main className="relative grid min-h-screen place-items-center bg-[#02030a] px-4 text-white">
      <section className="glass-surface animated-border w-full max-w-xl rounded-lg p-6">
        <div className="relative z-10">
          <p className="text-xs font-black uppercase text-violet-200/75">Protected Settings</p>
          <h1 className="mt-2 text-3xl font-black text-white">Login required</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">Server Settings are available to connected server owners and DZN admins only.</p>
          <Link href={`/login?returnTo=${encodeURIComponent("/dashboard/server-settings")}`} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white">
            Login with Discord <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-lg border border-violet-300/25 bg-violet-500/15 text-violet-100">{icon}</span>
      <h2 className="text-xl font-black text-white">{title}</h2>
    </div>
  );
}

function StatusChip({ icon, tone, children }: { icon: React.ReactNode; tone: "emerald" | "violet" | "cyan" | "amber" | "zinc"; children: React.ReactNode }) {
  const classes = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    violet: "border-violet-300/25 bg-violet-400/10 text-violet-100",
    cyan: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
    amber: "border-amber-300/25 bg-amber-400/10 text-amber-100",
    zinc: "border-white/10 bg-white/[0.04] text-zinc-200",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-black uppercase ${classes}`}>{icon}{children}</span>;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-3">
      <p className="text-[10px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-zinc-100">{value}</p>
    </div>
  );
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Request failed: ${response.status}`);
  return data as { message?: string };
}

function formatPlan(value: string) {
  if (!value) return "Free";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function signOut() {
  clearClientAuthState();
  void logoutAndRedirect();
}
