const EMBERS = Array.from({ length: 14 }, (_, index) => index + 1);
const TRACERS = [1, 2, 3];

export function AnimatedBullet() {
  return (
    <div className="dzn-bullet-wrap" aria-hidden="true">
      <div className="dzn-bullet-stage">
        <div className="dzn-bullet-smoke" />
        <div className="dzn-bullet-heat" />
        <div className="dzn-bullet-tracer-wrap">
          {TRACERS.map((item) => (
            <span key={item} className={`dzn-bullet-tracer dzn-bullet-tracer--${item}`} />
          ))}
        </div>
        <div className="dzn-bullet-glow" />
        {EMBERS.map((item) => (
          <span key={item} className={`dzn-ember dzn-ember--${item}`} />
        ))}
        <svg className="dzn-bullet-svg" viewBox="0 0 620 180" role="img" focusable="false">
          <defs>
            <linearGradient id="dznBulletCasing" x1="56" x2="438" y1="0" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#5f2d12" />
              <stop offset="0.13" stopColor="#b86b24" />
              <stop offset="0.28" stopColor="#ffd17a" />
              <stop offset="0.48" stopColor="#c87525" />
              <stop offset="0.7" stopColor="#7a3415" />
              <stop offset="1" stopColor="#2f140c" />
            </linearGradient>
            <linearGradient id="dznBulletNose" x1="356" x2="580" y1="90" y2="90" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#7b3417" />
              <stop offset="0.24" stopColor="#f59e35" />
              <stop offset="0.5" stopColor="#fff1b8" />
              <stop offset="0.72" stopColor="#ff8a1f" />
              <stop offset="1" stopColor="#8a2014" />
            </linearGradient>
            <linearGradient id="dznBulletShadow" x1="86" x2="500" y1="138" y2="38" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="rgba(0,0,0,0.55)" />
              <stop offset="0.5" stopColor="rgba(255,255,255,0.2)" />
              <stop offset="1" stopColor="rgba(0,0,0,0.46)" />
            </linearGradient>
            <radialGradient id="dznBulletRearGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#fff3b0" stopOpacity="0.95" />
              <stop offset="0.32" stopColor="#fb923c" stopOpacity="0.72" />
              <stop offset="1" stopColor="#ef4444" stopOpacity="0" />
            </radialGradient>
            <filter id="dznBulletGlow" x="-35%" y="-70%" width="170%" height="240%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0.95 0 0.6 0 0 0.35 0 0 0.2 0 0.06 0 0 0 1 0" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g className="dzn-bullet-projectile" filter="url(#dznBulletGlow)">
            <ellipse cx="78" cy="90" rx="58" ry="36" fill="url(#dznBulletRearGlow)" opacity="0.78" />
            <path className="dzn-bullet-casing" d="M76 52h308c38 0 72 17 96 38-24 21-58 38-96 38H76c-26 0-45-16-45-38s19-38 45-38Z" fill="url(#dznBulletCasing)" />
            <path className="dzn-bullet-nose" d="M362 52c72 4 153 24 214 38-61 14-142 34-214 38 30-23 30-53 0-76Z" fill="url(#dznBulletNose)" />
            <path d="M58 63h332c35 0 72 11 113 28-50-7-112-8-171-8H57c-11 0-20 2-28 6 1-17 15-26 29-26Z" fill="rgba(255,255,255,0.34)" />
            <path d="M54 103h343c38 0 76-10 118-26-52 36-121 51-184 51H76c-20 0-36-10-42-25Z" fill="url(#dznBulletShadow)" opacity="0.68" />
            <ellipse cx="71" cy="90" rx="25" ry="32" fill="#32150d" opacity="0.72" />
            <ellipse cx="78" cy="90" rx="14" ry="22" fill="#c7772d" opacity="0.88" />
            <path className="dzn-bullet-ridge" d="M122 55c-17 18-17 52 0 70M158 54c-15 18-15 54 0 72M198 54c-14 20-14 52 0 72" fill="none" stroke="#2f140c" strokeLinecap="round" strokeWidth="8" opacity="0.62" />
            <path className="dzn-bullet-ridge dzn-bullet-ridge--light" d="M132 55c-10 20-10 50 0 70M170 54c-9 20-9 52 0 72M212 54c-8 20-8 52 0 72" fill="none" stroke="#ffd28a" strokeLinecap="round" strokeWidth="2.4" opacity="0.58" />
            <path d="M397 57c50 6 113 21 162 33-44 3-96 3-150-4-6-12-9-22-12-29Z" fill="rgba(255,255,255,0.34)" />
            <path d="M533 83l43 7-43 7c7-6 7-8 0-14Z" fill="#fff4c7" />
          </g>
        </svg>
      </div>
    </div>
  );
}
