"use client";

import { ExternalLink, Eye, EyeOff, Loader2, ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PrivacyPreferenceKey =
  | "public_profile_enabled"
  | "show_display_name"
  | "show_gameplay_summary"
  | "show_featured_server"
  | "show_xp_progress"
  | "show_challenge_progress"
  | "show_calling_cards"
  | "show_award_dates";

type PrivacyPreferences = Record<PrivacyPreferenceKey, boolean>;

type PrivacySection = {
  key: PrivacyPreferenceKey;
  label: string;
  description: string;
  default_value: boolean;
  enabled: boolean;
};

type PrivacyPayload = {
  ok: true;
  settings: PrivacyPreferences;
  sections: PrivacySection[];
  public_profile_status: "published" | "preferences_saved" | "private_by_default";
  public_profile_handle: string | null;
  public_profile_href: string | null;
  source: "player_profile_privacy_preferences" | "defaults" | "unavailable";
  updated_at: string | null;
  private: true;
  presentation_only: true;
  message: string;
  fairness_boundary: string[];
};

type PrivacyState =
  | { status: "loading"; data: null; message: null }
  | { status: "ready"; data: PrivacyPayload; message: string | null }
  | { status: "saving"; data: PrivacyPayload; message: string }
  | { status: "error"; data: PrivacyPayload | null; message: string };

async function requestPrivacyPreferences(): Promise<PrivacyPayload> {
  const response = await fetch("/api/player/profile/privacy", { cache: "no-store", credentials: "include" });
  const payload = (await response.json().catch(() => null)) as Partial<PrivacyPayload> & { message?: string } | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? "Profile privacy settings are not available right now.");
  }

  return payload as PrivacyPayload;
}

async function updatePrivacyPreference(key: PrivacyPreferenceKey, enabled: boolean): Promise<PrivacyPayload> {
  const response = await fetch("/api/player/profile/privacy", {
    method: "PATCH",
    cache: "no-store",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ settings: { [key]: enabled } }),
  });
  const payload = (await response.json().catch(() => null)) as Partial<PrivacyPayload> & { message?: string } | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message ?? "Profile privacy setting could not be saved.");
  }

  return payload as PrivacyPayload;
}

