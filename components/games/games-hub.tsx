"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Award, BookOpen, Check, CircleHelp, Clock3, Crosshair, Flag, Flame, Gamepad2, Hammer, KeyRound, LoaderCircle,
  LogIn, Map, MessageCircle, Microchip, MousePointer2, Play, Radio, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Target, X, Zap } from "lucide-react";
import { SiteHeaderAuthState, SiteHomeLink } from "@/components/site-header";
import { DEFAULT_HUB_GAME_AVAILABILITY, GAME_MODES, HUB_BADGES, HUB_CHALLENGE_TARGETS, HUB_EQUIPMENT, WORKSHOP_PART_COST, WORKSHOP_STAGES,
  hubEquipmentUnlocked, type GameMode, type GameView, type HubEquipment, type HubGameId, type HubPayload } from "@/lib/games-hub";
import { TRIVIA_DIFFICULTIES, type TriviaDifficulty, type TriviaPayload } from "@/lib/games-trivia";
import { WORD_CHAIN_REWARD, type WordChainPayload } from "@/lib/games-word-chain";
import { HIDE_SEEK_REWARD, type HideSeekPayload } from "@/lib/games-hide-seek";
import { RELAY_RUSH_LANES, RELAY_RUSH_PULSE_INTERVAL_MS, RELAY_RUSH_REWARD, type RelayRushLane, type RelayRushPayload } from "@/lib/games-relay-rush";
import { CIPHER_GRID_MAX_ATTEMPTS, CIPHER_GRID_REWARD, CIPHER_GRID_WORD_LENGTH, type CipherGridMark, type CipherGridPayload } from "@/lib/games-cipher-grid";
import { ECHO_ARRAY_CUE_INTERVAL_MS, ECHO_ARRAY_CUE_LEAD_MS, ECHO_ARRAY_MIN_INPUT_INTERVAL_MS, ECHO_ARRAY_REWARD, type EchoArrayNode, type EchoArrayPayload } from "@/lib/games-echo-array";
import { OUTPOST_RUN_DIRECTIONS, OUTPOST_RUN_MIN_MOVE_INTERVAL_MS, OUTPOST_RUN_REWARD, type OutpostRunDirection, type OutpostRunPayload } from "@/lib/games-outpost-run";
import { SIGNAL_SHIFT_MIN_MOVE_INTERVAL_MS, SIGNAL_SHIFT_REWARD, type SignalShiftPayload } from "@/lib/games-signal-shift";
import { CIRCUIT_FORGE_MIN_ROTATION_INTERVAL_MS, CIRCUIT_FORGE_REWARD, type CircuitForgePayload } from "@/lib/games-circuit-forge";
import { RANGER_RANGE_MIN_ACTION_INTERVAL_MS, RANGER_RANGE_REWARD, RANGER_RANGE_TARGETS, type RangerRangePayload, type RangerRangeTarget } from "@/lib/games-ranger-range";
import styles from "./games-hub.module.css";

type View = "play" | "workshop" | "insignia" | "activity";
type BoardView = "field" | "grid";
type PlayGame = HubGameId;
const Minefield3D = dynamic(() => import("./minefield-3d").then(module => module.Minefield3D), { ssr: false });
const views = [{ id: "play", label: "Play", icon: Gamepad2 }, { id: "workshop", label: "Workshop", icon: Hammer },
  { id: "insignia", label: "Insignia", icon: Award }, { id: "activity", label: "Activity", icon: Clock3 }] as const;
const modes = Object.keys(GAME_MODES) as GameMode[];
function clock(value: number) { const seconds = Math.max(0, Math.floor(value / 1000)); return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; }
const RELAY_RUSH_LANE_META: Record<RelayRushLane, { label: string; key: string }> = {
  left: { label: "Left", key: "A" }, centre: { label: "Centre", key: "S" }, right: { label: "Right", key: "D" },
};
const CIPHER_GRID_KEYS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const CIPHER_GRID_MARK_PRIORITY: Record<CipherGridMark, number> = { absent: 0, present: 1, correct: 2 };
const RELAY_RUSH_INPUT_GUARD_MS = 120;
const OUTPOST_RUN_COOLDOWN_MS = OUTPOST_RUN_MIN_MOVE_INTERVAL_MS + 40;
const ECHO_ARRAY_COOLDOWN_MS = ECHO_ARRAY_MIN_INPUT_INTERVAL_MS + 40;
const SIGNAL_SHIFT_COOLDOWN_MS = SIGNAL_SHIFT_MIN_MOVE_INTERVAL_MS + 40;
const CIRCUIT_FORGE_COOLDOWN_MS = CIRCUIT_FORGE_MIN_ROTATION_INTERVAL_MS + 40;
const RANGER_RANGE_COOLDOWN_MS = RANGER_RANGE_MIN_ACTION_INTERVAL_MS + 50;
const ECHO_ARRAY_NODE_META: Record<EchoArrayNode, { label: string; key: string }> = {
  north: { label: "North array", key: "1" }, east: { label: "East array", key: "2" }, south: { label: "South array", key: "3" }, west: { label: "West array", key: "4" },
};
const ECHO_ARRAY_NODE_ORDER: EchoArrayNode[] = ["north", "east", "south", "west"];
const OUTPOST_RUN_DIRECTION_META: Record<OutpostRunDirection, { label: string; icon: typeof ArrowUp }> = {
  north: { label: "Move north", icon: ArrowUp }, east: { label: "Move east", icon: ArrowRight }, south: { label: "Move south", icon: ArrowDown }, west: { label: "Move west", icon: ArrowLeft },
};
const RANGER_RANGE_TARGET_META: Record<RangerRangeTarget, { label: string; key: string; detail: string }> = {
  ridge: { label: "Ridge", key: "1", detail: "High ridge plate" },
  ruins: { label: "Ruins", key: "2", detail: "Ruined wall plate" },
  road: { label: "Road", key: "3", detail: "Roadside plate" },
  treeline: { label: "Treeline", key: "4", detail: "Treeline plate" },
  tower: { label: "Tower", key: "5", detail: "Watchtower plate" },
  ravine: { label: "Ravine", key: "6", detail: "Ravine plate" },
};
const ARCADE_CATALOGUE = [
  { name: "Minefield", detail: "3D tactical sweep", icon: Target },
  { name: "Relay Rush", detail: "Server-timed reactions", icon: Zap },
  { name: "Outpost Run", detail: "Fog-grid extraction", icon: Map },
  { name: "Ranger Range", detail: "Bow target drill", icon: Crosshair },
  { name: "Cipher Grid", detail: "Field-code puzzle", icon: KeyRound },
  { name: "Circuit Forge", detail: "Power-grid rebuild", icon: Settings2 },
] as const;

function useTransientActionCooldown(duration: number) {
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const cooldownTimer = useRef<number | null>(null);

  const clearCooldown = useCallback(() => {
    if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current);
    cooldownTimer.current = null;
    setNotice("");
    setCooldown(false);
  }, []);

  const startCooldown = useCallback((message: string) => {
    if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current);
    setNotice(message);
    setCooldown(true);
    cooldownTimer.current = window.setTimeout(() => {
      cooldownTimer.current = null;
      setNotice("");
      setCooldown(false);
    }, duration);
  }, [duration]);

  useEffect(() => () => {
    if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current);
  }, []);

  return { notice, cooldown, clearCooldown, startCooldown };
}

