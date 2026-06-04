"use client";

import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, Save, Sparkles } from "lucide-react";

import { BadgeIcon, ServerCardBadges, ServerProfileFrame, ServerThemeBanner } from "@/components/badges/server-visuals";
import {
  getAvailableFrameVisuals,
  getAvailableThemeBannerVisuals,
  toVisualBadge,
  type BadgeAnimationType,
  type ProfileFrameVisual,
  type ServerThemeBannerVisual,
  type VisualBadge,
} from "@/lib/badges/visuals";
import { SaveProgressButton, useSaveProgress } from "./save-progress";

type VisualLoadoutResponse = {
  ok: true;
  server: {
    id: string;
    name: string | null;
    category: string | null;
    planKey: string | null;
  };
  loadout: {
    showcaseBadges: VisualBadge[];
    showcaseBadgeCodes: string[];
    profileFrame: ProfileFrameVisual;
    profileFrameKey: string;
    themeBanner: ServerThemeBannerVisual;
    themeBannerKey: string;
    animationEnabled: boolean;
    limits: {
      planKey: string;
      maxShowcaseBadges: number;
      animationsAllowed: boolean;
    };
    updatedAt: string | null;
  };
  availableFrames: ProfileFrameVisual[];
  availableThemes: ServerThemeBannerVisual[];
  availableShowcaseBadges: VisualBadge[];
  limits: {
    planKey: string;
    maxShowcaseBadges: number;
    animationsAllowed: boolean;
  };
  message?: string;
};

type ApiErrorDetails = {
  message: string;
  errorCode: string | null;
  status: number | null;
};

const ALL_FRAMES = Object.values(getAvailableFrameVisuals());
const ALL_THEMES = Object.values(getAvailableThemeBannerVisuals());
const LOCKED_BADGE_PREVIEWS = [
  lockedBadge("king_of_dzn", "King of DZN", "crown", "Live crown for the top DZN server."),
  lockedBadge("warlord", "Warlord", "combat", "Unlock at 25,000 confirmed kills."),
  lockedBadge("long_shot_legend", "Long Shot Legend", "combat", "Unlock at a 1,000m longest kill."),
  lockedBadge("event_champion", "Event Champion", "community", "Reserved for event winners."),
  lockedBadge("founder", "Founder", "founder", "Limited launch-period badge."),
  lockedBadge("summer_champion", "Summer Champion", "seasonal", "Permanent seasonal championship badge."),
];

