// These poses only drive scenery. The local game service owns resources and jobs.
export function facilityMotion(level, phase, running, reducedMotion = false) {
  const tier = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  const progress = ((Number(phase) || 0) % 1 + 1) % 1;
  const moving = Boolean(running && !reducedMotion);
  const strike = moving ? Math.max(0, Math.sin(progress * Math.PI * 2)) : 0;
  return {
    tier,
    moving,
    cycleSeconds: 3.2 - tier * 0.38,
    pressHeight: 1.47 - strike * 0.63,
    feedX: moving ? -0.7 + progress * 1.4 : -0.7,
    glow: running ? 0.72 + strike * 0.6 : 0.16,
    sparks: moving && progress > 0.38 && progress < 0.66,
    dishCount: tier >= 4 ? 2 : 1,
    depotCrateCount: Math.min(3, Math.ceil(tier / 2)),
  };
}
