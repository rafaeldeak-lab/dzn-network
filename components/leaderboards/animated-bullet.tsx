const ASSETS = {
  sniper: "/leaderboards/sniper-accent.svg",
  rifle: "/leaderboards/rifle-accent.svg",
  projectile: "/leaderboards/bullet-tracer-accent.svg",
};

export function KillProjectileAccent({
  tone,
  variant = "projectile",
}: {
  tone: "violet" | "cyan" | "orange";
  variant?: "sniper" | "rifle" | "projectile";
}) {
  return (
    <span
      className={`leaderboard-ref-kill-art leaderboard-ref-kill-art--${variant} leaderboard-reference-weapon-accent leaderboard-reference-weapon-accent--${variant} dzn-kill-projectile dzn-kill-projectile--${tone}`}
      style={{ backgroundImage: `url(${ASSETS[variant]})` }}
      aria-hidden="true"
    />
  );
}
