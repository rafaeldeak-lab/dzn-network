"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type DznOperationalGlobeNode = {
  id: string;
  name: string;
  display_name?: string | null;
  slug: string | null;
  mode: string | null;
  server_type?: string | null;
  status: string;
  sync_status: "active" | "pending" | string;
  region: string | null;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  lat?: number | null;
  lng?: number | null;
  x: number;
  y: number;
  active: boolean;
  approximate?: boolean;
};

type GlobePoint = {
  node: DznOperationalGlobeNode;
  lat: number;
  lng: number;
  region: string;
  active: boolean;
};

type TooltipState = {
  x: number;
  y: number;
  name: string;
  status: string;
  region: string;
} | null;

type WorldDot = {
  lat: number;
  lng: number;
};

type DecorPoint = {
  lat: number;
  lng: number;
  size: number;
  color: number;
};

const WORLD_DOTS = buildWorldDotMatrix();

const DECOR_POINTS: DecorPoint[] = [
  { lat: 43, lng: -105, size: 0.022, color: 0xa855f7 },
  { lat: 30, lng: -74, size: 0.018, color: 0x67e8f9 },
  { lat: -15, lng: -58, size: 0.018, color: 0xa855f7 },
  { lat: 52, lng: -2, size: 0.024, color: 0xe9d5ff },
  { lat: 48, lng: 11, size: 0.021, color: 0xa855f7 },
  { lat: 4, lng: 21, size: 0.017, color: 0x67e8f9 },
  { lat: 35, lng: 78, size: 0.022, color: 0xa855f7 },
  { lat: 1, lng: 104, size: 0.019, color: 0x67e8f9 },
  { lat: -25, lng: 134, size: 0.02, color: 0xa855f7 },
];

export function DznOperationalGlobe({ nodes }: { nodes: DznOperationalGlobeNode[] }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const loggedRef = useRef(false);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const globePoints = useMemo(() => buildGlobePoints(nodes), [nodes]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function loadGlobe() {
      try {
        const THREE = await import("three");
        if (disposed || !stageRef.current) return;
        cleanup = createThreeGlobe({
          THREE,
          stage: stageRef.current,
          points: globePoints,
          onTooltip: setTooltip,
          onReady: () => {
            setReady(true);
            if (!loggedRef.current) {
              console.log("DZN ROTATING GLOBE MAP LOADED");
              loggedRef.current = true;
            }
          },
        });
      } catch {
        if (!disposed) {
          setFailed(true);
          setReady(false);
        }
      }
    }

    setReady(false);
    setFailed(false);
    setTooltip(null);
    loadGlobe();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [globePoints]);

  return (
    <div
      ref={stageRef}
      className="dzn-operational-globe-stage"
      role="img"
      aria-label="Slow rotating DZN operational globe with linked public server nodes"
    >
      <span className="dzn-operational-globe-orbit dzn-operational-globe-orbit-one" aria-hidden="true" />
      <span className="dzn-operational-globe-orbit dzn-operational-globe-orbit-two" aria-hidden="true" />
      <span className="dzn-operational-globe-floor-glow" aria-hidden="true" />
      {!ready && !failed ? (
        <span className="dzn-operational-globe-fallback">Loading globe telemetry</span>
      ) : null}
      {failed ? (
        <span className="dzn-operational-globe-fallback">Globe telemetry unavailable</span>
      ) : null}
      {ready && globePoints.length === 0 ? (
        <span className="dzn-operational-globe-empty">Awaiting public server locations</span>
      ) : null}
      {tooltip ? (
        <span
          className="dzn-operational-globe-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <strong>{tooltip.name}</strong>
          <span>{tooltip.region}</span>
          <em>{tooltip.status}</em>
        </span>
      ) : null}
    </div>
  );
}

