const ASSETS = {
  sniper: "/leaderboards/sniper-accent.png",
  rifle: "/leaderboards/rifle-accent.png",
  projectile: "/leaderboards/bullet-tracer-accent.png",
};

const BULLET_EMBERS = Array.from({ length: 9 }, (_, index) => index + 1);

export function KillProjectileAccent({
  tone,
  variant = "projectile",
}: {
  tone: "violet" | "cyan" | "orange";
  variant?: "sniper" | "rifle" | "projectile";
}) {
  if (variant === "projectile") {
    return (
      <span
        className={`leaderboard-ref-kill-art leaderboard-ref-kill-art--projectile leaderboard-ref-bullet-scene leaderboard-reference-weapon-accent leaderboard-reference-weapon-accent--projectile dzn-kill-projectile dzn-kill-projectile--${tone}`}
        aria-hidden="true"
      >
        <span className="leaderboard-ref-bullet-glow" />
        <span className="leaderboard-ref-bullet-trail leaderboard-ref-bullet-trail--wide" />
        <span className="leaderboard-ref-bullet-trail leaderboard-ref-bullet-trail--hot" />
        <span className="leaderboard-ref-bullet-shockwave leaderboard-ref-bullet-shockwave--one" />
        <span className="leaderboard-ref-bullet-shockwave leaderboard-ref-bullet-shockwave--two" />
        {BULLET_EMBERS.map((ember) => (
          <span key={ember} className={`leaderboard-ref-bullet-ember leaderboard-ref-bullet-ember--${ember}`} />
        ))}
        <span className="leaderboard-ref-bullet-flight">
          <span className="leaderboard-ref-bullet-img" />
        </span>
      </span>
    );
  }

  return (
    <span
      className={`leaderboard-ref-kill-art leaderboard-ref-kill-art--${variant} leaderboard-reference-weapon-accent leaderboard-reference-weapon-accent--${variant} dzn-kill-projectile dzn-kill-projectile--${tone}`}
      style={{ backgroundImage: `url(${ASSETS[variant]})` }}
      aria-hidden="true"
    />
  );
}