export function GamesHub() {
  const [payload, setPayload] = useState<HubPayload | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "login" | "unavailable">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("play");
  const [mode, setMode] = useState<GameMode>("recon");
  const [tool, setTool] = useState<"reveal" | "flag">("reveal");
  const [boardView, setBoardView] = useState<BoardView>("field");
  const [playGame, setPlayGame] = useState<PlayGame>("minefield");
  const [help, setHelp] = useState(false);
  const [replace, setReplace] = useState(false);
  const [now, setNow] = useState(0);
  const [motionReady, setMotionReady] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const lock = useRef(false);
  const assemblyKey = useRef<string | null>(null);
  const generation = useRef(0);
  const serverClock = useRef({ time: 0, measuredAt: 0 });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/hub", { credentials: "include", cache: "no-store", signal });
      const result = await response.json();
      if (sequence !== generation.current || signal?.aborted) return;
      if (!response.ok) { setPhase(response.status === 401 ? "login" : "unavailable"); setError(result.error || "Games Hub is unavailable."); return; }
      serverClock.current = { time: result.serverTime, measuredAt: performance.now() };
      setNow(result.serverTime); setPayload(result); setPhase("ready"); setMode(result.game?.mode ?? "recon"); setError("");
    } catch { if (sequence === generation.current && !signal?.aborted) { setError("Connection interrupted. Retry to load your saved progress."); setPhase("unavailable"); } }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => { const clock = serverClock.current; if (clock.time) setNow(clock.time + performance.now() - clock.measuredAt); }, 1000);
    const syncHash = () => { const hash = location.hash.slice(1); if (views.some(item => item.id === hash)) setView(hash as View); };
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(preference.matches);
    const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
    const initial = window.setTimeout(() => {
      syncHash(); syncMotion(); syncVisibility();
      try { setMotionPaused(localStorage.getItem("dzn.games.motion") === "paused"); } catch { /* Storage may be disabled. */ }
      setMotionReady(true); void refresh(controller.signal);
    }, 0);
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("hashchange", syncHash);
    return () => { controller.abort(); clearTimeout(initial); clearInterval(timer); window.removeEventListener("hashchange", syncHash); preference.removeEventListener("change", syncMotion); document.removeEventListener("visibilitychange", syncVisibility); };
  }, [refresh]);

  useEffect(() => {
    if (!payload) return;
    const timer = window.setInterval(() => {
      const clock = serverClock.current;
      const refreshAt = Math.min(payload.summary.resetAt, payload.summary.challenges.weeklyExpiresAt ?? Number.POSITIVE_INFINITY);
      if (!lock.current && document.visibilityState === "visible" && clock.time + performance.now() - clock.measuredAt >= refreshAt) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [payload, refresh]);

  async function mutate(body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); generation.current++;
    try {
      const response = await fetch("/api/games/hub", { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) { setPayload(null); setPhase("login"); }
        if (response.status === 409) await refresh();
        setError(result.error || "That action could not be completed."); return;
      }
      serverClock.current = { time: result.serverTime, measuredAt: performance.now() };
      setNow(result.serverTime); setPayload(result); setPhase("ready");
      if (body.action === "assemble") assemblyKey.current = null;
    } catch { setError("Connection interrupted. Refresh before retrying; your confirmed progress is saved."); }
    finally { lock.current = false; setBusy(false); }
  }

  const summary = payload?.summary;
  const game = payload?.game ?? null;
  const availableGames = payload?.availableGames ?? DEFAULT_HUB_GAME_AVAILABILITY;
  const selectedPlayGame = availableGames[playGame] ? playGame : "minefield";
  const active = game?.status === "playing" && (!now || now < game.expiresAt);
  const newBoardCoolingDown = Boolean(game && (now || game.startedAt) < game.startedAt + 5000);
  const xp = summary?.xp ?? 0;
  const rankIndex = Math.max(0, HUB_BADGES.findLastIndex(badge => xp >= badge.xp));
  const rank = HUB_BADGES[rankIndex];
  const nextRank = HUB_BADGES.find(badge => badge.xp > xp);
  const progress = nextRank ? Math.min(100, xp / nextRank.xp * 100) : 100;
  const challengeProgress = summary?.challenges ?? { dailyRewards: summary?.today.length ?? 0, weeklyXp: 0, streak: summary?.streak ?? 0, weeklyExpiresAt: null };
  const challenges = summary ? [
    { id: "daily", label: "Daily operator", detail: "Rewarded activities today", icon: Target,
      value: challengeProgress.dailyRewards, target: HUB_CHALLENGE_TARGETS.dailyRewards },
    { id: "weekly", label: "Seven-day signal", detail: "Website XP earned in 7 days", icon: Zap,
      value: challengeProgress.weeklyXp, target: HUB_CHALLENGE_TARGETS.weeklyXp },
    { id: "streak", label: "Hold the line", detail: "Consecutive reward days", icon: Flame,
      value: challengeProgress.streak, target: HUB_CHALLENGE_TARGETS.streak },
  ] : [];
  const equipmentProgress = { xp, assemblies: summary?.assemblies ?? 0 };
  const equipmentCollected = HUB_EQUIPMENT.filter(item => hubEquipmentUnlocked(item, equipmentProgress)).length;

  function start() {
    setReplace(false); setTool("reveal");
    void mutate({ action: "start", mode });
  }

  const motionRunning = motionReady && pageVisible && !motionPaused && !reducedMotion;

  return <main className={styles.hub} data-motion={motionRunning ? "running" : "paused"}>
    <OutpostBackground />
    <div className={styles.hubContent}>
    <SiteHeaderAuthState authenticated={phase === "ready"} checkingAccount={phase === "loading"} returnTo="/games" />
    <nav className={styles.hubNav} aria-label="DZN Network"><SiteHomeLink className={styles.homeButton} /><div className={styles.navActions}><Link href="/community" prefetch={false}><MessageCircle size={16} />Community</Link><Link href="/player" prefetch={false}>Player Hub<ArrowRight size={16} /></Link></div></nav>
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>DZN / PLAYER ARCADE</span><h1>DZN Games Hub<span className={styles.dot}>.</span></h1></div>
      {summary && <div className={styles.identity}>{xp >= HUB_BADGES[0].xp ? <Insignia position={rank.position} small /> : <span className={styles.recruit}><Gamepad2 size={24} /></span>}<div><strong>{summary.username}</strong><span>{xp >= HUB_BADGES[0].xp ? rank.name : "New recruit"}</span></div><span className={styles.level}>LV {1 + Math.floor(xp / 150)}</span></div>}
    </div>
    <div className={styles.topline}>
      <nav aria-label="Games Hub" className={styles.tabs}>{views.map(item => <a href={`#${item.id}`} key={item.id} aria-label={item.label} title={item.label} aria-current={view === item.id ? "page" : undefined}
        onClick={() => setView(item.id)}><item.icon size={17} /><span>{item.label}</span></a>)}</nav>
      {summary && <div className={styles.balances}><span title="Website XP"><Zap size={15} />{xp.toLocaleString()} <small>XP</small></span><span title="Earned workshop parts"><Microchip size={15} />{summary.parts} <small>PARTS</small></span></div>}
    </div>

    {phase !== "ready" ? <section className={styles.gate} aria-busy={phase === "loading"}>
      <div className={styles.gateArt}><Insignia position="100% 100%" /></div>
      <div className={styles.gateCopy}>
        <span className={styles.eyebrow}>DZN / PLAYER ARCADE</span>
        <h2>{phase === "loading" ? "Opening your Games Hub" : phase === "login" ? "Field games. One earned record." : "Games Hub unavailable"}</h2>
        {phase === "loading" ? <LoaderCircle className={styles.spinner} /> : phase === "login" ? <>
          <p>Sign in with Discord to play DZN field games, earn verified website XP and build your personal workshop collection. Your rewards are saved to your own account.</p>
          <div className={styles.gateActions}><Link className={styles.primary} href="/login?returnTo=%2Fgames" prefetch={false}><LogIn size={18} />Sign in with Discord</Link><Link className={styles.secondary} href="/community" prefetch={false}><MessageCircle size={17} />Visit the Lounge</Link></div>
          <p className={styles.catalogueNote}>The DZN Games Hub catalogue is shown below. Sign in to see the modes currently enabled for this launch.</p>
          <ul className={styles.arcadeBriefing} aria-label="DZN Games Hub game catalogue">{ARCADE_CATALOGUE.map(game => <li key={game.name}><game.icon size={17} aria-hidden="true" /><span><strong>{game.name}</strong><small>{game.detail}</small></span></li>)}</ul>
          <p className={styles.gateBoundary}><ShieldCheck size={16} aria-hidden="true" />Rewards are validated server-side. They have no cash value and never change DayZ statistics, subscriptions or competitive eligibility.</p>
        </> : <><p>{error}</p><button className={styles.primary} onClick={() => void refresh()}><RefreshCw size={18} />Retry</button></>}
      </div>
    </section> : <>
      {error && <div className={styles.error} role="alert"><span>{error}</span><button title="Refresh saved progress" disabled={busy} onClick={() => void refresh()}><RefreshCw size={18} /></button></div>}
      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          {view === "play" && <div className={styles.gamePicker} role="group" aria-label="Choose a game">
            {availableGames.minefield && <button aria-pressed={selectedPlayGame === "minefield"} onClick={() => setPlayGame("minefield")}><Target size={17} /><span><strong>Minefield</strong><small>3D tactical sweep</small></span></button>}
            {availableGames.trivia && <button aria-pressed={selectedPlayGame === "trivia"} onClick={() => setPlayGame("trivia")}><BookOpen size={17} /><span><strong>DZN Trivia</strong><small>Survival knowledge</small></span></button>}
            {availableGames["word-chain"] && <button aria-pressed={selectedPlayGame === "word-chain"} onClick={() => setPlayGame("word-chain")}><Radio size={17} /><span><strong>Word Chain</strong><small>Shared daily relay</small></span></button>}
            {availableGames["hide-seek"] && <button aria-pressed={selectedPlayGame === "hide-seek"} onClick={() => setPlayGame("hide-seek")}><Search size={17} /><span><strong>Signal Hunt</strong><small>Find concealed beacons</small></span></button>}
            {availableGames["relay-rush"] && <button aria-pressed={selectedPlayGame === "relay-rush"} onClick={() => setPlayGame("relay-rush")}><Zap size={17} /><span><strong>Relay Rush</strong><small>Timed signal run</small></span></button>}
            {availableGames["cipher-grid"] && <button aria-pressed={selectedPlayGame === "cipher-grid"} onClick={() => setPlayGame("cipher-grid")}><KeyRound size={17} /><span><strong>Cipher Grid</strong><small>Field-code puzzle</small></span></button>}
            {availableGames["echo-array"] && <button aria-pressed={selectedPlayGame === "echo-array"} onClick={() => setPlayGame("echo-array")}><Microchip size={17} /><span><strong>Echo Array</strong><small>Memory signal run</small></span></button>}
            {availableGames["outpost-run"] && <button aria-pressed={selectedPlayGame === "outpost-run"} onClick={() => setPlayGame("outpost-run")}><Map size={17} /><span><strong>Outpost Run</strong><small>Fog-grid extraction</small></span></button>}
            {availableGames["signal-shift"] && <button aria-pressed={selectedPlayGame === "signal-shift"} onClick={() => setPlayGame("signal-shift")}><Target size={17} /><span><strong>Signal Shift</strong><small>Tactical grid routing</small></span></button>}
            {availableGames["circuit-forge"] && <button aria-pressed={selectedPlayGame === "circuit-forge"} onClick={() => setPlayGame("circuit-forge")}><Settings2 size={17} /><span><strong>Circuit Forge</strong><small>Power-grid rebuild</small></span></button>}
            {availableGames["ranger-range"] && <button aria-pressed={selectedPlayGame === "ranger-range"} onClick={() => setPlayGame("ranger-range")}><Crosshair size={17} /><span><strong>Ranger Range</strong><small>Bow target drill</small></span></button>}
          </div>}
          {view === "play" && availableGames.minefield && selectedPlayGame === "minefield" && <section aria-labelledby="mines-title">
            <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>01 / FIELD OPERATIONS</span><h2 id="mines-title">Minesweeper</h2></div><button className={styles.iconButton} title="Game rules" onClick={() => setHelp(true)}><CircleHelp size={20} /></button></div>
            <div className={styles.gameTools}>
              <label>Difficulty<select aria-label="Difficulty" value={mode} disabled={busy} onChange={event => setMode(event.target.value as GameMode)}>{modes.map(key => <option value={key} key={key}>{GAME_MODES[key].label} / {GAME_MODES[key].size} x {GAME_MODES[key].size}</option>)}</select></label>
              <div className={styles.toolSwitch} aria-label="Cell action"><button title="Reveal cell" aria-pressed={tool === "reveal"} disabled={busy} onClick={() => setTool("reveal")}><MousePointer2 size={18} /></button><button title="Place or remove flag" aria-pressed={tool === "flag"} disabled={busy} onClick={() => setTool("flag")}><Flag size={18} /></button></div>
              <button className={styles.primary} disabled={busy || newBoardCoolingDown} title={newBoardCoolingDown ? "New board available five seconds after the last start" : undefined} onClick={() => active ? setReplace(true) : start()}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{game ? "New board" : "Start mission"}</button>
            </div>
            {game ? <>
              <div className={styles.boardStatus}><span><Target size={15} />{GAME_MODES[game.mode].label}</span><span><Flag size={15} />{game.cells.flat().filter(cell => cell === "flag").length} / {GAME_MODES[game.mode].mines}</span><span><Clock3 size={15} />{clock(game.expiresAt - (now || game.startedAt))}</span></div>
              <div className={styles.boardViewSwitch} role="group" aria-label="Minefield view">
                <button aria-pressed={boardView === "field"} onClick={() => setBoardView("field")}><Sparkles size={16} />3D field</button>
                <button aria-pressed={boardView === "grid"} onClick={() => setBoardView("grid")}><Target size={16} />Tactical grid</button>
              </div>
              {boardView === "field" ? <Minefield3D game={game} tool={tool} disabled={busy || !active} motionRunning={motionRunning}
                onMove={(x, y, selectedTool) => void mutate({ action: "move", gameId: game.id, version: game.version, x, y, tool: selectedTool })} />
                : <MineBoard game={game} tool={tool} disabled={busy || !active} onMove={(x, y, selectedTool) => void mutate({ action: "move", gameId: game.id, version: game.version, x, y, tool: selectedTool })} />}
              <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
                {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Sector secured</strong><span>{summary?.today.includes(game.mode) ? `${GAME_MODES[game.mode].label} reward recorded for today. Further wins today are practice.` : "Daily rewards have reset. Start a new mission for today's reward."}</span></div></> : game.status === "lost" ? <><Target size={22} /><div><strong>Mine triggered</strong><span>Mission ended. Your earned XP and parts are unchanged.</span></div></> : !active ? <><Clock3 size={22} /><div><strong>Mission expired</strong><span>Start a new board when you are ready.</span></div></> : <><Radio size={20} /><div><strong>Mission in progress</strong><span>{tool === "flag" ? "Flag mode" : "Reveal mode"} / {game.cells.flat().filter(cell => typeof cell === "number").length} safe cells cleared</span></div></>}
              </div>
            </> : <div className={styles.readyBoard}><Image className={styles.scannerArt} src="/images/games/dzn-field-scanner.webp" alt="DZN field scanner, survey flags and equipment bag" width={960} height={640} loading="eager" /><h3>{GAME_MODES[mode].label} standing by</h3><div className={styles.rewardPills}><span>{GAME_MODES[mode].mines} mines</span><span>+{GAME_MODES[mode].xp} XP</span><span>+{GAME_MODES[mode].parts} parts</span></div></div>}
          </section>}
          {view === "play" && availableGames.trivia && selectedPlayGame === "trivia" && <TriviaPanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && availableGames["word-chain"] && selectedPlayGame === "word-chain" && <WordChainPanel onProgress={() => void refresh()} />}
          {view === "play" && availableGames["hide-seek"] && selectedPlayGame === "hide-seek" && <HideSeekPanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && availableGames["relay-rush"] && selectedPlayGame === "relay-rush" && <RelayRushPanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && availableGames["cipher-grid"] && selectedPlayGame === "cipher-grid" && <CipherGridPanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && availableGames["echo-array"] && selectedPlayGame === "echo-array" && <EchoArrayPanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && availableGames["outpost-run"] && selectedPlayGame === "outpost-run" && <OutpostRunPanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && availableGames["signal-shift"] && selectedPlayGame === "signal-shift" && <SignalShiftPanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && availableGames["circuit-forge"] && selectedPlayGame === "circuit-forge" && <CircuitForgePanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && availableGames["ranger-range"] && selectedPlayGame === "ranger-range" && <RangerRangePanel now={now} onProgress={() => void refresh()} />}

          {view === "workshop" && <section>
            <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>COLLECTION / PROJECT {(Math.floor((summary?.assemblies ?? 0) / 3) + 1).toString().padStart(2, "0")}</span><h2>Field relay workshop</h2></div><Hammer size={24} /></div>
            <div className={styles.workshopImage} role="img" aria-label="DZN field radio relay collectible" />
            <div className={styles.projectLine}><div><h3>Restore the signal</h3><p>Prestige {Math.floor((summary?.assemblies ?? 0) / 3)} / {(summary?.assemblies ?? 0) % 3} of 3 assemblies</p></div><span className={styles.materialCount}><Microchip />{summary?.parts} <small>parts</small></span></div>
            <ol className={styles.stages}>{WORKSHOP_STAGES.map((name, index) => <li key={name} data-complete={index < (summary?.assemblies ?? 0) % 3}><span>{index < (summary?.assemblies ?? 0) % 3 ? <Check size={16} /> : `0${index + 1}`}</span><strong>{name}</strong><small>{WORKSHOP_PART_COST} parts</small></li>)}</ol>
            <button className={styles.primary} disabled={busy || (summary?.parts ?? 0) < WORKSHOP_PART_COST} onClick={() => { assemblyKey.current ??= crypto.randomUUID(); void mutate({ action: "assemble", requestId: assemblyKey.current }); }}><Hammer size={18} />Assemble {WORKSHOP_STAGES[(summary?.assemblies ?? 0) % 3]}<span>{WORKSHOP_PART_COST} parts</span></button>
            <div className={styles.collectionHeading}><div><span className={styles.eyebrow}>YOUR / FIELD EQUIPMENT</span><h3>Equipment rack</h3></div><strong>{equipmentCollected} / {HUB_EQUIPMENT.length}</strong></div>
            <div className={styles.equipmentRack}>{HUB_EQUIPMENT.map(item => { const unlocked = hubEquipmentUnlocked(item, equipmentProgress); return <article key={item.id} data-collected={unlocked}>
              <span className={styles.equipmentIcon}>{unlocked ? <EquipmentIcon item={item} /> : <ShieldCheck size={21} />}</span>
              <div><h4>{item.name}</h4><p>{unlocked ? item.detail : equipmentRequirement(item)}</p></div>
              <span>{unlocked ? <><Check size={13} />Collected</> : "Locked"}</span>
            </article>; })}</div>
          </section>}

          {view === "insignia" && <section><div className={styles.sectionTitle}><div><span className={styles.eyebrow}>COLLECTION / EARNED RECOGNITION</span><h2>Field insignia</h2></div><span>{HUB_BADGES.filter(badge => xp >= badge.xp).length} / 6</span></div>
            <div className={styles.badges}>{HUB_BADGES.map(badge => <article key={badge.name} className={xp >= badge.xp ? styles.earnedBadge : styles.lockedBadge}><Insignia position={badge.position} /><h3>{badge.name}</h3><span>{badge.xp.toLocaleString()} XP</span><div className={styles.badgeState}>{xp >= badge.xp ? <><Check size={15} />Earned</> : <><Target size={15} />{(badge.xp - xp).toLocaleString()} XP remaining</>}</div></article>)}</div>
          </section>}

          {view === "activity" && <section><div className={styles.sectionTitle}><div><span className={styles.eyebrow}>YOUR / REWARD HISTORY</span><h2>Recent activity</h2></div><Clock3 size={24} /></div>
            {summary?.history.length ? <ul className={styles.history}>{summary.history.map((entry, index) => { const triviaDifficulty = entry.kind.startsWith("trivia:") ? entry.kind.slice(7) as TriviaDifficulty : null; const wordChain = entry.kind === "word-chain"; const hideSeek = entry.kind === "hide-seek"; const relayRush = entry.kind === "relay-rush"; const cipherGrid = entry.kind === "cipher-grid"; const echoArray = entry.kind === "echo-array"; const outpostRun = entry.kind === "outpost-run"; const signalShift = entry.kind === "signal-shift"; const circuitForge = entry.kind === "circuit-forge"; const rangerRange = entry.kind === "ranger-range"; return <li key={`${entry.created_at}:${index}`}><span className={styles.historyIcon}>{entry.kind === "workshop" ? <Hammer size={20} /> : triviaDifficulty ? <BookOpen size={20} /> : wordChain ? <Radio size={20} /> : hideSeek ? <Search size={20} /> : relayRush ? <Zap size={20} /> : cipherGrid ? <KeyRound size={20} /> : echoArray ? <Microchip size={20} /> : outpostRun ? <Map size={20} /> : signalShift ? <Target size={20} /> : circuitForge ? <Settings2 size={20} /> : rangerRange ? <Crosshair size={20} /> : <ShieldCheck size={20} />}</span><div><strong>{entry.kind === "workshop" ? "Workshop assembly" : triviaDifficulty ? `${TRIVIA_DIFFICULTIES[triviaDifficulty].label} trivia passed` : wordChain ? "Word Chain relay" : hideSeek ? "Signal Hunt cleared" : relayRush ? "Relay Rush completed" : cipherGrid ? "Cipher Grid decoded" : echoArray ? "Echo Array synchronised" : outpostRun ? "Outpost Run extracted" : signalShift ? "Signal Shift routed" : circuitForge ? "Circuit Forge restored" : rangerRange ? "Ranger Range cleared" : `${GAME_MODES[entry.kind as GameMode].label} secured`}</strong><time dateTime={new Date(entry.created_at).toISOString()}>{new Date(entry.created_at).toLocaleString("en-GB")}</time></div><span>{entry.xp ? `+${entry.xp} XP` : ""}<small>{entry.parts > 0 ? "+" : ""}{entry.parts} parts</small></span></li>; })}</ul> : <div className={styles.empty}><Clock3 size={30} /><h3>No rewards recorded yet</h3></div>}
          </section>}
        </div>

        <aside className={styles.sidebar}>
          <section className={styles.missions}><div className={styles.asideHeading}><span className={styles.eyebrow}>NETWORK CHALLENGES</span><span>{challenges.filter(item => item.value >= item.target).length} / {challenges.length}</span></div><h3>Play across the Hub.</h3>
            <div className={styles.reset}><Clock3 size={13} /><span>Daily resets {new Date(summary!.resetAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span><span><Flame size={14} />{summary?.streak} day streak</span></div>
            <ul>{challenges.map(item => { const done = item.value >= item.target; const shown = Math.min(item.value, item.target); return <li key={item.id} data-complete={done}><span className={styles.missionCheck}>{done ? <Check size={17} /> : <item.icon size={17} />}</span><div><strong>{item.label}</strong><span>{item.detail}</span><progress value={shown} max={item.target} aria-label={`${item.label} progress`} /></div><span>{shown.toLocaleString()} / {item.target.toLocaleString()}</span></li>; })}</ul>
          </section>
          <section className={styles.rankProgress}><div className={styles.asideHeading}><span className={styles.eyebrow}>NEXT INSIGNIA</span><Sparkles size={17} /></div><div className={styles.nextBadge}><Insignia position={(nextRank ?? rank).position} small /><div><h3>{nextRank?.name ?? "Network Legend"}</h3><span>{xp.toLocaleString()} / {(nextRank?.xp ?? xp).toLocaleString()} XP</span></div></div><progress value={progress} max={100} aria-label="Next insignia progress" /></section>
          {view !== "workshop" && <a href="#workshop" onClick={() => setView("workshop")} className={styles.projectTeaser}><div className={styles.projectTeaserImage} /><div><span className={styles.eyebrow}>THE WORKSHOP</span><h3>Your field relay</h3><span>{summary?.parts} parts collected<ArrowRight size={18} /></span></div></a>}
          <div className={styles.fairPlay}><ShieldCheck size={18} /><span>Website rewards only. No cash value. No DayZ stat or paid-plan advantage.</span></div>
        </aside>
      </div>
    </>}

    <details className={styles.displaySettings}><summary><Settings2 size={15} aria-hidden="true" />Display</summary>
      <label className={styles.motionSetting}><input type="checkbox" checked={!motionPaused && !reducedMotion} disabled={!motionReady || reducedMotion} onChange={event => {
        const paused = !event.target.checked; setMotionPaused(paused);
        try { localStorage.setItem("dzn.games.motion", paused ? "paused" : "running"); } catch { /* The preference still applies for this visit. */ }
      }} /><span>Animated scenery{reducedMotion && <small>Off in your device motion settings</small>}</span></label>
    </details>
    {help && <Dialog title="Minesweeper rules" onClose={() => setHelp(false)}><p>Reveal every safe cell without triggering a mine. Numbers count mines in the eight neighbouring cells. Flags mark suspected mines. The first revealed cell is safe.</p><p>Each difficulty awards XP and parts once per UTC day. Boards expire after 30 minutes. Further wins are practice; rewards cannot be bought, transferred or exchanged for money.</p><p>Arrow keys move between cells. Enter reveals or flags with the selected tool; F toggles a flag.</p><button className={styles.primary} onClick={() => setHelp(false)}>Back to mission</button></Dialog>}
    {replace && <Dialog title="Start a new board?" onClose={() => setReplace(false)}><p>The current unfinished board will be replaced. Earned XP and parts are kept.</p><div className={styles.dialogActions}><button onClick={() => setReplace(false)}>Keep playing</button><button className={styles.primary} onClick={start}><RefreshCw size={17} />New board</button></div></Dialog>}
    </div>
  </main>;
}

function equipmentRequirement(item: HubEquipment) {
  return item.requirement.kind === "xp" ? `${item.requirement.value.toLocaleString()} verified XP` : `${item.requirement.value} workshop ${item.requirement.value === 1 ? "assembly" : "assemblies"}`;
}

function EquipmentIcon({ item }: { item: HubEquipment }) {
  if (item.id === "field-scanner") return <Search size={21} />;
  if (item.id === "signal-decoder") return <Radio size={21} />;
  if (item.id === "relay-core") return <Microchip size={21} />;
  if (item.id === "field-case") return <Hammer size={21} />;
  return <Sparkles size={21} />;
}

function TriviaPanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<TriviaPayload | null>(null);
  const [difficulty, setDifficulty] = useState<TriviaDifficulty>("recruit");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/games/trivia", { credentials: "include", cache: "no-store" });
      const result = await response.json() as TriviaPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Trivia is unavailable.");
      setPayload(result); if (result.game) setDifficulty(result.game.difficulty); setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DZN Trivia is unavailable.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function mutate(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/trivia", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as TriviaPayload & { error?: string };
      if (!response.ok) { setError(result.error || "The trivia request failed."); return; }
      setPayload(result); if (result.game) setDifficulty(result.game.difficulty); onProgress();
    } catch { setError("The trivia request could not be completed."); }
    finally { setBusy(false); }
  }

  const game = payload?.game;
  const active = game?.status === "playing" && game.expiresAt > now;
  return <section aria-labelledby="trivia-title" className={styles.triviaPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>02 / SURVIVAL INTELLIGENCE</span><h2 id="trivia-title">DZN Trivia</h2></div><BookOpen size={24} /></div>
    {error && <div className={styles.triviaUnavailable} role="status"><ShieldCheck size={20} /><div><strong>{payload ? "Round paused" : "Not open yet"}</strong><span>{error}</span></div>{payload && <button className={styles.iconButton} title="Retry trivia" onClick={() => void load()}><RefreshCw size={17} /></button>}</div>}
    {!error && <>
      <div className={styles.gameTools}>
        <label>Difficulty<select aria-label="Trivia difficulty" value={difficulty} disabled={busy || active} onChange={event => setDifficulty(event.target.value as TriviaDifficulty)}>{(Object.keys(TRIVIA_DIFFICULTIES) as TriviaDifficulty[]).map(key => <option key={key} value={key}>{TRIVIA_DIFFICULTIES[key].label}</option>)}</select></label>
        <button className={styles.primary} disabled={busy || active} onClick={() => void mutate({ action: "start", difficulty })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Round in progress" : game ? "New round" : "Start round"}</button>
      </div>
      {game?.question && active ? <div className={styles.triviaQuestion}>
        <div className={styles.triviaMeta}><span>Question {game.question.number} / {game.question.total}</span><span>{game.correct} correct</span><span><Clock3 size={14} />{clock(game.expiresAt - now)}</span></div>
        <h3>{game.question.prompt}</h3>
        <div className={styles.triviaChoices}>{game.question.choices.map((choice, index) => <button key={choice} disabled={busy} onClick={() => void mutate({ action: "answer", gameId: game.id, version: game.version, answer: index })}><span>{String.fromCharCode(65 + index)}</span>{choice}</button>)}</div>
      </div> : game && <div className={`${styles.result} ${game.status === "passed" ? styles.won : ""}`} role="status">
        {game.status === "passed" ? <><ShieldCheck size={22} /><div><strong>Briefing passed</strong><span>{payload.rewardedToday.includes(game.difficulty) ? `${TRIVIA_DIFFICULTIES[game.difficulty].label} reward recorded for today.` : "Round complete."}</span></div></> : game.status === "failed" ? <><Target size={22} /><div><strong>Briefing incomplete</strong><span>{game.correct} of 5 correct. Four correct answers are required.</span></div></> : <><Clock3 size={22} /><div><strong>Briefing expired</strong><span>Start a new round when you are ready.</span></div></>}
      </div>}
      {!game && <div className={styles.triviaReady}><BookOpen size={34} /><h3>Five questions. Four to pass.</h3><p>Answers are checked by DZN. Each difficulty can award website XP and parts once per UTC day.</p><div className={styles.rewardPills}><span>+{TRIVIA_DIFFICULTIES[difficulty].xp} XP</span><span>+{TRIVIA_DIFFICULTIES[difficulty].parts} parts</span></div></div>}
    </>}
  </section>;
}

function WordChainPanel({ onProgress }: { onProgress: () => void }) {
  const [payload, setPayload] = useState<WordChainPayload | null>(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    if (submitting.current) return;
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/word-chain", { credentials: "include", cache: "no-store" });
      const result = await response.json() as WordChainPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Word Chain is unavailable.");
      if (sequence !== generation.current) return;
      setPayload(result); setError("");
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Word Chain is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 10_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  async function play() {
    if (!payload || busy) return;
    let refreshAfter = false;
    submitting.current = true;
    generation.current++;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/word-chain", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "play", roundId: payload.round.id, version: payload.round.version, word }) });
      const result = await response.json() as WordChainPayload & { error?: string };
      if (!response.ok) { setError(result.error || "That turn could not be recorded."); refreshAfter = response.status === 409; return; }
      setPayload(result); setWord(""); onProgress();
    } catch { setError("That turn could not be recorded. Refresh before retrying."); }
    finally { submitting.current = false; setBusy(false); if (refreshAfter) void load(); }
  }

  const required = payload?.round.requiredLetter.toUpperCase() ?? "-";
  return <section aria-labelledby="word-chain-title" className={styles.wordChainPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>03 / NETWORK RELAY</span><h2 id="word-chain-title">DZN Word Chain</h2></div><Radio size={24} /></div>
    {error && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error}</span><button className={styles.iconButton} title="Refresh Word Chain" onClick={() => void load()}><RefreshCw size={17} /></button></div>}
    {payload && <>
      <div className={styles.chainCurrent}><span>Current signal</span><strong>{payload.round.currentWord}</strong><div>Next word starts with <b>{required}</b></div></div>
      <form className={styles.chainForm} onSubmit={event => { event.preventDefault(); void play(); }}>
        <label htmlFor="word-chain-entry">Your word</label><div><input id="word-chain-entry" value={word} maxLength={18} autoComplete="off" spellCheck
          placeholder={`${required.toLowerCase()}...`} disabled={busy || !payload.round.canPlay} onChange={event => setWord(event.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 18))} />
        <button className={styles.primary} disabled={busy || !payload.round.canPlay || word.length < 3}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <ArrowRight size={17} />}Send turn</button></div>
        <small>{payload.round.completed ? "Signal complete. A new shared chain starts tomorrow." : payload.round.canPlay ? "Real words only. Used words cannot repeat." : "Another player must take the next turn."}</small>
      </form>
      <div className={styles.chainReward}><ShieldCheck size={18} /><div><strong>{payload.rewardedToday ? "Daily relay reward earned" : `First accepted turn: +${WORD_CHAIN_REWARD.xp} XP and +${WORD_CHAIN_REWARD.parts} part`}</strong><span>Game words stay in this game feed and are not posted to Global Chat.</span></div></div>
      <div className={styles.chainFeed}><div className={styles.triviaMeta}><span>Latest accepted turns</span><span>Turn {payload.round.version}</span></div>
        {payload.round.entries.length ? <ol>{payload.round.entries.map(entry => <li key={entry.id}><span>{entry.turn.toString().padStart(2, "0")}</span><strong>{entry.word}</strong><small>{entry.player}</small></li>)}</ol>
          : <div className={styles.chainEmpty}>Be the first player to continue today&apos;s signal.</div>}
      </div>
    </>}
    {!payload && busy && <div className={styles.triviaReady}><LoaderCircle className={styles.spinner} size={34} /><h3>Joining the daily chain</h3></div>}
  </section>;
}

function HideSeekPanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<HideSeekPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/hide-seek", { credentials: "include", cache: "no-store" });
      const result = await response.json() as HideSeekPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Signal Hunt is unavailable.");
      if (sequence === generation.current) { setPayload(result); setError(""); }
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Signal Hunt is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, []);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  async function mutate(body: Record<string, unknown>) {
    if (busy) return;
    const sequence = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/hide-seek", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as HideSeekPayload & { error?: string };
      if (!response.ok) { setError(result.error || "That scan could not be recorded."); if (response.status === 409) void load(); return; }
      if (sequence !== generation.current) return;
      setPayload(result); onProgress();
    } catch { if (sequence === generation.current) setError("That scan could not be recorded. Refresh before retrying."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }

  const game = payload?.game;
  const available = Boolean(payload) && !error;
  const active = available && game?.status === "playing" && game.expiresAt > now;
  const restartCoolingDown = Boolean(game && now < game.startedAt + 5000);
  function scan(x: number, y: number) { if (game && active && !busy) void mutate({ action: "scan", gameId: game.id, version: game.version, x, y }); }
  return <section aria-labelledby="hide-seek-title" className={styles.hideSeekPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>04 / RECONNAISSANCE</span><h2 id="hide-seek-title">DZN Signal Hunt</h2></div><Search size={24} /></div>
    {error && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error}</span><button className={styles.iconButton} title="Refresh Signal Hunt" onClick={() => void load()}><RefreshCw size={17} /></button></div>}
    <div className={styles.hideSeekTools}>
      <div><strong>{game ? `${game.foundCount} / ${game.targets.length} signals` : "Four concealed signals"}</strong><span>{game ? `${game.maxMisses - game.misses} scan errors remaining` : "Five minutes. Six scan errors."}</span></div>
      <button className={styles.primary} disabled={busy || !available || Boolean(active) || restartCoolingDown}
        title={restartCoolingDown && !active ? "New hunt available five seconds after the last start" : undefined}
        onClick={() => void mutate({ action: "start" })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Hunt in progress" : game ? "New hunt" : "Start hunt"}</button>
    </div>
    {game ? <>
      <div className={styles.hideSeekMeta}><span><Search size={14} />{game.foundCount} found</span><span><Target size={14} />{game.misses} misses</span><span><Clock3 size={14} />{clock(game.expiresAt - now)}</span></div>
      <div className={styles.hideSeekScene} role="group" aria-label="DZN outpost signal hunt scene" aria-disabled={!active || busy}
        onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); scan(Math.round((event.clientX - bounds.left) / bounds.width * 1000), Math.round((event.clientY - bounds.top) / bounds.height * 1000)); }}>
        <Image src="/images/games/dzn-outpost.webp" alt="DZN mountain communications outpost" fill sizes="(max-width: 760px) 100vw, 760px" />
        {game.targets.map((target, index) => <button key={target.id} type="button" className={styles.hideSeekTarget} data-found={target.found}
          style={{ left: `${target.x / 10}%`, top: `${target.y / 10}%` }} disabled={!active || busy || target.found}
          aria-label={target.found ? `Signal ${index + 1} found` : `Investigate concealed signal ${index + 1}`}
          onClick={event => { event.stopPropagation(); scan(target.x, target.y); }}>{target.found ? <Check size={15} /> : <Search size={14} />}</button>)}
      </div>
      <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>All signals recovered</strong><span>{payload.rewardGranted ? `Daily reward recorded: +${HIDE_SEEK_REWARD.xp} XP and +${HIDE_SEEK_REWARD.parts} parts.` : payload.rewardedToday ? "Practice hunt complete. Today's reward was already recorded." : "Hunt complete."}</span></div></>
          : game.status === "failed" ? <><Target size={22} /><div><strong>Search window closed</strong><span>Too many empty scans. Your existing progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Hunt expired</strong><span>Start a new reconnaissance run when ready.</span></div></>
              : <><Radio size={20} /><div><strong>Signals concealed</strong><span>Inspect the scene closely. Every find is checked by DZN.</span></div></>}
      </div>
    </> : <div className={styles.triviaReady}><Search size={34} /><h3>Search the outpost.</h3><p>Find four concealed DZN signals. Mouse, touch and keyboard targets are supported.</p><div className={styles.rewardPills}><span>+{HIDE_SEEK_REWARD.xp} XP</span><span>+{HIDE_SEEK_REWARD.parts} parts</span></div></div>}
  </section>;
}

function RelayRushPanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<RelayRushPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const serverClock = useRef({ time: 0, measuredAt: 0 });
  const [relayNow, setRelayNow] = useState(0);

  const receivePayload = useCallback((result: RelayRushPayload) => {
    serverClock.current = { time: result.serverTime, measuredAt: performance.now() };
    setRelayNow(result.serverTime);
    setPayload(result);
  }, []);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/relay-rush", { credentials: "include", cache: "no-store" });
      const result = await response.json() as RelayRushPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Relay Rush is unavailable.");
      if (sequence === generation.current) { receivePayload(result); setError(""); }
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Relay Rush is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [receivePayload]);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (busy) return;
    const sequence = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/relay-rush", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as RelayRushPayload & { error?: string };
      if (!response.ok) { setError(result.error || "That signal pulse could not be recorded."); if (response.status === 409) void load(); return; }
      if (sequence !== generation.current) return;
      receivePayload(result); onProgress();
    } catch { if (sequence === generation.current) setError("That signal pulse could not be recorded. Refresh before retrying."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [busy, load, onProgress, receivePayload]);

  useEffect(() => {
    if (!payload?.game) return;
    const timer = window.setInterval(() => {
      const clock = serverClock.current;
      setRelayNow(clock.time + performance.now() - clock.measuredAt);
    }, 50);
    return () => window.clearInterval(timer);
  }, [payload?.game, payload?.serverTime]);

  const game = payload?.game;
  const clockNow = Math.max(now, relayNow, payload?.serverTime ?? 0);
  const available = Boolean(payload) && !error;
  const active = Boolean(available && game?.status === "playing" && game.expiresAt > clockNow &&
    (!game.nextAt || clockNow < game.nextAt + RELAY_RUSH_PULSE_INTERVAL_MS));
  const targetOpen = Boolean(active && game?.nextAt && clockNow >= game.nextAt && clockNow < game.nextAt + RELAY_RUSH_PULSE_INTERVAL_MS - RELAY_RUSH_INPUT_GUARD_MS);
  const restartCoolingDown = Boolean(game && clockNow < game.startedAt + 5000);
  const submitPulse = useCallback((lane: RelayRushLane) => {
    if (!game || !active || !targetOpen || busy) return;
    void mutate({ action: "pulse", gameId: game.id, version: game.version, lane });
  }, [active, busy, game, mutate, targetOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const source = event.target;
      if (source instanceof Element && source.closest("input, textarea, select, [contenteditable=true]")) return;
      const key = event.key.toLowerCase();
      const lane = key === "a" || event.key === "ArrowLeft" ? "left" : key === "s" || event.key === "ArrowDown" ? "centre" : key === "d" || event.key === "ArrowRight" ? "right" : null;
      if (!lane || !active || !targetOpen || busy) return;
      event.preventDefault(); submitPulse(lane);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, busy, submitPulse, targetOpen]);

  return <section aria-labelledby="relay-rush-title" className={styles.relayRushPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>05 / SIGNAL ENDURANCE</span><h2 id="relay-rush-title">DZN Relay Rush</h2></div><Zap size={24} /></div>
    {error && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error}</span><button className={styles.iconButton} title="Refresh Relay Rush" onClick={() => void load()}><RefreshCw size={17} /></button></div>}
    <div className={styles.relayRushTools}>
      <div><strong>{game ? `${game.pulsesCleared} / ${game.totalPulses} pulses` : "Twelve signal pulses"}</strong><span>{game ? `${game.maxMisses - game.misses} signal errors remaining` : "Read the live lane, then answer on time."}</span></div>
      <button className={styles.primary} disabled={busy || !available || active || restartCoolingDown}
        title={restartCoolingDown && !active ? "New run available five seconds after the last start" : undefined}
        onClick={() => void mutate({ action: "start" })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Run in progress" : game ? "New run" : "Start run"}</button>
    </div>
    {game ? <>
      <div className={styles.relayRushMeta}><span><Zap size={14} />{game.pulsesCleared} / {game.totalPulses}</span><span><Target size={14} />{game.misses} misses</span><span><Clock3 size={14} />{clock(game.expiresAt - clockNow)}</span></div>
      <div className={styles.relayRushStage} data-ready={targetOpen} data-status={game.status} aria-live="polite">
        <div className={styles.relayRushReadout}><span>{active ? targetOpen ? "INCOMING PULSE" : "SYNCING RELAY" : game.status === "won" ? "RUN COMPLETE" : "RUN CLOSED"}</span><strong>{active ? targetOpen ? "Choose the lit lane" : "Stand by for the next signal" : game.status === "won" ? "Signal restored" : game.status === "failed" ? "Signal lost" : "Window expired"}</strong></div>
        <div className={styles.relayRushLanes} role="group" aria-label="Relay Rush signal lanes">
          {RELAY_RUSH_LANES.map(lane => { const meta = RELAY_RUSH_LANE_META[lane]; const lit = targetOpen && game.nextLane === lane; return <button type="button" key={lane} className={styles.relayRushLane}
            data-lane={lane} data-target={lit} disabled={busy || !active || !targetOpen} onClick={() => submitPulse(lane)}
            aria-label={`${meta.label} signal lane (${meta.key})${lit ? ", live" : ""}`}><span>{meta.key}</span><strong>{meta.label}</strong><small>{lit ? "Pulse live" : active ? "Await signal" : "Stand down"}</small></button>; })}
        </div>
        <p className={styles.relayRushHint}>Keyboard: A / S / D or arrow keys. The server verifies pulse order and timing.</p>
      </div>
      <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Relay restored</strong><span>{payload?.rewardGranted ? `Daily reward recorded: +${RELAY_RUSH_REWARD.xp} XP and +${RELAY_RUSH_REWARD.parts} parts.` : payload?.rewardedToday ? "Practice run complete. Today's reward was already recorded." : "Run complete."}</span></div></>
          : game.status === "failed" ? <><Target size={22} /><div><strong>Signal lost</strong><span>Three missed pulses ended the run. Existing Hub progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Run expired</strong><span>Start a new signal run when ready.</span></div></>
              : <><Radio size={20} /><div><strong>{targetOpen ? "Pulse live" : "Relay synchronising"}</strong><span>{targetOpen ? "Choose the highlighted lane before the next pulse." : "The next lane appears when the DZN relay opens it."}</span></div></>}
      </div>
    </> : !busy && !error && <div className={styles.relayRushReady}><Radio size={34} /><h3>Keep the relay alive.</h3><p>Read twelve DZN-controlled signal pulses. The route, timing and reward are verified server-side.</p><div className={styles.rewardPills}><span>12 pulses</span><span>+{RELAY_RUSH_REWARD.xp} XP</span><span>+{RELAY_RUSH_REWARD.parts} parts</span></div></div>}
  </section>;
}

function EchoArrayPanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<EchoArrayPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [litNode, setLitNode] = useState<EchoArrayNode | null>(null);
  const generation = useRef(0);
  const serverClock = useRef({ time: 0, measuredAt: 0 });
  const [echoNow, setEchoNow] = useState(0);
  const { notice, cooldown, clearCooldown, startCooldown } = useTransientActionCooldown(ECHO_ARRAY_COOLDOWN_MS);

  const receivePayload = useCallback((result: EchoArrayPayload) => {
    serverClock.current = { time: result.serverTime, measuredAt: performance.now() };
    setEchoNow(result.serverTime);
    setPayload(result);
  }, []);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/echo-array", { credentials: "include", cache: "no-store" });
      const result = await response.json() as EchoArrayPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Echo Array is unavailable.");
      if (sequence === generation.current) { receivePayload(result); clearCooldown(); setError(""); }
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Echo Array is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [clearCooldown, receivePayload]);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (busy || cooldown) return;
    const sequence = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/echo-array", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as EchoArrayPayload & { error?: string };
      if (!response.ok) {
        if (response.status === 429) { startCooldown(result.error || "Take a moment before selecting the next node."); return; }
        setError(result.error || "That echo input could not be recorded."); if (response.status === 409) void load(); return;
      }
      if (sequence !== generation.current) return;
      receivePayload(result); clearCooldown(); onProgress();
    } catch { if (sequence === generation.current) setError("That echo input could not be recorded. Refresh before retrying."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [busy, clearCooldown, cooldown, load, onProgress, receivePayload, startCooldown]);

  useEffect(() => {
    if (!payload?.game) return;
    const timer = window.setInterval(() => {
      const clock = serverClock.current;
      setEchoNow(clock.time + performance.now() - clock.measuredAt);
    }, 50);
    return () => window.clearInterval(timer);
  }, [payload?.game, payload?.serverTime]);

  const game = payload?.game;
  const clockNow = Math.max(now, echoNow, payload?.serverTime ?? 0);
  const available = Boolean(payload) && !error;
  const active = Boolean(available && game?.status === "playing" && game.expiresAt > clockNow);
  const revealing = Boolean(active && game && clockNow < game.cueEndsAt);
  const inputOpen = active && !revealing;
  const restartCoolingDown = Boolean(game && clockNow < game.startedAt + 5000);
  const submitNode = useCallback((node: EchoArrayNode) => {
    if (!game || !inputOpen || busy || cooldown) return;
    void mutate({ action: "tap", gameId: game.id, version: game.version, node });
  }, [busy, cooldown, game, inputOpen, mutate]);

  useEffect(() => {
    const cue = game?.cue;
    const cueStartedAt = game?.cueStartedAt;
    if (!cue || cueStartedAt === undefined || !revealing) {
      const clear = window.setTimeout(() => setLitNode(null), 0);
      return () => window.clearTimeout(clear);
    }
    const update = () => {
      const serverNow = Math.max(now, serverClock.current.time + performance.now() - serverClock.current.measuredAt);
      const index = Math.floor((serverNow - cueStartedAt - ECHO_ARRAY_CUE_LEAD_MS) / ECHO_ARRAY_CUE_INTERVAL_MS);
      setLitNode(index >= 0 && index < cue.length ? cue[index] : null);
    };
    update();
    const timer = window.setInterval(update, 60);
    return () => window.clearInterval(timer);
  }, [game?.cue, game?.cueStartedAt, now, revealing]);

  useEffect(() => {
    if (!game || !revealing) return;
    const timer = window.setTimeout(() => void load(), Math.max(80, game.cueEndsAt - clockNow + 80));
    return () => window.clearTimeout(timer);
  }, [clockNow, game, load, revealing]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const source = event.target;
      if (source instanceof Element && source.closest("input, textarea, select, [contenteditable=true]")) return;
      const node = event.key === "1" || event.key === "ArrowUp" ? "north" : event.key === "2" || event.key === "ArrowRight" ? "east"
        : event.key === "3" || event.key === "ArrowDown" ? "south" : event.key === "4" || event.key === "ArrowLeft" ? "west" : null;
      if (!node || !inputOpen || busy || cooldown) return;
      event.preventDefault(); submitNode(node);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, cooldown, inputOpen, submitNode]);

  return <section aria-labelledby="echo-array-title" className={styles.echoArrayPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>07 / MEMORY RELAY</span><h2 id="echo-array-title">DZN Echo Array</h2></div><Microchip size={24} /></div>
    {(error || notice) && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error || notice}</span>{error && <button className={styles.iconButton} title="Refresh Echo Array" onClick={() => void load()}><RefreshCw size={17} /></button>}</div>}
    <div className={styles.echoArrayTools}>
      <div><strong>{game ? `Stage ${game.stage} / ${game.totalStages}` : "Three escalating signal echoes"}</strong><span>{game ? `${game.maxErrors - game.errors} calibration retries remaining` : "Watch the pattern, then replay it from memory."}</span></div>
      <button className={styles.primary} disabled={busy || cooldown || !available || active || restartCoolingDown}
        title={restartCoolingDown && !active ? "New echo available five seconds after the last start" : undefined}
        onClick={() => void mutate({ action: "start" })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Echo in progress" : game ? "New echo" : "Start echo"}</button>
    </div>
    {game ? <>
      <div className={styles.echoArrayMeta}><span><Microchip size={14} />Stage {game.stage} / {game.totalStages}</span><span><Target size={14} />{game.inputIndex} / {game.sequenceLength} nodes</span><span><Clock3 size={14} />{clock(game.expiresAt - clockNow)}</span></div>
      <div className={styles.echoArrayStage} data-revealing={revealing} data-status={game.status} aria-live="polite">
        <div className={styles.echoArrayReadout}><span>{active ? revealing ? "WATCH THE ARRAY" : "REPLAY THE ARRAY" : game.status === "won" ? "ARRAY SYNCHRONISED" : "ARRAY CLOSED"}</span><strong>{active ? revealing ? "Commit the pulse pattern" : "Repeat the stored signal" : game.status === "won" ? "Network echo restored" : game.status === "failed" ? "Signal memory lost" : "Signal window expired"}</strong></div>
        <div className={styles.echoArrayNodes} role="group" aria-label="Echo Array signal nodes">
          {ECHO_ARRAY_NODE_ORDER.map(node => { const meta = ECHO_ARRAY_NODE_META[node]; const lit = revealing && litNode === node; return <button type="button" key={node} className={styles.echoArrayNode}
            data-node={node} data-lit={lit} disabled={busy || cooldown || !inputOpen} onClick={() => submitNode(node)}
            aria-label={`${meta.label} (${meta.key})${lit ? ", signal live" : ""}`}><span>{meta.key}</span><strong>{meta.label.replace(" array", "")}</strong><small>{lit ? "Pulse live" : revealing ? "Observe" : inputOpen ? "Select" : "Stand down"}</small></button>; })}
        </div>
        <p className={styles.echoArrayHint}>Keyboard: 1 to 4 or the arrow keys. The server records every stage, retry and reward.</p>
      </div>
      <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Echo synchronised</strong><span>{payload?.rewardGranted ? `Daily reward recorded: +${ECHO_ARRAY_REWARD.xp} XP and +${ECHO_ARRAY_REWARD.parts} parts.` : payload?.rewardedToday ? "Practice echo complete. Today's reward was already recorded." : "Echo complete."}</span></div></>
          : game.status === "failed" ? <><Target size={22} /><div><strong>Signal memory lost</strong><span>Two calibration errors ended the run. Existing Hub progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Echo expired</strong><span>Start a new array when you are ready.</span></div></>
              : <><Radio size={20} /><div><strong>{revealing ? "Pattern live" : "Input open"}</strong><span>{revealing ? "Watch each illuminated node before the array unlocks." : "Replay the full pattern in its original order."}</span></div></>}
      </div>
    </> : !busy && !error && <div className={styles.echoArrayReady}><Microchip size={34} /><h3>Hold the tactical pattern.</h3><p>Replay three escalating field-signal arrays from memory. Progression is recorded only when the DZN server verifies the complete run.</p><div className={styles.rewardPills}><span>3 stages</span><span>+{ECHO_ARRAY_REWARD.xp} XP</span><span>+{ECHO_ARRAY_REWARD.parts} parts</span></div></div>}
  </section>;
}

function OutpostRunPanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<OutpostRunPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const generation = useRef(0);
  const cooldownTimer = useRef<number | null>(null);

  const startCooldown = useCallback((message: string) => {
    if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current);
    setNotice(message); setCooldown(true);
    cooldownTimer.current = window.setTimeout(() => { cooldownTimer.current = null; setNotice(""); setCooldown(false); }, OUTPOST_RUN_COOLDOWN_MS);
  }, []);

  useEffect(() => () => { if (cooldownTimer.current !== null) window.clearTimeout(cooldownTimer.current); }, []);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/outpost-run", { credentials: "include", cache: "no-store" });
      const result = await response.json() as OutpostRunPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Outpost Run is unavailable.");
      if (sequence === generation.current) { setPayload(result); setError(""); setNotice(""); setCooldown(false); }
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Outpost Run is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, []);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (busy || cooldown) return;
    const sequence = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/outpost-run", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as OutpostRunPayload & { error?: string };
      if (!response.ok) {
        if (response.status === 429) { startCooldown(result.error || "Take a moment before the next field command."); return; }
        setError(result.error || "That field command could not be recorded."); if (response.status === 409) void load(); return;
      }
      if (sequence !== generation.current) return;
      setPayload(result); setNotice(""); onProgress();
    } catch { if (sequence === generation.current) setError("That field command could not be recorded. Refresh before retrying."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [busy, cooldown, load, onProgress, startCooldown]);

  const game = payload?.game;
  const clockNow = Math.max(now, payload?.serverTime ?? 0);
  const available = Boolean(payload) && !error;
  const active = Boolean(available && game?.status === "playing" && game.expiresAt > clockNow);
  const restartCoolingDown = Boolean(game && clockNow < game.startedAt + 5_000);
  const revealed = new globalThis.Map((game?.visibleCells ?? []).map(cell => [`${cell.row}:${cell.column}`, cell.kind]));
  const sendMove = useCallback((direction: OutpostRunDirection) => {
    if (!game || !active || busy || cooldown) return;
    void mutate({ action: "move", gameId: game.id, version: game.version, direction });
  }, [active, busy, cooldown, game, mutate]);
  const moveDisabled = (direction: OutpostRunDirection) => {
    if (!game || !active || busy || cooldown) return true;
    if (direction === "north") return game.row === 0;
    if (direction === "east") return game.column === game.gridSize - 1;
    if (direction === "south") return game.row === game.gridSize - 1;
    return game.column === 0;
  };

  return <section aria-labelledby="outpost-run-title" className={styles.outpostRunPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>08 / FIELD EXTRACTION</span><h2 id="outpost-run-title">DZN Outpost Run</h2></div><Map size={24} /></div>
    {(error || notice) && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error || notice}</span>{error && <button className={styles.iconButton} title="Refresh Outpost Run" onClick={() => void load()}><RefreshCw size={17} /></button>}</div>}
    <div className={styles.outpostRunTools}>
      <div><strong>{game ? `Field grid ${game.moves} / ${game.maxMoves}` : "Fog-grid field extraction"}</strong><span>{game ? `${game.energy} stamina cells remaining` : "Reach the emergency relay before your field pack runs dry."}</span></div>
      <button className={styles.primary} disabled={busy || cooldown || !available || active || restartCoolingDown}
        title={restartCoolingDown && !active ? "New outpost run available five seconds after the last start" : undefined}
        onClick={() => void mutate({ action: "start" })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Run in progress" : game ? "New run" : "Start run"}</button>
    </div>
    {game ? <>
      <div className={styles.outpostRunMeta}><span><ShieldCheck size={14} />{game.energy} / {game.maxEnergy} stamina</span><span><Map size={14} />{game.moves} / {game.maxMoves} field moves</span><span><Clock3 size={14} />{clock(game.expiresAt - clockNow)}</span></div>
      <div className={styles.outpostRunStage} data-status={game.status}>
        <div className={styles.outpostRunReadout}><span>{active ? "FIELD SIGNAL / UNVERIFIED" : game.status === "won" ? "RELAY / SECURED" : "FIELD SIGNAL / CLOSED"}</span><strong>{active ? "Trace the emergency relay" : game.status === "won" ? "Extraction route completed" : game.status === "failed" ? "Field pack exhausted" : "Signal window expired"}</strong></div>
        <div className={styles.outpostRunGrid} role="grid" aria-label="Outpost Run fog grid">
          {Array.from({ length: game.gridSize * game.gridSize }, (_, index) => {
            const row = Math.floor(index / game.gridSize); const column = index % game.gridSize;
            const terrain = revealed.get(`${row}:${column}`);
            const player = game.row === row && game.column === column;
            const label = player ? "You" : terrain === "relay" ? "Emergency relay" : terrain === "hazard" ? "Hazard" : terrain === "start" ? "Field entry" : terrain === "clear" ? "Surveyed ground" : "Unknown terrain";
            return <div key={`${row}:${column}`} role="gridcell" aria-label={`${label}, row ${row + 1}, column ${column + 1}`}
              className={styles.outpostRunCell} data-terrain={terrain ?? "unknown"} data-player={player}>
              {terrain === "relay" ? <Radio size={18} /> : terrain === "hazard" ? <Zap size={18} /> : terrain === "start" ? <Flag size={18} /> : terrain === "clear" ? <Check size={16} /> : <span>?</span>}
              {player && <ShieldCheck className={styles.outpostRunPlayer} size={19} />}
            </div>;
          })}
        </div>
        <div className={styles.outpostRunCommand}>
          <button className={styles.outpostRunScan} disabled={busy || cooldown || !active || !game.scanAvailable}
            onClick={() => void mutate({ action: "scan", gameId: game.id, version: game.version })}><Search size={16} />{game.scanHint ? `Scanner: ${game.scanHint.replace("-", " / ")}` : "Use field scanner"}</button>
          <div className={styles.outpostRunControls} aria-label="Outpost movement controls">
            {OUTPOST_RUN_DIRECTIONS.map(direction => { const meta = OUTPOST_RUN_DIRECTION_META[direction]; const DirectionIcon = meta.icon; return <button key={direction} type="button"
              className={styles.outpostRunMove} data-direction={direction} disabled={moveDisabled(direction)} onClick={() => sendMove(direction)} title={meta.label} aria-label={meta.label}><DirectionIcon size={18} /></button>; })}
          </div>
        </div>
        <p className={styles.outpostRunHint}>Only ground you enter becomes visible. Hazards drain one stamina cell; the scanner gives one coarse relay direction.</p>
      </div>
      <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Relay secured</strong><span>{payload?.rewardGranted ? `Daily reward recorded: +${OUTPOST_RUN_REWARD.xp} XP and +${OUTPOST_RUN_REWARD.parts} parts.` : payload?.rewardedToday ? "Practice run complete. Today's reward was already recorded." : "Outpost Run complete."}</span></div></>
          : game.status === "failed" ? <><Target size={22} /><div><strong>Field pack exhausted</strong><span>Hazards or a lost route ended the extraction. Existing Hub progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Signal expired</strong><span>Start a new field run when you are ready.</span></div></>
              : <><Radio size={20} /><div><strong>Extraction active</strong><span>{game.scanHint ? `Scanner points ${game.scanHint.replace("-", " and ")}.` : "Use the scanner once, then move through the fog grid."}</span></div></>}
      </div>
    </> : !busy && !error && <div className={styles.outpostRunReady}><Map size={34} /><h3>Hold the route through the unknown.</h3><p>Move through a live five-by-five field grid, manage stamina around hazards, and extract the emergency relay before the signal closes.</p><div className={styles.rewardPills}><span>Fog grid</span><span>+{OUTPOST_RUN_REWARD.xp} XP</span><span>+{OUTPOST_RUN_REWARD.parts} parts</span></div></div>}
  </section>;
}

function SignalShiftPanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<SignalShiftPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const { notice, cooldown, clearCooldown, startCooldown } = useTransientActionCooldown(SIGNAL_SHIFT_COOLDOWN_MS);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/signal-shift", { credentials: "include", cache: "no-store" });
      const result = await response.json() as SignalShiftPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Signal Shift is unavailable.");
      if (sequence === generation.current) { setPayload(result); clearCooldown(); setError(""); }
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Signal Shift is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [clearCooldown]);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (busy || cooldown) return;
    const sequence = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/signal-shift", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as SignalShiftPayload & { error?: string };
      if (!response.ok) {
        if (response.status === 429) { startCooldown(result.error || "Route one sector at a time."); return; }
        setError(result.error || "That Signal Shift command could not be recorded."); if (response.status === 409) void load(); return;
      }
      if (sequence !== generation.current) return;
      setPayload(result); clearCooldown(); onProgress();
    } catch { if (sequence === generation.current) setError("That Signal Shift command could not be recorded. Refresh before retrying."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [busy, clearCooldown, cooldown, load, onProgress, startCooldown]);

  const game = payload?.game;
  const clockNow = Math.max(now, payload?.serverTime ?? 0);
  const available = Boolean(payload) && !error;
  const active = Boolean(available && game?.status === "playing" && game.expiresAt > clockNow);
  const restartCoolingDown = Boolean(game && clockNow < game.startedAt + 5_000);
  const blank = game?.tiles.indexOf(0) ?? -1;
  const isAdjacent = (index: number) => {
    if (!game || blank < 0) return false;
    const row = Math.floor(index / game.gridSize); const column = index % game.gridSize;
    const blankRow = Math.floor(blank / game.gridSize); const blankColumn = blank % game.gridSize;
    return Math.abs(row - blankRow) + Math.abs(column - blankColumn) === 1;
  };
  const move = useCallback((tile: number) => {
    if (!game || !active || busy || cooldown) return;
    void mutate({ action: "move", gameId: game.id, version: game.version, tile });
  }, [active, busy, cooldown, game, mutate]);

  return <section aria-labelledby="signal-shift-title" className={styles.signalShiftPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>09 / TACTICAL ROUTING</span><h2 id="signal-shift-title">DZN Signal Shift</h2></div><Target size={24} /></div>
    {(error || notice) && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error || notice}</span>{error && <button className={styles.iconButton} title="Refresh Signal Shift" onClick={() => void load()}><RefreshCw size={17} /></button>}</div>}
    <div className={styles.signalShiftTools}>
      <div><strong>{game ? `${game.moves} / ${game.maxMoves} sector shifts` : "Four-by-four tactical routing"}</strong><span>{game ? "Move sectors into the open relay slot to rebuild the signal line." : "The verified DZN server owns the route, move count, reward, and daily cap."}</span></div>
      <button className={styles.primary} disabled={busy || cooldown || !available || active || restartCoolingDown}
        title={restartCoolingDown && !active ? "New Signal Shift board available five seconds after the last start" : undefined}
        onClick={() => void mutate({ action: "start" })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Route in progress" : game ? "New route" : "Start routing"}</button>
    </div>
    {game ? <>
      <div className={styles.signalShiftMeta}><span><Target size={14} />{game.moves} / {game.maxMoves} shifts</span><span><Microchip size={14} />{game.gridSize} x {game.gridSize} relay grid</span><span><Clock3 size={14} />{clock(game.expiresAt - clockNow)}</span></div>
      <div className={styles.signalShiftStage} data-status={game.status}>
        <div className={styles.signalShiftReadout} aria-live="polite"><span>{active ? "RELAY MATRIX / LIVE" : game.status === "won" ? "RELAY MATRIX / STABLE" : "RELAY MATRIX / CLOSED"}</span><strong>{active ? "Route each sector into sequence" : game.status === "won" ? "Signal line restored" : game.status === "failed" ? "Shift limit reached" : "Signal window expired"}</strong></div>
        <div className={styles.signalShiftGrid} role="grid" aria-label="Signal Shift tactical grid">
          {game.tiles.map((tile, index) => {
            const movable = active && tile !== 0 && isAdjacent(index);
            const row = Math.floor(index / game.gridSize) + 1;
            const column = index % game.gridSize + 1;
            return <button type="button" key={`${tile}:${index}`} role="gridcell" className={styles.signalShiftTile}
              data-blank={tile === 0} data-adjacent={movable} disabled={!movable || busy || cooldown}
              aria-label={tile === 0 ? `Open relay slot, row ${row}, column ${column}` : `Sector ${tile}, row ${row}, column ${column}${movable ? ", available to shift" : ""}`}
              onClick={() => move(tile)}>{tile === 0 ? <span>CORE</span> : <><small>SECTOR</small><strong>{String(tile).padStart(2, "0")}</strong></>}</button>;
          })}
        </div>
        <p className={styles.signalShiftHint}>Only sectors beside the open relay slot can move. Put sectors 01 through 15 in order, with the core slot at the end.</p>
      </div>
      <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Signal line restored</strong><span>{payload?.rewardGranted ? `Daily reward recorded: +${SIGNAL_SHIFT_REWARD.xp} XP and +${SIGNAL_SHIFT_REWARD.parts} parts.` : payload?.rewardedToday ? "Practice route complete. Today's reward was already recorded." : "Signal Shift complete."}</span></div></>
          : game.status === "failed" ? <><Target size={22} /><div><strong>Route limit reached</strong><span>The relay line did not stabilise in time. Existing Hub progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Signal expired</strong><span>Start another route when you are ready.</span></div></>
              : <><Radio size={20} /><div><strong>Routing active</strong><span>Choose one highlighted neighbouring sector at a time. The server validates every shift.</span></div></>}
      </div>
    </> : !busy && !error && <div className={styles.signalShiftReady}><Target size={34} /><h3>Bring the relay matrix online.</h3><p>Shift sectors through a live four-by-four grid until every route is back in sequence. Only verified server wins award progression.</p><div className={styles.rewardPills}><span>72 shifts</span><span>+{SIGNAL_SHIFT_REWARD.xp} XP</span><span>+{SIGNAL_SHIFT_REWARD.parts} parts</span></div></div>}
  </section>;
}

function CircuitForgePanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<CircuitForgePayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const { notice, cooldown, clearCooldown, startCooldown } = useTransientActionCooldown(CIRCUIT_FORGE_COOLDOWN_MS);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/circuit-forge", { credentials: "include", cache: "no-store" });
      const result = await response.json() as CircuitForgePayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Circuit Forge is unavailable.");
      if (sequence === generation.current) { setPayload(result); clearCooldown(); setError(""); }
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Circuit Forge is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [clearCooldown]);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (busy || cooldown) return;
    const sequence = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/circuit-forge", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as CircuitForgePayload & { error?: string };
      if (!response.ok) {
        if (response.status === 429) { startCooldown(result.error || "Rotate one relay at a time."); return; }
        setError(result.error || "That Circuit Forge rotation could not be recorded."); if (response.status === 409) void load(); return;
      }
      if (sequence !== generation.current) return;
      setPayload(result); clearCooldown(); onProgress();
    } catch { if (sequence === generation.current) setError("That Circuit Forge rotation could not be recorded. Refresh before retrying."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [busy, clearCooldown, cooldown, load, onProgress, startCooldown]);

  const game = payload?.game;
  const clockNow = Math.max(now, payload?.serverTime ?? 0);
  const available = Boolean(payload) && !error;
  const active = Boolean(available && game?.status === "playing" && game.expiresAt > clockNow);
  const restartCoolingDown = Boolean(game && clockNow < game.startedAt + 5_000);
  const rotate = useCallback((index: number) => {
    if (!game || !active || busy || cooldown || game.tiles[index]?.core) return;
    void mutate({ action: "rotate", gameId: game.id, version: game.version, index });
  }, [active, busy, cooldown, game, mutate]);

  return <section aria-labelledby="circuit-forge-title" className={styles.circuitForgePanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>10 / RELAY WORKSHOP</span><h2 id="circuit-forge-title">DZN Circuit Forge</h2></div><Settings2 size={24} /></div>
    {(error || notice) && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error || notice}</span>{error && <button className={styles.iconButton} title="Refresh Circuit Forge" onClick={() => void load()}><RefreshCw size={17} /></button>}</div>}
    <div className={styles.circuitForgeTools}>
      <div><strong>{game ? `${game.rotations} / ${game.maxRotations} relay rotations` : "Five-by-five power-grid rebuild"}</strong><span>{game ? `${game.poweredCount} / ${game.tiles.length} relays connected to the core.` : "The verified DZN server owns every relay state, win, reward, and daily cap."}</span></div>
      <button className={styles.primary} disabled={busy || cooldown || !available || active || restartCoolingDown}
        title={restartCoolingDown && !active ? "New Circuit Forge board available five seconds after the last start" : undefined}
        onClick={() => void mutate({ action: "start" })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Grid online" : game ? "New grid" : "Start rebuild"}</button>
    </div>
    {game ? <>
      <div className={styles.circuitForgeMeta}><span><Settings2 size={14} />{game.poweredCount} / {game.tiles.length} powered</span><span><Target size={14} />{game.rotations} / {game.maxRotations} rotations</span><span><Clock3 size={14} />{clock(game.expiresAt - clockNow)}</span></div>
      <div className={styles.circuitForgeStage} data-status={game.status}>
        <div className={styles.circuitForgeReadout} aria-live="polite"><span>{active ? "POWER GRID / LIVE" : game.status === "won" ? "POWER GRID / STABLE" : "POWER GRID / CLOSED"}</span><strong>{active ? "Reconnect every relay to the command core" : game.status === "won" ? "All relays are online" : game.status === "failed" ? "Rotation limit reached" : "Power window expired"}</strong></div>
        <div className={styles.circuitForgeGrid} role="grid" aria-label="Circuit Forge power grid">
          {game.tiles.map((tile, index) => {
            const rotatable = active && !tile.core;
            return <button type="button" key={index} role="gridcell" className={styles.circuitForgeTile}
              data-core={tile.core} data-powered={tile.powered} data-rotatable={rotatable} disabled={!rotatable || busy || cooldown}
              title={tile.core ? "Command core" : "Rotate relay clockwise"}
              aria-label={tile.core ? `Command core, ${tile.powered ? "powered" : "offline"}` : `Relay ${String(index + 1).padStart(2, "0")}, ${tile.powered ? "powered" : "offline"}, rotate clockwise`}
              onClick={() => rotate(index)}>
              {tile.mask & 1 ? <span className={`${styles.circuitForgeWire} ${styles.circuitForgeWireNorth}`} aria-hidden="true" /> : null}
              {tile.mask & 2 ? <span className={`${styles.circuitForgeWire} ${styles.circuitForgeWireEast}`} aria-hidden="true" /> : null}
              {tile.mask & 4 ? <span className={`${styles.circuitForgeWire} ${styles.circuitForgeWireSouth}`} aria-hidden="true" /> : null}
              {tile.mask & 8 ? <span className={`${styles.circuitForgeWire} ${styles.circuitForgeWireWest}`} aria-hidden="true" /> : null}
              <span className={styles.circuitForgeNode}>{tile.core ? "CORE" : String(index + 1).padStart(2, "0")}</span>
            </button>;
          })}
        </div>
        <p className={styles.circuitForgeHint}>Tap a relay to turn it clockwise. Finish with every cable joined and every relay powered from the core.</p>
      </div>
      <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Relay network restored</strong><span>{payload?.rewardGranted ? `Daily reward recorded: +${CIRCUIT_FORGE_REWARD.xp} XP and +${CIRCUIT_FORGE_REWARD.parts} parts.` : payload?.rewardedToday ? "Practice rebuild complete. Today's reward was already recorded." : "Circuit Forge complete."}</span></div></>
          : game.status === "failed" ? <><Settings2 size={22} /><div><strong>Rotation limit reached</strong><span>The grid did not stabilise. Existing Hub progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Power window expired</strong><span>Start another grid when you are ready.</span></div></>
              : <><Radio size={20} /><div><strong>Power restoration active</strong><span>Rotate a relay clockwise. The server validates every network change.</span></div></>}
      </div>
    </> : !busy && !error && <div className={styles.circuitForgeReady}><Settings2 size={34} /><h3>Rebuild the perimeter relay grid.</h3><p>Rotate the field conduits until every DZN relay has a clean route back to command. Only verified server restorations award progression.</p><div className={styles.rewardPills}><span>25 relays</span><span>+{CIRCUIT_FORGE_REWARD.xp} XP</span><span>+{CIRCUIT_FORGE_REWARD.parts} parts</span></div></div>}
  </section>;
}

function RangerRangePanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<RangerRangePayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const serverClock = useRef({ time: 0, measuredAt: 0 });
  const [rangeNow, setRangeNow] = useState(0);
  const { notice, cooldown, clearCooldown, startCooldown } = useTransientActionCooldown(RANGER_RANGE_COOLDOWN_MS);

  const receivePayload = useCallback((result: RangerRangePayload) => {
    serverClock.current = { time: result.serverTime, measuredAt: performance.now() };
    setRangeNow(result.serverTime);
    setPayload(result);
  }, []);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/ranger-range", { credentials: "include", cache: "no-store" });
      const result = await response.json() as RangerRangePayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Ranger Range is unavailable.");
      if (sequence === generation.current) { receivePayload(result); clearCooldown(); setError(""); }
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Ranger Range is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [clearCooldown, receivePayload]);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (busy || cooldown) return;
    const sequence = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/ranger-range", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as RangerRangePayload & { error?: string };
      if (!response.ok) {
        if (response.status === 429) { startCooldown(result.error || "Nock one arrow at a time."); return; }
        setError(result.error || "That arrow could not be recorded."); if (response.status === 409) void load(); return;
      }
      if (sequence !== generation.current) return;
      receivePayload(result); clearCooldown(); onProgress();
    } catch { if (sequence === generation.current) setError("That arrow could not be recorded. Refresh before retrying."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [busy, clearCooldown, cooldown, load, onProgress, receivePayload, startCooldown]);

  useEffect(() => {
    if (!payload?.game) return;
    const timer = window.setInterval(() => {
      const clock = serverClock.current;
      setRangeNow(clock.time + performance.now() - clock.measuredAt);
    }, 50);
    return () => window.clearInterval(timer);
  }, [payload?.game, payload?.serverTime]);

  const game = payload?.game;
  const clockNow = Math.max(now, rangeNow, payload?.serverTime ?? 0);
  const available = Boolean(payload) && !error;
  const active = Boolean(available && game?.status === "playing" && game.expiresAt > clockNow && game.targetEndsAt > clockNow);
  const targetOpen = Boolean(active && game?.target && clockNow >= game.targetStartsAt && clockNow < game.targetEndsAt);
  const restartCoolingDown = Boolean(game && clockNow < game.startedAt + 5_000);
  const fire = useCallback((target: RangerRangeTarget) => {
    if (!game || !active || !targetOpen || busy || cooldown) return;
    void mutate({ action: "fire", gameId: game.id, version: game.version, target });
  }, [active, busy, cooldown, game, mutate, targetOpen]);

  useEffect(() => {
    if (!game || game.status !== "playing") return;
    // The server withholds the next plate until its window begins. Refresh at that edge
    // while it is still hidden, then refresh again only after the visible window closes.
    const nextRefreshAt = game.target ? game.targetEndsAt + 45 : game.targetStartsAt + 45;
    const clock = serverClock.current;
    const serverNow = clock.time + performance.now() - clock.measuredAt;
    const timer = window.setTimeout(() => void load(), Math.max(45, nextRefreshAt - serverNow));
    return () => window.clearTimeout(timer);
  }, [game, load]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const source = event.target;
      if (source instanceof Element && source.closest("input, textarea, select, [contenteditable=true]")) return;
      const index = Number.parseInt(event.key, 10) - 1;
      const target = Number.isInteger(index) ? RANGER_RANGE_TARGETS[index] : null;
      if (!target || !targetOpen || busy || cooldown) return;
      event.preventDefault(); fire(target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, cooldown, fire, targetOpen]);

  return <section aria-labelledby="ranger-range-title" className={styles.rangerRangePanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>11 / RANGER DRILL</span><h2 id="ranger-range-title">DZN Ranger Range</h2></div><Crosshair size={24} /></div>
    {(error || notice) && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error || notice}</span>{error && <button className={styles.iconButton} title="Refresh Ranger Range" onClick={() => void load()}><RefreshCw size={17} /></button>}</div>}
    <div className={styles.rangerRangeTools}>
      <div><strong>{game ? `${game.shotsCleared} / ${game.totalShots} plates cleared` : "Eight moving range plates"}</strong><span>{game ? `${game.maxMisses - game.misses} misses remaining` : "Use the bow range to read and release onto the live target."}</span></div>
      <button className={styles.primary} disabled={busy || cooldown || !available || active || restartCoolingDown}
        title={restartCoolingDown && !active ? "New range run available five seconds after the last start" : undefined}
        onClick={() => void mutate({ action: "start" })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Range in progress" : game ? "New range" : "Start range"}</button>
    </div>
    {game ? <>
      <div className={styles.rangerRangeMeta}><span><Crosshair size={14} />{game.shotsCleared} / {game.totalShots}</span><span><Target size={14} />{game.misses} misses</span><span><Clock3 size={14} />{clock(game.expiresAt - clockNow)}</span></div>
      <div className={styles.rangerRangeStage} data-status={game.status} data-live={targetOpen}>
        <div className={styles.rangerRangeReadout} aria-live="polite"><span>{active ? targetOpen ? "TARGET / LIVE" : "BOW / NOCKED" : game.status === "won" ? "RANGE / CLEAR" : "RANGE / CLOSED"}</span><strong>{active ? targetOpen ? "Release on the lit plate" : "Hold while the next target crosses the range" : game.status === "won" ? "Perfect range clear" : game.status === "failed" ? "Range run lost" : "Target window expired"}</strong></div>
        <div className={styles.rangerRangeField} role="group" aria-label="Ranger Range targets">
          <div className={styles.rangerRangeBow} aria-hidden="true"><span /><i /><b /></div>
          {RANGER_RANGE_TARGETS.map(target => {
            const meta = RANGER_RANGE_TARGET_META[target];
            const live = targetOpen && game.target === target;
            return <button type="button" key={target} className={styles.rangerRangeTarget}
              data-target={target} data-live={live} disabled={!active || !targetOpen || busy || cooldown}
              aria-label={`${meta.detail} (${meta.key})${live ? ", live target" : ""}`} onClick={() => fire(target)}>
              <span className={styles.rangerRangeBullseye} aria-hidden="true"><i /><b /></span><strong>{meta.label}</strong><small>{live ? "Release arrow" : "Range marker"}</small><kbd>{meta.key}</kbd>
            </button>;
          })}
        </div>
        <p className={styles.rangerRangeHint}>Keyboard: 1 through 6. Each target, timing window, verified hit, miss, and daily reward is set by the DZN server.</p>
      </div>
      <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Range cleared</strong><span>{payload?.rewardGranted ? `Daily reward recorded: +${RANGER_RANGE_REWARD.xp} XP and +${RANGER_RANGE_REWARD.parts} parts.` : payload?.rewardedToday ? "Practice range complete. Today's reward was already recorded." : "Ranger Range complete."}</span></div></>
          : game.status === "failed" ? <><Target size={22} /><div><strong>Arrows spent</strong><span>Two missed plates ended the run. Existing Hub progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Range expired</strong><span>Start another range run when you are ready.</span></div></>
              : <><Radio size={20} /><div><strong>{targetOpen ? "Plate live" : "Bow nocked"}</strong><span>{targetOpen ? "Release on the highlighted plate before it clears the range." : "The DZN range is preparing the next server-verified target."}</span></div></>}
      </div>
    </> : !busy && !error && <div className={styles.rangerRangeReady}><Crosshair size={34} /><h3>Set the bow range.</h3><p>Track eight moving DZN range plates and release only when the live target appears. The server verifies every arrow before it can award progression.</p><div className={styles.rewardPills}><span>8 plates</span><span>+{RANGER_RANGE_REWARD.xp} XP</span><span>+{RANGER_RANGE_REWARD.parts} parts</span></div></div>}
  </section>;
}

