"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Award, BookOpen, Check, CircleHelp, Clock3, Flag, Flame, Gamepad2, Hammer, LoaderCircle,
  LogIn, Microchip, MousePointer2, Play, Radio, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Target, X, Zap } from "lucide-react";
import { SiteHeaderAuthState, SiteHomeLink } from "@/components/site-header";
import { GAME_MODES, HUB_BADGES, WORKSHOP_PART_COST, WORKSHOP_STAGES, type GameMode, type GameView, type HubPayload } from "@/lib/games-hub";
import { TRIVIA_DIFFICULTIES, type TriviaDifficulty, type TriviaPayload } from "@/lib/games-trivia";
import { WORD_CHAIN_REWARD, type WordChainPayload } from "@/lib/games-word-chain";
import { HIDE_SEEK_REWARD, type HideSeekPayload } from "@/lib/games-hide-seek";
import styles from "./games-hub.module.css";

type View = "play" | "workshop" | "insignia" | "activity";
type BoardView = "field" | "grid";
type PlayGame = "minefield" | "trivia" | "word-chain" | "hide-seek";
const Minefield3D = dynamic(() => import("./minefield-3d").then(module => module.Minefield3D), { ssr: false });
const views = [{ id: "play", label: "Play", icon: Gamepad2 }, { id: "workshop", label: "Workshop", icon: Hammer },
  { id: "insignia", label: "Insignia", icon: Award }, { id: "activity", label: "Activity", icon: Clock3 }] as const;
