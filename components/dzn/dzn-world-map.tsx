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

type Dot = {
  x: number;
  y: number;
  opacity?: number;
};

type DecorNode = {
  x: number;
  y: number;
  size: number;
  tone: "violet" | "cyan";
};

const mapDots = buildDotMatrixWorld();

const decorativeNodes: DecorNode[] = [
  { x: 172, y: 164, size: 2.2, tone: "violet" },
  { x: 228, y: 145, size: 1.8, tone: "cyan" },
  { x: 282, y: 198, size: 2.4, tone: "violet" },
  { x: 326, y: 304, size: 1.9, tone: "violet" },
  { x: 486, y: 171, size: 2.6, tone: "cyan" },
  { x: 527, y: 241, size: 2.1, tone: "violet" },
  { x: 588, y: 196, size: 1.7, tone: "violet" },
  { x: 642, y: 174, size: 2.3, tone: "cyan" },
  { x: 704, y: 208, size: 1.9, tone: "violet" },
  { x: 772, y: 326, size: 2.2, tone: "cyan" },
  { x: 842, y: 244, size: 1.8, tone: "violet" },
];

const decorativeConnections = [
  [0, 1],
  [1, 2],
  [2, 4],
  [3, 5],
  [4, 5],
  [4, 7],
  [5, 6],
  [6, 7],
  [7, 8],
  [8, 10],
  [8, 9],
];

export function DznWorldMap({ nodes }: { nodes: DznWorldMapNode[] }) {
  const safeNodes = nodes
    .map((node, index) => {
      const position = nodePosition(node);
      const duplicateOffset = duplicateNodeOffset(index);
      return {
        ...node,
        mapX: clamp(position.mapX + duplicateOffset.x, 30, 970),
        mapY: clamp(position.mapY + duplicateOffset.y, 28, 472),
      };
    })
    .filter((node) => Number.isFinite(node.mapX) && Number.isFinite(node.mapY));

  const hub = decorativeNodes[4];

  return (
    <div className="dzn-world-map-stage" aria-label="Live public server world map">
      <svg className="dzn-world-map-svg" viewBox="0 0 1000 420" role="img" aria-label="DZN public server network map">
        <defs>
          <pattern id="dznMapGrid" width="42" height="42" patternUnits="userSpaceOnUse">
            <path d="M42 0H0V42" fill="none" stroke="rgba(103,232,249,0.1)" strokeWidth="1" />
          </pattern>
          <linearGradient id="dznMapLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(103,232,249,0)" />
            <stop offset="48%" stopColor="rgba(168,85,247,0.76)" />
            <stop offset="100%" stopColor="rgba(103,232,249,0)" />
          </linearGradient>
          <radialGradient id="dznMapBloom" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="rgba(168,85,247,0.34)" />
            <stop offset="100%" stopColor="rgba(168,85,247,0)" />
          </radialGradient>
        </defs>

        <rect className="dzn-map-grid" width="1000" height="420" />
        <ellipse className="dzn-map-glow" cx="520" cy="212" rx="360" ry="154" />

        <g aria-hidden="true">
          {mapDots.map((dot, index) => (
            <circle
              key={`${dot.x}-${dot.y}-${index}`}
              className="dzn-map-dot"
              cx={dot.x}
              cy={dot.y}
              r="1.45"
              style={{ opacity: dot.opacity ?? 1 }}
            />
          ))}
        </g>

        <g aria-hidden="true">
          {decorativeConnections.map(([from, to], index) => {
            const start = decorativeNodes[from];
            const end = decorativeNodes[to];
            return (
              <line
                key={`decor-line-${index}`}
                className="dzn-map-connection"
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
              />
            );
          })}
          {safeNodes.map((node) => (
            <line
              key={`real-line-${node.id}`}
              className="dzn-map-connection dzn-map-connection--real"
              x1={hub.x}
              y1={hub.y}
              x2={node.mapX}
              y2={node.mapY}
            />
          ))}
        </g>

        <g aria-hidden="true">
          {decorativeNodes.map((node, index) => (
            <circle
              key={`decor-node-${index}`}
              className={`dzn-map-decor-node dzn-map-decor-node--${node.tone}`}
              cx={node.x}
              cy={node.y}
              r={node.size}
              style={{ animationDelay: `${index * 0.18}s` }}
            />
          ))}
        </g>

        {safeNodes.length === 0 ? (
          <g className="dzn-map-empty">
            <circle cx="500" cy="210" r="23" />
            <text x="500" y="257" textAnchor="middle">Awaiting public server nodes</text>
          </g>
        ) : null}

        {safeNodes.map((node, index) => {
          const href = node.slug ? `/servers/profile?slug=${encodeURIComponent(node.slug)}` : "/servers";
          const title = `${node.name} — ${node.region ?? "Location awaiting metadata"} — ${node.active ? "Sync active" : "Pending"}`;
          return (
            <a key={node.id} href={href} aria-label={title}>
              <g className={node.active ? "dzn-map-real-node-group dzn-map-real-node-group--active" : "dzn-map-real-node-group dzn-map-real-node-group--pending"}>
                <title>{title}</title>
                {node.active ? <circle className="dzn-map-pulse" cx={node.mapX} cy={node.mapY} r="5" /> : null}
                <circle className="dzn-map-real-node-halo" cx={node.mapX} cy={node.mapY} r={node.active ? 13 : 9} />
                <circle
                  className={node.active ? "dzn-map-real-node dzn-map-real-node--active" : "dzn-map-real-node dzn-map-real-node--pending"}
                  cx={node.mapX}
                  cy={node.mapY}
                  r={node.active ? 5.2 : 4.4}
                  style={{ animationDelay: `${index * 0.22}s` }}
                />
              </g>
            </a>
          );
        })}
      </svg>
      <span className="dzn-map-scan" aria-hidden="true" />
    </div>
  );
}

