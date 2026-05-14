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
  testOnboarding,
  validateNitradoToken,
} from "./api";
import type { DiscordGuild, NitradoService, OnboardingChecks } from "./types";
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
                  <ReviewStep guild={selectedGuildData} service={selectedServiceData} serverType={serverType} tags={selectedTags} checks={checks} busy={busy} onTest={runTest} onGoLive={publish} />
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

function ReviewStep({ guild, service, serverType, tags, checks, busy, onTest, onGoLive }: { guild?: DiscordGuild; service?: NitradoService; serverType: string; tags: string[]; checks: OnboardingChecks | null; busy: boolean; onTest: () => void; onGoLive: () => void }) {
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
          {checks.admLog ? (
            <div className="mt-5 rounded-lg border border-white/10 bg-black/24 p-4">
              <p className="text-xs font-black uppercase text-violet-200/70">ADM discovery</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Summary label="Newest ADM file" value={checks.admLog.newestAdmFileName ?? "Not found"} />
                <Summary label="ADM path found" value={checks.admLog.admPath ?? "Not found"} />
                <Summary label="Last checked" value={formatCheckedAt(checks.admLog.lastCheckedAt)} />
                <Summary label="Sample read" value={checks.admLog.sampleReadSucceeded ? "Succeeded" : "Not available"} />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
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

function formatCheckedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
