"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronRight,
  Gamepad2,
  KeyRound,
  Loader2,
  Server,
  ShieldCheck,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import {
  getGuilds,
  getMe,
  getNitradoServices,
  goLive,
  saveOnboarding,
  testAdmPath,
  testOnboarding,
  validateNitradoToken,
} from "./api";
import type { AdmApiDebug, DiscordGuild, NitradoService, OnboardingChecks } from "./types";
import { DznLogo } from "@/components/dzn/dzn-logo";

const steps = [
  "Select Discord Server",
  "Server Type & Categories",
  "Connect Nitrado Account",
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
  const [selectedService, setSelectedService] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<OnboardingChecks | null>(null);

  useEffect(() => {
    async function load() {
      try {
        await getMe();
        setAuthenticated(true);
        const guildResult = await getGuilds();
        setGuilds(guildResult.guilds);
        if (guildResult.guilds[0]) setSelectedGuild(guildResult.guilds[0].guild_id);
      } catch {
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const selectedGuildData = useMemo(
    () => guilds.find((guild) => guild.guild_id === selectedGuild),
    [guilds, selectedGuild],
  );
  const selectedServiceData = useMemo(
    () => services.find((service) => service.id === selectedService),
    [services, selectedService],
  );

  async function validateToken() {
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
      const serviceResult = await getNitradoServices();
      setServices(serviceResult.services);
      if (serviceResult.services[0]) setSelectedService(serviceResult.services[0].id);
      setStep(3);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nitrado token validation failed");
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
    try {
      await goLive();
      setStep(5);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Go-live failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      if (current.length >= 5) return current;
      return [...current, tag];
    });
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
    <SetupFrame>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="glass-surface animated-border rounded-lg p-5">
          <div className="relative z-10">
            <p className="text-xs font-black uppercase text-violet-200/70">Verification flow</p>
            <h1 className="mt-2 text-2xl font-black uppercase text-white">Server onboarding</h1>
            <div className="mt-6 space-y-3">
              {steps.map((label, index) => (
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
                  <GuildStep guilds={guilds} selectedGuild={selectedGuild} setSelectedGuild={setSelectedGuild} onNext={() => setStep(1)} />
                ) : null}
                {step === 1 ? (
                  <TypeStep serverType={serverType} setServerType={setServerType} selectedTags={selectedTags} toggleTag={toggleTag} onNext={() => setStep(2)} />
                ) : null}
                {step === 2 ? (
                  <TokenStep tokenInput={tokenInput} setTokenInput={setTokenInput} tokenValid={tokenValid} busy={busy} onValidate={validateToken} />
                ) : null}
                {step === 3 ? (
                  <ServiceStep services={services} selectedService={selectedService} setSelectedService={setSelectedService} onNext={saveAndReview} busy={busy} />
                ) : null}
                {step === 4 ? (
                  <ReviewStep guild={selectedGuildData} service={selectedServiceData} serverType={serverType} tags={selectedTags} checks={checks} busy={busy} onTest={runTest} onTestAdmPath={runManualAdmPathTest} onGoLive={publish} />
                ) : null}
                {step === 5 ? <LiveStep /> : null}
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

function SetupFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] px-5 py-8 text-white sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(139,92,246,0.25),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.14),transparent_26%),linear-gradient(180deg,#02030a_0%,#07101f_52%,#02030a_100%)]" />
      <div className="scanline absolute inset-0 opacity-20" />
      <div className="relative z-10 mx-auto max-w-7xl">
        <nav className="mb-8 flex items-center justify-between">
          <DznLogo />
          <Link href="/dashboard" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase text-zinc-200">
            Dashboard
          </Link>
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

function GuildStep({ guilds, selectedGuild, setSelectedGuild, onNext }: { guilds: DiscordGuild[]; selectedGuild: string; setSelectedGuild: (value: string) => void; onNext: () => void }) {
  return (
    <Step title="Select Discord Server" icon={Users} description="Only guilds you own or administer are eligible for DZN Network verification.">
      <div className="grid gap-3">
        {guilds.map((guild) => (
          <button key={guild.guild_id} type="button" onClick={() => setSelectedGuild(guild.guild_id)} className={`flex items-center gap-4 rounded-lg border p-4 text-left transition ${selectedGuild === guild.guild_id ? "border-violet-300/50 bg-violet-400/12" : "border-white/10 bg-white/[0.03]"}`}>
            {guild.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={guild.icon_url} alt="" className="h-12 w-12 rounded-lg" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-violet-500/20 text-lg font-black">{guild.name[0]}</span>
            )}
            <span className="flex-1">
              <span className="block font-black text-white">{guild.name}</span>
              <span className="text-xs font-bold uppercase text-zinc-500">{guild.owner ? "Owner" : "Administrator"}</span>
            </span>
          </button>
        ))}
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

function TokenStep({ tokenInput, setTokenInput, tokenValid, busy, onValidate }: { tokenInput: string; setTokenInput: (value: string) => void; tokenValid: boolean; busy: boolean; onValidate: () => void }) {
  return (
    <Step title="Connect Nitrado Account" icon={KeyRound} description="Paste your Nitrado access token. It is sent only to the backend, encrypted, and never returned to this page.">
      <input value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} type="password" autoComplete="off" placeholder="Nitrado API token" className="h-12 w-full rounded-lg border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-violet-300/60" />
      <WizardButton disabled={!tokenInput || busy} onClick={onValidate}>
        {busy ? "Validating" : tokenValid ? "Validated" : "Validate token"}
      </WizardButton>
    </Step>
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
  const canGoLive = Boolean(checks?.tokenValid && checks.serviceAccess && checks.dayzServiceDetected);
  const checkRows = checks
    ? [
        ["tokenValid", checks.tokenValid],
        ["serviceAccess", checks.serviceAccess],
        ["admLogsFound", checks.admLogsFound],
        ["dayzServiceDetected", checks.dayzServiceDetected],
      ] as const
    : [];
  return (
    <Step title="Review & Test" icon={ShieldCheck} description="Confirm details and run the owner verification checks before publishing.">
      <div className="grid gap-3 md:grid-cols-2">
        <Summary label="Discord guild" value={guild?.name ?? "Not selected"} />
        <Summary label="Nitrado service" value={service?.name ?? "Not selected"} />
        <Summary label="Server type" value={serverType} />
        <Summary label="Tags" value={tags.length ? tags.join(", ") : "No optional tags"} />
      </div>
      {checks ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {checkRows.map(([key, value]) => (
              <div key={key} className={`rounded-lg border p-3 text-sm font-bold ${value ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-orange-300/25 bg-orange-400/10 text-orange-100"}`}>
                {key}: {value ? "Passed" : "Needs review"}
              </div>
            ))}
          </div>
        </>
      ) : null}
      <div className="mt-5 rounded-lg border border-white/10 bg-black/24 p-4">
        <p className="text-xs font-black uppercase text-violet-200/70">ADM discovery</p>
        <div className="mt-4">
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
          <p className="mt-2 text-sm text-zinc-400">
            The visible Nitrado Web Interface path may differ from the API file path. DZN will first try Nitrado&apos;s game_specific.log_files API list.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Copy this from Nitrado - Information - Log Files - Your log link when a manual fallback is needed.
          </p>
        </div>
        {checks?.admLog ? (
          <>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <Summary label="Newest ADM file" value={checks.admLog.newestAdmFileName ?? "Not found"} />
              <Summary label="ADM path found" value={checks.admLog.admPath ?? "Not found"} />
              <Summary label="Last checked" value={formatCheckedAt(checks.admLog.lastCheckedAt)} />
              <Summary label="Sample read" value={checks.admLog.sampleReadSucceeded ? "Succeeded" : "Not available"} />
            </div>
            {checks.admLog.debug ? <AdmApiDebugPanel debug={checks.admLog.debug} /> : null}
          </>
        ) : null}
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <WizardButton disabled={busy} onClick={onTest}>{busy ? "Testing" : "Run test"}</WizardButton>
        <WizardButton disabled={!canGoLive || busy} onClick={onGoLive}>Go live</WizardButton>
      </div>
    </Step>
  );
}

function LiveStep() {
  return (
    <Step title="Go Live" icon={Gamepad2} description="Your verified DayZ server is now ready for DZN Network discovery.">
      <Link href="/dashboard" className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-violet-500 px-5 text-xs font-black uppercase text-white">
        Open dashboard
        <ChevronRight className="h-4 w-4" />
      </Link>
    </Step>
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

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/24 p-4">
      <p className="text-xs font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-2 break-words font-bold text-white">{value}</p>
    </div>
  );
}

function AdmApiDebugPanel({ debug }: { debug: AdmApiDebug }) {
  return (
    <div className="mt-5 rounded-lg border border-violet-300/15 bg-violet-950/10 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-black uppercase text-violet-200/70">ADM API Debug</p>
        <span className="text-xs font-bold text-zinc-500">{formatCheckedAt(debug.lastCheckedAt)}</span>
      </div>
      {debug.message ? (
        <p className="mt-3 rounded-lg border border-orange-300/20 bg-orange-400/10 px-3 py-2 text-sm font-bold text-orange-100">
          {debug.message}
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Summary label="Exact manual path tested" value={debug.exactManualPath ?? "Not provided"} />
        <Summary label="Exact selected ADM path" value={debug.exactSelectedAdmPath ?? "Not selected"} />
        <Summary label="Gameserver username found" value={debug.gameserverUsernameFound ? "yes" : "no"} />
        <Summary label="Actual username used" value={debug.actualUsernameUsed ? "yes" : "no"} />
        <Summary label="Username redacted in UI" value={debug.usernameRedactedInUi ? "yes" : "no"} />
        <Summary label="game_specific.log_files found" value={debug.gameSpecificLogFilesFound ? "yes" : "no"} />
        <Summary label="Log files returned" value={String(debug.gameSpecificLogFilesReturned)} />
        <Summary label="ADM files from log_files" value={String(debug.gameSpecificAdmFilesFound.length)} />
        <Summary label="Selected game_specific ADM" value={debug.selectedGameSpecificAdmFile ?? "Not selected"} />
        <Summary label="API file path tested" value={debug.apiLogFilePathTested ?? "Not tested"} />
        <Summary label="File visible through stat" value={debug.fileVisibleThroughStat ? "yes" : "no"} />
        <Summary label="Download token created" value={debug.downloadTokenCreated ? "yes" : "no"} />
        <Summary label="Token URL received" value={debug.tokenUrlReceived ? "yes" : "no"} />
        <Summary label="Sample fetch attempted" value={debug.sampleFetchAttempted ? "yes" : "no"} />
        <Summary label="Sample fetch status" value={debug.sampleFetchStatus} />
        <Summary label="Sample read status" value={debug.sampleReadStatus} />
        <Summary label="Sample read succeeded" value={debug.sampleReadSucceeded ? "yes" : "no"} />
      </div>
      <DebugList title="Nitrado API log file paths tested" items={debug.apiLogFilePathVariants.length ? debug.apiLogFilePathVariants : ["No game_specific API paths"]} />
      <DebugList title="ADM files from game_specific.log_files" items={debug.gameSpecificAdmFilesFound.length ? debug.gameSpecificAdmFilesFound : ["No ADM files returned by game_specific.log_files"]} />
      <DebugList title="Path variants tested" items={debug.pathVariants.length ? debug.pathVariants : ["No path variants"]} />
      <DebugList title="Paths checked" items={debug.pathsChecked} />
      <DebugList title="ADM files found" items={debug.filesFound.length ? debug.filesFound : ["No ADM files returned by API"]} />
      <div className="mt-4">
        <p className="text-xs font-black uppercase text-zinc-500">Methods tried</p>
        <div className="mt-2 grid max-h-72 gap-2 overflow-auto pr-1">
          {debug.methodsTried.map((attempt, index) => (
            <div key={`${attempt.method}-${attempt.path ?? attempt.dir ?? "detail"}-${attempt.search ?? "none"}-${index}`} className="grid gap-2 rounded-lg border border-white/10 bg-black/24 p-3 text-xs text-zinc-300 lg:grid-cols-[90px_70px_1fr_1fr]">
              <span className="font-black text-violet-100">{attempt.method}</span>
              <span className={attempt.status === "OK" ? "font-black text-emerald-100" : "font-black text-orange-100"}>{attempt.status}</span>
              <span className="break-words">{attempt.pathRedacted || attempt.path ? `path: ${attempt.pathRedacted ?? attempt.path}` : `dir: ${attempt.dir ?? "-"}`}</span>
              <span className="break-words">
                {attempt.method === "list"
                  ? `search: ${attempt.search ?? "none"} | entries: ${attempt.entriesReturned ?? 0} | ADM: ${attempt.admFilesFound ?? 0}`
                  : attempt.method === "stat"
                    ? `visible: ${attempt.fileVisible ? "yes" : "no"} | ${formatShape(attempt.responseShape)}${attempt.errorMessageSafe ? ` | ${attempt.errorMessageSafe}` : ""}`
                    : attempt.method === "service-details"
                      ? `paths: ${attempt.entriesReturned ?? 0} | log_files: ${debug.gameSpecificLogFilesReturned} | ADM: ${debug.gameSpecificAdmFilesFound.length}`
                      : `token: ${attempt.downloadTokenCreated ? "yes" : "no"} | token URL: ${attempt.tokenUrlReceived ? "yes" : "no"} | fetch: ${attempt.sampleFetchAttempted ? attempt.sampleFetchStatus ?? "error" : "no"} | sample: ${attempt.sampleReadSucceeded ? "yes" : "no"} | ${formatShape(attempt.responseShape)}${attempt.errorMessageSafe ? ` | ${attempt.errorMessageSafe}` : ""}`}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <p className="text-xs font-black uppercase text-zinc-500">List attempts</p>
        <div className="mt-2 grid max-h-64 gap-2 overflow-auto pr-1">
          {debug.listAttempts.map((attempt, index) => (
            <div key={`${attempt.dir}-${attempt.search ?? "none"}-${index}`} className="grid gap-2 rounded-lg border border-white/10 bg-black/24 p-3 text-xs text-zinc-300 md:grid-cols-[70px_1fr_1fr]">
              <span className={attempt.status === "OK" ? "font-black text-emerald-100" : "font-black text-orange-100"}>{attempt.status}</span>
              <span className="break-words">dir: {attempt.dir}</span>
              <span className="break-words">search: {attempt.search ?? "none"} | ADM: {attempt.admFileCount}</span>
            </div>
          ))}
        </div>
      </div>
      {debug.samplePreview ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase text-zinc-500">Sample preview</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-xs leading-5 text-zinc-300">
            {debug.samplePreview}
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

function formatCheckedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatShape(shape: AdmApiDebug["methodsTried"][number]["responseShape"]) {
  if (!shape) return "shape: data no / token no / url no / value no";
  return `shape: data ${shape.hasData ? "yes" : "no"} / token ${shape.hasToken ? "yes" : "no"} / url ${shape.hasTokenUrl ? "yes" : "no"} / value ${shape.hasTokenValue ? "yes" : "no"}`;
}
