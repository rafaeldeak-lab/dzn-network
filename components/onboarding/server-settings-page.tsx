"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
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
  Send,
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
import { SaveProgressButton, useSaveProgress } from "./save-progress";
import type { LinkedServer } from "./types";
import { VisualLoadoutSection } from "./visual-loadout-section";

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
    discordConnected?: boolean;
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
    policy_group: "trial_free" | "pro_premium";
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
  discordEventChannels?: {
    selected: Record<EventChannelType, EventChannelSummary | null> | null;
    liveScoreboardReady: boolean;
    defaultReady: boolean;
  };
  setupPageUrl: string;
  publicPageUrl: string;
};

type SaveState = {
  area: "category" | "tags" | "listing" | "discord" | null;
  message: string | null;
  error: string | null;
};

type ApiErrorDetails = {
  message: string;
  endpoint: string;
  status: number | null;
  errorCode: string | null;
  requestId: string | null;
};

type EventChannelType = "default_event" | "event_announcements" | "event_live_scoreboard" | "event_results";

type EventChannelSummary = {
  channelId: string;
  channelName: string | null;
  channelType: string;
  valid: boolean;
  missingPermissions: string[];
};

type DiscordEventChannelOption = {
  id: string;
  name: string;
  type: string;
  canSelect: boolean;
  botCanView: boolean;
  botCanSend: boolean;
  botCanEmbed: boolean;
  botCanReadHistory: boolean;
  missingPermissions: string[];
};

type DiscordEventChannelsResponse = {
  ok: boolean;
  source?: "live" | "cached";
  warning?: string;
  guildId?: string | null;
  guildName?: string | null;
  channels: DiscordEventChannelOption[];
  selected?: Record<EventChannelType, EventChannelSummary | null>;
  error?: string;
  errorCode?: string;
  message?: string;
};

type VisibilityCompleteness = {
  percent: number;
  completed: number;
  total: number;
  items: Array<{
    key: string;
    label: string;
    complete: boolean;
    action: string;
  }>;
};

type VisibilityStatusResponse = {
  ok: true;
  planKey: string;
  visibilityTier: "standard" | "enhanced" | "premium";
  visibilityWeight: number;
  discoveryScore: number;
  isFeaturedEligible: boolean;
  isSpotlightEligible: boolean;
  visibilityExplanation: {
    summary: string;
    factors: string[];
    fairness: string;
  };
  profileCompleteness: VisibilityCompleteness;
  visualLoadoutCompleteness: VisibilityCompleteness;
  badgeShowcaseCompleteness: VisibilityCompleteness;
  recommendedActions: string[];
  upgradeBenefits: string[];
};

type PromotionType = "directory_bump" | "featured_rotation" | "spotlight_boost" | "seasonal_push";

type PromotionTypeStatus = {
  promotionType: PromotionType;
  label: string;
  allowed: boolean;
  reason: string | null;
  durationHours: number;
};

type ActivePromotion = {
  id: string;
  promotionType: PromotionType;
  status: string;
  startsAt: string;
  endsAt: string;
  label: string;
};

type PromotionStatusResponse = {
  ok: true;
  planKey: string;
  creditsAvailable: number;
  creditsUsed: number;
  periodStart: string;
  periodEnd: string;
  activePromotions: ActivePromotion[];
  availablePromotionTypes: PromotionTypeStatus[];
  lockedPromotionTypes: PromotionTypeStatus[];
  promotionBenefits: string[];
  upgradeBenefits: string[];
  message?: string;
};

type PromotionAnalyticsEvent = {
  id: string;
  type: "impression" | "click";
  source: string;
  promotionId: string | null;
  occurredAt: string;
};

type PromotionAnalyticsResponse = {
  ok: true;
  impressionsLast7Days: number;
  clicksLast7Days: number;
  activePromotionCount: number;
  creditsUsedThisPeriod: number;
  estimatedVisibilityLift: number;
  recentPromotionEvents: PromotionAnalyticsEvent[];
};

type PromotionActionState = {
  promotionType: PromotionType | null;
  busy: boolean;
  message: string | null;
  error: string | null;
};

const ADVANCED_EVENT_CHANNEL_TYPES: EventChannelType[] = ["event_announcements", "event_live_scoreboard", "event_results"];

const CATEGORY_ICON: Record<CategoryValue, React.ReactNode> = {
  pvp: <Swords className="h-5 w-5" />,
  deathmatch: <Skull className="h-5 w-5" />,
  pve: <ShieldCheck className="h-5 w-5" />,
  pvp_pve: <Gamepad2 className="h-5 w-5" />,
};

const EVENT_CHANNEL_FIELDS: Array<{ key: EventChannelType; inputKey: string; label: string; description: string }> = [
  {
    key: "default_event",
    inputKey: "defaultEventChannelId",
    label: "Primary Event Channel",
    description: "Recommended. DZN will use this channel for all event announcements, live scoreboards, and final results unless you choose advanced channels below.",
  },
  {
    key: "event_announcements",
    inputKey: "eventAnnouncementsChannelId",
    label: "Announcement Channel Optional",
    description: "Overrides the primary channel for event entries, tournament starts, bracket updates, and event announcements.",
  },
  {
    key: "event_live_scoreboard",
    inputKey: "eventLiveScoreboardChannelId",
    label: "Live Scoreboard Channel Optional",
    description: "Overrides the primary channel for live matchup scoreboards, phase progress, and midpoint updates.",
  },
  {
    key: "event_results",
    inputKey: "eventResultsChannelId",
    label: "Results Channel Optional",
    description: "Overrides the primary channel for final matchup results, champions, and tournament reports.",
  },
];

