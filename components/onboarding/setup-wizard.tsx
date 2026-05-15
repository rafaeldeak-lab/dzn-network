"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Loader2,
  LockKeyhole,
  Search,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Tags,
  Trophy,
  Users,
  X,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import {
  clearClientAuthState,
  getGuilds,
  getMe,
  getNitradoServices,
  goLive,
  logoutAndRedirect,
  saveOnboarding,
  testAdmPath,
  testOnboarding,
  validateNitradoToken,
} from "./api";
import type { AdmApiDebug, DiscordGuild, LinkedServer, NitradoService, OnboardingChecks } from "./types";
import { DznLogo } from "@/components/dzn/dzn-logo";

const steps = [
  "Select Discord Server",
  "Server Type & Categories",
  "Nitrado Token + Service ID",
  "Select Nitrado Service",
  "Review & Test",
  "Go Live",
];

const serverTypes = ["PVP", "DEATHMATCH", "PVE", "PVP / PVE"];
const tags = [
  "Raid Focused",
  "Factions",
  "Base Building",
  "Trader / Economy",
  "Events",
  "Survival",
  "Hardcore",
  "No Base Decay",
  "Custom Maps",
  "Weekend Raids",
  "KOS",
  "Active Admins",
  "New Player Friendly",
  "Roleplay",
  "Modded",
];