export function PlayerProfilePrivacySettings() {
  const [state, setState] = useState<PrivacyState>({ status: "loading", data: null, message: null });

  useEffect(() => {
    let active = true;
    requestPrivacyPreferences()
      .then((data) => {
        if (active) setState({ status: "ready", data, message: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: "error", data: null, message: errorMessage(error) });
      });

    return () => {
      active = false;
    };
  }, []);

  const publicStatus = useMemo(() => {
    const data = state.data;
    if (!data) return { label: "Checking", tone: "border-slate-300/20 bg-white/8 text-slate-100" };
    if (data.public_profile_status === "published") {
      return { label: "Published", tone: "border-emerald-300/35 bg-emerald-300/12 text-emerald-100" };
    }
    if (data.settings.public_profile_enabled) {
      return { label: "Preferences saved", tone: "border-cyan-300/35 bg-cyan-300/12 text-cyan-100" };
    }
    return { label: "Private by default", tone: "border-amber-300/35 bg-amber-300/12 text-amber-100" };
  }, [state.data]);

  async function onToggle(key: PrivacyPreferenceKey, enabled: boolean) {
    if (!state.data || state.status === "saving") return;
    const previous = state.data;
    const optimistic = {
      ...previous,
      settings: { ...previous.settings, [key]: enabled },
      sections: previous.sections.map((section) => section.key === key ? { ...section, enabled } : section),
    };
    setState({ status: "saving", data: optimistic, message: "Saving profile display preferences." });

    try {
      const next = await updatePrivacyPreference(key, enabled);
      setState({ status: "ready", data: next, message: "Profile display preferences saved." });
    } catch (error) {
      setState({ status: "error", data: previous, message: errorMessage(error) });
    }
  }

  return (
    <section className="rounded-lg border border-cyan-300/25 bg-slate-950/78 p-5 shadow-[0_0_42px_rgba(34,211,238,0.1)] backdrop-blur">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-cyan-300/35 bg-cyan-300/10 text-cyan-100">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-black uppercase text-white">Profile Privacy Preferences</h2>
            <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
              Choose which approved sections can appear on your public DZN profile link. Profile attribution across other DZN surfaces remains blocked until its own approval slice.
            </p>
          </div>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black uppercase ${publicStatus.tone}`}>
          {state.data?.settings.public_profile_enabled ? <Eye aria-hidden="true" className="h-4 w-4" /> : <EyeOff aria-hidden="true" className="h-4 w-4" />}
          {publicStatus.label}
        </span>
      </div>

      {state.status === "loading" ? (
        <div className="mt-5 flex items-center gap-2 rounded-md border border-white/10 bg-white/6 p-4 text-sm font-semibold text-slate-300">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Loading profile privacy preferences
        </div>
      ) : null}

      {state.data ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {state.data.sections.map((section) => (
              <PrivacyToggle
                key={section.key}
                section={section}
                saving={state.status === "saving"}
                onToggle={onToggle}
              />
            ))}
          </div>

          <div className="rounded-md border border-violet-300/20 bg-violet-300/8 p-4">
            <p className="text-xs font-black uppercase text-violet-100">Saved Preference Boundary</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{state.data.message}</p>
            {state.data.public_profile_href ? (
              <Link
                href={state.data.public_profile_href}
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-cyan-200/45 bg-cyan-300/12 px-3 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-100/70 hover:bg-cyan-300/18"
              >
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                View Public Profile
              </Link>
            ) : null}
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">
              Last saved: {formatSavedAt(state.data.updated_at)}. Source: {state.data.source.replace(/_/g, " ")}.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {state.data.fairness_boundary.map((line) => (
              <div key={line} className="rounded-md border border-amber-300/20 bg-amber-300/8 p-3 text-sm font-semibold leading-6 text-amber-50">
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="mt-5 rounded-md border border-rose-300/30 bg-rose-400/10 p-4 text-sm font-semibold leading-6 text-rose-50">
          {state.message}
        </div>
      ) : null}

      {state.status === "saving" ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-cyan-100" aria-live="polite">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {state.message}
        </p>
      ) : state.message ? (
        <p className="mt-4 text-sm font-semibold text-emerald-100" aria-live="polite">{state.message}</p>
      ) : null}
    </section>
  );
}

function PrivacyToggle({
  section,
  saving,
  onToggle,
}: {
  section: PrivacySection;
  saving: boolean;
  onToggle: (key: PrivacyPreferenceKey, enabled: boolean) => void;
}) {
  const enabled = section.enabled;
  return (
    <button
      type="button"
      onClick={() => onToggle(section.key, !enabled)}
      disabled={saving}
      className={`group flex min-h-[118px] items-start justify-between gap-4 rounded-md border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-70 ${
        enabled
          ? "border-cyan-300/35 bg-cyan-300/10 hover:border-cyan-100/65"
          : "border-white/10 bg-white/6 hover:border-white/25"
      }`}
      aria-pressed={enabled}
      aria-label={`${enabled ? "Hide" : "Show"} ${section.label} on public profile surfaces`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-black uppercase text-white">{section.label}</span>
        <span className="mt-2 block text-sm font-semibold leading-6 text-slate-300">{section.description}</span>
        <span className="mt-3 inline-flex rounded-md border border-white/10 bg-white/6 px-2 py-1 text-[10px] font-black uppercase text-slate-300">
          Default {section.default_value ? "on" : "off"}
        </span>
      </span>
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${
        enabled ? "border-cyan-300/45 bg-cyan-300/12 text-cyan-100" : "border-slate-500/40 bg-slate-900/80 text-slate-300"
      }`}>
        {enabled ? <ToggleRight aria-hidden="true" className="h-5 w-5" /> : <ToggleLeft aria-hidden="true" className="h-5 w-5" />}
      </span>
    </button>
  );
}

function formatSavedAt(value: string | null) {
  if (!value) return "not saved yet";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "saved recently";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Profile privacy settings are not available right now.";
}
