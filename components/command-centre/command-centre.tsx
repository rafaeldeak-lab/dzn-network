"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Boxes, ChevronLeft, Clock3, Hammer, Radio, ShieldCheck, TowerControl, Wrench } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  COMMAND_CENTRE_BUILDING_COPY,
  COMMAND_CENTRE_BUILDINGS,
  type CommandCentreBuilding,
  type CommandCentreBuildingView,
  type CommandCentrePayload,
} from "../../lib/command-centre";
import { CommandCentre3D } from "./command-centre-3d";
import styles from "./command-centre.module.css";

const ICONS: Record<CommandCentreBuilding, typeof TowerControl> = {
  headquarters: TowerControl,
  workshop: Wrench,
  watchtower: ShieldCheck,
  communications: Radio,
};

const BUILDING_ASSETS: Record<CommandCentreBuilding, string> = {
  headquarters: "/media/stronghold/rosebud/hq_l01.webp",
  workshop: "/media/stronghold/rosebud/forge_l01.webp",
  watchtower: "/media/stronghold/rosebud/watchtower_l01.webp",
  communications: "/media/stronghold/rosebud/comms_l01.webp",
};

function formatRemaining(milliseconds: number) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours ? `${hours}h ${minutes.toString().padStart(2, "0")}m` : `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function CommandCentre() {
  const [payload, setPayload] = useState<CommandCentrePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [clientNow, setClientNow] = useState(() => Date.now());
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [motionRunning, setMotionRunning] = useState(true);
  const mutationActiveRef = useRef(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/player/command-centre", { cache: "no-store" });
    const body = await response.json() as CommandCentrePayload & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Command Centre is unavailable.");
    const nextReceivedAt = Date.now();
    setPayload(body);
    setReceivedAt(nextReceivedAt);
    setClientNow(nextReceivedAt);
    setError(null);
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setMotionRunning(!motion.matches);
    updateMotion();
    motion.addEventListener("change", updateMotion);
    const load = async () => {
      try { await refresh(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Command Centre is unavailable."); }
    };
    void load();
    return () => motion.removeEventListener("change", updateMotion);
  }, [refresh]);

  useEffect(() => {
    const updateClock = () => setClientNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const serverNow = useMemo(() => payload ? payload.serverTime + Math.max(0, clientNow - receivedAt) : 0, [clientNow, payload, receivedAt]);
  const run = async (key: string, body: Record<string, unknown>) => {
    if (mutationActiveRef.current) return;
    mutationActiveRef.current = true;
    setBusy(key); setError(null);
    try {
      const response = await fetch("/api/player/command-centre", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const next = await response.json() as CommandCentrePayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "Command Centre update failed.");
      const nextReceivedAt = Date.now();
      setPayload(next);
      setReceivedAt(nextReceivedAt);
      setClientNow(nextReceivedAt);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Command Centre update failed.");
    } finally { mutationActiveRef.current = false; setBusy(null); }
  };
  const byBuilding = new Map(payload?.buildings.map(building => [building.building, building]));
  const active = Boolean(payload?.profile);

  return <main className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.heroTopline}><Link href="/player" className={styles.back}><ChevronLeft size={16} /> Player Hub</Link><span>Private player progression</span></div>
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>DZN Command Centre</p>
          <h1>{payload?.profile?.tier ?? "Establish your settlement"}</h1>
          <p>Build a personal DZN stronghold with verified Games Hub parts. Construction is saved server-side and does not affect competitive standings, public maps, or real DayZ server outcomes.</p>
          <div className={styles.resourceStrip}>
            <span><Activity size={15} /> {payload?.resources.xp ?? 0} XP</span>
            <span><Boxes size={15} /> {payload?.resources.partsAvailable ?? 0} parts available</span>
            <span><Hammer size={15} /> {payload?.resources.partsSpent ?? 0} committed</span>
          </div>
          {!payload?.profile && !error && <button className={styles.primaryAction} disabled={busy === "initialize" || !payload} onClick={() => void run("initialize", { action: "initialize" })}>
            <TowerControl size={18} /> {busy === "initialize" ? "Establishing..." : "Establish Command Centre"}
          </button>}
          {error && <div className={styles.notice} role="status">{error}</div>}
        </div>
        <div className={styles.sceneFrame}>
          <CommandCentre3D buildings={payload?.buildings ?? []} active={active} motionRunning={motionRunning} onUnavailable={() => setWebglUnavailable(true)} />
          {webglUnavailable && <div className={styles.sceneFallback}><TowerControl size={34} /><span>Settlement view unavailable on this device. Your progression remains accessible below.</span></div>}
          {active && <div className={styles.sceneStatus}><span className={styles.liveDot} /> {payload?.buildings.filter(building => building.targetLevel).length ?? 0} construction orders active</div>}
        </div>
      </div>
    </section>

    <section className={styles.operations} aria-label="Command Centre buildings">
      <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Construction board</p><h2>Settlement operations</h2></div><p>Upgrades reserve only real parts. Completion time is checked by the server.</p></div>
      <div className={styles.buildingGrid}>
        {COMMAND_CENTRE_BUILDINGS.map(buildingName => <BuildingCard
          key={buildingName}
          building={buildingName}
          value={byBuilding.get(buildingName)}
          serverNow={serverNow}
          xp={payload?.resources.xp ?? 0}
          parts={payload?.resources.partsAvailable ?? 0}
          active={active}
          busy={busy}
          onStart={(building) => void run(`start:${building}`, { action: "start-upgrade", building, version: byBuilding.get(building)?.version, requestId: crypto.randomUUID() })}
          onComplete={(building) => void run(`complete:${building}`, { action: "complete-upgrade", building, version: byBuilding.get(building)?.version })}
        />)}
      </div>
    </section>
  </main>;
}

function BuildingCard({ building, value, serverNow, xp, parts, active, busy, onStart, onComplete }: {
  building: CommandCentreBuilding; value?: CommandCentreBuildingView; serverNow: number; xp: number; parts: number; active: boolean; busy: string | null;
  onStart: (building: CommandCentreBuilding) => void; onComplete: (building: CommandCentreBuilding) => void;
}) {
  const Icon = ICONS[building];
  const copy = COMMAND_CENTRE_BUILDING_COPY[building];
  const ready = Boolean(value?.completesAt && value.completesAt <= serverNow);
  const construction = Boolean(value?.targetLevel);
  const next = value?.nextUpgrade;
  const canAfford = Boolean(next && xp >= next.requiredXp && parts >= next.parts && !value?.blockedByHeadquarters);
  const startKey = `start:${building}`;
  const completeKey = `complete:${building}`;
  return <article className={styles.buildingCard}>
    <div className={styles.buildingVisual} data-building={building}>
      <Image src={BUILDING_ASSETS[building]} alt="" width={960} height={960} sizes="(max-width: 620px) 80vw, 18vw" />
    </div>
    <div className={styles.buildingTitle}><span className={styles.iconWell}><Icon size={20} /></span><div><p>{copy.name}</p><strong>{active ? `Level ${value?.level ?? 0}` : "Not established"}</strong></div></div>
    <p className={styles.buildingCopy}>{copy.short}</p>
    {!active ? <p className={styles.locked}>Establish the Command Centre to create authoritative building records.</p>
      : construction ? <div className={styles.construction}><span><Clock3 size={15} /> {ready ? "Ready to finalize" : `Completes in ${formatRemaining((value?.completesAt ?? serverNow) - serverNow)}`}</span>
        <button className={styles.secondaryAction} disabled={!ready || busy !== null} onClick={() => onComplete(building)}>{busy === completeKey ? "Finalizing..." : "Finalize upgrade"}</button></div>
      : next ? <div className={styles.upgrade}><div><span>Next level</span><strong>+{next.parts} parts · {next.requiredXp} XP</strong><small>{formatRemaining(next.durationMs)} construction time</small></div>
        {value?.blockedByHeadquarters ? <p className={styles.locked}>Headquarters must reach Level {value.level + 1} first.</p>
          : <button className={styles.secondaryAction} disabled={!canAfford || busy !== null} onClick={() => onStart(building)}>{busy === startKey ? "Reserving..." : "Begin construction"}</button>}
      </div>
      : <p className={styles.complete}>Maximum construction level reached.</p>}
  </article>;
}