function buildDotMatrixWorld() {
  const dots: Dot[] = [];
  addEllipseDots(dots, 210, 158, 132, 66, 15, -8, 0.76);
  addEllipseDots(dots, 286, 196, 86, 52, 15, 6, 0.66);
  addEllipseDots(dots, 314, 298, 54, 104, 15, 14, 0.72);
  addEllipseDots(dots, 468, 153, 48, 26, 13, -8, 0.82);
  addEllipseDots(dots, 520, 242, 72, 98, 14, -2, 0.74);
  addEllipseDots(dots, 652, 172, 172, 72, 15, 4, 0.78);
  addEllipseDots(dots, 742, 226, 102, 54, 15, 10, 0.68);
  addEllipseDots(dots, 786, 322, 64, 34, 14, 6, 0.76);
  addEllipseDots(dots, 344, 92, 42, 18, 13, 0, 0.58);

  return dots.filter((dot) => !isDotCutOut(dot));
}

function addEllipseDots(dots: Dot[], cx: number, cy: number, rx: number, ry: number, step: number, slant = 0, opacity = 0.72) {
  for (let y = cy - ry; y <= cy + ry; y += step) {
    const rowShift = Math.round((y - (cy - ry)) / step) % 2 === 0 ? 0 : step / 2;
    for (let x = cx - rx; x <= cx + rx; x += step) {
      const shiftedX = x + rowShift + ((y - cy) / ry) * slant;
      const dx = (shiftedX - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        dots.push({
          x: Math.round(shiftedX * 10) / 10,
          y: Math.round(y * 10) / 10,
          opacity: opacity + (((Math.round(x + y) % 5) - 2) * 0.045),
        });
      }
    }
  }
}

function isDotCutOut(dot: Dot) {
  const cuts = [
    { cx: 265, cy: 139, rx: 34, ry: 24 },
    { cx: 250, cy: 232, rx: 54, ry: 28 },
    { cx: 573, cy: 163, rx: 38, ry: 26 },
    { cx: 595, cy: 260, rx: 40, ry: 38 },
    { cx: 718, cy: 152, rx: 52, ry: 30 },
    { cx: 704, cy: 252, rx: 42, ry: 24 },
  ];
  return cuts.some((cut) => {
    const dx = (dot.x - cut.cx) / cut.rx;
    const dy = (dot.y - cut.cy) / cut.ry;
    return dx * dx + dy * dy < 1;
  });
}

function nodePosition(node: DznWorldMapNode) {
  if (Number.isFinite(node.latitude) && Number.isFinite(node.longitude)) {
    const longitude = clamp(Number(node.longitude), -180, 180);
    const latitude = clamp(Number(node.latitude), -90, 90);
    return {
      mapX: ((longitude + 180) / 360) * 1000,
      mapY: ((90 - latitude) / 180) * 420,
    };
  }

  return {
    mapX: clamp(node.x, 0, 100) * 10,
    mapY: clamp(node.y, 0, 100) * 4.2,
  };
}

function duplicateNodeOffset(index: number) {
  const offsets = [
    { x: 0, y: 0 },
    { x: 12, y: -7 },
    { x: -10, y: 8 },
    { x: 14, y: 10 },
    { x: -13, y: -9 },
    { x: 20, y: 2 },
  ];
  return offsets[index % offsets.length];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
