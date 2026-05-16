"use client";

import { geoContains, geoEquirectangular, geoGraticule10, geoPath } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import land50m from "world-atlas/land-50m.json";

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
  location_label?: string | null;
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

type LonLat = [number, number];
type LandTopology = Topology<{ land: GeometryCollection }>;
type GlobeControls = {
  zoomBy: (amount: number) => void;
  resetZoom: () => void;
};
type PointerState = {
  x: number;
  y: number;
  hasDragged: boolean;
  pointerId: number | null;
};

const LAND_TOPOLOGY = land50m as unknown as LandTopology;
const LAND_FEATURE = feature(LAND_TOPOLOGY, LAND_TOPOLOGY.objects.land) as FeatureCollection<Geometry>;
const WORLD_DOTS = buildWorldDotMatrix();
const DEFAULT_GLOBE_ROTATION_X = -0.1;
const DEFAULT_GLOBE_ROTATION_Y = -0.42;
const DEFAULT_GLOBE_ZOOM = 1;
const MIN_GLOBE_ZOOM = 0.82;
const MAX_GLOBE_ZOOM = 1.35;
const GLOBE_ZOOM_STEP = 0.08;
const BASE_CAMERA_Z = 3.15;
const AUTO_ROTATE_SPEED = 0.00155;
const DRAG_ROTATE_X_SPEED = 0.006;
const DRAG_ROTATE_Y_SPEED = 0.0035;

