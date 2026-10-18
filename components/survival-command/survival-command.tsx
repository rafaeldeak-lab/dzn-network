"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, BadgeAlert, Binoculars, Boxes, Check, ChevronRight, Clock3, Crosshair, LockKeyhole, MapPinned, Radio, ShieldCheck, TowerControl, Truck, Wrench, Zap } from "lucide-react";
import { SiteHeaderAuthState, SiteHomeLink } from "../site-header";
import {
  SURVIVAL_COMMAND_APPROACHES,
  SURVIVAL_COMMAND_SECTOR_KEYS,
  type SurvivalCommandApproach,
  type SurvivalCommandPayload,
  type SurvivalCommandSector,
} from "../../lib/survival-command";
import { SurvivalCommandScene } from "./survival-command-scene";
import styles from "./survival-command.module.css";

const APPROACH_ICONS: Record<SurvivalCommandApproach, typeof Radio> = { scout: Binoculars, balanced: ShieldCheck, breach: Crosshair };

function duration(value: number) {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function time(value: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function SurvivalCommand() {
  const [payload, setPayload] = useState<SurvivalCommandPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [selectedSector, setSelectedSector] = useState<SurvivalCommandSector>("perimeter");
  const [approach, setApproach] = useState<SurvivalCommandApproach>("balanced");
  const [motionRunning, setMotionRunning] = useState(true);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const mutationLock = useRef(false);
  const readyRefreshRef = useRef<string | null>(null);
  const dayRefreshRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/player/survival-command", { cache: "no-store" });
    const result = await response.json() as SurvivalCommandPayload & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Survival Command is unavailable.");
    const received = Date.now();
    setPayload(result);
    setReceivedAt(received);
    setClock(received);
    setError(null);
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setMotionRunning(!motion.matches && document.visibilityState === "visible");
    syncMotion();
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    const load = async () => {
      try { await refresh(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Survival Command is unavailable."); }
    };
    const queuedLoad = window.setTimeout(() => { void load(); }, 0);
    return () => { clearTimeout(queuedLoad); motion.removeEventListener("change", syncMotion); document.removeEventListener("visibilitychange", syncMotion); };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const serverNow = useMemo(() => payload ? payload.serverTime + Math.max(0, clock - receivedAt) : 0, [clock, payload, receivedAt]);
  const selected = payload?.sectors.find(sector => sector.key === selectedSector) ?? null;
  const expedition = payload?.expedition ?? null;
  const activeRemaining = expedition ? Math.max(0, expedition.readyAt - serverNow) : 0;
  const serverDayKey = serverNow ? new Date(serverNow).toISOString().slice(0, 10) : null;

  useEffect(() => {
    if (!expedition || expedition.state !== "in-transit" || activeRemaining > 0) return;
    if (readyRefreshRef.current === expedition.id) return;
    readyRefreshRef.current = expedition.id;
    void refresh().catch(reason => setError(reason instanceof Error ? reason.message : "The field decision could not be loaded."));
  }, [activeRemaining, expedition, refresh]);

  useEffect(() => {
    if (!payload || !serverDayKey || payload.deployment.dayKey === serverDayKey) return;
    if (dayRefreshRef.current === serverDayKey) return;
    dayRefreshRef.current = serverDayKey;
    void refresh().catch(reason => setError(reason instanceof Error ? reason.message : "The new deployment cycle could not be loaded."));
  }, [payload, refresh, serverDayKey]);

  const mutate = async (key: string, body: Record<string, unknown>) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(key); setError(null);
    try {
      const response = await fetch("/api/player/survival-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as SurvivalCommandPayload & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The field order could not be recorded.");
      const received = Date.now();
      setPayload(result); setReceivedAt(received); setClock(received);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The field order could not be recorded."); }
    finally { mutationLock.current = false; setBusy(null); }
  };

  const activeSector = expedition ? payload?.sectors.find(sector => sector.key === expedition.sector) ?? null : null;
  return <main className={styles.page} data-motion={motionRunning ? "running" : "paused"}>
    <SiteHeaderAuthState authenticated={Boolean(payload)} checkingAccount={!payload && !error} returnTo="/survival-command" />
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Survival Command navigation">
        <SiteHomeLink className={styles.home} />
        <div className={styles.navTrail}><Link href="/games" prefetch={false}>Field drills</Link><ChevronRight size={14} /><span>Survival Command</span></div>
        <Link className={styles.back} href="/command-centre" prefetch={false}><TowerControl size={16} />Command Centre</Link>
      </nav>

      <header className={styles.header}>
        <div><p className={styles.eyebrow}>DZN // SURVIVAL COMMAND</p><h1>Sector Operations</h1><p className={styles.intro}>Deploy from your private Command Centre, make a field decision when the team arrives, and build an enduring record of each recovery.</p></div>
        <div className={styles.accountState} aria-label="Survival Command resources">
          <span><Boxes size={17} />{payload?.resources.salvage ?? 0}<small>salvage</small></span>
          <span><Radio size={17} />{payload?.resources.intel ?? 0}<small>intel</small></span>
          <span><Activity size={17} />{payload?.resources.resolvedExpeditions ?? 0}<small>returns</small></span>
        </div>
      </header>

      {error && !payload ? <section className={styles.gate}><div><p className={styles.eyebrow}>Private player system</p><h2>Survival Command is unavailable</h2><p>{error}</p><button className={styles.primaryAction} onClick={() => void refresh()}><ArrowRight size={17} />Retry connection</button></div></section> : <>
        {error && <div className={styles.notice} role="alert"><BadgeAlert size={18} /><span>{error}</span><button aria-label="Refresh Survival Command" title="Refresh Survival Command" onClick={() => void refresh()}><ArrowRight size={16} /></button></div>}
        <section className={styles.operationBoard} aria-label="Sector operations board">
          <aside className={styles.statusRail}>
            <div className={styles.railHeading}><p className={styles.eyebrow}>Command status</p><strong>{payload?.profile ? "Field-ready" : "Not established"}</strong></div>
            <dl className={styles.railMetrics}>
              <div><dt>Deployments</dt><dd>{payload?.deployment.used ?? 0}<span> / {payload?.deployment.capacity ?? 0}</span></dd></div>
              <div><dt>Day cycle</dt><dd>{payload?.deployment.dayKey ?? "--"}</dd></div>
              <div><dt>HQ level</dt><dd>{payload?.buildings?.headquarters ?? "--"}</dd></div>
            </dl>
            <div className={styles.protocol}><ShieldCheck size={17} /><p><strong>Authoritative operations</strong>Route unlocks, timing, incidents and recovered resources are recorded by DZN, not the browser.</p></div>
          </aside>

          <div className={styles.scenePanel}>
            <SurvivalCommandScene selectedSector={expedition?.sector ?? selectedSector} expedition={expedition} motionRunning={motionRunning} onUnavailable={() => setWebglUnavailable(true)} />
            <div className={styles.sceneLabel}><MapPinned size={15} /><span>{expedition ? activeSector?.coordinate : selected?.coordinate ?? "GRID -- / --"}</span></div>
            {webglUnavailable && <div className={styles.sceneFallback}><MapPinned size={28} /><span>The 3D sector board is unavailable on this device. Mission decisions remain accessible.</span></div>}
          </div>

          <section className={styles.dossier} aria-live="polite">
            {!payload?.profile ? <EstablishDossier busy={busy} onEstablish={() => void mutate("initialize", { action: "initialize" })} />
              : expedition ? expedition.state === "in-transit"
                ? <TransitDossier sector={activeSector} remaining={activeRemaining} readyAt={expedition.readyAt} />
                : <DecisionDossier expedition={expedition} sector={activeSector} busy={busy} onResolve={decision => void mutate(`resolve:${decision}`, { action: "resolve", expeditionId: expedition.id, version: expedition.version, requestId: crypto.randomUUID(), decision })} />
                : <DeployDossier selected={selected} approach={approach} busy={busy} deployment={payload.deployment}
                  onApproach={setApproach} onDeploy={() => selected && void mutate("deploy", { action: "deploy", sector: selected.key, approach, requestId: crypto.randomUUID() })} />}
          </section>
        </section>

        <section className={styles.sectorSection} aria-labelledby="sector-heading">
          <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Deployment map</p><h2 id="sector-heading">Choose an operation</h2></div><p>Each sector needs a working settlement profile. Deeper locations have more demanding build requirements and a different risk profile.</p></div>
          <div className={styles.sectorList}>{payload?.sectors.map(sector => <button key={sector.key} className={styles.sector} data-selected={sector.key === selectedSector} data-locked={!sector.unlocked}
            onClick={() => !expedition && setSelectedSector(sector.key)} disabled={Boolean(expedition)}>
            <span className={styles.sectorIndex}>{String(SURVIVAL_COMMAND_SECTOR_KEYS.indexOf(sector.key) + 1).padStart(2, "0")}</span>
            <span className={styles.sectorCopy}><strong>{sector.name}</strong><small>{sector.coordinate}</small><em>{sector.unlocked ? sector.briefing : sector.lockReason}</em></span>
            <span className={styles.sectorMeta}>{sector.unlocked ? <><Clock3 size={14} />{duration(sector.durationMs)}</> : <LockKeyhole size={16} />}</span>
          </button>)}</div>
        </section>

        <section className={styles.history} aria-labelledby="history-heading">
          <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>Operation record</p><h2 id="history-heading">Recent returns</h2></div><p>Completion history is private to this player account and never alters DayZ server outcomes, rankings or locations.</p></div>
          {payload?.history.length ? <ol className={styles.historyList}>{payload.history.map(row => <li key={row.id}><span className={styles.historyMarker} data-outcome={row.outcome} /><div><strong>{payload.sectors.find(sector => sector.key === row.sector)?.name ?? row.sector}</strong><small>{row.outcome} resolution via {row.action}</small></div><span className={styles.historyRewards}><b>+{row.salvage}</b> salvage <b>+{row.intel}</b> intel<time>{time(row.resolvedAt)}</time></span></li>)}</ol>
            : <div className={styles.emptyHistory}><Truck size={23} /><span>Your first recovered operation will appear here.</span></div>}
        </section>
      </>}
    </div>
  </main>;
}

function EstablishDossier({ busy, onEstablish }: { busy: string | null; onEstablish: () => void }) {
  return <><p className={styles.dossierKicker}>Operations terminal</p><h2>Open a field ledger</h2><p>Your Command Centre must be established first. Sector Operations then creates a private, server-backed mission record without changing DZN standings or DayZ data.</p><button className={styles.primaryAction} disabled={busy !== null} onClick={onEstablish}><TowerControl size={18} />{busy === "initialize" ? "Opening..." : "Establish Sector Operations"}</button></>;
}

function TransitDossier({ sector, remaining, readyAt }: { sector: SurvivalCommandPayload["sectors"][number] | null; remaining: number; readyAt: number }) {
  return <><p className={styles.dossierKicker}>Team in transit</p><h2>{sector?.name ?? "Active operation"}</h2><p>{sector?.briefing}</p><div className={styles.timer}><Clock3 size={20} /><div><strong>{duration(remaining)}</strong><span>{remaining ? "until field decision" : "field decision ready"}</span></div></div><div className={styles.timeline}><span /><span /><span data-active="true" /><span /></div><p className={styles.returnTime}>Expected field contact {time(readyAt)}. You can leave this page; the clock is measured by the server.</p></>;
}

function DecisionDossier({ expedition, sector, busy, onResolve }: { expedition: NonNullable<SurvivalCommandPayload["expedition"]>; sector: SurvivalCommandPayload["sectors"][number] | null; busy: string | null; onResolve: (action: string) => void }) {
  return <><p className={styles.dossierKicker}>Field decision required</p><h2>{expedition.incident?.title}</h2><p>{expedition.incident?.detail}</p><div className={styles.incidentMeta}><span>{sector?.name}</span><span>{expedition.approach} route</span></div><div className={styles.decisionList}>{expedition.incident?.actions.map(action => <button key={action} disabled={busy !== null} onClick={() => onResolve(action)}><span>{action}</span><ArrowRight size={17} /></button>)}</div><p className={styles.returnTime}>One response is written to this operation. The final recovery is calculated server-side.</p></>;
}

function DeployDossier({ selected, approach, busy, deployment, onApproach, onDeploy }: { selected: SurvivalCommandPayload["sectors"][number] | null; approach: SurvivalCommandApproach; busy: string | null; deployment: SurvivalCommandPayload["deployment"]; onApproach: (approach: SurvivalCommandApproach) => void; onDeploy: () => void }) {
  const locked = !selected?.unlocked;
  const capacityExceeded = !selected || deployment.used + selected.deploymentCost > deployment.capacity;
  return <><p className={styles.dossierKicker}>New deployment</p><h2>{selected?.name ?? "Select a sector"}</h2><p>{selected?.briefing ?? "Choose an available sector from the operational map."}</p><div className={styles.rewardLine}><span><Boxes size={15} />Base {selected?.reward.salvage[0] ?? 0}-{selected?.reward.salvage[1] ?? 0} salvage</span><span><Radio size={15} />Base {selected?.reward.intel[0] ?? 0}-{selected?.reward.intel[1] ?? 0} intel</span></div><p className={styles.returnTime}>Base recovery estimates only. Route choice, field decision, settlement readiness and the final operation outcome determine the recorded return.</p><fieldset className={styles.approaches}><legend>Route plan</legend>{(Object.keys(SURVIVAL_COMMAND_APPROACHES) as SurvivalCommandApproach[]).map(key => { const Icon = APPROACH_ICONS[key]; const value = SURVIVAL_COMMAND_APPROACHES[key]; return <button key={key} type="button" data-selected={approach === key} onClick={() => onApproach(key)}><Icon size={17} /><span><strong>{value.name}</strong><small>{value.detail}</small></span></button>; })}</fieldset><button className={styles.primaryAction} disabled={busy !== null || locked || capacityExceeded} onClick={onDeploy}><Truck size={18} />{locked ? "Sector locked" : capacityExceeded ? "Insufficient deployment capacity" : busy === "deploy" ? "Dispatching..." : `Dispatch team (${selected?.deploymentCost ?? 0} capacity)`}</button></>;
}
