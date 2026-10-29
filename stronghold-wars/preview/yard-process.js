// The yard's visible machinery illustrates production. Inventory remains owned by game-service.
export const YARD_CYCLE_SECONDS = Object.freeze([11, 9.5, 8, 7, 6]);

export function yardProcessState(level, elapsedSeconds, production) {
  const tier = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  const capacity = Math.max(0, Number(production?.capacity) || 0);
  const stored = Math.max(0, Number(production?.stored) || 0);
  const running = (Number(production?.perMinute) || 0) > 0 && capacity > 0 && stored < capacity;
  const cycleSeconds = YARD_CYCLE_SECONDS[tier - 1];
  const phase = ((Number(elapsedSeconds) || 0) / cycleSeconds % 1 + 1) % 1;
  const stage = !running ? 'stored' : phase < .39 ? 'feed' : phase < .53 ? 'cut' : phase < .88 ? 'sort' : 'reset';
  return {
    tier, running, cycleSeconds, phase, stage,
    fill: capacity ? Math.min(1, stored / capacity) : 0,
    logX: -2.65 + Math.min(1, phase / .39) * 1.95,
    plankX: -.45 + Math.max(0, Math.min(1, (phase - .53) / .35)) * 2.3,
    sawdust: running && stage === 'cut',
    light: running ? (stage === 'cut' ? 'cutting' : 'working') : 'stored',
  };
}
