// Aegis' replay drones make a short, bounded intercept and return to their operator.
// The locked battle report decides whether a volley was stopped; this only stages it.
export function aegisInterceptWeight(elapsed) {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 1.12) return 0;
  const smooth = value => value * value * (3 - 2 * value);
  if (elapsed < .26) return smooth(elapsed / .26);
  if (elapsed < .52) return 1;
  return smooth((1.12 - elapsed) / .6);
}

export function aegisInterceptPoint(origin, target, reach = 4.5) {
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const distance = Math.hypot(dx, dz);
  const distanceToFly = Math.min(Math.max(0, reach), Math.max(0, distance - .9));
  if (!distance || !distanceToFly) return { ...origin };
  return { x: origin.x + dx / distance * distanceToFly,
    y: Math.max(1.15, Math.min(2.2, target.y ?? origin.y)),
    z: origin.z + dz / distance * distanceToFly };
}