function createThreeGlobe({
  THREE,
  stage,
  points,
  onTooltip,
  onReady,
}: {
  THREE: typeof import("three");
  stage: HTMLDivElement;
  points: GlobePoint[];
  onTooltip: (tooltip: TooltipState) => void;
  onReady: () => void;
}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
  camera.position.set(0, 0, 3.15);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.domElement.className = "dzn-operational-globe-canvas";
  stage.appendChild(renderer.domElement);

  const globeGroup = new THREE.Group();
  globeGroup.rotation.set(-0.1, -0.42, 0);
  scene.add(globeGroup);

  const ambient = new THREE.AmbientLight(0x8ea2ff, 0.95);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xd8b4fe, 2.4);
  keyLight.position.set(-2, 1.8, 3.2);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0x67e8f9, 1.35, 8);
  rimLight.position.set(1.8, -0.4, 2.1);
  scene.add(rimLight);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 72, 72),
    new THREE.MeshPhongMaterial({
      color: 0x061025,
      emissive: 0x11051d,
      emissiveIntensity: 0.82,
      specular: 0x7c3aed,
      shininess: 34,
    }),
  );
  globeGroup.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.075, 72, 72),
    new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.16,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  globeGroup.add(atmosphere);

  const surfaceGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.011, 72, 72),
    new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.035,
      wireframe: true,
      depthWrite: false,
    }),
  );
  globeGroup.add(surfaceGlow);

  addGlobeGrid(THREE, globeGroup);
  addWorldDots(THREE, globeGroup);

  const decorNodeMeshes = addDecorativeNetwork(THREE, globeGroup);
  const { targetMeshes, pulseMeshes } = addServerNodes(THREE, globeGroup, points);
  addConnectionLines(THREE, globeGroup, decorNodeMeshes.map((entry) => entry.position), points);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const clock = new THREE.Clock();
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let animationFrame = 0;
  let visible = true;
  let pointerDown = false;
  let hasDragged = false;
  let lastX = 0;
  let lastY = 0;

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  const intersectionObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          ([entry]) => {
            visible = Boolean(entry?.isIntersecting);
          },
          { threshold: 0.05 },
        )
      : null;
  intersectionObserver?.observe(stage);

  stage.addEventListener("pointerdown", handlePointerDown);
  stage.addEventListener("pointermove", handlePointerMove);
  stage.addEventListener("pointerup", handlePointerUp);
  stage.addEventListener("pointerleave", handlePointerLeave);

  onReady();
  animate();

  return () => {
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    intersectionObserver?.disconnect();
    stage.removeEventListener("pointerdown", handlePointerDown);
    stage.removeEventListener("pointermove", handlePointerMove);
    stage.removeEventListener("pointerup", handlePointerUp);
    stage.removeEventListener("pointerleave", handlePointerLeave);
    onTooltip(null);
    disposeScene(scene);
    renderer.dispose();
    renderer.domElement.remove();
  };

  function resize() {
    const width = Math.max(stage.clientWidth, 240);
    const height = Math.max(stage.clientHeight, 180);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function animate() {
    animationFrame = requestAnimationFrame(animate);
    if (!visible) return;

    const elapsed = clock.getElapsedTime();
    if (!prefersReducedMotion && !pointerDown) {
      globeGroup.rotation.y += 0.00155;
      globeGroup.rotation.x = Math.sin(elapsed * 0.22) * 0.035 - 0.08;
    }

    for (const item of pulseMeshes) {
      const wave = (Math.sin(elapsed * 2.2 + item.delay) + 1) / 2;
      item.mesh.scale.setScalar(0.88 + wave * 0.72);
      item.material.opacity = item.active ? 0.12 + (1 - wave) * 0.16 : 0.055;
    }

    for (const item of decorNodeMeshes) {
      const glow = (Math.sin(elapsed * 1.9 + item.delay) + 1) / 2;
      item.mesh.scale.setScalar(0.92 + glow * 0.22);
    }

    renderer.render(scene, camera);
  }

  function handlePointerDown(event: PointerEvent) {
    pointerDown = true;
    hasDragged = false;
    lastX = event.clientX;
    lastY = event.clientY;
    stage.classList.add("is-dragging");
    stage.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (pointerDown) {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) hasDragged = true;
      globeGroup.rotation.y += dx * 0.006;
      globeGroup.rotation.x = clamp(globeGroup.rotation.x + dy * 0.0035, -0.62, 0.42);
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }

    pickNode(event);
  }

  function handlePointerUp(event: PointerEvent) {
    pointerDown = false;
    stage.classList.remove("is-dragging");
    stage.releasePointerCapture?.(event.pointerId);
    const picked = pickNode(event);
    if (!hasDragged && picked?.node.slug) {
      window.location.href = `/servers/profile?slug=${encodeURIComponent(picked.node.slug)}`;
    }
  }

  function handlePointerLeave() {
    pointerDown = false;
    stage.classList.remove("is-dragging");
    onTooltip(null);
  }

  function pickNode(event: PointerEvent) {
    const rect = stage.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hit = raycaster.intersectObjects(targetMeshes, false)[0];
    if (!hit) {
      stage.classList.remove("has-node-hover");
      onTooltip(null);
      return null;
    }

    const point = hit.object.userData.dznPoint as GlobePoint | undefined;
    if (!point) return null;
    stage.classList.add("has-node-hover");
    onTooltip({
      x: Math.min(Math.max(event.clientX - rect.left + 12, 10), rect.width - 170),
      y: Math.min(Math.max(event.clientY - rect.top + 12, 10), rect.height - 82),
      name: point.node.display_name || point.node.name,
      region: point.region,
      status: point.active ? "Sync active" : "Pending",
    });
    return point;
  }
}

