const EMBERS = Array.from({ length: 7 }, (_, index) => index + 1);

export function KillProjectileAccent({
  tone,
  variant = "projectile",
}: {
  tone: "violet" | "cyan" | "orange";
  variant?: "rifle" | "projectile";
}) {
  const casingId = `dznKillCasing-${tone}`;
  const tipId = `dznKillTip-${tone}`;

  return (
    <span className={`leaderboard-reference-weapon-accent leaderboard-reference-weapon-accent--${variant} dzn-kill-projectile dzn-kill-projectile--${tone}`} aria-hidden="true">
      <span className="leaderboard-reference-tracer dzn-kill-tracer dzn-kill-tracer--outer" />
      <span className="leaderboard-reference-tracer dzn-kill-tracer dzn-kill-tracer--inner" />
      {EMBERS.map((item) => (
        <span key={item} className={`dzn-kill-ember dzn-kill-ember--${item}`} />
      ))}
      {variant === "rifle" ? (
        <svg className="leaderboard-reference-rifle-svg" viewBox="0 0 360 130" focusable="false">
          <defs>
            <linearGradient id={`dznRifleMetal-${tone}`} x1="32" x2="330" y1="0" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#172033" />
              <stop offset="0.22" stopColor="#7e93ad" />
              <stop offset="0.5" stopColor="#e5edf8" />
              <stop offset="0.76" stopColor="#344458" />
              <stop offset="1" stopColor="#050816" />
            </linearGradient>
            <linearGradient id={`dznRifleWood-${tone}`} x1="84" x2="206" y1="65" y2="112" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#462013" />
              <stop offset="0.48" stopColor="#9a4a21" />
              <stop offset="1" stopColor="#220d08" />
            </linearGradient>
          </defs>
          <g className="leaderboard-reference-rifle" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 71h302" stroke={`url(#dznRifleMetal-${tone})`} strokeWidth="10" />
            <path d="M95 62h112l30 14H83Z" fill={`url(#dznRifleMetal-${tone})`} stroke="#020617" strokeWidth="3" />
            <path d="M222 59h70" stroke={`url(#dznRifleMetal-${tone})`} strokeWidth="7" />
            <path d="M292 58h40" stroke="#0f172a" strokeWidth="4" />
            <path d="M103 78c-18 22-36 33-58 35l30-35Z" fill={`url(#dznRifleWood-${tone})`} stroke="#160905" strokeWidth="3" />
            <path d="M142 76l18 51h32l-21-51Z" fill="#0b1220" stroke="#020617" strokeWidth="3" />
            <path d="M152 83c8 12 20 13 31 2" stroke="#64748b" strokeWidth="3" />
            <path d="M228 49c0-20 16-34 36-34s36 14 36 34-16 34-36 34-36-14-36-34Z" fill="rgba(8,13,31,0.55)" stroke={`url(#dznRifleMetal-${tone})`} strokeWidth="5" />
            <path d="M241 49h48M264 26v45" stroke="#b7c8de" strokeWidth="3" opacity="0.75" />
            <path d="M36 67h-22M330 70h38" stroke="#e5edf8" strokeWidth="4" />
            <path d="M323 68l42 2-42 5" fill="#f8fafc" opacity="0.78" />
          </g>
        </svg>
      ) : (
        <svg className="dzn-kill-projectile-svg" viewBox="0 0 230 64" focusable="false">
          <defs>
            <linearGradient id={casingId} x1="20" x2="144" y1="0" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#4b1f0d" />
              <stop offset="0.17" stopColor="#b76524" />
              <stop offset="0.38" stopColor="#ffd58a" />
              <stop offset="0.63" stopColor="#c56a22" />
              <stop offset="1" stopColor="#2a1209" />
            </linearGradient>
            <linearGradient id={tipId} x1="128" x2="196" y1="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#7c2d12" />
              <stop offset="0.35" stopColor="#f59e0b" />
              <stop offset="0.62" stopColor="#fff4c7" />
              <stop offset="1" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          <g className="dzn-kill-projectile-round">
            <path d="M29 18h120c14 0 26 5 35 14-9 9-21 14-35 14H29c-12 0-21-8-21-16s9-12 21-12Z" fill={`url(#${casingId})`} />
            <path d="M135 18c29 2 58 9 88 14-30 5-59 12-88 14 11-13 11-33 0-46Z" fill={`url(#${tipId})`} />
            <path d="M25 23h127c14 0 32 4 49 11-42-4-91-4-174-4-7 0-14 1-19 3 2-7 9-10 17-10Z" fill="rgba(255,255,255,0.38)" />
            <path d="M28 38h126c17 0 34-5 50-12-25 16-54 20-86 20H31c-10 0-18-4-22-10 6 2 13 2 19 2Z" fill="rgba(0,0,0,0.34)" />
            <ellipse cx="28" cy="32" rx="11" ry="16" fill="#2a1209" opacity="0.78" />
            <ellipse cx="33" cy="32" rx="5.5" ry="10" fill="#c27931" opacity="0.9" />
            <path d="M58 20c-7 9-7 23 0 32M76 20c-6 9-6 23 0 32M96 20c-6 9-6 23 0 32" fill="none" stroke="#2f140c" strokeLinecap="round" strokeWidth="4.5" opacity="0.72" />
            <path d="M66 20c-3 10-3 22 0 32M86 20c-3 10-3 22 0 32" fill="none" stroke="#ffe0a3" strokeLinecap="round" strokeWidth="1.6" opacity="0.6" />
            <path d="M174 28l22 4-22 4c4-3 4-5 0-8Z" fill="#fff7c2" />
          </g>
        </svg>
      )}
    </span>
  );
}