function cipherGridKeyMark(payload: CipherGridPayload | null, letter: string) {
  let strongest: CipherGridMark | undefined;
  for (const attempt of payload?.game?.attempts ?? []) {
    for (let index = 0; index < attempt.guess.length; index++) {
      if (attempt.guess[index] !== letter) continue;
      const mark = attempt.marks[index];
      if (!strongest || CIPHER_GRID_MARK_PRIORITY[mark] > CIPHER_GRID_MARK_PRIORITY[strongest]) strongest = mark;
    }
  }
  return strongest;
}

function CipherGridPanel({ now, onProgress }: { now: number; onProgress: () => void }) {
  const [payload, setPayload] = useState<CipherGridPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [entry, setEntry] = useState("");
  const generation = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++generation.current;
    try {
      const response = await fetch("/api/games/cipher-grid", { credentials: "include", cache: "no-store" });
      const result = await response.json() as CipherGridPayload & { error?: string };
      if (!response.ok) throw new Error(result.error || "DZN Cipher Grid is unavailable.");
      if (sequence === generation.current) { setPayload(result); setError(""); }
    } catch (cause) { if (sequence === generation.current) setError(cause instanceof Error ? cause.message : "DZN Cipher Grid is unavailable."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, []);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    if (busy) return;
    const sequence = ++generation.current; setBusy(true); setError("");
    try {
      const response = await fetch("/api/games/cipher-grid", { method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as CipherGridPayload & { error?: string };
      if (!response.ok) { setError(result.error || "That field-word guess could not be recorded."); if (response.status === 409) void load(); return; }
      if (sequence !== generation.current) return;
      setEntry(""); setPayload(result); onProgress();
    } catch { if (sequence === generation.current) setError("That field-word guess could not be recorded. Refresh before retrying."); }
    finally { if (sequence === generation.current) setBusy(false); }
  }, [busy, load, onProgress]);

  const game = payload?.game;
  const clockNow = Math.max(now, payload?.serverTime ?? 0);
  const available = Boolean(payload) && !error;
  const active = Boolean(available && game?.status === "playing" && game.expiresAt > clockNow);
  const restartCoolingDown = Boolean(game && clockNow < game.startedAt + 5000);
  const normalize = (value: string) => setEntry(value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, CIPHER_GRID_WORD_LENGTH));
  const submit = useCallback(() => {
    if (!game || !active || busy || entry.length !== CIPHER_GRID_WORD_LENGTH) return;
    void mutate({ action: "guess", gameId: game.id, version: game.version, guess: entry });
  }, [active, busy, entry, game, mutate]);

  return <section aria-labelledby="cipher-grid-title" className={styles.cipherGridPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>06 / FIELD CRYPTOGRAPHY</span><h2 id="cipher-grid-title">DZN Cipher Grid</h2></div><KeyRound size={24} /></div>
    {error && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error}</span><button className={styles.iconButton} title="Refresh Cipher Grid" onClick={() => void load()}><RefreshCw size={17} /></button></div>}
    <div className={styles.cipherGridTools}>
      <div><strong>{game ? `${game.attempts.length} / ${game.maxAttempts} attempts` : "Six field-word attempts"}</strong><span>{game ? "Decode the five-letter DZN field word." : "The answer and reward are verified by the DZN server."}</span></div>
      <button className={styles.primary} disabled={busy || !available || active || restartCoolingDown}
        title={restartCoolingDown && !active ? "New decode available five seconds after the last start" : undefined}
        onClick={() => void mutate({ action: "start" })}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{active ? "Decode in progress" : game ? "New decode" : "Start decode"}</button>
    </div>
    {game ? <>
      <div className={styles.cipherGridMeta}><span><KeyRound size={14} />{game.attempts.length} / {game.maxAttempts}</span><span><Target size={14} />{game.answerLength} letters</span><span><Clock3 size={14} />{clock(game.expiresAt - clockNow)}</span></div>
      <form className={styles.cipherGridStage} aria-label="Cipher Grid field-word puzzle" onSubmit={event => { event.preventDefault(); submit(); }}>
        <div className={styles.cipherGridReadout} aria-live="polite"><span>{active ? "LIVE FIELD CIPHER" : game.status === "won" ? "CIPHER RESOLVED" : "CIPHER CLOSED"}</span><strong>{active ? "Build a five-letter field word" : game.status === "won" ? "Signal decoded" : game.status === "failed" ? "No attempts remain" : "Decode window expired"}</strong></div>
        <div className={styles.cipherGridBoard} role="grid" aria-label="Cipher Grid attempts">
          {Array.from({ length: CIPHER_GRID_MAX_ATTEMPTS }, (_, rowIndex) => {
            const attempt = game.attempts[rowIndex];
            const draft = active && rowIndex === game.attempts.length ? entry : "";
            return <div key={rowIndex} className={styles.cipherGridRow} role="row">{Array.from({ length: CIPHER_GRID_WORD_LENGTH }, (_, columnIndex) => {
              const letter = attempt?.guess[columnIndex] ?? draft[columnIndex] ?? "";
              const mark = attempt?.marks[columnIndex];
              return <span key={columnIndex} className={styles.cipherGridTile} role="gridcell" data-mark={mark} data-entry={Boolean(letter)} aria-label={`Attempt ${rowIndex + 1}, letter ${columnIndex + 1}${letter ? `: ${letter}` : ": blank"}`}>{letter}</span>;
            })}</div>;
          })}
        </div>
        <div className={styles.cipherGridEntry}>
          <label htmlFor="cipher-grid-entry">Field word</label>
          <input id="cipher-grid-entry" value={entry} disabled={busy || !active} onChange={event => normalize(event.target.value)}
            autoCapitalize="characters" autoComplete="off" autoCorrect="off" inputMode="text" maxLength={CIPHER_GRID_WORD_LENGTH} placeholder="TYPE 5 LETTERS" />
          <button type="submit" className={styles.primary} disabled={busy || !active || entry.length !== CIPHER_GRID_WORD_LENGTH}><KeyRound size={17} />Submit</button>
        </div>
        <div className={styles.cipherGridKeyboard} role="group" aria-label="Cipher Grid keyboard">
          {CIPHER_GRID_KEYS.map(row => <div key={row}>{Array.from(row).map(letter => <button type="button" key={letter} className={styles.cipherGridKey}
            data-mark={cipherGridKeyMark(payload, letter)} disabled={busy || !active || entry.length >= CIPHER_GRID_WORD_LENGTH} onClick={() => normalize(`${entry}${letter}`)}>{letter}</button>)}</div>)}
          <div><button type="button" className={`${styles.cipherGridKey} ${styles.cipherGridWideKey}`} disabled={busy || !active || !entry} onClick={() => setEntry(value => value.slice(0, -1))}><X size={16} /><span>Backspace</span></button></div>
        </div>
        <p className={styles.cipherGridHint}>Teal means the right letter in the right slot. Amber means the letter belongs elsewhere. The server keeps the answer private.</p>
      </form>
      <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Cipher resolved</strong><span>{payload?.rewardGranted ? `Daily reward recorded: +${CIPHER_GRID_REWARD.xp} XP and +${CIPHER_GRID_REWARD.parts} parts.` : payload?.rewardedToday ? "Practice decode complete. Today's reward was already recorded." : "Decode complete."}</span></div></>
          : game.status === "failed" ? <><Target size={22} /><div><strong>Signal lost</strong><span>Six guesses ended the decode. Existing Hub progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Decode expired</strong><span>Start a new field cipher when ready.</span></div></>
              : <><Radio size={20} /><div><strong>Decode in progress</strong><span>Use the marks to narrow the DZN field word before the window closes.</span></div></>}
      </div>
    </> : !busy && !error && <div className={styles.cipherGridReady}><KeyRound size={34} /><h3>Decode the field signal.</h3><p>Find a five-letter DZN field word in six attempts. Only the verified server can award progression.</p><div className={styles.rewardPills}><span>6 attempts</span><span>+{CIPHER_GRID_REWARD.xp} XP</span><span>+{CIPHER_GRID_REWARD.parts} parts</span></div></div>}
  </section>;
}

function OutpostBackground() {
  return <div className={styles.environment} aria-hidden="true" data-outpost="environment">
    <div className={styles.environmentFrame}>
      <div className={styles.environmentImage} data-outpost="scene" data-animated="true">
        {/* The image and effects share one 3:2 coordinate plane, including on phones. */}
        {[styles.windowLeft, styles.windowCentre, styles.windowRight].map(windowClass => <div key={windowClass} className={`${styles.weatherWindow} ${windowClass}`}>
          <span className={styles.rainFar} data-outpost="rain" data-animated="true" />
          <span className={styles.rainNear} data-animated="true" />
        </div>)}
        <span className={styles.radioLeft}><span className={styles.radioSweep} data-outpost="radio" data-animated="true" /></span>
        <span className={styles.radioRight}><span className={styles.radioSweep} data-animated="true" /></span>
        <span className={styles.beacon} data-outpost="beacon" data-animated="true" />
        <span className={styles.workLight} data-animated="true" />
      </div>
    </div>
  </div>;
}

function Insignia({ position, small = false }: { position: string; small?: boolean }) {
  return <span aria-hidden="true" className={`${styles.insignia} ${small ? styles.smallInsignia : ""}`} style={{ backgroundPosition: position }} />;
}

function MineBoard({ game, tool, disabled, onMove }: { game: GameView; tool: "reveal" | "flag"; disabled: boolean; onMove: (x: number, y: number, tool: "reveal" | "flag") => void }) {
  const [focus, setFocus] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const size = GAME_MODES[game.mode].size;
  function key(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target = index;
    if (event.key === "ArrowRight") target = Math.min(size * size - 1, index + 1);
    else if (event.key === "ArrowLeft") target = Math.max(0, index - 1);
    else if (event.key === "ArrowDown") target = Math.min(size * size - 1, index + size);
    else if (event.key === "ArrowUp") target = Math.max(0, index - size);
    else if (event.key.toLowerCase() === "f") { event.preventDefault(); if (!disabled) onMove(index % size, Math.floor(index / size), "flag"); return; }
    else return;
    event.preventDefault(); setFocus(target); grid.current?.querySelector<HTMLButtonElement>(`[data-index="${target}"]`)?.focus();
  }
  return <div className={styles.boardScroll} tabIndex={-1}><div className={styles.boardChassis} data-field-board="dzn" style={{ minWidth: size * 28, maxWidth: size * 44 }}>
    <div className={styles.boardPlate}><Image src="/media/dzn-logo.png" alt="DZN Network" width={610} height={445} /><div><strong>FIELD OPERATIONS</strong><span>{GAME_MODES[game.mode].label.toUpperCase()} / {size} x {size}</span></div><Target size={20} aria-hidden="true" /></div>
    <div className={styles.board} ref={grid} role="group" aria-label={`${GAME_MODES[game.mode].label} Minesweeper board`} aria-busy={disabled && game.status === "playing"}
    style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
    {game.cells.flatMap((line, y) => line.map((cell, x) => { const index = y * size + x; const label = cell === "hidden" ? "Unrevealed" : cell === "flag" ? "Flagged" : cell === "mine" ? "Mine" : `${cell} nearby mines`;
      return <button key={index} className={styles.cell} data-state={typeof cell === "number" ? "open" : cell} data-number={cell} data-index={index}
        aria-label={`Row ${y + 1}, column ${x + 1}: ${label}`} aria-disabled={disabled} tabIndex={Math.min(focus, size * size - 1) === index ? 0 : -1}
        onFocus={() => setFocus(index)} onKeyDown={event => key(event, index)} onClick={() => { if (!disabled) onMove(x, y, tool); }}
        onContextMenu={event => { event.preventDefault(); if (!disabled) onMove(x, y, "flag"); }}>
        {cell === "flag" ? <Flag size={15} /> : cell === "mine" ? <Target size={17} /> : typeof cell === "number" && cell > 0 ? cell : null}
      </button>;
    }))}
  </div><div className={styles.boardRail} aria-hidden="true"><span />DZN / MINEFIELD<span /></div></div></div>;
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={styles.dialog} onCancel={onClose}><div className={styles.sectionTitle}><h2>{title}</h2><button className={styles.iconButton} title="Close dialog" onClick={onClose}><X size={20} /></button></div>{children}</dialog>;
}