const modes = Object.keys(GAME_MODES) as GameMode[];
function clock(value: number) { const seconds = Math.max(0, Math.floor(value / 1000)); return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; }

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
      if (!lock.current && document.visibilityState === "visible" && clock.time + performance.now() - clock.measuredAt >= payload.summary.resetAt) void refresh();
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
  const active = game?.status === "playing" && (!now || now < game.expiresAt);
  const newBoardCoolingDown = Boolean(game && (now || game.startedAt) < game.startedAt + 5000);
  const xp = summary?.xp ?? 0;
  const rankIndex = Math.max(0, HUB_BADGES.findLastIndex(badge => xp >= badge.xp));
  const rank = HUB_BADGES[rankIndex];
  const nextRank = HUB_BADGES.find(badge => badge.xp > xp);
  const progress = nextRank ? Math.min(100, xp / nextRank.xp * 100) : 100;

  function start() {
    setReplace(false); setTool("reveal");
    void mutate({ action: "start", mode });
  }

  const motionRunning = motionReady && pageVisible && !motionPaused && !reducedMotion;

  return <main className={styles.hub} data-motion={motionRunning ? "running" : "paused"}>
    <OutpostBackground />
    <div className={styles.hubContent}>
    <SiteHeaderAuthState authenticated={phase === "ready"} checkingAccount={phase === "loading"} returnTo="/games" />
    <nav className={styles.hubNav} aria-label="DZN Network"><SiteHomeLink className={styles.homeButton} /><div className={styles.navActions}><Link href="/player" prefetch={false}>Player Hub<ArrowRight size={16} /></Link></div></nav>
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>DZN / PLAYER ARCADE</span><h1>DZN Games Hub<span className={styles.dot}>.</span></h1></div>
      {summary && <div className={styles.identity}>{xp >= HUB_BADGES[0].xp ? <Insignia position={rank.position} small /> : <span className={styles.recruit}><Gamepad2 size={24} /></span>}<div><strong>{summary.username}</strong><span>{xp >= HUB_BADGES[0].xp ? rank.name : "New recruit"}</span></div><span className={styles.level}>LV {1 + Math.floor(xp / 150)}</span></div>}
    </div>
    <div className={styles.topline}>
      <nav aria-label="Games Hub" className={styles.tabs}>{views.map(item => <a href={`#${item.id}`} key={item.id} aria-current={view === item.id ? "page" : undefined}
        onClick={() => setView(item.id)}><item.icon size={17} /><span>{item.label}</span></a>)}</nav>
      {summary && <div className={styles.balances}><span title="Website XP"><Zap size={15} />{xp.toLocaleString()} <small>XP</small></span><span title="Earned workshop parts"><Microchip size={15} />{summary.parts} <small>PARTS</small></span></div>}
    </div>

    {phase !== "ready" ? <section className={styles.gate} aria-busy={phase === "loading"}>
      <div className={styles.gateArt}><Insignia position="100% 100%" /></div>
      <div><span className={styles.eyebrow}>MINESWEEPER / FIELD OPERATIONS</span><h2>{phase === "loading" ? "Opening your Games Hub" : phase === "login" ? "Your next mission starts here" : "Games Hub unavailable"}</h2>
        {phase === "loading" ? <LoaderCircle className={styles.spinner} /> : <p>{error}</p>}
        {phase === "login" ? <Link className={styles.primary} href="/login?returnTo=%2Fgames" prefetch={false}><LogIn size={18} />Sign in with Discord</Link> : phase === "unavailable" && <button className={styles.primary} onClick={() => void refresh()}><RefreshCw size={18} />Retry</button>}
      </div>
    </section> : <>
      {error && <div className={styles.error} role="alert"><span>{error}</span><button title="Refresh saved progress" disabled={busy} onClick={() => void refresh()}><RefreshCw size={18} /></button></div>}
      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          {view === "play" && <div className={styles.gamePicker} role="group" aria-label="Choose a game">
            <button aria-pressed={playGame === "minefield"} onClick={() => setPlayGame("minefield")}><Target size={17} /><span><strong>Minefield</strong><small>3D tactical sweep</small></span></button>
            <button aria-pressed={playGame === "trivia"} onClick={() => setPlayGame("trivia")}><BookOpen size={17} /><span><strong>DZN Trivia</strong><small>Survival knowledge</small></span></button>
            <button aria-pressed={playGame === "word-chain"} onClick={() => setPlayGame("word-chain")}><Radio size={17} /><span><strong>Word Chain</strong><small>Shared daily relay</small></span></button>
            <button aria-pressed={playGame === "hide-seek"} onClick={() => setPlayGame("hide-seek")}><Search size={17} /><span><strong>Signal Hunt</strong><small>Find concealed beacons</small></span></button>
          </div>}
          {view === "play" && playGame === "minefield" && <section aria-labelledby="mines-title">
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
          {view === "play" && playGame === "trivia" && <TriviaPanel now={now} onProgress={() => void refresh()} />}
          {view === "play" && playGame === "word-chain" && <WordChainPanel onProgress={() => void refresh()} />}
          {view === "play" && playGame === "hide-seek" && <HideSeekPanel now={now} onProgress={() => void refresh()} />}

          {view === "workshop" && <section>
            <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>COLLECTION / PROJECT {(Math.floor((summary?.assemblies ?? 0) / 3) + 1).toString().padStart(2, "0")}</span><h2>Field relay workshop</h2></div><Hammer size={24} /></div>
            <div className={styles.workshopImage} role="img" aria-label="DZN field radio relay collectible" />
            <div className={styles.projectLine}><div><h3>Restore the signal</h3><p>Prestige {Math.floor((summary?.assemblies ?? 0) / 3)} / {(summary?.assemblies ?? 0) % 3} of 3 assemblies</p></div><span className={styles.materialCount}><Microchip />{summary?.parts} <small>parts</small></span></div>
            <ol className={styles.stages}>{WORKSHOP_STAGES.map((name, index) => <li key={name} data-complete={index < (summary?.assemblies ?? 0) % 3}><span>{index < (summary?.assemblies ?? 0) % 3 ? <Check size={16} /> : `0${index + 1}`}</span><strong>{name}</strong><small>{WORKSHOP_PART_COST} parts</small></li>)}</ol>
            <button className={styles.primary} disabled={busy || (summary?.parts ?? 0) < WORKSHOP_PART_COST} onClick={() => { assemblyKey.current ??= crypto.randomUUID(); void mutate({ action: "assemble", requestId: assemblyKey.current }); }}><Hammer size={18} />Assemble {WORKSHOP_STAGES[(summary?.assemblies ?? 0) % 3]}<span>{WORKSHOP_PART_COST} parts</span></button>
          </section>}

          {view === "insignia" && <section><div className={styles.sectionTitle}><div><span className={styles.eyebrow}>COLLECTION / EARNED RECOGNITION</span><h2>Field insignia</h2></div><span>{HUB_BADGES.filter(badge => xp >= badge.xp).length} / 6</span></div>
            <div className={styles.badges}>{HUB_BADGES.map(badge => <article key={badge.name} className={xp >= badge.xp ? styles.earnedBadge : styles.lockedBadge}><Insignia position={badge.position} /><h3>{badge.name}</h3><span>{badge.xp.toLocaleString()} XP</span><div className={styles.badgeState}>{xp >= badge.xp ? <><Check size={15} />Earned</> : <><Target size={15} />{(badge.xp - xp).toLocaleString()} XP remaining</>}</div></article>)}</div>
          </section>}

          {view === "activity" && <section><div className={styles.sectionTitle}><div><span className={styles.eyebrow}>YOUR / REWARD HISTORY</span><h2>Recent activity</h2></div><Clock3 size={24} /></div>
            {summary?.history.length ? <ul className={styles.history}>{summary.history.map((entry, index) => { const triviaDifficulty = entry.kind.startsWith("trivia:") ? entry.kind.slice(7) as TriviaDifficulty : null; const wordChain = entry.kind === "word-chain"; const hideSeek = entry.kind === "hide-seek"; return <li key={`${entry.created_at}:${index}`}><span className={styles.historyIcon}>{entry.kind === "workshop" ? <Hammer size={20} /> : triviaDifficulty ? <BookOpen size={20} /> : wordChain ? <Radio size={20} /> : hideSeek ? <Search size={20} /> : <ShieldCheck size={20} />}</span><div><strong>{entry.kind === "workshop" ? "Workshop assembly" : triviaDifficulty ? `${TRIVIA_DIFFICULTIES[triviaDifficulty].label} trivia passed` : wordChain ? "Word Chain relay" : hideSeek ? "Signal Hunt cleared" : `${GAME_MODES[entry.kind as GameMode].label} secured`}</strong><time dateTime={new Date(entry.created_at).toISOString()}>{new Date(entry.created_at).toLocaleString("en-GB")}</time></div><span>{entry.xp ? `+${entry.xp} XP` : ""}<small>{entry.parts > 0 ? "+" : ""}{entry.parts} parts</small></span></li>; })}</ul> : <div className={styles.empty}><Clock3 size={30} /><h3>No rewards recorded yet</h3></div>}
          </section>}
        </div>

        <aside className={styles.sidebar}>
          <section className={styles.missions}><div className={styles.asideHeading}><span className={styles.eyebrow}>DAILY MISSIONS</span><span>{summary?.today.length} / 3</span></div><h3>Clear. Collect. Construct.</h3>
            <div className={styles.reset}><Clock3 size={13} /><span>Resets {new Date(summary!.resetAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span><span><Flame size={14} />{summary?.streak} day streak</span></div>
            <ul>{modes.map(key => { const done = summary?.today.includes(key); return <li key={key} data-complete={done}><span className={styles.missionCheck}>{done ? <Check size={17} /> : <Target size={17} />}</span><div><strong>{GAME_MODES[key].label} sweep</strong><span>{GAME_MODES[key].xp} XP + {GAME_MODES[key].parts} parts</span></div><span>{done ? "Done" : "0 / 1"}</span></li>; })}</ul>
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
  const active = game?.status === "playing" && game.expiresAt > now;
  const restartCoolingDown = Boolean(game && now < game.startedAt + 5000);
  function scan(x: number, y: number) { if (game && active && !busy) void mutate({ action: "scan", gameId: game.id, version: game.version, x, y }); }
  return <section aria-labelledby="hide-seek-title" className={styles.hideSeekPanel}>
    <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>04 / RECONNAISSANCE</span><h2 id="hide-seek-title">DZN Signal Hunt</h2></div><Search size={24} /></div>
    {error && <div className={styles.wordChainNotice} role="status"><ShieldCheck size={20} /><span>{error}</span><button className={styles.iconButton} title="Refresh Signal Hunt" onClick={() => void load()}><RefreshCw size={17} /></button></div>}
    <div className={styles.hideSeekTools}>
      <div><strong>{game ? `${game.foundCount} / ${game.targets.length} signals` : "Four concealed signals"}</strong><span>{game ? `${game.maxMisses - game.misses} scan errors remaining` : "Five minutes. Six scan errors."}</span></div>
      <button className={styles.primary} disabled={busy || Boolean(active) || restartCoolingDown}
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
        {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>All signals recovered</strong><span>{payload.rewardedToday ? `Daily reward recorded: +${HIDE_SEEK_REWARD.xp} XP and +${HIDE_SEEK_REWARD.parts} parts.` : "Hunt complete."}</span></div></>
          : game.status === "failed" ? <><Target size={22} /><div><strong>Search window closed</strong><span>Too many empty scans. Your existing progress is unchanged.</span></div></>
            : !active ? <><Clock3 size={22} /><div><strong>Hunt expired</strong><span>Start a new reconnaissance run when ready.</span></div></>
              : <><Radio size={20} /><div><strong>Signals concealed</strong><span>Inspect the scene closely. Every find is checked by DZN.</span></div></>}
      </div>
    </> : <div className={styles.triviaReady}><Search size={34} /><h3>Search the outpost.</h3><p>Find four concealed DZN signals. Mouse, touch and keyboard targets are supported.</p><div className={styles.rewardPills}><span>+{HIDE_SEEK_REWARD.xp} XP</span><span>+{HIDE_SEEK_REWARD.parts} parts</span></div></div>}
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
