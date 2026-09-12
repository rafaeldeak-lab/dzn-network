"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Award, Check, CircleHelp, Clock3, Flag, Flame, Gamepad2, Hammer, LoaderCircle,
  LogIn, Microchip, MousePointer2, Play, Radio, RefreshCw, ShieldCheck, Sparkles, Target, X, Zap } from "lucide-react";
import { SiteHeaderAuthState } from "@/components/site-header";
import { GAME_MODES, HUB_BADGES, WORKSHOP_PART_COST, WORKSHOP_STAGES, type GameMode, type GameView, type HubPayload } from "@/lib/games-hub";
import styles from "./games-hub.module.css";

type View = "play" | "workshop" | "insignia" | "activity";
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
  const [help, setHelp] = useState(false);
  const [replace, setReplace] = useState(false);
  const [now, setNow] = useState(0);
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
    const initial = window.setTimeout(() => { syncHash(); void refresh(controller.signal); }, 0);
    window.addEventListener("hashchange", syncHash);
    return () => { controller.abort(); clearTimeout(initial); clearInterval(timer); window.removeEventListener("hashchange", syncHash); };
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

  return <main className={styles.hub}>
    <SiteHeaderAuthState authenticated={phase === "ready"} checkingAccount={phase === "loading"} returnTo="/games" />
    <nav className={styles.hubNav} aria-label="DZN Network"><Link href="/" prefetch={false}><ArrowLeft size={16} /><strong>DZN NETWORK</strong></Link><Link href="/player" prefetch={false}>Player Hub<ArrowRight size={16} /></Link></nav>
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
          {view === "play" && <section aria-labelledby="mines-title">
            <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>01 / FIELD OPERATIONS</span><h2 id="mines-title">Minesweeper</h2></div><button className={styles.iconButton} title="Game rules" onClick={() => setHelp(true)}><CircleHelp size={20} /></button></div>
            <div className={styles.gameTools}>
              <label>Difficulty<select aria-label="Difficulty" value={mode} disabled={busy} onChange={event => setMode(event.target.value as GameMode)}>{modes.map(key => <option value={key} key={key}>{GAME_MODES[key].label} / {GAME_MODES[key].size} x {GAME_MODES[key].size}</option>)}</select></label>
              <div className={styles.toolSwitch} aria-label="Cell action"><button title="Reveal cell" aria-pressed={tool === "reveal"} disabled={busy} onClick={() => setTool("reveal")}><MousePointer2 size={18} /></button><button title="Place or remove flag" aria-pressed={tool === "flag"} disabled={busy} onClick={() => setTool("flag")}><Flag size={18} /></button></div>
              <button className={styles.primary} disabled={busy || newBoardCoolingDown} title={newBoardCoolingDown ? "New board available five seconds after the last start" : undefined} onClick={() => active ? setReplace(true) : start()}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Play size={17} />}{game ? "New board" : "Start mission"}</button>
            </div>
            {game ? <>
              <div className={styles.boardStatus}><span><Target size={15} />{GAME_MODES[game.mode].label}</span><span><Flag size={15} />{game.cells.flat().filter(cell => cell === "flag").length} / {GAME_MODES[game.mode].mines}</span><span><Clock3 size={15} />{clock(game.expiresAt - (now || game.startedAt))}</span></div>
              <MineBoard game={game} tool={tool} disabled={busy || !active} onMove={(x, y, selectedTool) => void mutate({ action: "move", gameId: game.id, version: game.version, x, y, tool: selectedTool })} />
              <div className={`${styles.result} ${game.status === "won" ? styles.won : ""}`} role="status">
                {game.status === "won" ? <><ShieldCheck size={22} /><div><strong>Sector secured</strong><span>{summary?.today.includes(game.mode) ? `${GAME_MODES[game.mode].label} reward recorded for today. Further wins today are practice.` : "Daily rewards have reset. Start a new mission for today's reward."}</span></div></> : game.status === "lost" ? <><Target size={22} /><div><strong>Mine triggered</strong><span>Mission ended. Your earned XP and parts are unchanged.</span></div></> : !active ? <><Clock3 size={22} /><div><strong>Mission expired</strong><span>Start a new board when you are ready.</span></div></> : <><Radio size={20} /><div><strong>Mission in progress</strong><span>{tool === "flag" ? "Flag mode" : "Reveal mode"} / {game.cells.flat().filter(cell => typeof cell === "number").length} safe cells cleared</span></div></>}
              </div>
            </> : <div className={styles.readyBoard}><Target size={42} /><h3>Recon standing by</h3><div className={styles.rewardPills}><span>{GAME_MODES[mode].mines} mines</span><span>+{GAME_MODES[mode].xp} XP</span><span>+{GAME_MODES[mode].parts} parts</span></div></div>}
          </section>}

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
            {summary?.history.length ? <ul className={styles.history}>{summary.history.map((entry, index) => <li key={`${entry.created_at}:${index}`}><span className={styles.historyIcon}>{entry.kind === "workshop" ? <Hammer size={20} /> : <ShieldCheck size={20} />}</span><div><strong>{entry.kind === "workshop" ? "Workshop assembly" : `${GAME_MODES[entry.kind as GameMode].label} secured`}</strong><time dateTime={new Date(entry.created_at).toISOString()}>{new Date(entry.created_at).toLocaleString("en-GB")}</time></div><span>{entry.xp ? `+${entry.xp} XP` : ""}<small>{entry.parts > 0 ? "+" : ""}{entry.parts} parts</small></span></li>)}</ul> : <div className={styles.empty}><Clock3 size={30} /><h3>No rewards recorded yet</h3></div>}
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

    {help && <Dialog title="Minesweeper rules" onClose={() => setHelp(false)}><p>Reveal every safe cell without triggering a mine. Numbers count mines in the eight neighbouring cells. Flags mark suspected mines. The first revealed cell is safe.</p><p>Each difficulty awards XP and parts once per UTC day. Boards expire after 30 minutes. Further wins are practice; rewards cannot be bought, transferred or exchanged for money.</p><p>Arrow keys move between cells. Enter reveals or flags with the selected tool; F toggles a flag.</p><button className={styles.primary} onClick={() => setHelp(false)}>Back to mission</button></Dialog>}
    {replace && <Dialog title="Start a new board?" onClose={() => setReplace(false)}><p>The current unfinished board will be replaced. Earned XP and parts are kept.</p><div className={styles.dialogActions}><button onClick={() => setReplace(false)}>Keep playing</button><button className={styles.primary} onClick={start}><RefreshCw size={17} />New board</button></div></Dialog>}
  </main>;
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
  return <div className={styles.boardScroll} tabIndex={-1}><div className={styles.board} ref={grid} role="group" aria-label={`${GAME_MODES[game.mode].label} Minesweeper board`} aria-busy={disabled && game.status === "playing"}
    style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, minWidth: size * 28, maxWidth: size * 44 }}>
    {game.cells.flatMap((line, y) => line.map((cell, x) => { const index = y * size + x; const label = cell === "hidden" ? "Unrevealed" : cell === "flag" ? "Flagged" : cell === "mine" ? "Mine" : `${cell} nearby mines`;
      return <button key={index} className={styles.cell} data-state={typeof cell === "number" ? "open" : cell} data-number={cell} data-index={index}
        aria-label={`Row ${y + 1}, column ${x + 1}: ${label}`} aria-disabled={disabled} tabIndex={Math.min(focus, size * size - 1) === index ? 0 : -1}
        onFocus={() => setFocus(index)} onKeyDown={event => key(event, index)} onClick={() => { if (!disabled) onMove(x, y, tool); }}
        onContextMenu={event => { event.preventDefault(); if (!disabled) onMove(x, y, "flag"); }}>
        {cell === "flag" ? <Flag size={15} /> : cell === "mine" ? <Target size={17} /> : typeof cell === "number" && cell > 0 ? cell : null}
      </button>;
    }))}
  </div></div>;
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={styles.dialog} onCancel={onClose}><div className={styles.sectionTitle}><h2>{title}</h2><button className={styles.iconButton} title="Close dialog" onClick={onClose}><X size={20} /></button></div>{children}</dialog>;
}
