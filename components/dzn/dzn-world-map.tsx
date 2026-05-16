"use client";

export type DznWorldMapNode = {
  id: string;
  name: string;
  slug: string | null;
  mode: string | null;
  status: string;
  sync_status: "active" | "pending" | string;
  region: string | null;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  x: number;
  y: number;
  active: boolean;
  approximate?: boolean;
};

export function DznWorldMap({ nodes }: { nodes: DznWorldMapNode[] }) {
  const safeNodes = nodes
    .map((node) => ({ ...node, ...nodePosition(node) }))
    .filter((node) => Number.isFinite(node.mapX) && Number.isFinite(node.mapY));
  const anchor = safeNodes.find((node) => node.active) ?? safeNodes[0] ?? null;

  return (
    <div className="dzn-world-map-stage" aria-label="Live public server world map">
      <svg className="dzn-world-svg" viewBox="0 0 1000 500" role="img" aria-label="DZN public server network map">
        <defs>
          <pattern id="dznWorldGrid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M50 0H0V50" fill="none" stroke="rgba(103,232,249,0.12)" strokeWidth="1" />
          </pattern>
          <pattern id="dznWorldDots" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.1" fill="rgba(168,85,247,0.18)" />
          </pattern>
          <linearGradient id="dznWorldLine" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(103,232,249,0)" />
            <stop offset="50%" stopColor="rgba(168,85,247,0.85)" />
            <stop offset="100%" stopColor="rgba(103,232,249,0)" />
          </linearGradient>
          <radialGradient id="dznWorldGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(168,85,247,0.52)" />
            <stop offset="100%" stopColor="rgba(168,85,247,0)" />
          </radialGradient>
          <filter id="dznWorldNodeGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect className="dzn-world-grid-bg" width="1000" height="500" />
        <rect className="dzn-world-dot-texture" width="1000" height="500" />
        <ellipse className="dzn-world-center-glow" cx="510" cy="255" rx="310" ry="165" />

        <g className="dzn-world-continents">
          <path className="dzn-map-continent" d="M82 178C105 124 165 94 235 105C257 78 315 84 358 117C396 146 408 184 382 211C350 213 331 238 305 253C273 270 259 299 229 308C195 282 173 252 134 247C100 243 71 221 82 178Z" />
          <path className="dzn-map-continent" d="M149 256C183 254 221 277 233 314C219 336 229 359 252 381C276 405 272 448 244 476C214 442 205 407 183 380C160 352 147 313 149 256Z" />
          <path className="dzn-map-continent" d="M402 146C429 123 471 120 500 139C488 160 463 164 444 179C424 193 401 179 402 146Z" />
          <path className="dzn-map-continent" d="M454 196C487 169 538 174 563 209C591 248 585 310 551 350C514 373 468 354 452 309C438 270 427 229 454 196Z" />
          <path className="dzn-map-continent" d="M523 143C585 105 682 104 759 138C817 164 887 178 918 225C886 248 823 237 789 258C753 280 695 265 654 285C612 305 574 280 582 236C589 196 547 184 523 143Z" />
          <path className="dzn-map-continent" d="M747 300C776 287 831 305 857 338C837 358 797 357 765 343C739 332 726 314 747 300Z" />
          <path className="dzn-map-continent" d="M316 71C344 50 389 57 407 86C382 103 333 104 316 71Z" />
          <path className="dzn-map-continent dzn-map-continent--island" d="M874 267C901 260 930 270 943 291C922 304 887 300 874 267Z" />
        </g>

        {anchor
          ? safeNodes
              .filter((node) => node.id !== anchor.id)
              .map((node) => (
                <line
                  key={`line-${node.id}`}
                  className="dzn-map-connection"
                  x1={anchor.mapX}
                  y1={anchor.mapY}
                  x2={node.mapX}
                  y2={node.mapY}
                />
              ))
          : null}

        {safeNodes.length === 0 ? (
          <g className="dzn-map-empty">
            <circle cx="500" cy="250" r="32" />
            <text x="500" y="306" textAnchor="middle">Awaiting public server nodes</text>
          </g>
        ) : null}

        {safeNodes.map((node, index) => {
          const href = node.slug ? `/servers/profile?slug=${encodeURIComponent(node.slug)}` : "/servers";
          const title = `${node.name} - ${node.active ? "Sync active" : "Pending"} - ${node.region ?? "Location awaiting metadata"}${node.approximate ? " (approx. region)" : ""}`;
          return (
            <a key={node.id} href={href} aria-label={title}>
              <g
                className={node.active ? "dzn-map-node dzn-map-node--active" : "dzn-map-node dzn-map-node--pending"}
                style={{ animationDelay: `${index * 0.22}s` }}
              >
                <title>{title}</title>
                {node.active ? <circle className="dzn-map-pulse" cx={node.mapX} cy={node.mapY} r="34" /> : null}
                <circle className="dzn-map-node-halo" cx={node.mapX} cy={node.mapY} r={node.active ? 20 : 15} />
                <circle className="dzn-map-node-dot" cx={node.mapX} cy={node.mapY} r={node.active ? 8 : 6.5} />
              </g>
            </a>
          );
        })}

        <line className="dzn-map-scan" x1="0" y1="0" x2="0" y2="500" />
      </svg>
    </div>
  );
}

function nodePosition(node: DznWorldMapNode) {
  if (Number.isFinite(node.latitude) && Number.isFinite(node.longitude)) {
    const longitude = clamp(Number(node.longitude), -180, 180);
    const latitude = clamp(Number(node.latitude), -90, 90);
    return {
      mapX: ((longitude + 180) / 360) * 1000,
      mapY: ((90 - latitude) / 180) * 500,
    };
  }

  return {
    mapX: clamp(node.x, 0, 100) * 10,
    mapY: clamp(node.y, 0, 100) * 5,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
