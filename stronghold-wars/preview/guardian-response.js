// Guardian can intercept an approach without abandoning its assigned gate.
// This only chooses a replay destination; the locked war report owns the result.
export function guardianInterceptGoal(home, target, progress, reach = 8.5, leash = 2.8) {
  if (!target || progress < 0.26 || progress >= 0.84) return { ...home, intercepting: false };
  const dx = target.x - home.x, dz = target.z - home.z;
  const distance = Math.hypot(dx, dz);
  if (!distance || distance > reach) return { ...home, intercepting: false };
  const advance = Math.min(leash, Math.max(0, distance - 1.65));
  return { x: home.x + dx / distance * advance, z: home.z + dz / distance * advance,
    intercepting: advance > 0.1 };
}

export function guardianAction({ warActive = false, moving = false, sprinting = false,
  blockUntil = 0, time = 0, threat = 0 } = {}) {
  if (warActive && time < blockUntil) return 'block';
  if (moving) return warActive && sprinting ? 'run' : 'walk';
  return !warActive && threat > .35 ? 'block' : 'idle';
}