function addGlobeGrid(THREE: typeof import("three"), group: import("three").Group) {
  const material = new THREE.LineBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.11,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  for (const lat of [-60, -40, -20, 0, 20, 40, 60]) {
    const points = [];
    for (let lng = -180; lng <= 180; lng += 4) {
      points.push(latLngToVector(THREE, lat, lng, 1.018));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material.clone()));
  }

  for (let lng = -150; lng <= 180; lng += 30) {
    const points = [];
    for (let lat = -82; lat <= 82; lat += 4) {
      points.push(latLngToVector(THREE, lat, lng, 1.018));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material.clone()));
  }
}

function addWorldDots(THREE: typeof import("three"), group: import("three").Group) {
  const geometry = new THREE.SphereGeometry(0.008, 5, 5);
  const material = new THREE.MeshBasicMaterial({
    color: 0xb7c7ff,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, WORLD_DOTS.length);
  const matrix = new THREE.Matrix4();

  WORLD_DOTS.forEach((dot, index) => {
    matrix.identity();
    matrix.setPosition(latLngToVector(THREE, dot.lat, dot.lng, 1.029));
    mesh.setMatrixAt(index, matrix);
  });

  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

function addDecorativeNetwork(THREE: typeof import("three"), group: import("three").Group) {
  const entries: Array<{
    mesh: import("three").Mesh;
    position: import("three").Vector3;
    delay: number;
  }> = [];

  DECOR_POINTS.forEach((point, index) => {
    const position = latLngToVector(THREE, point.lat, point.lng, 1.07);
    const material = new THREE.MeshBasicMaterial({
      color: point.color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(point.size, 12, 12), material);
    mesh.position.copy(position);
    group.add(mesh);
    entries.push({ mesh, position, delay: index * 0.42 });
  });

  return entries;
}

function addServerNodes(THREE: typeof import("three"), group: import("three").Group, points: GlobePoint[]) {
  const targetMeshes: import("three").Object3D[] = [];
  const pulseMeshes: Array<{
    mesh: import("three").Mesh;
    material: import("three").MeshBasicMaterial;
    delay: number;
    active: boolean;
  }> = [];

  points.forEach((point, index) => {
    const position = latLngToVector(THREE, point.lat, point.lng, 1.096);
    const nodeMaterial = new THREE.MeshBasicMaterial({
      color: point.active ? 0xe9d5ff : 0x8b7bbd,
      transparent: true,
      opacity: point.active ? 1 : 0.56,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const nodeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(point.active ? 0.037 : 0.028, 16, 16),
      nodeMaterial,
    );
    nodeMesh.position.copy(position);
    nodeMesh.userData.dznPoint = point;
    group.add(nodeMesh);
    targetMeshes.push(nodeMesh);

    const pulseMaterial = new THREE.MeshBasicMaterial({
      color: point.active ? 0xa855f7 : 0x64748b,
      transparent: true,
      opacity: point.active ? 0.22 : 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pulseMesh = new THREE.Mesh(
      new THREE.SphereGeometry(point.active ? 0.076 : 0.052, 18, 18),
      pulseMaterial,
    );
    pulseMesh.position.copy(position);
    group.add(pulseMesh);
    pulseMeshes.push({ mesh: pulseMesh, material: pulseMaterial, delay: index * 0.55, active: point.active });
  });

  return { targetMeshes, pulseMeshes };
}

function addConnectionLines(
  THREE: typeof import("three"),
  group: import("three").Group,
  decorPositions: import("three").Vector3[],
  points: GlobePoint[],
) {
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xa855f7,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const decorConnections = [
    [0, 1],
    [1, 3],
    [3, 4],
    [4, 6],
    [6, 7],
    [7, 8],
    [4, 5],
  ];

  for (const [from, to] of decorConnections) {
    const start = decorPositions[from];
    const end = decorPositions[to];
    if (start && end) group.add(new THREE.Line(createArcGeometry(THREE, start, end), lineMaterial.clone()));
  }

  points.forEach((point, index) => {
    const start = decorPositions[index % decorPositions.length];
    const end = latLngToVector(THREE, point.lat, point.lng, 1.105);
    if (start) group.add(new THREE.Line(createArcGeometry(THREE, start, end), lineMaterial.clone()));
  });
}

function createArcGeometry(
  THREE: typeof import("three"),
  start: import("three").Vector3,
  end: import("three").Vector3,
) {
  const mid = start.clone().add(end).normalize().multiplyScalar(1.32);
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  return new THREE.BufferGeometry().setFromPoints(curve.getPoints(28));
}

function latLngToVector(THREE: typeof import("three"), lat: number, lng: number, radius: number) {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  return new THREE.Vector3(
    radius * Math.cos(latRad) * Math.sin(lngRad),
    radius * Math.sin(latRad),
    radius * Math.cos(latRad) * Math.cos(lngRad),
  );
}

function buildGlobePoints(nodes: DznOperationalGlobeNode[]) {
  const coordinateCounts = new Map<string, number>();
  return nodes
    .map((node) => {
      const location = nodeLocation(node);
      if (!location) return null;
      const key = `${Math.round(location.lat)}:${Math.round(location.lng)}`;
      const count = coordinateCounts.get(key) ?? 0;
      coordinateCounts.set(key, count + 1);
      const offset = duplicateOffset(count);
      return {
        node,
        lat: clamp(location.lat + offset.lat, -76, 76),
        lng: clamp(location.lng + offset.lng, -178, 178),
        region: node.region || node.country || node.city || "Approx. region",
        active: Boolean(node.active) || node.sync_status === "active" || node.status === "active",
      };
    })
    .filter((point): point is GlobePoint => Boolean(point));
}

function nodeLocation(node: DznOperationalGlobeNode) {
  const lat = finiteNumber(node.lat ?? node.latitude);
  const lng = finiteNumber(node.lng ?? node.longitude);
  if (lat !== null && lng !== null) {
    return { lat: clamp(lat, -82, 82), lng: clamp(lng, -180, 180) };
  }

  const region = (node.region ?? "").trim().toLowerCase();
  const hasUsableRegion =
    region.length > 0 &&
    !region.includes("awaiting") &&
    !region.includes("unknown") &&
    !region.includes("metadata");
  const x = finiteNumber(node.x);
  const y = finiteNumber(node.y);
  if (hasUsableRegion && x !== null && y !== null) {
    return {
      lat: clamp(90 - (clamp(y, 0, 100) / 100) * 180, -82, 82),
      lng: clamp((clamp(x, 0, 100) / 100) * 360 - 180, -180, 180),
    };
  }

  return null;
}

function duplicateOffset(index: number) {
  const offsets = [
    { lat: 0, lng: 0 },
    { lat: 2, lng: 2.6 },
    { lat: -2.1, lng: -2.4 },
    { lat: 1.4, lng: -3.2 },
    { lat: -1.5, lng: 3.4 },
  ];
  return offsets[index % offsets.length];
}

function buildWorldDotMatrix() {
  const dots: WorldDot[] = [];
  addEllipseDots(dots, 210, 158, 132, 66, 13, -8);
  addEllipseDots(dots, 286, 196, 86, 52, 13, 6);
  addEllipseDots(dots, 314, 298, 54, 104, 13, 14);
  addEllipseDots(dots, 468, 153, 48, 26, 12, -8);
  addEllipseDots(dots, 520, 242, 72, 98, 13, -2);
  addEllipseDots(dots, 652, 172, 172, 72, 13, 4);
  addEllipseDots(dots, 742, 226, 102, 54, 13, 10);
  addEllipseDots(dots, 786, 322, 64, 34, 12, 6);
  addEllipseDots(dots, 344, 92, 42, 18, 12, 0);
  return dots.filter((dot) => !isCutOut(dot));
}

function addEllipseDots(dots: WorldDot[], cx: number, cy: number, rx: number, ry: number, step: number, slant = 0) {
  for (let y = cy - ry; y <= cy + ry; y += step) {
    const rowShift = Math.round((y - (cy - ry)) / step) % 2 === 0 ? 0 : step / 2;
    for (let x = cx - rx; x <= cx + rx; x += step) {
      const shiftedX = x + rowShift + ((y - cy) / ry) * slant;
      const dx = (shiftedX - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        dots.push({
          lng: (shiftedX / 1000) * 360 - 180,
          lat: 90 - (y / 420) * 180,
        });
      }
    }
  }
}

function isCutOut(dot: WorldDot) {
  const x = ((dot.lng + 180) / 360) * 1000;
  const y = ((90 - dot.lat) / 180) * 420;
  const cuts = [
    { cx: 265, cy: 139, rx: 34, ry: 24 },
    { cx: 250, cy: 232, rx: 54, ry: 28 },
    { cx: 573, cy: 163, rx: 38, ry: 26 },
    { cx: 595, cy: 260, rx: 40, ry: 38 },
    { cx: 718, cy: 152, rx: 52, ry: 30 },
    { cx: 704, cy: 252, rx: 42, ry: 24 },
  ];
  return cuts.some((cut) => {
    const dx = (x - cut.cx) / cut.rx;
    const dy = (y - cut.cy) / cut.ry;
    return dx * dx + dy * dy < 1;
  });
}

function disposeScene(scene: import("three").Scene) {
  scene.traverse((object) => {
    const renderable = object as {
      geometry?: { dispose?: () => void };
      material?: { dispose?: () => void } | Array<{ dispose?: () => void }>;
    };
    if (renderable.geometry) {
      renderable.geometry.dispose?.();
    }
    if (renderable.material) {
      const material = renderable.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose?.());
      } else if (typeof material === "object") {
        material.dispose?.();
      }
    }
  });
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