export function VisualLoadoutSection({ serverId, serverName, planKey }: { serverId: string; serverName: string; planKey: string }) {
  const [payload, setPayload] = useState<VisualLoadoutResponse | null>(null);
  const [loadError, setLoadError] = useState<ApiErrorDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBadgeCodes, setSelectedBadgeCodes] = useState<string[]>([]);
  const [selectedFrameKey, setSelectedFrameKey] = useState("");
  const [selectedThemeKey, setSelectedThemeKey] = useState("");
  const [animationEnabled, setAnimationEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveProgress = useSaveProgress();

  useEffect(() => {
    let active = true;
    void fetchLoadout(serverId)
      .then((data) => {
        if (!active) return;
        applyPayload(data);
        setPayload(data);
        setLoadError(null);
      })
      .catch((caught) => {
        if (!active) return;
        setLoadError(apiErrorDetails(caught, "Visual loadout is temporarily unavailable."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [serverId]);

  const selectedBadges = useMemo(() => {
    const byCode = new Map((payload?.availableShowcaseBadges ?? []).map((badge) => [badge.code, badge]));
    return selectedBadgeCodes.map((code) => byCode.get(code)).filter(Boolean).map((badge) => withBadgeMotion(badge as VisualBadge, animationEnabled));
  }, [animationEnabled, payload?.availableShowcaseBadges, selectedBadgeCodes]);

  const availableBadgeCodes = useMemo(() => new Set((payload?.availableShowcaseBadges ?? []).map((badge) => badge.code)), [payload?.availableShowcaseBadges]);
  const availableFrameKeys = useMemo(() => new Set((payload?.availableFrames ?? []).map((frame) => frame.key)), [payload?.availableFrames]);
  const availableThemeKeys = useMemo(() => new Set((payload?.availableThemes ?? []).map((theme) => theme.key)), [payload?.availableThemes]);
  const selectedFrame = withFrameMotion(ALL_FRAMES.find((frame) => frame.key === selectedFrameKey) ?? payload?.loadout.profileFrame ?? null, animationEnabled);
  const selectedTheme = ALL_THEMES.find((theme) => theme.key === selectedThemeKey) ?? payload?.loadout.themeBanner ?? null;
  const limits = payload?.limits ?? payload?.loadout.limits ?? { planKey, maxShowcaseBadges: 3, animationsAllowed: false };
  const selectedCount = selectedBadgeCodes.length;
  const changed = Boolean(payload && (
    selectedFrameKey !== payload.loadout.profileFrameKey ||
    selectedThemeKey !== payload.loadout.themeBannerKey ||
    animationEnabled !== payload.loadout.animationEnabled ||
    JSON.stringify(selectedBadgeCodes) !== JSON.stringify(payload.loadout.showcaseBadgeCodes)
  ));
  const planLabel = formatPlan(limits.planKey || planKey);

  function toggleBadge(code: string) {
    if (!availableBadgeCodes.has(code)) return;
    setSelectedBadgeCodes((current) => {
      if (current.includes(code)) return current.filter((item) => item !== code);
      if (current.length >= limits.maxShowcaseBadges) return current;
      return [...current, code];
    });
  }

  async function saveLoadout() {
    if (!payload) return;
    saveProgress.start("Validating visual loadout...", 15);
    setMessage(null);
    setError(null);
    try {
      saveProgress.setStage("saving", "Saving visual loadout...", 35);
      const next = await putLoadout(serverId, {
        showcaseBadges: selectedBadgeCodes,
        profileFrameKey: selectedFrameKey,
        themeBannerKey: selectedThemeKey,
        animationEnabled,
      });
      saveProgress.setStage("refreshing", "Refreshing visual preview...", 70);
      applyPayload(next);
      setPayload(next);
      setMessage(next.message ?? "Server visual loadout saved.");
      saveProgress.complete("Saved");
    } catch (caught) {
      const details = apiErrorDetails(caught, "Unable to save visual loadout.");
      setError(details.message);
      saveProgress.fail(details.message);
    }
  }

  return (
    <section id="visual-loadout" className="glass-surface animated-border mt-5 rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-400/12 text-cyan-100"><Sparkles className="h-5 w-5" /></span>
              <div>
                <h2 className="text-xl font-black text-white">Server Visual Loadout</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-300">Choose the earned badges, frame, and theme shown on your public presentation.</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-xs font-bold text-zinc-300">
            {planLabel}: {selectedCount}/{limits.maxShowcaseBadges} showcase slots
          </div>
        </div>

        {loading ? <p className="mt-4 text-sm font-bold text-zinc-400">Loading visual loadout...</p> : null}
        {loadError ? <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-bold text-amber-50">{loadError.message}</p> : null}
        {message || error ? (
          <p aria-live="polite" className={`mt-4 rounded-lg border p-3 text-sm font-bold ${error ? "border-red-300/25 bg-red-400/10 text-red-50" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"}`}>
            {error ?? message}
          </p>
        ) : null}

        {payload ? (
          <>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid gap-3">
                <PreviewCard title="Current public card preview">
                  <div className="rounded-lg border border-white/10 bg-[#050813] p-3">
                    <ServerThemeBanner theme={selectedTheme}>
                      <div className="min-h-[132px] p-4">
                        <div className="flex items-start gap-3">
                          <ServerProfileFrame frame={selectedFrame} compact>
                            <div className="grid h-14 w-14 place-items-center rounded-lg bg-black/50 text-lg font-black text-white">{serverInitials(serverName)}</div>
                          </ServerProfileFrame>
                          <div className="min-w-0">
                            <p className="truncate text-base font-black text-white">{serverName}</p>
                            <p className="mt-1 text-[11px] font-black uppercase text-cyan-100">{selectedTheme?.label ?? "Default"} theme</p>
                            <ServerCardBadges badges={selectedBadges} max={limits.maxShowcaseBadges} className="mt-3" />
                          </div>
                        </div>
                      </div>
                    </ServerThemeBanner>
                  </div>
                </PreviewCard>

                <PreviewCard title="Current profile header preview">
                  <ServerThemeBanner theme={selectedTheme}>
                    <div className="flex min-h-[154px] items-end justify-between gap-4 p-5">
                      <div className="flex min-w-0 items-end gap-4">
                        <ServerProfileFrame frame={selectedFrame}>
                          <div className="grid h-20 w-20 place-items-center rounded-xl bg-black/56 text-2xl font-black text-white">{serverInitials(serverName)}</div>
                        </ServerProfileFrame>
                        <div className="min-w-0 pb-1">
                          <p className="truncate text-2xl font-black text-white">{serverName}</p>
                          <p className="mt-1 text-xs font-black uppercase text-zinc-300">{selectedFrame?.label ?? "Default frame"} / {selectedTheme?.label ?? "Default theme"}</p>
                        </div>
                      </div>
                    </div>
                  </ServerThemeBanner>
                </PreviewCard>
              </div>

              <div className="grid gap-4">
                <SelectorPanel title="Showcase badge selector" helper={`${selectedCount}/${limits.maxShowcaseBadges} selected. Only earned badges can be selected; locked crowns, founder rewards, and seasonal wins are previews until awarded.`}>
                  <div className="grid max-h-[230px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {(payload.availableShowcaseBadges.length ? payload.availableShowcaseBadges : []).map((badge) => {
                      const selected = selectedBadgeCodes.includes(badge.code);
                      const disabled = !selected && selectedBadgeCodes.length >= limits.maxShowcaseBadges;
                      return (
                        <button
                          key={badge.code}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleBadge(badge.code)}
                          className={`flex min-w-0 items-center gap-2 rounded-lg border p-2 text-left transition ${selected ? "border-cyan-300/45 bg-cyan-400/12" : "border-white/10 bg-black/24 hover:border-white/20"} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <BadgeIcon badge={withBadgeMotion(badge, animationEnabled)} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-black text-white">{badge.name}</span>
                            <span className="block truncate text-[10px] font-bold uppercase text-zinc-500">{badge.rarity} / earned</span>
                          </span>
                        </button>
                      );
                    })}
                    {LOCKED_BADGE_PREVIEWS.filter((badge) => !availableBadgeCodes.has(badge.code)).map((badge) => (
                      <button key={badge.code} type="button" disabled className="flex min-w-0 cursor-not-allowed items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2 text-left opacity-55">
                        <BadgeIcon badge={badge} size="sm" locked />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-black text-white">{badge.name}</span>
                          <span className="block truncate text-[10px] font-bold uppercase text-zinc-500">Locked reward</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {!payload.availableShowcaseBadges.length ? <p className="text-xs font-bold text-zinc-400">Earn badges through activity, reputation, events, and admin-awarded milestones before selecting a showcase.</p> : null}
                </SelectorPanel>

                <div className="grid gap-4 lg:grid-cols-2">
                  <SelectorPanel title="Frame selector" helper="Unavailable frames stay locked by plan or earned status.">
                    <div className="grid max-h-[210px] gap-2 overflow-y-auto pr-1">
                      {ALL_FRAMES.map((frame) => {
                        const available = availableFrameKeys.has(frame.key);
                        return (
                          <VisualChoiceButton
                            key={frame.key}
                            active={selectedFrameKey === frame.key}
                            locked={!available}
                            title={frame.label}
                            meta={available ? frame.eligibility : frame.key === "premium" || frame.eligibility === "plan" ? "Premium locked" : "Locked"}
                            onClick={() => available && setSelectedFrameKey(frame.key)}
                            preview={<ServerProfileFrame frame={withFrameMotion(frame, animationEnabled)} compact><span className="block h-8 w-8 rounded-md bg-white/10" /></ServerProfileFrame>}
                          />
                        );
                      })}
                    </div>
                  </SelectorPanel>

                  <SelectorPanel title="Theme selector" helper="Standard themes unlock on Pro. Premium unlocks all themes.">
                    <div className="grid max-h-[210px] gap-2 overflow-y-auto pr-1">
                      {ALL_THEMES.map((theme) => {
                        const available = availableThemeKeys.has(theme.key);
                        return (
                          <VisualChoiceButton
                            key={theme.key}
                            active={selectedThemeKey === theme.key}
                            locked={!available}
                            title={theme.label}
                            meta={available ? "Available" : premiumThemeLockedLabel(theme.key)}
                            onClick={() => available && setSelectedThemeKey(theme.key)}
                            preview={<span className="h-9 w-14 rounded-md border border-white/10" style={{ background: theme.fallbackGradient }} />}
                          />
                        );
                      })}
                    </div>
                  </SelectorPanel>
                </div>

                <SelectorPanel title="Animation level selector" helper="Animations respect reduced-motion preferences. Premium unlocks animated frames and visuals.">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => setAnimationEnabled(false)} className={`rounded-lg border p-3 text-left ${!animationEnabled ? "border-cyan-300/45 bg-cyan-400/12" : "border-white/10 bg-black/24"}`}>
                      <span className="text-sm font-black text-white">Static</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-400">Use still assets and subtle styling.</span>
                    </button>
                    <button type="button" disabled={!limits.animationsAllowed} onClick={() => setAnimationEnabled(true)} className={`rounded-lg border p-3 text-left ${animationEnabled ? "border-violet-300/45 bg-violet-400/12" : "border-white/10 bg-black/24"} disabled:cursor-not-allowed disabled:opacity-50`}>
                      <span className="inline-flex items-center gap-2 text-sm font-black text-white">{!limits.animationsAllowed ? <LockKeyhole className="h-4 w-4" /> : null} Animated</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-400">Premium animated frames, badge motion, and glow treatment.</span>
                    </button>
                  </div>
                </SelectorPanel>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-white/10 bg-black/24 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid gap-1 text-sm font-bold text-zinc-300">
                <span>{planLabel} can display {limits.maxShowcaseBadges} showcase badges. You are using {selectedCount} slot{selectedCount === 1 ? "" : "s"}.</span>
                {limits.planKey !== "premium" ? <span className="text-amber-100">Premium unlocks 8 slots, animated frames, all theme banners, and full visual loadout benefits. Earned competitive badges still cannot be faked.</span> : <span className="text-cyan-100">Premium visual loadout unlocked: 8 slots, animations, premium frames, premium themes, and stronger public presentation.</span>}
              </div>
              <SaveProgressButton
                idleLabel="Save Visual Loadout"
                savingLabel="Saving Loadout..."
                refreshingLabel="Refreshing Preview..."
                successLabel="Saved"
                errorLabel="Retry Save"
                state={saveProgress.state}
                disabled={!changed}
                onClick={saveLoadout}
                icon={<Save className="h-4 w-4" />}
                buttonClassName="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-55"
              />
            </div>
          </>
        ) : null}
      </div>
    </section>
  );

  function applyPayload(data: VisualLoadoutResponse) {
    setSelectedBadgeCodes(data.loadout.showcaseBadgeCodes);
    setSelectedFrameKey(data.loadout.profileFrameKey);
    setSelectedThemeKey(data.loadout.themeBannerKey);
    setAnimationEnabled(data.loadout.animationEnabled);
    setError(null);
  }
}

function SelectorPanel({ title, helper, children }: { title: string; helper: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <p className="text-sm font-black text-white">{title}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-400">{helper}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function PreviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <p className="mb-3 text-xs font-black uppercase text-zinc-400">{title}</p>
      {children}
    </div>
  );
}

function VisualChoiceButton({ active, locked, title, meta, preview, onClick }: { active: boolean; locked: boolean; title: string; meta: string; preview: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      className={`flex min-w-0 items-center gap-3 rounded-lg border p-2 text-left transition ${active ? "border-violet-300/45 bg-violet-400/12" : "border-white/10 bg-black/24 hover:border-white/20"} ${locked ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span className="grid h-11 w-16 shrink-0 place-items-center overflow-hidden rounded-md bg-black/20">{preview}</span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-black text-white">{title}</span>
        <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] font-bold uppercase text-zinc-500">{locked ? <LockKeyhole className="h-3 w-3" /> : null}{meta}</span>
      </span>
    </button>
  );
}

async function fetchLoadout(serverId: string) {
  const endpoint = `/api/servers/${encodeURIComponent(serverId)}/visual-loadout`;
  const response = await fetch(endpoint, { cache: "no-store", credentials: "include", headers: { accept: "application/json" } });
  return readApiResponse<VisualLoadoutResponse>(response, "Visual loadout is temporarily unavailable.");
}

async function putLoadout(serverId: string, body: unknown) {
  const endpoint = `/api/servers/${encodeURIComponent(serverId)}/visual-loadout`;
  const response = await fetch(endpoint, {
    method: "PUT",
    cache: "no-store",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  return readApiResponse<VisualLoadoutResponse>(response, "Unable to save visual loadout.");
}

class VisualLoadoutRequestError extends Error {
  details: ApiErrorDetails;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = "VisualLoadoutRequestError";
    this.details = details;
  }
}

async function readApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
    throw new VisualLoadoutRequestError({
      message: stringOrNull(body.message) ?? fallbackMessage,
      errorCode: stringOrNull(body.errorCode) ?? stringOrNull(body.error),
      status: response.status,
    });
  }
  return data as T;
}

function apiErrorDetails(error: unknown, fallbackMessage: string): ApiErrorDetails {
  if (error instanceof VisualLoadoutRequestError) return error.details;
  return {
    message: error instanceof Error ? error.message : fallbackMessage,
    errorCode: null,
    status: null,
  };
}

function withBadgeMotion(badge: VisualBadge, enabled: boolean): VisualBadge {
  return enabled ? badge : { ...badge, animationType: "none", animatedIconUrl: badge.staticIconUrl };
}

function withFrameMotion(frame: ProfileFrameVisual | null | undefined, enabled: boolean): ProfileFrameVisual | null {
  if (!frame) return null;
  return enabled ? frame : { ...frame, isAnimated: false, animationType: "none" as BadgeAnimationType, animatedImageOverlayUrl: frame.imageOverlayUrl };
}

function lockedBadge(key: string, name: string, category: string, description: string) {
  return toVisualBadge({ key, name, category, description, permanent: true }, { locked: true });
}

function premiumThemeLockedLabel(key: string) {
  return ["space", "neon_city", "toxic_zone"].includes(key) ? "Premium locked" : "Plan locked";
}

function serverInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return initials || "DZN";
}

function formatPlan(value: string) {
  if (!value) return "Starter";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