export function SetupWizard() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [step, setStep] = useState(0);
  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [services, setServices] = useState<NitradoService[]>([]);
  const [selectedGuild, setSelectedGuild] = useState("");
  const [serverType, setServerType] = useState("PVP");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenValid, setTokenValid] = useState(false);
  const [serviceIdInput, setServiceIdInput] = useState("");
  const [webInterfaceUrl, setWebInterfaceUrl] = useState("");
  const [detectedServiceId, setDetectedServiceId] = useState("");
  const [validatedService, setValidatedService] = useState<NitradoService | null>(null);
  const [directServiceValidated, setDirectServiceValidated] = useState(false);
  const [selectedService, setSelectedService] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<OnboardingChecks | null>(null);
  const [publishedServer, setPublishedServer] = useState<LinkedServer | null>(null);
  const [publishError, setPublishError] = useState("");
  const [guildRefreshing, setGuildRefreshing] = useState(false);
  const [guildRefreshMessage, setGuildRefreshMessage] = useState("");

  const loadDiscordGuilds = useCallback(async (fresh: boolean) => {
    try {
      return await getGuilds({ fresh });
    } catch (error) {
      if (fresh) {
        setGuildRefreshMessage(error instanceof Error ? error.message : "Unable to refresh Discord servers.");
        return getGuilds();
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const auth = await getMe();
        setAuthenticated(true);
        const guildResult = await loadDiscordGuilds(true);
        setGuilds(guildResult.guilds);
        const linkedServer = auth.linkedServer;
        if (linkedServer?.guild_id) {
          setSelectedGuild(linkedServer.guild_id);
        } else if (guildResult.guilds[0]) {
          setSelectedGuild(guildResult.guilds[0].guild_id);
        }

        if (window.location.hash === "#review-test" && linkedServer) {
          const existingService: NitradoService = {
            id: linkedServer.nitrado_service_id,
            name: linkedServer.nitrado_service_name || linkedServer.server_name,
            game: linkedServer.game ?? "DayZ",
            region: linkedServer.region ?? undefined,
            platform: linkedServer.platform ?? undefined,
            ipAddress: linkedServer.ip_address ?? undefined,
            playerSlots: linkedServer.player_slots ?? undefined,
            status: linkedServer.status,
          };
          setServerType(linkedServer.server_type || "PVP");
          setSelectedTags(parseLinkedServerTags(linkedServer.tags_json));
          setServices([existingService]);
          setValidatedService(existingService);
          setSelectedService(existingService.id);
          setTokenValid(true);
          setDirectServiceValidated(true);
          setStep(4);
        }
      } catch {
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loadDiscordGuilds]);

  async function refreshDiscordGuilds() {
    setGuildRefreshing(true);
    setGuildRefreshMessage("");
    try {
      const result = await getGuilds({ fresh: true });
      setGuilds(result.guilds);
      setSelectedGuild((current) => current && result.guilds.some((guild) => guild.guild_id === current)
        ? current
        : result.guilds[0]?.guild_id ?? "");
      setGuildRefreshMessage("Discord servers refreshed.");
      console.log("DZN DISCORD GUILDS REFRESHED");
    } catch (error) {
      setGuildRefreshMessage(error instanceof Error ? error.message : "Unable to refresh Discord servers. Log out and back in to refresh Discord permissions.");
    } finally {
      setGuildRefreshing(false);
    }
  }

  const selectedGuildData = useMemo(
    () => guilds.find((guild) => guild.guild_id === selectedGuild),
    [guilds, selectedGuild],
  );
  const selectedServiceData = useMemo(
    () => services.find((service) => service.id === selectedService) ?? validatedService ?? undefined,
    [services, selectedService, validatedService],
  );
  const stepLabels = useMemo(
    () => steps.map((label, index) => (index === 3 && directServiceValidated ? "Confirm Nitrado Server" : label)),
    [directServiceValidated],
  );

  async function validateTokenWithServiceId() {
    setBusy(true);
    setMessage("");
    try {
      const normalizedServiceId = serviceIdInput.trim();
      if (!normalizedServiceId) throw new Error("Nitrado Service ID is required");
      const result = await validateNitradoToken({
        token: tokenInput,
        serviceId: normalizedServiceId,
        discordGuildId: selectedGuild,
        serverType,
        tags: selectedTags,
      });
      setTokenInput("");
      setTokenValid(true);
      if (result.service) {
        setValidatedService(result.service);
        setServices([result.service]);
        setSelectedService(result.service.id);
      }
      setDirectServiceValidated(true);
      setStep(3);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nitrado token validation failed");
    } finally {
      setBusy(false);
    }
  }

  async function findServicesInstead() {
    setBusy(true);
    setMessage("");
    try {
      await validateNitradoToken({
        token: tokenInput,
        discordGuildId: selectedGuild,
        serverType,
        tags: selectedTags,
      });
      setTokenInput("");
      setTokenValid(true);
      setDirectServiceValidated(false);
      setValidatedService(null);
      const serviceResult = await getNitradoServices();
      setServices(serviceResult.services);
      if (serviceResult.services[0]) setSelectedService(serviceResult.services[0].id);
      setStep(3);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nitrado service discovery failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveAndReview() {
    setBusy(true);
    setMessage("");
    try {
      await saveOnboarding({
        discordGuildId: selectedGuild,
        serverType,
        tags: selectedTags,
        nitradoServiceId: selectedService,
      });
      setStep(4);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save onboarding");
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setMessage("");
    try {
      const result = await testOnboarding();
      setChecks(result.checks);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Verification test failed");
    } finally {
      setBusy(false);
    }
  }

  async function runManualAdmPathTest(path: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await testAdmPath(path);
      setChecks(result.checks);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ADM path test failed");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setMessage("");
    setPublishError("");
    try {
      await goLive();
      const refreshed = await getMe().catch(() => null);
      setPublishedServer(refreshed?.linkedServer ?? null);
      setStep(5);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Go-live failed");
      setStep(5);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    clearClientAuthState();
    await logoutAndRedirect();
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      if (current.length >= 5) return current;
      return [...current, tag];
    });
  }

  function updateWebInterfaceUrl(value: string) {
    setWebInterfaceUrl(value);
    const id = extractNitradoServiceId(value);
    setDetectedServiceId(id);
    if (id) setServiceIdInput(id);
  }

  if (loading) return <SetupFrame><LoadingState /></SetupFrame>;

  if (!authenticated) {
    return (
      <SetupFrame>
        <div className="glass-surface animated-border mx-auto max-w-2xl rounded-lg p-8 text-center">
          <div className="relative z-10">
            <ShieldCheck className="mx-auto h-12 w-12 text-violet-200" />
            <h1 className="mt-5 text-3xl font-black uppercase text-white">Login required</h1>
            <p className="mt-3 text-zinc-300">
              Connect Discord before selecting a guild and verifying your Nitrado DayZ server.
            </p>
            <Link className="mt-6 inline-flex rounded-lg bg-violet-500 px-5 py-3 text-xs font-black uppercase text-white" href="/login">
              Login with Discord
            </Link>
          </div>
        </div>
      </SetupFrame>
    );
  }

  return (
    <SetupFrame onLogout={signOut}>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <p className="text-xs font-black uppercase text-violet-200/70">Verification flow</p>
            <h1 className="mt-2 text-2xl font-black uppercase text-white">Server onboarding</h1>
            <div className="mt-6 space-y-3">
              {stepLabels.map((label, index) => (
                <button
                  key={label}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm font-bold transition ${
                    index === step
                      ? "border-violet-300/45 bg-violet-400/14 text-white"
                      : index < step
                        ? "border-emerald-300/25 bg-emerald-400/8 text-emerald-100"
                        : "border-white/10 bg-white/[0.03] text-zinc-400"
                  }`}
                  onClick={() => index < step && setStep(index)}
                  type="button"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-black/20 text-xs">
                    {index < step ? <Check className="h-4 w-4" /> : index + 1}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="glass-surface animated-border min-h-[620px] rounded-lg p-5 sm:p-7">
          <div className="relative z-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.28 }}
              >
                {step === 0 ? (
                  <GuildStep
                    guilds={guilds}
                    selectedGuild={selectedGuild}
                    setSelectedGuild={setSelectedGuild}
                    onNext={() => setStep(1)}
                    onRefresh={refreshDiscordGuilds}
                    refreshing={guildRefreshing}
                    refreshMessage={guildRefreshMessage}
                  />
                ) : null}
                {step === 1 ? (
                  <TypeStep serverType={serverType} setServerType={setServerType} selectedTags={selectedTags} toggleTag={toggleTag} onNext={() => setStep(2)} />
                ) : null}
                {step === 2 ? (
                  <TokenStep
                    tokenInput={tokenInput}
                    setTokenInput={setTokenInput}
                    serviceIdInput={serviceIdInput}
                    setServiceIdInput={setServiceIdInput}
                    webInterfaceUrl={webInterfaceUrl}
                    setWebInterfaceUrl={updateWebInterfaceUrl}
                    detectedServiceId={detectedServiceId}
                    tokenValid={tokenValid}
                    busy={busy}
                    onValidateServiceId={validateTokenWithServiceId}
                    onFindServices={findServicesInstead}
                  />
                ) : null}
                {step === 3 ? (
                  directServiceValidated && validatedService ? (
                    <ConfirmedServiceStep service={validatedService} onNext={() => setStep(4)} />
                  ) : (
                    <ServiceStep services={services} selectedService={selectedService} setSelectedService={setSelectedService} onNext={saveAndReview} busy={busy} />
                  )
                ) : null}
                {step === 4 ? (
                  <ReviewStep guild={selectedGuildData} service={selectedServiceData} serverType={serverType} tags={selectedTags} checks={checks} busy={busy} onTest={runTest} onTestAdmPath={runManualAdmPathTest} onGoLive={publish} />
                ) : null}
                {step === 5 ? (
                  <LiveStep
                    server={publishedServer}
                    service={selectedServiceData}
                    checks={checks}
                    finalError={publishError}
                    onRetryTest={async () => {
                      await runTest();
                      setStep(4);
                    }}
                    onBack={() => setStep(4)}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>
            {message ? (
              <p className="mt-5 rounded-lg border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm font-bold text-red-100">
                {message}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </SetupFrame>
  );
}

function SetupFrame({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-8 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(139,92,246,0.25),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.14),transparent_26%),linear-gradient(180deg,#02030a_0%,#07101f_52%,#02030a_100%)]" />
      <div className="scanline absolute inset-0 opacity-20" />
      <div className="relative z-10 mx-auto max-w-7xl">
        <nav className="mb-8 flex items-center justify-between">
          <DznLogo />
          <div className="flex items-center gap-3">
            <Link href="/servers" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 sm:inline-flex">
              Servers
            </Link>
            <Link href="/signup" className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200 md:inline-flex">
              Add Your Server
            </Link>
            <Link href="/dashboard" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200">
              Dashboard
            </Link>
            {onLogout ? (
              <button type="button" onClick={onLogout} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200">
                Logout
              </button>
            ) : null}
          </div>
        </nav>
        {children}
      </div>
    </main>
  );
}

function LoadingState() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Loader2 className="h-10 w-10 animate-spin text-violet-200" />
    </div>
  );
}

function GuildStep({
  guilds,
  selectedGuild,
  setSelectedGuild,
  onNext,
  onRefresh,
  refreshing,
  refreshMessage,
}: {
  guilds: DiscordGuild[];
  selectedGuild: string;
  setSelectedGuild: (value: string) => void;
  onNext: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshMessage: string;
}) {
  useEffect(() => {
    console.log("DZN DISCORD SERVER LINK LIST READY");
  }, [guilds.length]);

  return (
    <Step title="Select Discord Server" icon={Users} description="Choose the Discord community you want to link to DZN Network.">
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-cyan-300/15 bg-cyan-400/8 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase text-cyan-100">Latest Discord servers</p>
          <p className="mt-1 text-sm leading-6 text-zinc-300">Only servers you own or administer are shown.</p>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            Can&apos;t see a new Discord server? Click Refresh Discord Servers or log out and back in to refresh Discord permissions.
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-cyan-300/30 bg-cyan-400/12 px-4 py-3 text-xs font-black uppercase text-cyan-50 transition hover:border-cyan-300/55 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh Discord Servers"}
        </button>
      </div>
      {refreshMessage ? (
        <p className="mb-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-zinc-200">
          {refreshMessage}
        </p>
      ) : null}
      <div className="grid gap-3">
        {guilds.length ? guilds.map((guild) => (
          <button key={guild.guild_id} type="button" onClick={() => setSelectedGuild(guild.guild_id)} className={`flex items-center gap-4 rounded-lg border p-4 text-left transition ${selectedGuild === guild.guild_id ? "border-violet-300/50 bg-violet-400/12" : "border-white/10 bg-white/[0.03]"}`}>
            {guild.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={guild.icon_url} alt="" className="h-12 w-12 rounded-lg" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-violet-500/20 text-lg font-black">{guild.name[0]}</span>
            )}
            <span className="flex-1">
              <span className="block font-black text-white">{guild.name}</span>
              <span className="mt-1 block text-sm text-zinc-400">This Discord server can be linked to DZN Network.</span>
              <span className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-md border border-violet-300/25 bg-violet-400/10 px-2 py-1 text-[10px] font-black uppercase text-violet-100">
                  {guild.owner ? "Owner" : "Administrator"}
                </span>
                <span className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-100">
                  Ready to link
                </span>
              </span>
            </span>
          </button>
        )) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm font-black uppercase text-white">No manageable Discord servers found.</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              You need to own the server or have Administrator permission. If you just created a server, click Refresh Discord Servers. If it still does not appear, log out and log back in.
            </p>
          </div>
        )}
      </div>
      <WizardButton disabled={!selectedGuild} onClick={onNext}>Continue</WizardButton>
    </Step>
  );
}

function TypeStep({ serverType, setServerType, selectedTags, toggleTag, onNext }: { serverType: string; setServerType: (value: string) => void; selectedTags: string[]; toggleTag: (tag: string) => void; onNext: () => void }) {
  return (
    <Step title="Server Type & Categories" icon={Tags} description="Choose the primary mode and up to five tags that describe your server.">
      <div className="grid gap-3 sm:grid-cols-4">
        {serverTypes.map((type) => (
          <button key={type} type="button" onClick={() => setServerType(type)} className={`rounded-lg border p-4 text-sm font-black uppercase transition ${serverType === type ? "border-violet-300/50 bg-violet-500/20 text-white" : "border-white/10 bg-white/[0.03] text-zinc-300"}`}>
            {type}
          </button>
        ))}
      </div>
      <p className="mt-6 text-xs font-black uppercase text-zinc-500">{selectedTags.length}/5 optional tags selected</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <button key={tag} type="button" onClick={() => toggleTag(tag)} className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${selectedTags.includes(tag) ? "border-cyan-300/40 bg-cyan-300/12 text-cyan-100" : "border-white/10 bg-white/[0.03] text-zinc-400"}`}>
            {tag}
          </button>
        ))}
      </div>
      <WizardButton onClick={onNext}>Continue</WizardButton>
    </Step>
  );
}

function TokenStep({
  tokenInput,
  setTokenInput,
  serviceIdInput,
  setServiceIdInput,
  webInterfaceUrl,
  setWebInterfaceUrl,
  detectedServiceId,
  tokenValid,
  busy,
  onValidateServiceId,
  onFindServices,
}: {
  tokenInput: string;
  setTokenInput: (value: string) => void;
  serviceIdInput: string;
  setServiceIdInput: (value: string) => void;
  webInterfaceUrl: string;
  setWebInterfaceUrl: (value: string) => void;
  detectedServiceId: string;
  tokenValid: boolean;
  busy: boolean;
  onValidateServiceId: () => void;
  onFindServices: () => void;
}) {
  const [showToken, setShowToken] = useState(false);
  const [showServiceGuide, setShowServiceGuide] = useState(false);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);

  return (
    <Step
      title="Connect Your Nitrado Server"
      icon={KeyRound}
      description="To verify ownership and read DayZ server logs, DZN needs a Nitrado Long-Life Token and your Nitrado Service ID."
    >
      <div className="grid gap-5 xl:grid-cols-[1fr_330px]">
        <div className="space-y-5">
          <GuideSection title="1. Create Your Nitrado Token">
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 text-xs font-black uppercase text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:bg-violet-400"
                href="https://server.nitrado.net/eng/account_api"
                rel="noreferrer"
                target="_blank"
              >
                Open Nitrado Token Page
                <ExternalLink className="h-4 w-4" />
              </a>
              <a
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs font-black uppercase text-zinc-200 transition hover:border-violet-300/30"
                href="https://server.nitrado.net/eng/services"
                rel="noreferrer"
                target="_blank"
              >
                Open My Nitrado Services
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <p className="mt-3 text-sm text-zinc-400">
              If the button does not open the correct page, log in to Nitrado and go to: Account - Developer Portal - Long-Life Tokens.
            </p>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_280px]">
              <MiniChecklist
                items={[
                  "Description: DZN Network Access",
                  "Enable only: service",
                  "Click Create",
                  "Copy the token once it appears",
                ]}
              />
              <NitradoTokenMockup />
            </div>
          </GuideSection>

          <GuideSection title="2. Use Only The Required Permission">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-4">
                <p className="text-xs font-black uppercase text-emerald-100">Required</p>
                <p className="mt-3 flex items-center gap-2 text-sm font-black text-white"><Check className="h-4 w-4 text-emerald-200" />service</p>
              </div>
              <div className="rounded-lg border border-red-300/20 bg-red-400/8 p-4">
                <p className="text-xs font-black uppercase text-red-100">Not required</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-red-100/80">
                  {["rootserver", "ssh_keys", "user_edit", "service_order", "user_info"].map((permission) => (
                    <span key={permission} className="inline-flex items-center gap-1 rounded-md border border-red-300/20 px-2 py-1"><X className="h-3 w-3" />{permission}</span>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm text-zinc-400">
              DZN only needs the service permission to verify your DayZ server and read server information/logs. Do not enable extra permissions.
            </p>
          </GuideSection>

          <GuideSection title="3. Paste Token + Service ID">
            <div className="grid gap-4">
              <div>
                <label className="text-xs font-black uppercase text-zinc-500" htmlFor="nitrado-token">Nitrado API Token</label>
                <div className="mt-2 flex h-12 items-center rounded-lg border border-white/10 bg-black/30 focus-within:border-violet-300/60">
                  <input
                    id="nitrado-token"
                    value={tokenInput}
                    onChange={(event) => setTokenInput(event.target.value)}
                    type={showToken ? "text" : "password"}
                    autoComplete="off"
                    placeholder="Paste your Nitrado Long-Life Token"
                    className="h-full min-w-0 flex-1 bg-transparent px-4 text-sm text-white outline-none placeholder:text-zinc-600"
                  />
                  <button
                    aria-label={showToken ? "Hide token" : "Show token"}
                    className="grid h-12 w-12 place-items-center text-zinc-400 transition hover:text-violet-100"
                    onClick={() => setShowToken((value) => !value)}
                    type="button"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-2 text-sm font-bold text-orange-100/90">
                  Never share this token publicly. DZN encrypts it and never shows it again.
                </p>
              </div>

              <div>
                <label className="text-xs font-black uppercase text-zinc-500" htmlFor="nitrado-service-id">Nitrado Service ID</label>
                <input
                  id="nitrado-service-id"
                  value={serviceIdInput}
                  onChange={(event) => setServiceIdInput(event.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder="Example: 18765761"
                  className="mt-2 h-12 w-full rounded-lg border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-300/60"
                />
                <p className="mt-2 text-sm text-zinc-400">Find this number in your Nitrado Web Interface URL.</p>
                <p className="mt-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-300">
                  webinterface.nitrado.net/18765761/wi/gameserver - Service ID = 18765761
                </p>
              </div>

              <div>
                <label className="text-xs font-black uppercase text-zinc-500" htmlFor="nitrado-web-url">Paste Nitrado Web Interface URL</label>
                <input
                  id="nitrado-web-url"
                  value={webInterfaceUrl}
                  onChange={(event) => setWebInterfaceUrl(event.target.value)}
                  placeholder="https://webinterface.nitrado.net/18765761/wi/gameserver/..."
                  className="mt-2 h-12 w-full rounded-lg border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-300/60"
                />
                {detectedServiceId ? (
                  <p className="mt-2 text-sm font-black text-emerald-100">Detected Service ID: {detectedServiceId}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 lg:flex-row">
              <button
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white shadow-[0_0_28px_rgba(139,92,246,0.42)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!tokenInput || !serviceIdInput || busy}
                onClick={onValidateServiceId}
                type="button"
              >
                {busy ? "Validating" : tokenValid ? "Validated" : "Validate Token + Service ID"}
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-5 text-xs font-black uppercase text-zinc-100 transition hover:border-violet-300/30 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!tokenInput || busy}
                onClick={onFindServices}
                type="button"
              >
                <Search className="h-4 w-4" />
                Find My Services Instead
              </button>
            </div>
          </GuideSection>
        </div>

        <aside className="space-y-4">
          <HelpPanel
            onOpenPermissions={() => setShowPermissionGuide((value) => !value)}
            onOpenServiceGuide={() => setShowServiceGuide((value) => !value)}
          />
          {showServiceGuide ? <ServiceIdGuide /> : null}
          {showPermissionGuide ? <PermissionGuide /> : null}
          <TrustCard />
        </aside>
      </div>
    </Step>
  );
}

function ConfirmedServiceStep({ service, onNext }: { service: NitradoService; onNext: () => void }) {
  return (
    <Step title="Confirm Nitrado Server" icon={Server} description="DZN verified that your token can access this DayZ service. Continue when the details look right.">
      <ServerFoundCard service={service} />
      <button
        className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white shadow-[0_0_28px_rgba(139,92,246,0.42)] transition hover:bg-violet-400"
        onClick={onNext}
        type="button"
      >
        Continue to Log Check
        <ChevronRight className="h-4 w-4" />
      </button>
    </Step>
  );
}

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/24 p-4">
      <h3 className="text-sm font-black uppercase text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MiniChecklist({ items }: { items: string[] }) {
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-bold text-zinc-200">
          <Check className="h-4 w-4 text-emerald-200" />
          {item}
        </div>
      ))}
    </div>
  );
}

function NitradoTokenMockup() {
  const permissions = [
    ["service", true],
    ["rootserver", false],
    ["ssh_keys", false],
    ["user_edit", false],
    ["service_order", false],
    ["user_info", false],
  ] as const;
  return (
    <div className="rounded-lg border border-violet-300/20 bg-[#080a14] p-4 shadow-[0_0_28px_rgba(139,92,246,0.14)]">
      <p className="text-xs font-black uppercase text-violet-200/70">Long-Life Token</p>
      <div className="mt-3 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold text-zinc-200">DZN Network Access</div>
      <div className="mt-3 grid gap-2">
        {permissions.map(([permission, checked]) => (
          <div key={permission} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-300">
            <span>{permission}</span>
            <span className={`grid h-4 w-4 place-items-center rounded-sm border ${checked ? "border-emerald-300 bg-emerald-400/20 text-emerald-100" : "border-zinc-600 text-transparent"}`}>
              <Check className="h-3 w-3" />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-md bg-yellow-400 px-3 py-2 text-center text-xs font-black uppercase text-black">Create</div>
    </div>
  );
}

function HelpPanel({ onOpenServiceGuide, onOpenPermissions }: { onOpenServiceGuide: () => void; onOpenPermissions: () => void }) {
  return (
    <div className="rounded-lg border border-violet-300/15 bg-violet-950/10 p-4">
      <p className="text-xs font-black uppercase text-violet-200/70">Need help?</p>
      <div className="mt-3 grid gap-2">
        <button type="button" onClick={onOpenServiceGuide} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm font-bold text-zinc-100 transition hover:border-violet-300/30">
          View Setup Guide
        </button>
        <a href="https://discord.com" rel="noreferrer" target="_blank" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-bold text-zinc-100 transition hover:border-violet-300/30">
          Join Discord
        </a>
        <a href="mailto:support@dayz-network.com" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-bold text-zinc-100 transition hover:border-violet-300/30">
          Contact Support
        </a>
        <button type="button" onClick={onOpenServiceGuide} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm font-bold text-zinc-100 transition hover:border-violet-300/30">
          Where do I find my Service ID?
        </button>
        <button type="button" onClick={onOpenPermissions} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm font-bold text-zinc-100 transition hover:border-violet-300/30">
          What permissions should I enable?
        </button>
      </div>
    </div>
  );
}

function ServiceIdGuide() {
  return (
    <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/8 p-4">
      <HelpCircle className="h-5 w-5 text-cyan-100" />
      <p className="mt-3 text-sm font-black uppercase text-white">Where do I find my Service ID?</p>
      <ol className="mt-3 space-y-2 text-sm text-zinc-300">
        <li>1. Open your Nitrado Web Interface.</li>
        <li>2. Look at the browser URL.</li>
        <li>3. Copy the number after webinterface.nitrado.net/</li>
        <li>4. Example: webinterface.nitrado.net/18765761/wi/gameserver</li>
      </ol>
      <p className="mt-3 rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-sm font-black text-cyan-100">Service ID = 18765761</p>
    </div>
  );
}

function PermissionGuide() {
  return (
    <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/8 p-4">
      <ShieldCheck className="h-5 w-5 text-emerald-100" />
      <p className="mt-3 text-sm font-black uppercase text-white">What permissions should I enable?</p>
      <p className="mt-2 text-sm text-zinc-300">Enable only service. Leave rootserver, ssh_keys, user_edit, service_order, and user_info disabled.</p>
    </div>
  );
}

function TrustCard() {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <LockKeyhole className="h-5 w-5 text-violet-100" />
      <p className="mt-3 text-sm font-black uppercase text-white">We only request what we need</p>
      <p className="mt-2 text-sm text-zinc-400">
        DZN uses your token only to verify your Nitrado DayZ server and read required server/log information. We do not access billing, rootserver systems, SSH keys, or unrelated services.
      </p>
      <div className="mt-3 grid gap-2 text-sm font-bold text-zinc-300">
        {["Token encrypted before storage", "Token never shown again", "No FTP/MySQL passwords displayed", "No billing access", "You can revoke the token in Nitrado anytime"].map((item) => (
          <span key={item} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-200" />{item}</span>
        ))}
      </div>
    </div>
  );
}

function ServerFoundCard({ service }: { service: NitradoService }) {
  const rows = [
    ["Server name", service.name],
    ["Service ID", service.id],
    ["Game", service.game || "DayZ"],
    ["Platform", service.platform],
    ["IP address", service.ipAddress],
    ["Player slots", service.playerSlots ? String(service.playerSlots) : undefined],
    ["Status", service.status],
  ].filter(([, value]) => Boolean(value)) as [string, string][];

  return (
    <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/8 p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-emerald-300/20 bg-emerald-400/15 text-emerald-100">
          <Check className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-black uppercase text-emerald-100/80">Nitrado Server Found</p>
          <h3 className="text-xl font-black text-white">{service.name}</h3>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {rows.map(([label, value]) => <Summary key={label} label={label} value={value} />)}
      </div>
    </div>
  );
}

function ServiceStep({ services, selectedService, setSelectedService, onNext, busy }: { services: NitradoService[]; selectedService: string; setSelectedService: (value: string) => void; onNext: () => void; busy: boolean }) {
  return (
    <Step title="Select Nitrado Service" icon={Server} description="Only services detected as DayZ game servers are available for selection.">
      <div className="grid gap-3">
        {services.map((service) => (
          <button key={service.id} type="button" onClick={() => setSelectedService(service.id)} className={`rounded-lg border p-4 text-left transition ${selectedService === service.id ? "border-violet-300/50 bg-violet-400/12" : "border-white/10 bg-white/[0.03]"}`}>
            <span className="block font-black text-white">{service.name}</span>
            <span className="mt-1 block text-sm text-zinc-400">{service.game}{service.region ? ` - ${service.region}` : ""}</span>
          </button>
        ))}
      </div>
      <WizardButton disabled={!selectedService || busy} onClick={onNext}>Save and review</WizardButton>
    </Step>
  );
}

function ReviewStep({ guild, service, serverType, tags, checks, busy, onTest, onTestAdmPath, onGoLive }: { guild?: DiscordGuild; service?: NitradoService; serverType: string; tags: string[]; checks: OnboardingChecks | null; busy: boolean; onTest: () => void; onTestAdmPath: (path: string) => Promise<void>; onGoLive: () => void }) {
  const [manualAdmPath, setManualAdmPath] = useState("");
  const setupReview = getSetupReviewState({ guild, service, checks });
  const canGoLive = setupReview.requiredPassed;
  return (
    <Step title="Review & Test" icon={ShieldCheck} description="Confirm details and run the owner verification checks before publishing.">
      <div className="grid gap-3 md:grid-cols-2">
        <Summary label="Discord guild" value={guild?.name ?? "Not selected"} />
        <Summary label="Nitrado service" value={service?.name ?? "Not selected"} />
        <Summary label="Server type" value={serverType} />
        <Summary label="Tags" value={tags.length ? tags.join(", ") : "No optional tags"} />
      </div>
      <SetupResultBanner review={setupReview} busy={busy} />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {setupReview.checks.map((check) => (
          <SetupCheckCard key={check.label} check={check} />
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <WizardButton disabled={busy} onClick={onTest}>{busy ? "Testing" : "Run test"}</WizardButton>
        <WizardButton disabled={!canGoLive || busy} onClick={onGoLive}>Go live</WizardButton>
      </div>
      {!canGoLive ? (
        <p className="mt-4 rounded-lg border border-white/10 bg-black/24 px-4 py-3 text-sm font-bold leading-6 text-zinc-300">
          Run the test and pass the required Discord, Nitrado, DayZ service, and metadata checks before publishing. ADM read pending is a warning, not a hard block.
        </p>
      ) : null}
      <AdvancedDiagnostics
        checks={checks}
        manualAdmPath={manualAdmPath}
        setManualAdmPath={setManualAdmPath}
        busy={busy}
        onTestAdmPath={onTestAdmPath}
      />
    </Step>
  );
}

type FriendlyCheck = {
  label: string;
  message: string;
  status: "passed" | "warning" | "failed" | "pending";
  required?: boolean;
};

type SetupReviewState = {
  status: "success" | "warning" | "failed" | "pending";
  title: string;
  message: string;
  requiredPassed: boolean;
  checks: FriendlyCheck[];
  attention: FriendlyCheck[];
};

function getSetupReviewState({ guild, service, checks }: { guild?: DiscordGuild; service?: NitradoService; checks: OnboardingChecks | null }): SetupReviewState {
  const admDiscovered = Boolean(checks?.admLogsFound || checks?.admLog?.admFileExists);
  const admReadable = Boolean(checks?.admLogsFound && checks?.admLog?.sampleReadSucceeded);
  const metadataSynced = Boolean(checks?.metadataSynced || service?.name);
  const checkRows: FriendlyCheck[] = [
    {
      label: "Discord server selected",
      status: guild ? "passed" : "failed",
      message: guild ? "Discord server connected." : "Select a Discord server you own or administer.",
      required: true,
    },
    {
      label: "Nitrado token valid",
      status: !checks ? "pending" : checks.tokenValid ? "passed" : "failed",
      message: !checks ? "Run the test to confirm Nitrado access." : checks.tokenValid ? "Nitrado access confirmed." : "Your Nitrado token was rejected. Check the token and try again.",
      required: true,
    },
    {
      label: "Nitrado service connected",
      status: !checks ? (service ? "pending" : "failed") : checks.serviceAccess ? "passed" : "failed",
      message: !checks ? (service ? "Ready to verify selected service." : "Select or validate a Nitrado service first.") : checks.serviceAccess ? "Nitrado service access confirmed." : "No DayZ service was found for that Service ID.",
      required: true,
    },
    {
      label: "DayZ server detected",
      status: !checks ? "pending" : checks.dayzServiceDetected ? "passed" : "failed",
      message: !checks ? "Run the test to confirm this is a DayZ server." : checks.dayzServiceDetected ? "DayZ server found." : "This service does not look like a DayZ server.",
      required: true,
    },
    {
      label: "ADM logs discovered",
      status: !checks ? "pending" : admDiscovered ? "passed" : "warning",
      message: !checks
        ? "Run the test to search for ADM logs."
        : admDiscovered
          ? "ADM log files discovered."
          : "DZN connected to Nitrado, but could not find ADM log files yet. Restart the server and try again after the next log update.",
    },
    {
      label: "Stats sync",
      status: !checks ? "pending" : admReadable ? "passed" : admDiscovered ? "warning" : "warning",
      message: !checks
        ? "Stats sync checks run after ADM discovery."
        : admReadable
          ? "Readable ADM activity is available for sync."
          : admDiscovered
            ? "ADM logs found. Stats will begin syncing automatically once readable activity is available."
            : "PvP stats will begin syncing once ADM logs are discovered and readable.",
    },
    {
      label: "Server metadata synced",
      status: !checks ? "pending" : metadataSynced ? "passed" : "failed",
      message: !checks ? "Run the test to sync server name, slots, and category." : metadataSynced ? "Server name, slots, and category were detected." : "Required server metadata could not be synced from Nitrado.",
      required: true,
    },
    {
      label: "Ready to publish",
      status: !checks ? "pending" : "pending",
      message: !checks ? "Run the test to confirm readiness." : "Waiting for required checks.",
    },
  ];

  const requiredPassed = checkRows.every((check) => !check.required || check.status === "passed");
  const hasFailedRequired = checkRows.some((check) => check.required && check.status === "failed");
  const hasWarnings = checkRows.some((check) => check.status === "warning");
  const status = !checks ? "pending" : hasFailedRequired ? "failed" : hasWarnings ? "warning" : "success";
  const readyIndex = checkRows.findIndex((check) => check.label === "Ready to publish");
  if (readyIndex >= 0) {
    checkRows[readyIndex] = {
      ...checkRows[readyIndex],
      status: requiredPassed ? "passed" : status === "failed" ? "failed" : "pending",
      message: requiredPassed ? "Required setup checks passed. You can publish this server." : "Complete the required checks before publishing.",
    };
  }

  const attention = checkRows.filter((check) => check.status === "failed" || check.status === "warning");
  if (status === "success") {
    return {
      status,
      title: "Ready to go live",
      message: "Your server is connected. DZN can detect your DayZ service and will begin syncing stats from ADM logs as data becomes available.",
      requiredPassed,
      checks: checkRows,
      attention,
    };
  }
  if (status === "warning") {
    return {
      status,
      title: "Almost ready",
      message: "Your server was found, but some optional sync checks are still waiting for Nitrado log activity.",
      requiredPassed,
      checks: checkRows,
      attention,
    };
  }
  if (status === "failed") {
    return {
      status,
      title: "Setup needs attention",
      message: "We could not complete verification. Fix the issue below and run the test again.",
      requiredPassed,
      checks: checkRows,
      attention,
    };
  }
  return {
    status,
    title: "Run verification",
    message: "Run the test to confirm Discord, Nitrado, DayZ service, metadata, and ADM readiness.",
    requiredPassed,
    checks: checkRows,
    attention,
  };
}

function SetupResultBanner({ review, busy }: { review: SetupReviewState; busy: boolean }) {
  const tone = review.status === "success" ? "emerald" : review.status === "failed" ? "red" : review.status === "warning" ? "orange" : "violet";
  const className = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-50",
    red: "border-red-300/25 bg-red-400/10 text-red-50",
    orange: "border-orange-300/25 bg-orange-400/10 text-orange-50",
    violet: "border-violet-300/20 bg-violet-400/10 text-violet-50",
  }[tone];
  return (
    <div className={`mt-5 rounded-lg border p-4 ${className}`}>
      <div className="flex items-start gap-3">
        {review.status === "failed" ? <AlertTriangle className="mt-1 h-5 w-5 shrink-0" /> : review.status === "success" ? <CheckCircle2 className="mt-1 h-5 w-5 shrink-0" /> : <ShieldCheck className="mt-1 h-5 w-5 shrink-0" />}
        <div>
          <p className="text-xs font-black uppercase opacity-75">{busy ? "Verification running" : review.title}</p>
          <p className="mt-1 text-sm font-bold leading-6 text-white">{busy ? "Running setup checks..." : review.message}</p>
          {review.attention.length && review.status !== "pending" ? (
            <ul className="mt-3 space-y-1 text-sm leading-6">
              {review.attention.slice(0, 3).map((item) => (
                <li key={item.label}>- {item.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SetupCheckCard({ check }: { check: FriendlyCheck }) {
  const Icon = check.status === "passed" ? CheckCircle2 : check.status === "failed" ? X : check.status === "warning" ? AlertTriangle : ShieldCheck;
  return (
    <div className={`rounded-lg border p-4 ${setupStatusClass(check.status)}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-current/20 bg-black/20">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black uppercase text-white">{check.label}</p>
            <span className="rounded-md border border-current/20 bg-black/20 px-2 py-1 text-[10px] font-black uppercase">
              {statusLabel(check.status)}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 opacity-85">{check.message}</p>
        </div>
      </div>
    </div>
  );
}

function setupStatusClass(status: FriendlyCheck["status"]) {
  if (status === "passed") return "border-emerald-300/25 bg-emerald-400/10 text-emerald-100";
  if (status === "failed") return "border-red-300/25 bg-red-400/10 text-red-100";
  if (status === "warning") return "border-orange-300/25 bg-orange-400/10 text-orange-100";
  return "border-white/10 bg-white/[0.04] text-zinc-300";
}

function statusLabel(status: FriendlyCheck["status"]) {
  if (status === "passed") return "Passed";
  if (status === "failed") return "Failed";
  if (status === "warning") return "Warning";
  return "Pending";
}

function AdvancedDiagnostics({
  checks,
  manualAdmPath,
  setManualAdmPath,
  busy,
  onTestAdmPath,
}: {
  checks: OnboardingChecks | null;
  manualAdmPath: string;
  setManualAdmPath: (value: string) => void;
  busy: boolean;
  onTestAdmPath: (path: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const admLog = checks?.admLog;
  return (
    <div className="mt-6 rounded-lg border border-violet-300/15 bg-violet-950/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase text-violet-100">Advanced diagnostics</p>
          <p className="mt-1 text-sm text-zinc-400">Technical diagnostics for support only.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center justify-center rounded-lg border border-violet-300/25 bg-violet-400/10 px-4 py-2 text-xs font-black uppercase text-violet-50 transition hover:border-violet-300/45"
        >
          {open ? "Hide technical details" : "Show technical details"}
        </button>
      </div>
      {open ? (
        <div className="mt-4 max-h-[360px] overflow-auto rounded-lg border border-white/10 bg-black/30 p-4">
          <div>
            <label className="text-xs font-black uppercase text-zinc-500" htmlFor="manual-adm-path">
              Manual ADM log path
            </label>
            <div className="mt-2 flex flex-col gap-3 lg:flex-row">
              <input
                id="manual-adm-path"
                value={manualAdmPath}
                onChange={(event) => setManualAdmPath(event.target.value)}
                placeholder="dayzps/config/DayZServer_PS4_x64_2026-05-14_12-01-39.ADM"
                className="h-12 flex-1 rounded-lg border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-300/60"
              />
              <button
                type="button"
                disabled={busy || !manualAdmPath.trim()}
                onClick={() => onTestAdmPath(manualAdmPath)}
                className="h-12 rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Test ADM Path
              </button>
            </div>
          </div>
          {admLog ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Summary label="Newest ADM file" value={redactDiagnosticValue(admLog.newestAdmFileName ?? "Not found")} />
              <Summary label="ADM path found" value={redactDiagnosticValue(admLog.admPath ?? "Not found")} />
              <Summary label="Last checked" value={formatCheckedAt(admLog.lastCheckedAt)} />
              <Summary label="Sample read" value={admLog.sampleReadSucceeded ? "Succeeded" : "Waiting for readable ADM data"} />
            </div>
          ) : null}
          {admLog?.debug ? <AdmApiDebugPanel debug={admLog.debug} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function LiveStep({ server, service, checks, finalError, onRetryTest, onBack }: { server: LinkedServer | null; service?: NitradoService; checks: OnboardingChecks | null; finalError: string; onRetryTest: () => void | Promise<void>; onBack: () => void }) {
  const reduceMotion = useReducedMotion();
  const serverName = server?.display_name ?? server?.hostname ?? server?.server_name ?? service?.name ?? "Your DayZ server";
  const publicHref = server?.public_slug ? `/servers/profile?slug=${encodeURIComponent(server.public_slug)}` : "/servers";
  const isFailure = Boolean(finalError || !server);
  const admPending = Boolean(checks?.admLog?.admFileExists && !checks.admLog.sampleReadSucceeded);

  useEffect(() => {
    console.log(isFailure ? "DZN SETUP FAILURE STATE LOADED" : "DZN SETUP SUCCESS CELEBRATION LOADED");
  }, [isFailure]);

  if (isFailure) {
    const attention = getSetupReviewState({ service, checks }).attention[0];
    return <SetupFailureState reason={finalError || attention?.message || "We could not complete your server setup yet."} onRetryTest={onRetryTest} onBack={onBack} />;
  }

  return (
    <div className="relative overflow-hidden rounded-lg">
      {!reduceMotion ? <CelebrationField /> : null}
      <div className="relative z-10 glass-surface animated-border overflow-hidden rounded-lg p-6 text-center sm:p-8">
        <div className="relative z-10">
          <motion.div
            initial={reduceMotion ? false : { scale: 0.75, opacity: 0 }}
            animate={reduceMotion ? undefined : { scale: [0.75, 1.12, 1], opacity: 1 }}
            transition={{ duration: 0.72, ease: "easeOut" }}
            className="mx-auto grid h-20 w-20 place-items-center rounded-lg border border-emerald-300/35 bg-emerald-400/15 text-emerald-100 shadow-[0_0_46px_rgba(52,211,153,0.45)]"
          >
            <CheckCircle2 className="h-11 w-11" />
          </motion.div>
          <motion.h2
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12 }}
            className="mt-7 bg-gradient-to-r from-white via-emerald-100 to-violet-100 bg-clip-text text-4xl font-black uppercase text-transparent sm:text-5xl"
          >
            Setup Complete!
          </motion.h2>
          <p className="mt-3 text-xl font-black text-white">{serverName}</p>
          <div className="mt-4 flex justify-center">
            <span className="rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-4 py-2 text-xs font-black uppercase text-emerald-100">
              Online / Live
            </span>
          </div>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-zinc-300">
            Your server is now listed on DZN Network.
          </p>
          <p className={`mx-auto mt-4 max-w-2xl rounded-lg border px-4 py-3 text-sm font-bold leading-6 ${admPending ? "border-orange-300/20 bg-orange-400/10 text-orange-50" : "border-emerald-300/20 bg-emerald-400/10 text-emerald-50"}`}>
            PvP stats will begin syncing automatically as ADM activity becomes available.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: "Global Rankings", icon: Trophy },
              { title: "Player Profiles", icon: Users },
              { title: "Live Kill Feed", icon: Crosshair },
              { title: "Server Analytics", icon: BarChart3 },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-white/10 bg-black/24 p-4 text-left">
                <item.icon className="h-6 w-6 text-violet-200" />
                <p className="mt-3 text-sm font-black uppercase text-white">{item.title}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">Activates as the DZN sync engine comes online.</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/dashboard" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white shadow-[0_0_28px_rgba(139,92,246,0.42)] transition hover:bg-violet-400">
              Open Dashboard
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link href={publicHref} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-5 text-xs font-black uppercase text-emerald-50 transition hover:border-emerald-300/40">
              View Public Page
            </Link>
            <Link href="/servers" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-5 text-xs font-black uppercase text-zinc-100 transition hover:border-violet-300/35 hover:text-white">
              View Network
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupFailureState({ reason, onRetryTest, onBack }: { reason: string; onRetryTest: () => void | Promise<void>; onBack: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(248,113,113,0.18),transparent_28%),radial-gradient(circle_at_80%_70%,rgba(251,191,36,0.12),transparent_24%)]" />
      <div className="relative z-10 glass-surface animated-border rounded-lg border-red-300/20 p-6 text-center sm:p-8">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: [0.9, 1.05, 1], opacity: 1 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="mx-auto grid h-20 w-20 place-items-center rounded-lg border border-orange-300/35 bg-orange-400/15 text-orange-100 shadow-[0_0_42px_rgba(251,146,60,0.32)]"
        >
          <AlertTriangle className="h-11 w-11" />
        </motion.div>
        <h2 className="mt-7 text-4xl font-black uppercase text-white sm:text-5xl">Setup Needs Attention</h2>
        <p className="mt-3 text-lg font-bold text-zinc-300">We could not complete your server setup yet.</p>
        <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-orange-300/20 bg-orange-400/10 p-4 text-left">
          <p className="text-xs font-black uppercase text-orange-100/80">What happened</p>
          <p className="mt-2 text-sm font-bold leading-6 text-orange-50">{friendlyFailureReason(reason)}</p>
          <p className="mt-4 text-xs font-black uppercase text-zinc-400">Next steps</p>
          <ol className="mt-2 space-y-1 text-sm leading-6 text-zinc-300">
            <li>1. Review the failed or warning check on Review & Test.</li>
            <li>2. Wait a few minutes if Nitrado has just restarted or created a new ADM log.</li>
            <li>3. Run the test again after making changes.</li>
          </ol>
        </div>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={onRetryTest} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white shadow-[0_0_28px_rgba(139,92,246,0.42)] transition hover:bg-violet-400">
            Run Test Again
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" onClick={onBack} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-5 text-xs font-black uppercase text-zinc-100 transition hover:border-violet-300/35 hover:text-white">
            Back to Review & Test
          </button>
          <a href="mailto:support@dayz-network.com" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-orange-300/20 bg-orange-400/10 px-5 text-xs font-black uppercase text-orange-50 transition hover:border-orange-300/40">
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}

function Step({ title, description, icon: Icon, children }: { title: string; description: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div>
      <span className="grid h-12 w-12 place-items-center rounded-lg border border-violet-300/25 bg-violet-400/10 text-violet-100">
        <Icon className="h-6 w-6" />
      </span>
      <h2 className="mt-5 text-3xl font-black uppercase text-white sm:text-4xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-zinc-300">{description}</p>
      <div className="mt-7">{children}</div>
    </div>
  );
}

function WizardButton({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white shadow-[0_0_28px_rgba(139,92,246,0.42)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-45">
      {children}
      <ChevronRight className="h-4 w-4" />
    </button>
  );
}

function CelebrationField() {
  const confetti = Array.from({ length: 34 }, (_, index) => ({
    id: `confetti-${index}`,
    left: `${8 + ((index * 23) % 84)}%`,
    delay: index * 0.035,
    x: (index % 2 === 0 ? 1 : -1) * (22 + (index % 7) * 10),
    rotate: (index % 2 === 0 ? 1 : -1) * (120 + (index % 8) * 26),
    color: ["bg-violet-300", "bg-emerald-300", "bg-cyan-200", "bg-white", "bg-yellow-200"][index % 5],
  }));
  const particles = Array.from({ length: 18 }, (_, index) => ({
    id: `success-particle-${index}`,
    left: `${12 + ((index * 31) % 78)}%`,
    top: `${32 + ((index * 17) % 38)}%`,
    delay: index * 0.09,
  }));

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, scale: 0.82 }}
        animate={{ opacity: [0, 0.85, 0], scale: [0.82, 1.18, 1.34] }}
        transition={{ duration: 3.6, ease: "easeOut" }}
        className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/18 blur-3xl"
      />
      {confetti.map((item) => (
        <motion.span
          key={item.id}
          initial={{ opacity: 0, y: 40, x: 0, rotate: 0, scale: 0.8 }}
          animate={{ opacity: [0, 1, 1, 0], y: [-8, -130, -190], x: [0, item.x, item.x * 1.35], rotate: item.rotate, scale: [0.8, 1, 0.92] }}
          transition={{ duration: 3.2, delay: item.delay, ease: "easeOut" }}
          className={`absolute bottom-[16%] h-2 w-5 rounded-sm ${item.color} shadow-[0_0_18px_rgba(255,255,255,0.28)]`}
          style={{ left: item.left }}
        />
      ))}
      {particles.map((item) => (
        <motion.span
          key={item.id}
          initial={{ opacity: 0, y: 18, scale: 0.6 }}
          animate={{ opacity: [0, 0.9, 0], y: [-8, -58], scale: [0.6, 1.1, 0.7] }}
          transition={{ duration: 3.8, delay: item.delay, ease: "easeOut" }}
          className="absolute grid h-8 w-8 place-items-center text-violet-100/70"
          style={{ left: item.left, top: item.top }}
        >
          <Sparkles className="h-4 w-4" />
        </motion.span>
      ))}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <p className="text-xs font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-2 break-words font-bold text-white">{value}</p>
    </div>
  );
}

function AdmApiDebugPanel({ debug }: { debug: AdmApiDebug }) {
  const methods = debug.methodsTried.slice(0, 80);
  const diagnosticsObject = sanitizeDiagnostics({
    message: debug.message,
    exactManualPath: debug.exactManualPath,
    newestSelectedAdmFile: debug.selectedGameSpecificAdmFile,
    exactSelectedAdmPath: debug.exactSelectedAdmPath,
    apiLogFilePathTested: debug.apiLogFilePathTested,
    gameserverUsernameFound: debug.gameserverUsernameFound,
    gameSpecificLogFilesFound: debug.gameSpecificLogFilesFound,
    gameSpecificLogFilesReturned: debug.gameSpecificLogFilesReturned,
    gameSpecificAdmFilesFound: debug.gameSpecificAdmFilesFound,
    sampleReadStatus: debug.sampleReadStatus,
    sampleReadSucceeded: debug.sampleReadSucceeded,
    pathsChecked: debug.pathsChecked,
    pathVariants: debug.pathVariants,
    listAttempts: debug.listAttempts,
    methodsTried: methods,
  });
  return (
    <div className="mt-5 rounded-lg border border-violet-300/15 bg-violet-950/10 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-black uppercase text-violet-200/70">Technical ADM diagnostics</p>
        <span className="text-xs font-bold text-zinc-500">{formatCheckedAt(debug.lastCheckedAt)}</span>
      </div>
      {debug.message ? (
        <p className="mt-3 rounded-lg border border-orange-300/20 bg-orange-400/10 px-3 py-2 text-sm font-bold text-orange-100">
          {friendlyAdmMessage(debug.message)}
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Summary label="ADM path tested" value={redactDiagnosticValue(debug.exactManualPath ?? debug.apiLogFilePathTested ?? "Not provided")} />
        <Summary label="Selected ADM path" value={redactDiagnosticValue(debug.exactSelectedAdmPath ?? "Not selected")} />
        <Summary label="Gameserver username found" value={debug.gameserverUsernameFound ? "yes" : "no"} />
        <Summary label="game_specific.log_files found" value={debug.gameSpecificLogFilesFound ? "yes" : "no"} />
        <Summary label="Log files returned" value={String(debug.gameSpecificLogFilesReturned)} />
        <Summary label="Sample read status" value={debug.sampleReadStatus} />
        <Summary label="Sample read succeeded" value={debug.sampleReadSucceeded ? "yes" : "no"} />
      </div>
      <DebugList title="Paths checked" items={(debug.pathsChecked.length ? debug.pathsChecked : ["No paths checked"]).map(redactDiagnosticValue).slice(0, 24)} />
      <DebugList title="ADM files found" items={(debug.filesFound.length ? debug.filesFound : ["No ADM files returned by API"]).map(redactDiagnosticValue).slice(0, 24)} />
      <div className="mt-4">
        <p className="text-xs font-black uppercase text-zinc-500">Methods tried</p>
        <div className="mt-2 grid gap-2 pr-1">
          {methods.map((attempt, index) => (
            <div key={`${attempt.method}-${attempt.path ?? attempt.dir ?? "detail"}-${attempt.search ?? "none"}-${index}`} className="grid gap-2 rounded-lg border border-white/10 bg-black/24 p-3 text-xs text-zinc-300 md:grid-cols-[70px_90px_90px_1fr]">
              <span className="font-black text-violet-100">{attempt.pathVariantLabel ?? "-"}</span>
              <span className="font-black text-violet-100">{attempt.method}</span>
              <span className={attempt.status === "OK" ? "font-black text-emerald-100" : "font-black text-orange-100"}>
                {attempt.status}{attempt.httpStatusCode ? ` / ${attempt.httpStatusCode}` : ""}
              </span>
              <span className="break-words">{attempt.pathRedacted || attempt.redactedPath || attempt.path ? `path: ${redactDiagnosticValue(attempt.pathRedacted ?? attempt.redactedPath ?? attempt.path ?? "")}` : `dir: ${redactDiagnosticValue(attempt.dir ?? "-")}`}</span>
            </div>
          ))}
        </div>
      </div>
      <pre className="mt-4 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-5 text-zinc-300">
        {JSON.stringify(diagnosticsObject, null, 2)}
      </pre>
      {debug.samplePreview ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase text-zinc-500">Sample preview</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-xs leading-5 text-zinc-300">
            {redactDiagnosticValue(debug.samplePreview)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function DebugList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-black uppercase text-zinc-500">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="break-all rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-zinc-300">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function sanitizeDiagnostics(value: unknown): unknown {
  if (typeof value === "string") return redactDiagnosticValue(value);
  if (Array.isArray(value)) return value.map(sanitizeDiagnostics);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(token|secret|password|credential|authorization|auth_url|download_url)/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = sanitizeDiagnostics(child);
    }
  }
  return result;
}

function redactDiagnosticValue(value: string) {
  return value
    .replace(/\/games\/\{gameserver-username\}\/noftp/gi, "/games/[gameserver]/noftp")
    .replace(/\/games\/[^/\s]+\/noftp/gi, "/games/[gameserver]/noftp")
    .replace(/token=([^&\s]+)/gi, "token=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}

function friendlyAdmMessage(value: string) {
  if (/not yet readable|did not return|file api|sample read/i.test(value)) {
    return "ADM logs found, waiting for Nitrado to make the latest file readable.";
  }
  if (/could not list|not found/i.test(value)) {
    return "DZN connected to Nitrado, but could not find ADM log files yet.";
  }
  return redactDiagnosticValue(value);
}

function friendlyFailureReason(value: string) {
  if (/token|unauthorized|access/i.test(value)) return "Your Nitrado token was rejected or no longer has access. Check the token and try again.";
  if (/service/i.test(value) && /not found|missing|selected/i.test(value)) return "No DayZ service was found for that Service ID. Confirm the Service ID and token access.";
  if (/dayz/i.test(value)) return "This Nitrado service does not look like a DayZ server.";
  if (/adm|log|readable|file api/i.test(value)) return "ADM logs were found, but Nitrado has not made the latest file readable yet. This can happen shortly after a restart.";
  return value;
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function extractNitradoServiceId(value: string) {
  const direct = value.trim().match(/^\d{5,}$/);
  if (direct) return direct[0];
  const webInterface = value.match(/webinterface\.nitrado\.net\/(\d+)/i);
  if (webInterface?.[1]) return webInterface[1];
  const services = value.match(/server\.nitrado\.net\/.*?services\/(\d+)/i);
  if (services?.[1]) return services[1];
  return "";
}

function parseLinkedServerTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
