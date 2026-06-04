const ASSETS = {
  sniper: "/leaderboards/sniper-accent.png",
  rifle: "/leaderboards/rifle-accent.png",
};

export function AnimatedBullet() {
  return (
    <div className="leaderboard-ref-bullet-effects" aria-hidden="true">
      <span className="leaderboard-ref-bullet-glow" />
      <span className="leaderboard-ref-bullet-heat" />
      <span className="leaderboard-ref-bullet-spark spark-one" />
      <span className="leaderboard-ref-bullet-spark spark-two" />
      <span className="leaderboard-ref-bullet-spark spark-three" />
      <span className="leaderboard-ref-bullet-spark spark-four" />
      <span className="leaderboard-ref-bullet-wave wave-one" />
      <span className="leaderboard-ref-bullet-wave wave-two" />
    </div>
  );
}

export function KillProjectileAccent({
  tone,
  variant = "projectile",
}: {
  tone: "violet" | "cyan" | "orange";
  variant?: "sniper" | "rifle" | "projectile";
}) {
  if (variant === "projectile") {
    return <AnimatedBullet />;
  }

  return (
    <span
      className={`leaderboard-ref-kill-art leaderboard-ref-kill-art--${variant} leaderboard-reference-weapon-accent leaderboard-reference-weapon-accent--${variant} dzn-kill-projectile dzn-kill-projectile--${tone}`}
      style={{ backgroundImage: `url(${ASSETS[variant]})` }}
      aria-hidden="true"
    />
  );
}