export function ServerSettingsPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [servers, setServers] = useState<LinkedServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [settingsLoadError, setSettingsLoadError] = useState<ApiErrorDetails | null>(null);
  const [settingsReloadNonce, setSettingsReloadNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ area: null, message: null, error: null });
  const [selectedCategory, setSelectedCategory] = useState<CategoryValue | "">("");
  const [confirmingCategory, setConfirmingCategory] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ListingVisibility>("public");
  const [discordChannels, setDiscordChannels] = useState<DiscordEventChannelsResponse | null>(null);
  const [discordChannelsLoading, setDiscordChannelsLoading] = useState(false);
  const [visibilityStatus, setVisibilityStatus] = useState<VisibilityStatusResponse | null>(null);
  const [visibilityStatusLoading, setVisibilityStatusLoading] = useState(false);
  const [visibilityStatusError, setVisibilityStatusError] = useState<string | null>(null);
  const [promotionStatus, setPromotionStatus] = useState<PromotionStatusResponse | null>(null);
  const [promotionStatusLoading, setPromotionStatusLoading] = useState(false);
  const [promotionStatusError, setPromotionStatusError] = useState<string | null>(null);
  const [promotionAnalytics, setPromotionAnalytics] = useState<PromotionAnalyticsResponse | null>(null);
  const [promotionAnalyticsLoading, setPromotionAnalyticsLoading] = useState(false);
  const [promotionAnalyticsError, setPromotionAnalyticsError] = useState<string | null>(null);
  const [promotionAction, setPromotionAction] = useState<PromotionActionState>({ promotionType: null, busy: false, message: null, error: null });
  const [advancedRoutingOpen, setAdvancedRoutingOpen] = useState(false);
  const [eventChannelIds, setEventChannelIds] = useState<Record<EventChannelType, string>>({
    default_event: "",
    event_announcements: "",
    event_live_scoreboard: "",
    event_results: "",
  });
  const categoryProgress = useSaveProgress();
  const tagsProgress = useSaveProgress();
  const descriptionProgress = useSaveProgress();
  const visibilityProgress = useSaveProgress();
  const discordSaveProgress = useSaveProgress();
  const discordTestProgress = useSaveProgress();

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
    const endpoint = `/api/servers/${encodeURIComponent(selectedServerId)}/settings`;
    fetch(`/api/servers/${encodeURIComponent(selectedServerId)}/settings`, {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => readApiResponse<SettingsResponse>(response, endpoint, "Server settings are temporarily unavailable. Please retry."))
      .then((data) => {
        if (!active) return;
        setSettings(data);
        setSettingsLoadError(null);
        setSelectedCategory(data.server.currentCategory ?? "");
        setSelectedTags(data.currentTags);
        setDescription(data.server.description ?? "");
        setVisibility(data.server.visibility);
        setEventChannelIds(channelIdsFromSettings(data));
        setSaveState({ area: null, message: null, error: null });
      })
      .catch((error) => {
        if (!active) return;
        const details = apiErrorDetails(error, endpoint, "Server settings are temporarily unavailable. Please retry.");
        setSettingsLoadError(details);
        setSaveState({ area: null, message: null, error: details.message });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedServerId, settingsReloadNonce]);

  useEffect(() => {
    if (!settings) return;
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, "");
    const focus = params.get("focus") || hash;
    if (focus === "category" || focus === "discord-event-channels") {
      window.requestAnimationFrame(() => document.getElementById(focus)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    void refreshDiscordEventChannels(settings.server.id, false);
    // The refresh helper intentionally reads the current selected server state; this effect is only keyed to the loaded server id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.server.id]);

  useEffect(() => {
    if (!settings?.server.id) return;
    const timer = window.setTimeout(() => void refreshVisibilityStatus(settings.server.id), 0);
    return () => {
      window.clearTimeout(timer);
    };
    // The refresh helper intentionally reads the current selected server state; this effect is only keyed to the loaded server id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.server.id]);

  useEffect(() => {
    if (!settings?.server.id) return;
    const timer = window.setTimeout(() => void refreshPromotionStatus(settings.server.id), 0);
    return () => {
      window.clearTimeout(timer);
    };
    // The refresh helper intentionally reads the current selected server state; this effect is only keyed to the loaded server id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.server.id]);

  useEffect(() => {
    if (!settings?.server.id) return;
    const timer = window.setTimeout(() => void refreshPromotionAnalytics(settings.server.id), 0);
    return () => {
      window.clearTimeout(timer);
    };
    // The refresh helper intentionally reads the current selected server state; this effect is only keyed to the loaded server id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.server.id]);

  const selectedServer = useMemo(() => servers.find((server) => server.id === selectedServerId) ?? null, [servers, selectedServerId]);
  const selectedCategoryOption = settings?.availableCategories.find((category) => category.value === selectedCategory) ?? null;
  const categoryChanged = Boolean(settings && selectedCategory && selectedCategory !== settings.server.currentCategory);
  const descriptionChanged = Boolean(settings && description !== (settings.server.description ?? ""));
  const visibilityChanged = Boolean(settings && visibility !== settings.server.visibility);
  const tagsChanged = Boolean(settings && JSON.stringify(selectedTags) !== JSON.stringify(settings.currentTags));
  const discordChanged = Boolean(settings && JSON.stringify(eventChannelIds) !== JSON.stringify(channelIdsFromSettings(settings)));

  async function saveCategory() {
    if (!settings || !selectedCategory) return;
    categoryProgress.start("Validating category change...", 15);
    setSaveState({ area: null, message: null, error: null });
    try {
      categoryProgress.setStage("saving", "Saving category...", 35);
      const result = await postJson(`/api/servers/${encodeURIComponent(settings.server.id)}/settings/category`, { category: selectedCategory });
      categoryProgress.setStage("refreshing", "Refreshing category status...", 70);
      await reloadSettings(settings.server.id);
      setSaveState({ area: null, message: result.message ?? "Category updated.", error: null });
      setConfirmingCategory(false);
      categoryProgress.complete("Saved");
    } catch (error) {
      const message = safeErrorMessage(error, "Unable to save category.");
      setSaveState({ area: null, message: null, error: message });
      categoryProgress.fail(message);
    }
  }

  async function saveTags() {
    if (!settings) return;
    tagsProgress.start("Validating tags...", 15);
    setSaveState({ area: null, message: null, error: null });
    try {
      tagsProgress.setStage("saving", "Saving tags...", 35);
      const result = await postJson(`/api/servers/${encodeURIComponent(settings.server.id)}/settings/tags`, { tags: selectedTags });
      tagsProgress.setStage("refreshing", "Refreshing saved tags...", 70);
      await reloadSettings(settings.server.id);
      setSaveState({ area: null, message: result.message ?? "Tags updated.", error: null });
      tagsProgress.complete("Saved");
    } catch (error) {
      const message = safeErrorMessage(error, "Unable to save tags.");
      setSaveState({ area: null, message: null, error: message });
      tagsProgress.fail(message);
    }
  }

  async function saveListing(kind: "description" | "visibility") {
    if (!settings) return;
    const progress = kind === "description" ? descriptionProgress : visibilityProgress;
    progress.start(kind === "description" ? "Validating description..." : "Validating visibility...", 15);
    setSaveState({ area: null, message: null, error: null });
    try {
      progress.setStage("saving", kind === "description" ? "Saving public description..." : "Saving listing visibility...", 35);
      const result = await postJson(`/api/servers/${encodeURIComponent(settings.server.id)}/settings/listing`, { description, visibility });
      progress.setStage("refreshing", "Refreshing public listing status...", 70);
      await reloadSettings(settings.server.id);
      const fallback = kind === "visibility"
        ? visibility === "hidden"
          ? "Server hidden from public listings."
          : "Public listing updated."
        : "Public description updated.";
      setSaveState({ area: null, message: result.message ?? fallback, error: null });
      progress.complete("Saved");
    } catch (error) {
      const message = safeErrorMessage(error, "Unable to save listing.");
      setSaveState({ area: null, message: null, error: message });
      progress.fail(message);
    }
  }

  async function reloadSettings(serverId: string) {
    const endpoint = `/api/servers/${encodeURIComponent(serverId)}/settings`;
    const response = await fetch(endpoint, {
      cache: "no-store",
      credentials: "include",
    });
    const next = await readApiResponse<SettingsResponse>(response, endpoint, "Server settings are temporarily unavailable. Please retry.");
    setSettingsLoadError(null);
    setSettings(next);
    setSelectedCategory(next.server.currentCategory ?? "");
    setSelectedTags(next.currentTags);
    setDescription(next.server.description ?? "");
    setVisibility(next.server.visibility);
    setEventChannelIds(channelIdsFromSettings(next));
    void refreshDiscordEventChannels(serverId, false);
  }

  async function refreshDiscordEventChannels(serverId = settings?.server.id ?? selectedServerId, showMessage = true) {
    if (!serverId) return;
    if (discordChannelsLoading) return;
    const endpoint = `/api/servers/${encodeURIComponent(serverId)}/discord/channels`;
    setDiscordChannelsLoading(true);
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const data = await readApiResponse<DiscordEventChannelsResponse>(response, endpoint, "Discord channels could not be loaded right now. Retry in a moment.");
      setDiscordChannels(data as DiscordEventChannelsResponse);
      if (data.selected) setEventChannelIds(channelIdsFromSelected(data.selected));
      if (showMessage) setSaveState({ area: null, message: "Discord channels refreshed.", error: null });
    } catch (error) {
      const details = apiErrorDetails(error, endpoint, "Discord channels could not be loaded right now. Retry in a moment.");
      setDiscordChannels((current) => current ?? { ok: false, channels: [], message: details.message, error: details.errorCode ?? "DISCORD_CHANNELS_UNAVAILABLE", errorCode: details.errorCode ?? "DISCORD_CHANNELS_UNAVAILABLE" });
      if (showMessage) setSaveState({ area: null, message: null, error: details.message });
    } finally {
      setDiscordChannelsLoading(false);
    }
  }

  async function refreshVisibilityStatus(serverId = settings?.server.id ?? selectedServerId) {
    if (!serverId) return;
    const endpoint = `/api/servers/${encodeURIComponent(serverId)}/visibility-status`;
    setVisibilityStatusLoading(true);
    setVisibilityStatusError(null);
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const data = await readApiResponse<VisibilityStatusResponse>(response, endpoint, "Visibility status could not be loaded right now.");
      setVisibilityStatus(data);
    } catch (error) {
      setVisibilityStatusError(safeErrorMessage(error, "Visibility status could not be loaded right now."));
    } finally {
      setVisibilityStatusLoading(false);
    }
  }

  async function refreshPromotionStatus(serverId = settings?.server.id ?? selectedServerId) {
    if (!serverId) return;
    const endpoint = `/api/servers/${encodeURIComponent(serverId)}/promotion-status`;
    setPromotionStatusLoading(true);
    setPromotionStatusError(null);
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const data = await readApiResponse<PromotionStatusResponse>(response, endpoint, "Promotion credits could not be loaded right now.");
      setPromotionStatus(data);
    } catch (error) {
      setPromotionStatusError(safeErrorMessage(error, "Promotion credits could not be loaded right now."));
    } finally {
      setPromotionStatusLoading(false);
    }
  }

  async function refreshPromotionAnalytics(serverId = settings?.server.id ?? selectedServerId) {
    if (!serverId) return;
    const endpoint = `/api/servers/${encodeURIComponent(serverId)}/promotion-analytics`;
    setPromotionAnalyticsLoading(true);
    setPromotionAnalyticsError(null);
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const data = await readApiResponse<PromotionAnalyticsResponse>(response, endpoint, "Promotion results could not be loaded right now.");
      setPromotionAnalytics(data);
    } catch (error) {
      setPromotionAnalyticsError(safeErrorMessage(error, "Promotion results could not be loaded right now."));
    } finally {
      setPromotionAnalyticsLoading(false);
    }
  }

  async function activatePromotionCredit(promotionType: PromotionType) {
    if (!settings || promotionAction.busy) return;
    const endpoint = `/api/servers/${encodeURIComponent(settings.server.id)}/promotions/use-credit`;
    setPromotionAction({ promotionType, busy: true, message: null, error: null });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ promotionType }),
      });
      const data = await readApiResponse<PromotionStatusResponse>(response, endpoint, "Promotion credit could not be used right now.");
      setPromotionStatus(data);
      setPromotionAction({
        promotionType,
        busy: false,
        message: data.message ?? `${promotionTypeLabel(promotionType)} activated.`,
        error: null,
      });
      void refreshVisibilityStatus(settings.server.id);
      void refreshPromotionAnalytics(settings.server.id);
    } catch (error) {
      setPromotionAction({
        promotionType,
        busy: false,
        message: null,
        error: safeErrorMessage(error, "Promotion credit could not be used right now."),
      });
    }
  }

  async function saveDiscordEventChannels() {
    if (!settings) return;
    discordSaveProgress.start("Checking channel permissions...", 15);
    setSaveState({ area: null, message: null, error: null });
    try {
      if (!eventChannelIds.default_event) {
        throw new Error("Choose a Primary Event Channel before saving.");
      }
      const body = EVENT_CHANNEL_FIELDS.reduce<Record<string, string>>((acc, field) => {
        acc[field.inputKey] = eventChannelIds[field.key] || "";
        return acc;
      }, {});
      discordSaveProgress.setStage("saving", "Saving Discord event channel...", 35);
      const result = await postJson(`/api/servers/${encodeURIComponent(settings.server.id)}/settings/discord-channels`, body);
      discordSaveProgress.setStage("refreshing", "Refreshing channel status...", 70);
      await reloadSettings(settings.server.id);
      await refreshDiscordEventChannels(settings.server.id, false);
      setSaveState({ area: null, message: result.message ?? "Discord event channel saved.", error: null });
      discordSaveProgress.complete("Discord event channel saved.");
    } catch (error) {
      const message = safeErrorMessage(error, "Unable to save Discord event channel.");
      setSaveState({ area: null, message: null, error: message });
      discordSaveProgress.fail(message);
    }
  }

  async function testDiscordEventChannel() {
    if (!settings) return;
    discordTestProgress.start("Checking channel permissions...", 15);
    setSaveState({ area: null, message: null, error: null });
    try {
      discordTestProgress.setStage("saving", "Sending test event message...", 35);
      const result = await postJson(`/api/servers/${encodeURIComponent(settings.server.id)}/settings/discord-channels/test`, {
        channelType: "default_event",
      });
      discordTestProgress.complete("Test Sent");
      const channelName = primaryChannelName ?? "the Primary Event Channel";
      setSaveState({ area: null, message: result.message ?? `Test event message sent to ${channelName}.`, error: null });
    } catch (error) {
      const message = safeErrorMessage(error, "DZN could not send a message to this channel. Check View Channel, Send Messages, Embed Links, and Read Message History permissions.");
      setSaveState({ area: null, message: null, error: message });
      discordTestProgress.fail(message);
    }
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

  if (!selectedServerId) {
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
    const loadError = settingsLoadError ?? {
      message: "Server settings are temporarily unavailable.",
      endpoint: selectedServerId ? `/api/servers/${selectedServerId}/settings` : "/api/servers/[serverId]/settings",
      status: null,
      errorCode: null,
      requestId: null,
    };
    return (
      <PageShell onLogout={signOut}>
        <section className="glass-surface animated-border rounded-lg p-6">
          <div className="relative z-10">
            <p className="text-xs font-black uppercase text-red-200/75">Server Settings</p>
            <h1 className="mt-2 text-3xl font-black text-white">Settings unavailable</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">{loadError.message}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setSettingsLoadError(null);
                  setSettingsReloadNonce((value) => value + 1);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
              <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black uppercase text-zinc-100">
                Back to Dashboard
              </Link>
            </div>
            <details className="mt-5 rounded-lg border border-white/10 bg-black/24 p-3 text-xs text-zinc-400">
              <summary className="cursor-pointer font-black uppercase text-zinc-200">Safe debug details</summary>
              <div className="mt-3 grid gap-1 break-all">
                <span>route: /dashboard/server-settings</span>
                <span>serverId: {selectedServerId || "missing"}</span>
                <span>endpoint: {loadError.endpoint}</span>
                <span>status: {loadError.status ?? "unknown"}</span>
                <span>errorCode: {loadError.errorCode ?? "unknown"}</span>
                <span>requestId: {loadError.requestId ?? "not provided"}</span>
              </div>
            </details>
          </div>
        </section>
      </PageShell>
    );
  }

  const categoryLocked = !settings.editState.canEditCategory && categoryChanged;
  const setupUrl = settings.setupPageUrl;
  const advancedRoutingSelected = ADVANCED_EVENT_CHANNEL_TYPES.some((type) => Boolean(eventChannelIds[type]));
  const primaryChannelName = channelDisplayName(discordChannels?.channels ?? [], settings.discordEventChannels?.selected?.default_event ?? null, eventChannelIds.default_event);
  const selectedChannelSummaries = {
    event_announcements: channelDisplayName(discordChannels?.channels ?? [], settings.discordEventChannels?.selected?.event_announcements ?? null, eventChannelIds.event_announcements),
    event_live_scoreboard: channelDisplayName(discordChannels?.channels ?? [], settings.discordEventChannels?.selected?.event_live_scoreboard ?? null, eventChannelIds.event_live_scoreboard),
    event_results: channelDisplayName(discordChannels?.channels ?? [], settings.discordEventChannels?.selected?.event_results ?? null, eventChannelIds.event_results),
  };

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
              setSettings(null);
              setSettingsLoadError(null);
              setSelectedServerId(event.target.value);
            }}
            className="appearance-none bg-transparent pr-8 text-sm font-black text-white outline-none"
          >
            {settings && !selectedServer ? (
              <option value={settings.server.id} className="bg-[#080b16] text-white">
                {settings.server.name}
              </option>
            ) : null}
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

      <VisibilityPromotionPanel
        status={visibilityStatus}
        loading={visibilityStatusLoading}
        error={visibilityStatusError}
        fallbackPlanKey={settings.plan.plan_key}
        onRetry={() => refreshVisibilityStatus(settings.server.id)}
      />

      <PromotionCreditsPanel
        status={promotionStatus}
        loading={promotionStatusLoading}
        error={promotionStatusError}
        analytics={promotionAnalytics}
        analyticsLoading={promotionAnalyticsLoading}
        analyticsError={promotionAnalyticsError}
        fallbackPlanKey={settings.plan.plan_key}
        actionState={promotionAction}
        onRetry={() => {
          void refreshPromotionStatus(settings.server.id);
          void refreshPromotionAnalytics(settings.server.id);
        }}
        onUseCredit={activatePromotionCredit}
      />

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
              disabled={!categoryChanged || categoryLocked || categoryProgress.isBusy}
              onClick={() => setConfirmingCategory(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Save className="h-4 w-4" />
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
              <SaveProgressButton
                idleLabel="Save Tags"
                savingLabel="Saving Tags..."
                refreshingLabel="Refreshing..."
                successLabel="Saved"
                errorLabel="Retry Save"
                state={tagsProgress.state}
                disabled={!tagsChanged || !settings.editState.canEditTags}
                onClick={saveTags}
                icon={<Save className="h-4 w-4" />}
                buttonClassName="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-4 py-3 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-55"
              />
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
            <SaveProgressButton
              idleLabel="Save Description"
              savingLabel="Saving Description..."
              refreshingLabel="Refreshing..."
              successLabel="Saved"
              errorLabel="Retry Save"
              state={descriptionProgress.state}
              disabled={!descriptionChanged || !settings.editState.canEditDescription}
              onClick={() => saveListing("description")}
              icon={<Save className="h-4 w-4" />}
              className="mt-4"
              buttonClassName="inline-flex items-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/10 px-4 py-3 text-xs font-black uppercase text-violet-50 transition hover:border-violet-300/45 disabled:cursor-not-allowed disabled:opacity-55"
            />
          </div>
        </section>
      </div>

      <VisualLoadoutSection key={settings.server.id} serverId={settings.server.id} serverName={settings.server.name} planKey={settings.plan.plan_key} />

      <section id="discord-event-channels" className="glass-surface animated-border mt-5 rounded-lg p-5">
        <div className="relative z-10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <SectionTitle icon={<Bell className="h-5 w-5" />} title="Discord Event Channel" />
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
                Choose where DZN should post event updates for this server.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={discordChannelsLoading}
                onClick={() => refreshDiscordEventChannels(settings.server.id, true)}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 disabled:opacity-55"
              >
                <RefreshCw className={`h-4 w-4 ${discordChannelsLoading ? "animate-spin" : ""}`} />
                Refresh Discord Channels
              </button>
              <SaveProgressButton
                idleLabel="Send Test Event Message"
                savingLabel="Sending Test..."
                refreshingLabel="Sending Test..."
                successLabel="Test Sent"
                errorLabel="Retry Test"
                state={discordTestProgress.state}
                disabled={!eventChannelIds.default_event}
                onClick={testDiscordEventChannel}
                icon={<Send className="h-4 w-4" />}
                buttonClassName="inline-flex items-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/10 px-3 py-2 text-xs font-black uppercase text-violet-50 disabled:opacity-55"
              />
            </div>
          </div>

          {discordChannels?.ok === false ? (
            <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/10 p-4">
              <p className="text-sm font-black text-amber-50">{discordChannels.message ?? "Discord channels are not ready."}</p>
              <p className="mt-2 text-sm leading-6 text-amber-100/85">{discordChannelHelpCopy(discordChannels.error)}</p>
              <Link href="/setup" className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-200/25 bg-amber-300/12 px-3 py-2 text-xs font-black uppercase text-amber-50">
                Open Setup
              </Link>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4">
            {renderEventChannelSelect(EVENT_CHANNEL_FIELDS[0], {
              channels: discordChannels?.channels ?? [],
              selectedId: eventChannelIds.default_event,
              primarySelected: Boolean(eventChannelIds.default_event),
              highlighted: true,
              onChange: (value) => setEventChannelIds((current) => ({ ...current, default_event: value })),
            })}

            {eventChannelIds.default_event ? (
              <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-4">
                {!advancedRoutingSelected ? (
                  <p className="text-sm font-bold text-cyan-50">All event posts will use {primaryChannelName ?? "the Primary Event Channel"}.</p>
                ) : (
                  <div className="grid gap-2 text-sm font-bold text-cyan-50">
                    <p>Advanced routing enabled.</p>
                    <p>Announcements: {selectedChannelSummaries.event_announcements ?? "Uses Primary Event Channel"}</p>
                    <p>Live scoreboards: {selectedChannelSummaries.event_live_scoreboard ?? "Uses Primary Event Channel"}</p>
                    <p>Results: {selectedChannelSummaries.event_results ?? "Uses Primary Event Channel"}</p>
                  </div>
                )}
              </div>
            ) : null}

            <details
              className="rounded-lg border border-white/10 bg-black/24 p-4"
              onToggle={(event) => setAdvancedRoutingOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-black text-white">Advanced channel routing</summary>
              <p className="mt-2 text-xs leading-5 text-zinc-400">Optional. Send announcements, live scoreboards, and results to different channels.</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {EVENT_CHANNEL_FIELDS.slice(1).map((field) => renderEventChannelSelect(field, {
                  channels: discordChannels?.channels ?? [],
                  selectedId: eventChannelIds[field.key],
                  primarySelected: Boolean(eventChannelIds.default_event),
                  highlighted: false,
                  onChange: (value) => setEventChannelIds((current) => ({ ...current, [field.key]: value })),
                }))}
              </div>
            </details>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SaveProgressButton
              idleLabel={advancedRoutingOpen || advancedRoutingSelected ? "Save Discord Event Channels" : "Save Discord Event Channel"}
              savingLabel="Saving Channel..."
              refreshingLabel="Refreshing..."
              successLabel="Saved"
              errorLabel="Retry Save"
              state={discordSaveProgress.state}
              disabled={!discordChanged}
              onClick={saveDiscordEventChannels}
              icon={<Save className="h-4 w-4" />}
              buttonClassName="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-55"
            />
            <span className="text-xs font-bold text-zinc-400">
              Required bot permissions: View Channel, Send Messages, Embed Links, Read Message History.
            </span>
          </div>
        </div>
      </section>

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
            <SaveProgressButton
              idleLabel="Save Visibility"
              savingLabel="Saving Visibility..."
              refreshingLabel="Refreshing..."
              successLabel="Saved"
              errorLabel="Retry Save"
              state={visibilityProgress.state}
              disabled={!visibilityChanged || !settings.editState.canEditVisibility}
              onClick={() => saveListing("visibility")}
              icon={<Save className="h-4 w-4" />}
              className="mt-4"
              buttonClassName="inline-flex items-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-4 py-3 text-xs font-black uppercase text-emerald-50 transition hover:border-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-55"
            />
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
              <SaveProgressButton
                idleLabel="Confirm Category Change"
                savingLabel="Saving Category..."
                refreshingLabel="Refreshing..."
                successLabel="Saved"
                errorLabel="Retry Save"
                state={categoryProgress.state}
                onClick={saveCategory}
                icon={<CheckCircle2 className="h-4 w-4" />}
                buttonClassName="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-55"
              />
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

function VisibilityPromotionPanel({
  status,
  loading,
  error,
  fallbackPlanKey,
  onRetry,
}: {
  status: VisibilityStatusResponse | null;
  loading: boolean;
  error: string | null;
  fallbackPlanKey: string;
  onRetry: () => void;
}) {
  const planKey = status?.planKey ?? fallbackPlanKey;
  const upgradeBenefits = status?.upgradeBenefits ?? [];

  return (
    <section className="glass-surface animated-border mt-5 rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<Eye className="h-5 w-5" />} title="Server Visibility & Promotion" />
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
              See how this server appears in discovery, featured placement, recommendations, and spotlight surfaces.
            </p>
            <p className="mt-2 text-xs font-bold text-zinc-500">
              Discovery and promotion only. Competitive leaderboard rankings are unchanged.
            </p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 disabled:opacity-55"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {loading && !status ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/24 p-4 text-sm font-bold text-zinc-300">
            Loading visibility status...
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/10 p-4">
            <p className="text-sm font-black text-amber-50">{error}</p>
            <p className="mt-2 text-sm leading-6 text-amber-100/85">Server settings remain available. Retry visibility status when ready.</p>
          </div>
        ) : null}

        {status ? (
          <div className="mt-5 grid gap-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <InfoRow label="Current plan" value={formatPlan(planKey)} />
              <InfoRow label="Visibility tier" value={formatVisibilityTier(status.visibilityTier)} />
              <InfoRow label="Discovery score" value={status.discoveryScore.toLocaleString("en-GB")} />
              <InfoRow label="Visibility weight" value={status.visibilityWeight} />
            </div>

            <div className="flex flex-wrap gap-2">
              <StatusChip tone={status.isFeaturedEligible ? "emerald" : "zinc"} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
                {status.isFeaturedEligible ? "Featured Eligible" : "Not Featured Eligible"}
              </StatusChip>
              <StatusChip tone={status.isSpotlightEligible ? "violet" : "zinc"} icon={<Eye className="h-3.5 w-3.5" />}>
                {status.isSpotlightEligible ? "Spotlight Eligible" : "Not Spotlight Eligible"}
              </StatusChip>
              <StatusChip tone="cyan" icon={<Globe2 className="h-3.5 w-3.5" />}>
                {status.visibilityExplanation.summary}
              </StatusChip>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <CompletenessMeter title="Profile completeness" status={status.profileCompleteness} />
              <CompletenessMeter title="Visual loadout completeness" status={status.visualLoadoutCompleteness} />
              <CompletenessMeter title="Badge showcase completeness" status={status.badgeShowcaseCompleteness} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/24 p-4">
                <p className="text-xs font-black uppercase text-zinc-300">Recommended actions</p>
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-zinc-300">
                  {status.recommendedActions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-cyan-200" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={`rounded-lg border p-4 ${upgradeBenefits.length ? "border-violet-300/20 bg-violet-400/10" : "border-emerald-300/20 bg-emerald-400/10"}`}>
                <p className="text-xs font-black uppercase text-zinc-200">{upgradeBenefits.length ? "Upgrade benefits" : "Premium visibility active"}</p>
                {upgradeBenefits.length ? (
                  <ul className="mt-3 grid gap-2 text-sm leading-6 text-violet-50">
                    {upgradeBenefits.map((benefit) => (
                      <li key={benefit} className="flex gap-2">
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-violet-100" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-emerald-50">
                    Premium discovery and spotlight eligibility are active. No upgrade needed.
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs leading-5 text-zinc-500">{status.visibilityExplanation.fairness}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PromotionCreditsPanel({
  status,
  loading,
  error,
  analytics,
  analyticsLoading,
  analyticsError,
  fallbackPlanKey,
  actionState,
  onRetry,
  onUseCredit,
}: {
  status: PromotionStatusResponse | null;
  loading: boolean;
  error: string | null;
  analytics: PromotionAnalyticsResponse | null;
  analyticsLoading: boolean;
  analyticsError: string | null;
  fallbackPlanKey: string;
  actionState: PromotionActionState;
  onRetry: () => void;
  onUseCredit: (promotionType: PromotionType) => void;
}) {
  const planKey = status?.planKey ?? fallbackPlanKey;
  const upgradeBenefits = status?.upgradeBenefits ?? [];
  const creditsAvailable = status?.creditsAvailable ?? 0;
  const activeTypes = new Set((status?.activePromotions ?? []).map((promotion) => promotion.promotionType));
  const promotionTypes = [
    ...(status?.availablePromotionTypes ?? []),
    ...(status?.lockedPromotionTypes ?? []),
  ];

  return (
    <section className="glass-surface animated-border mt-5 rounded-lg p-5">
      <div className="relative z-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <SectionTitle icon={<ArrowRight className="h-5 w-5" />} title="Server Promotion Credits" />
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
              Use monthly credits to refresh discovery placement, featured rotation, and Premium spotlight promotion.
            </p>
            <p className="mt-2 text-xs font-bold text-zinc-500">
              Promotions affect discovery and visibility only. They do not change competitive leaderboard rankings.
            </p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            disabled={loading || actionState.busy}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase text-cyan-50 disabled:opacity-55"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {loading && !status ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/24 p-4 text-sm font-bold text-zinc-300">
            Loading promotion credits...
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-400/10 p-4">
            <p className="text-sm font-black text-amber-50">{error}</p>
            <p className="mt-2 text-sm leading-6 text-amber-100/85">Server settings remain available. Retry promotion status when ready.</p>
          </div>
        ) : null}

        {status ? (
          <div className="mt-5 grid gap-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <InfoRow label="Current plan" value={formatPlan(planKey)} />
              <InfoRow label="Credits available" value={`${status.creditsAvailable}`} />
              <InfoRow label="Credits used" value={`${status.creditsUsed}`} />
              <InfoRow label="Current period" value={`${formatShortDate(status.periodStart)} - ${formatShortDate(status.periodEnd)}`} />
            </div>

            {actionState.message || actionState.error ? (
              <div aria-live="polite" className={`rounded-lg border px-4 py-3 text-sm font-bold ${actionState.error ? "border-red-300/25 bg-red-400/10 text-red-50" : "border-emerald-300/25 bg-emerald-400/10 text-emerald-50"}`}>
                {actionState.error ?? actionState.message}
              </div>
            ) : null}

            <PromotionResultsPanel
              analytics={analytics}
              loading={analyticsLoading}
              error={analyticsError}
              fallbackActivePromotionCount={status.activePromotions.length}
              fallbackCreditsUsed={status.creditsUsed}
              onRetry={onRetry}
            />

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/24 p-4">
                <p className="text-xs font-black uppercase text-zinc-300">Active promotions</p>
                {status.activePromotions.length ? (
                  <div className="mt-3 grid gap-2">
                    {status.activePromotions.map((promotion) => (
                      <div key={promotion.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2">
                        <span className="text-sm font-black text-emerald-50">{promotion.label}</span>
                        <span className="text-xs font-bold text-emerald-100/85">Ends {formatDate(promotion.endsAt)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-zinc-400">No active promotions.</p>
                )}
              </div>

              <div className={`rounded-lg border p-4 ${upgradeBenefits.length ? "border-violet-300/20 bg-violet-400/10" : "border-emerald-300/20 bg-emerald-400/10"}`}>
                <p className="text-xs font-black uppercase text-zinc-200">{upgradeBenefits.length ? "Upgrade benefits" : "Promotion tools active"}</p>
                <ul className="mt-3 grid gap-2 text-sm leading-6 text-zinc-100">
                  {(upgradeBenefits.length ? upgradeBenefits : status.promotionBenefits).map((benefit) => (
                    <li key={benefit} className="flex gap-2">
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-cyan-200" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {promotionTypes.map((promotion) => {
                const active = activeTypes.has(promotion.promotionType);
                const busy = actionState.busy && actionState.promotionType === promotion.promotionType;
                const disabled = actionState.busy || !promotion.allowed || creditsAvailable <= 0 || active;
                const buttonLabel = active
                  ? "Active"
                  : busy
                    ? "Activating..."
                    : creditsAvailable <= 0
                      ? "No Credits"
                      : promotion.allowed
                        ? "Use Credit"
                        : "Locked";
                return (
                  <div key={promotion.promotionType} className={`rounded-lg border p-4 ${promotion.allowed ? "border-cyan-300/20 bg-cyan-400/10" : "border-white/10 bg-black/24"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-white">{promotion.label}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">{promotion.durationHours > 0 ? `${promotion.durationHours} hour visibility promotion` : "Reserved for future seasonal campaigns"}</p>
                      </div>
                      {!promotion.allowed ? <LockKeyhole className="h-4 w-4 shrink-0 text-zinc-500" /> : null}
                    </div>
                    {promotion.reason ? <p className="mt-3 text-xs font-bold text-amber-100">{promotion.reason}</p> : null}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onUseCredit(promotion.promotionType)}
                      aria-busy={busy}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : promotion.allowed ? <ArrowRight className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                      {buttonLabel}
                    </button>
                  </div>
                );
              })}
            </div>

            <p className="text-xs leading-5 text-zinc-500">
              Starter has 0 monthly credits. Pro includes 2 monthly credits for directory and featured promotion. Premium includes 8 monthly credits and spotlight boost eligibility.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PromotionResultsPanel({
  analytics,
  loading,
  error,
  fallbackActivePromotionCount,
  fallbackCreditsUsed,
  onRetry,
}: {
  analytics: PromotionAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
  fallbackActivePromotionCount: number;
  fallbackCreditsUsed: number;
  onRetry: () => void;
}) {
  const activePromotionCount = analytics?.activePromotionCount ?? fallbackActivePromotionCount;
  const creditsUsedThisPeriod = analytics?.creditsUsedThisPeriod ?? fallbackCreditsUsed;
  return (
    <div className="rounded-lg border border-cyan-300/18 bg-cyan-400/[0.055] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-black uppercase text-cyan-100">
            <BarChart3 className="h-4 w-4" />
            Promotion Results
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            These are discovery/visibility results, not competitive leaderboard boosts.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={loading}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-[10px] font-black uppercase text-zinc-100 disabled:opacity-55"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Results
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-50">
          {error}
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <InfoRow label="Impressions 7d" value={loading && !analytics ? "Loading" : `${analytics?.impressionsLast7Days ?? 0}`} />
        <InfoRow label="Clicks 7d" value={loading && !analytics ? "Loading" : `${analytics?.clicksLast7Days ?? 0}`} />
        <InfoRow label="Active promotions" value={`${activePromotionCount}`} />
        <InfoRow label="Credits used this month" value={`${creditsUsedThisPeriod}`} />
        <InfoRow label="Est. visibility lift" value={`${analytics?.estimatedVisibilityLift ?? 0}%`} />
      </div>

      {analytics?.recentPromotionEvents.length ? (
        <div className="mt-4 grid gap-2">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">Recent promotion events</p>
          <div className="grid gap-1.5 md:grid-cols-2">
            {analytics.recentPromotionEvents.slice(0, 4).map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs">
                <span className="font-bold text-zinc-200">{event.type === "click" ? "Click" : "Impression"} - {formatPromotionSource(event.source)}</span>
                <span className="shrink-0 font-bold text-zinc-500">{formatRelativeDate(event.occurredAt)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CompletenessMeter({ title, status }: { title: string; status: VisibilityCompleteness }) {
  const percent = clampPercent(status.percent);
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-zinc-300">{title}</p>
          <p className="mt-1 text-xs font-bold text-zinc-500">{status.completed} of {status.total} complete</p>
        </div>
        <span className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-xs font-black text-cyan-100">{percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-300" style={{ width: `${percent}%` }} />
      </div>
      <ul className="mt-3 grid gap-1.5 text-xs leading-5 text-zinc-400">
        {status.items.slice(0, 3).map((item) => (
          <li key={item.key} className="flex gap-2">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.complete ? "bg-emerald-300" : "bg-zinc-600"}`} />
            <span>{item.complete ? item.label : item.action}</span>
          </li>
        ))}
      </ul>
    </div>
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
  return readApiResponse<{ message?: string }>(response, path, "Server settings are temporarily unavailable. Please retry.");
}

class ApiRequestError extends Error {
  details: ApiErrorDetails;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = "ApiRequestError";
    this.details = details;
  }
}

async function readApiResponse<T>(response: Response, endpoint: string, fallbackMessage: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
    throw new ApiRequestError({
      message: stringOrNull(body.message) ?? fallbackMessage,
      endpoint,
      status: response.status,
      errorCode: stringOrNull(body.errorCode) ?? stringOrNull(body.error),
      requestId: stringOrNull(body.requestId),
    });
  }
  return data as T;
}

function apiErrorDetails(error: unknown, endpoint: string, fallbackMessage: string): ApiErrorDetails {
  if (error instanceof ApiRequestError) return error.details;
  return {
    message: error instanceof Error && !/^Request failed:/i.test(error.message) ? error.message : fallbackMessage,
    endpoint,
    status: null,
    errorCode: null,
    requestId: null,
  };
}

function safeErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiRequestError) return error.details.message;
  if (error instanceof Error && !/^Request failed:/i.test(error.message)) return error.message;
  return fallbackMessage;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatPlan(value: string) {
  if (!value) return "Free";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatVisibilityTier(value: string) {
  if (value === "premium") return "Premium discovery";
  if (value === "enhanced") return "Enhanced discovery";
  return "Standard discovery";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
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

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function formatRelativeDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Recently";
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes || 1}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h ago`;
  return formatShortDate(value);
}

function formatPromotionSource(value: string) {
  return value.replace(/^discovery_/, "").replace(/_/g, " ");
}

function promotionTypeLabel(value: PromotionType) {
  if (value === "directory_bump") return "Directory bump";
  if (value === "featured_rotation") return "Featured rotation";
  if (value === "spotlight_boost") return "Spotlight boost";
  return "Seasonal push";
}

function channelIdsFromSettings(settings: SettingsResponse): Record<EventChannelType, string> {
  return channelIdsFromSelected(settings.discordEventChannels?.selected ?? null);
}

function channelIdsFromSelected(selected: Record<EventChannelType, EventChannelSummary | null> | null | undefined): Record<EventChannelType, string> {
  return {
    default_event: selected?.default_event?.channelId ?? "",
    event_announcements: selected?.event_announcements?.channelId ?? "",
    event_live_scoreboard: selected?.event_live_scoreboard?.channelId ?? "",
    event_results: selected?.event_results?.channelId ?? "",
  };
}

function renderEventChannelSelect(
  field: { key: EventChannelType; inputKey: string; label: string; description: string },
  options: {
    channels: DiscordEventChannelOption[];
    selectedId: string;
    primarySelected: boolean;
    highlighted: boolean;
    onChange: (value: string) => void;
  },
) {
  const warning = selectedChannelWarning(options.channels, options.selectedId);
  const emptyLabel = field.key === "default_event" || !options.primarySelected ? "Not selected" : "Uses Primary Event Channel";
  return (
    <label
      key={field.key}
      className={`grid gap-2 rounded-lg border p-4 ${
        options.highlighted
          ? "border-cyan-300/35 bg-cyan-400/12 shadow-[0_0_28px_rgba(34,211,238,0.12)]"
          : "border-white/10 bg-black/24"
      }`}
    >
      <span className="text-sm font-black text-white">{field.label}</span>
      <span className="text-xs leading-5 text-zinc-400">{field.description}</span>
      <select
        value={options.selectedId}
        onChange={(event) => options.onChange(event.target.value)}
        className="mt-1 rounded-lg border border-white/10 bg-[#080b16] px-3 py-3 text-sm font-bold text-white outline-none focus:border-cyan-300/45"
      >
        <option value="">{emptyLabel}</option>
        {options.channels.map((channel) => (
          <option key={`${field.key}-${channel.id}`} value={channel.id} disabled={!channel.canSelect}>
            #{channel.name} - {channel.type}{channel.canSelect ? " - Bot can post" : ` - Missing ${channel.missingPermissions.join(", ") || "permissions"}`}
          </option>
        ))}
      </select>
      {warning ? <span className="text-xs font-bold text-amber-100">{warning}</span> : null}
    </label>
  );
}

function channelDisplayName(channels: DiscordEventChannelOption[], saved: EventChannelSummary | null | undefined, channelId: string) {
  if (!channelId) return null;
  const live = channels.find((channel) => channel.id === channelId);
  if (live?.name) return `#${live.name}`;
  if (saved?.channelId === channelId && saved.channelName) return `#${saved.channelName}`;
  return "saved channel";
}

function selectedChannelWarning(channels: DiscordEventChannelOption[], channelId: string) {
  if (!channelId) return null;
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) return "Saved channel was not returned by Discord. Refresh channels or choose another event channel.";
  if (channel.canSelect) return null;
  return `Missing bot permissions: ${channel.missingPermissions.join(", ") || "required permissions"}.`;
}

function discordChannelHelpCopy(errorCode: string | undefined) {
  switch (errorCode) {
    case "DISCORD_GUILD_NOT_CONNECTED":
      return "Connect a Discord server in Setup before choosing event channels.";
    case "BOT_NOT_INSTALLED":
      return "Add DZN Bot in Setup before choosing event channels.";
    case "BOT_MISSING_PERMISSIONS":
      return "No valid channels found. Make sure DZN Bot can View Channel, Send Messages, Embed Links, and Read Message History.";
    case "RATE_LIMITED":
      return "Discord rate limited channel lookup. Retry in a moment.";
    default:
      return "Discord channels could not be loaded right now. Retry in a moment.";
  }
}

function signOut() {
  clearClientAuthState();
  void logoutAndRedirect();
}