const TEXTURE_NETWORK_NODES: LonLat[] = [
  [-122, 37], [-96, 35], [-74, 40], [-47, -23], [-3, 52], [2, 48], [10, 51], [13, 41],
  [31, 30], [28, -26], [39, -6], [55, 25], [77, 28], [103, 1], [121, 14], [139, 35], [151, -33],
];

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
  const globeControlsRef = useRef<GlobeControls | null>(null);
  const rotationXRef = useRef(DEFAULT_GLOBE_ROTATION_X);
  const rotationYRef = useRef(DEFAULT_GLOBE_ROTATION_Y);
  const zoomRef = useRef(DEFAULT_GLOBE_ZOOM);
  const isDraggingRef = useRef(false);
  const lastPointerRef = useRef<PointerState>({
    x: 0,
    y: 0,
    hasDragged: false,
    pointerId: null,
  });
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
          controlsRef: globeControlsRef,
          rotationXRef,
          rotationYRef,
          zoomRef,
          isDraggingRef,
          lastPointerRef,
          onTooltip: setTooltip,
          onReady: () => {
            setReady(true);
            if (!loggedRef.current) {
              console.log("DZN ROTATING GLOBE MAP LOADED");
              console.log("DZN ROTATING GLOBE LANDMASSES LOADED");
              console.log("DZN PREMIUM GLOBE TEXTURE LOADED");
              console.log("DZN GLOBE DRAG ROTATION ENABLED");
              console.log("DZN GLOBE FREE ROTATE AND ZOOM READY");
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
      <div
        className="dzn-operational-globe-controls"
        aria-label="Globe view controls"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Zoom globe in"
          onClick={() => globeControlsRef.current?.zoomBy(GLOBE_ZOOM_STEP)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom globe out"
          onClick={() => globeControlsRef.current?.zoomBy(-GLOBE_ZOOM_STEP)}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Reset globe zoom"
          onClick={() => globeControlsRef.current?.resetZoom()}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function createThreeGlobe({
  THREE,
  stage,
  points,
  controlsRef,
  rotationXRef,
  rotationYRef,
  zoomRef,
  isDraggingRef,
  lastPointerRef,
  onTooltip,
  onReady,
}: {
  THREE: typeof import("three");
  stage: HTMLDivElement;
  points: GlobePoint[];
  controlsRef: MutableRefObject<GlobeControls | null>;
  rotationXRef: MutableRefObject<number>;
  rotationYRef: MutableRefObject<number>;
  zoomRef: MutableRefObject<number>;
  isDraggingRef: MutableRefObject<boolean>;
  lastPointerRef: MutableRefObject<PointerState>;
  onTooltip: (tooltip: TooltipState) => void;
  onReady: () => void;
}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
  camera.position.set(0, 0, BASE_CAMERA_Z / zoomRef.current);

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
  globeGroup.rotation.set(rotationXRef.current, rotationYRef.current, 0);
  scene.add(globeGroup);

  const ambient = new THREE.AmbientLight(0x8ea2ff, 0.95);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xd8b4fe, 2.4);
  keyLight.position.set(-2, 1.8, 3.2);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0x67e8f9, 1.35, 8);
  rimLight.position.set(1.8, -0.4, 2.1);
  scene.add(rimLight);

  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const globeTexture = createDznGlobeTexture(THREE);
  globeTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 88, 88),
    new THREE.MeshStandardMaterial({
      map: globeTexture,
      emissiveMap: globeTexture,
      color: 0xe7efff,
      emissive: 0x16043d,
      emissiveIntensity: 0.28,
      roughness: 0.82,
      metalness: 0.05,
      transparent: true,
      opacity: 0.98,
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
  let pageVisible = !document.hidden;

  controlsRef.current = {
    zoomBy: (amount: number) => setZoom(zoomRef.current + amount),
    resetZoom: () => setZoom(DEFAULT_GLOBE_ZOOM),
  };

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
  stage.addEventListener("pointercancel", handlePointerCancel);
  stage.addEventListener("pointerleave", handlePointerLeave);
  stage.addEventListener("wheel", handleWheel, { passive: false });
  document.addEventListener("visibilitychange", handleVisibilityChange);

  onReady();
  animate();

  return () => {
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    intersectionObserver?.disconnect();
    stage.removeEventListener("pointerdown", handlePointerDown);
    stage.removeEventListener("pointermove", handlePointerMove);
    stage.removeEventListener("pointerup", handlePointerUp);
    stage.removeEventListener("pointercancel", handlePointerCancel);
    stage.removeEventListener("pointerleave", handlePointerLeave);
    stage.removeEventListener("wheel", handleWheel);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    controlsRef.current = null;
    isDraggingRef.current = false;
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
    if (!visible || !pageVisible) return;

    const elapsed = clock.getElapsedTime();
    if (!prefersReducedMotion && !isDraggingRef.current) {
      rotationYRef.current += AUTO_ROTATE_SPEED;
    }
    globeGroup.rotation.set(rotationXRef.current, rotationYRef.current, 0);

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
    if (isGlobeControlEvent(event)) return;
    event.preventDefault();
    isDraggingRef.current = true;
    lastPointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      hasDragged: false,
      pointerId: event.pointerId,
    };
    stage.classList.add("is-dragging");
    stage.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (isDraggingRef.current) {
      const dx = event.clientX - lastPointerRef.current.x;
      const dy = event.clientY - lastPointerRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) lastPointerRef.current.hasDragged = true;
      rotationYRef.current += dx * DRAG_ROTATE_X_SPEED;
      rotationXRef.current = clamp(
        rotationXRef.current + dy * DRAG_ROTATE_Y_SPEED,
        -1.05,
        1.05,
      );
      globeGroup.rotation.set(rotationXRef.current, rotationYRef.current, 0);
      lastPointerRef.current.x = event.clientX;
      lastPointerRef.current.y = event.clientY;
      return;
    }

    pickNode(event);
  }

  function handlePointerUp(event: PointerEvent) {
    if (isGlobeControlEvent(event)) return;
    const wasDragClick = !lastPointerRef.current.hasDragged;
    isDraggingRef.current = false;
    lastPointerRef.current.pointerId = null;
    stage.classList.remove("is-dragging");
    stage.releasePointerCapture?.(event.pointerId);
    const picked = pickNode(event);
    if (wasDragClick && picked?.node.slug) {
      window.location.href = `/servers/profile?slug=${encodeURIComponent(picked.node.slug)}`;
    }
  }

  function handlePointerCancel(event: PointerEvent) {
    isDraggingRef.current = false;
    lastPointerRef.current.pointerId = null;
    stage.classList.remove("is-dragging");
    stage.releasePointerCapture?.(event.pointerId);
  }

  function handlePointerLeave() {
    if (!isDraggingRef.current) {
      stage.classList.remove("has-node-hover");
    }
    onTooltip(null);
  }

  function handleWheel(event: WheelEvent) {
    if (isGlobeControlEvent(event)) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    setZoom(zoomRef.current + direction * GLOBE_ZOOM_STEP);
  }

  function handleVisibilityChange() {
    pageVisible = !document.hidden;
  }

  function setZoom(nextZoom: number) {
    zoomRef.current = clamp(nextZoom, MIN_GLOBE_ZOOM, MAX_GLOBE_ZOOM);
    camera.position.z = BASE_CAMERA_Z / zoomRef.current;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
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

  function isGlobeControlEvent(event: Event) {
    const target = event.target;
    return target instanceof Element && Boolean(target.closest(".dzn-operational-globe-controls"));
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

function createDznGlobeTexture(THREE: typeof import("three")) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const { width, height } = canvas;
  const ocean = ctx.createLinearGradient(0, 0, 0, height);
  ocean.addColorStop(0, "#08142e");
  ocean.addColorStop(0.42, "#030b1f");
  ocean.addColorStop(1, "#081332");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, width, height);

  const projection = geoEquirectangular()
    .translate([width / 2, height / 2])
    .scale(width / (2 * Math.PI))
    .precision(0.16);
  const path = geoPath(projection, ctx);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");

  drawTextureGrid(ctx, path);
  if (maskCtx) drawLandMask(maskCtx, path, width, height);
  drawTextureLand(ctx, path);
  if (maskCtx) drawTextureLandDots(ctx, maskCtx, width, height);
  const maskData = maskCtx ? maskCtx.getImageData(0, 0, width, height).data : null;
  drawTextureNetwork(ctx, projection, maskData, width);

  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, height * 0.12, width * 0.5, height * 0.48, width * 0.62);
  vignette.addColorStop(0, "rgba(147, 197, 253, 0.05)");
  vignette.addColorStop(0.6, "rgba(2, 7, 19, 0)");
  vignette.addColorStop(1, "rgba(2, 7, 19, 0.34)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function drawTextureGrid(ctx: CanvasRenderingContext2D, path: ReturnType<typeof geoPath>) {
  ctx.save();
  ctx.beginPath();
  path(geoGraticule10());
  ctx.strokeStyle = "rgba(96, 165, 250, 0.18)";
  ctx.lineWidth = 1.15;
  ctx.stroke();
  ctx.restore();
}

function drawLandMask(ctx: CanvasRenderingContext2D, path: ReturnType<typeof geoPath>, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

function drawTextureLand(ctx: CanvasRenderingContext2D, path: ReturnType<typeof geoPath>) {
  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.shadowColor = "rgba(103, 232, 249, 0.74)";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "rgba(30, 42, 115, 0.84)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.fillStyle = "rgba(88, 28, 135, 0.24)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.shadowColor = "rgba(168, 85, 247, 0.96)";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.62)";
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.shadowColor = "rgba(191, 219, 254, 0.9)";
  ctx.shadowBlur = 11;
  ctx.strokeStyle = "rgba(191, 219, 254, 0.78)";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.strokeStyle = "rgba(103, 232, 249, 0.44)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
}

function drawTextureLandDots(
  ctx: CanvasRenderingContext2D,
  maskCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const mask = maskCtx.getImageData(0, 0, width, height).data;
  const random = seededRandom(872341);
  let accepted = 0;
  let attempts = 0;

  ctx.save();
  while (accepted < 4200 && attempts < 42000) {
    attempts += 1;
    const x = Math.floor(random() * width);
    const y = Math.floor((0.05 + random() * 0.82) * height);
    if (!isMaskLand(mask, width, x, y)) continue;
    const bright = random() > 0.91;
    const cyan = random() > 0.72;
    const radius = bright ? 1.45 + random() * 1.1 : 0.55 + random() * 0.75;
    ctx.fillStyle = bright
      ? "rgba(233, 213, 255, 0.9)"
      : cyan
        ? "rgba(103, 232, 249, 0.38)"
        : "rgba(168, 85, 247, 0.46)";
    ctx.shadowColor = cyan ? "rgba(103, 232, 249, 0.55)" : "rgba(168, 85, 247, 0.62)";
    ctx.shadowBlur = bright ? 11 : 4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    accepted += 1;
  }
  ctx.restore();
}

function drawTextureNetwork(
  ctx: CanvasRenderingContext2D,
  projection: GeoProjection,
  maskData: Uint8ClampedArray | null,
  width: number,
) {
  const projected = TEXTURE_NETWORK_NODES.map(([lon, lat]) => projection([lon, lat]));
  const valid = projected.filter((point): point is [number, number] => Boolean(point));

  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.24)";
  ctx.shadowColor = "rgba(168, 85, 247, 0.55)";
  ctx.shadowBlur = 9;
  for (let index = 0; index < valid.length - 1; index += 1) {
    if (index % 4 === 3) continue;
    const start = valid[index];
    const end = valid[index + 1];
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  for (const [index, point] of valid.entries()) {
    const x = point[0];
    const y = point[1];
    if (maskData && !isMaskLand(maskData, width, Math.round(x), Math.round(y))) continue;
    const strong = index % 3 === 0;
    ctx.fillStyle = strong ? "rgba(233, 213, 255, 0.96)" : "rgba(168, 85, 247, 0.78)";
    ctx.shadowColor = strong ? "rgba(233, 213, 255, 0.95)" : "rgba(168, 85, 247, 0.85)";
    ctx.shadowBlur = strong ? 24 : 14;
    ctx.beginPath();
    ctx.arc(x, y, strong ? 5.4 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function latLngToVector(THREE: typeof import("three"), lat: number, lng: number, radius: number) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lng + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
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
        region: node.location_label || node.city || node.region || node.country || "Location awaiting metadata",
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
  const random = seededRandom(412789);
  for (let lat = -58; lat <= 74; lat += 3.25) {
    for (let lng = -178; lng <= 178; lng += 3.25) {
      const point: [number, number] = [
        lng + (random() - 0.5) * 1.65,
        lat + (random() - 0.5) * 1.65,
      ];
      if (geoContains(LAND_FEATURE, point)) {
        dots.push({ lng: point[0], lat: point[1] });
      }
    }
  }
  return dots;
}

function isMaskLand(mask: Uint8ClampedArray, width: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= width) return false;
  const index = (y * width + x) * 4 + 3;
  if (index < 0 || index >= mask.length) return false;
  return mask[index] > 0;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function disposeScene(scene: import("three").Scene) {
  scene.traverse((object) => {
    const renderable = object as {
      geometry?: { dispose?: () => void };
      material?: DisposableMaterial | DisposableMaterial[];
    };
    if (renderable.geometry) {
      renderable.geometry.dispose?.();
    }
    if (renderable.material) {
      const material = renderable.material;
      if (Array.isArray(material)) {
        material.forEach(disposeMaterial);
      } else if (typeof material === "object") {
        disposeMaterial(material);
      }
    }
  });
}

type DisposableMaterial = {
  dispose?: () => void;
  map?: { dispose?: () => void } | null;
  emissiveMap?: { dispose?: () => void } | null;
  alphaMap?: { dispose?: () => void } | null;
  bumpMap?: { dispose?: () => void } | null;
  normalMap?: { dispose?: () => void } | null;
  roughnessMap?: { dispose?: () => void } | null;
  metalnessMap?: { dispose?: () => void } | null;
};

function disposeMaterial(material: DisposableMaterial) {
  material.map?.dispose?.();
  material.emissiveMap?.dispose?.();
  material.alphaMap?.dispose?.();
  material.bumpMap?.dispose?.();
  material.normalMap?.dispose?.();
  material.roughnessMap?.dispose?.();
  material.metalnessMap?.dispose?.();
  material.dispose?.();
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
