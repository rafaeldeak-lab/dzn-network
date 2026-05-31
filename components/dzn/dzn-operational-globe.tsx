"use client";

import { geoEquirectangular, geoGraticule10, geoPath } from "d3-geo";
import { memo, useEffect, useMemo, useRef, useState } from "react";
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
  tone: "active" | "pending";
} | null;

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
let cachedDznGlobeTextureCanvas: HTMLCanvasElement | null = null;
let cachedCoastlinePositions: Float32Array | null = null;
const DEFAULT_GLOBE_ROTATION_X = -0.1;
const DEFAULT_GLOBE_ROTATION_Y = -0.42;
const DEFAULT_GLOBE_ZOOM = 1;
const MIN_GLOBE_ZOOM = 0.75;
const MAX_GLOBE_ZOOM = 1.85;
const GLOBE_ZOOM_STEP = 0.08;
const BASE_CAMERA_Z = 2.7;
const AUTO_ROTATE_SPEED = 0.00155;
const DRAG_ROTATE_X_SPEED = 0.006;
const DRAG_ROTATE_Y_SPEED = 0.0035;
const BASE_MARKER_SCALE = 1;
const MIN_MARKER_SCALE = 0.56;
const MAX_MARKER_SCALE = 1.04;

function DznOperationalGlobeComponent({ nodes }: { nodes: DznOperationalGlobeNode[] }) {
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
    if (process.env.NODE_ENV !== "development") return;
    console.log("DZN globe markers refined:", {
      mapNodes: nodes.length,
      renderedMarkers: globePoints.length,
      zoomRange: `${MIN_GLOBE_ZOOM}-${MAX_GLOBE_ZOOM}`,
    });
    console.log("DZN globe map nodes");
    console.table(
      globePoints.map((point) => ({
        name: point.node.display_name || point.node.name,
        status: point.active ? "active" : "pending",
        lat: point.lat,
        lng: point.lng,
        location_label: point.region,
        approximate: Boolean(point.node.approximate),
        slug: point.node.slug,
      })),
    );
  }, [globePoints, nodes.length]);

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
              console.log("DZN GLOBE REAL SERVER NODES ONLY");
              console.log("DZN HD GEO GLOBE READY");
              console.log("DZN HD GLOBE LAND DETAIL ACTIVE");
              console.log("DZN HD GLOBE PINS REFINED");
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
        <span className="dzn-operational-globe-empty">Server locations update after ADM sync</span>
      ) : null}
      {tooltip ? (
        <span
          className="dzn-operational-globe-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <strong>{tooltip.name}</strong>
          <span>{tooltip.region}</span>
          <em className={`dzn-operational-globe-tooltip-status dzn-operational-globe-tooltip-status--${tooltip.tone}`}>
            {tooltip.status}
          </em>
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
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.set(0, 0, BASE_CAMERA_Z / zoomRef.current);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
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
    new THREE.SphereGeometry(1, 96, 96),
    new THREE.MeshStandardMaterial({
      map: globeTexture,
      emissiveMap: globeTexture,
      color: 0xcdd9ff,
      emissive: 0x1d0757,
      emissiveIntensity: 0.34,
      roughness: 0.76,
      metalness: 0.08,
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
      opacity: 0.026,
      wireframe: true,
      depthWrite: false,
    }),
  );
  globeGroup.add(surfaceGlow);

  addGlobeGrid(THREE, globeGroup);
  addLandCoastlineOverlay(THREE, globeGroup);

  const { targetMeshes, pulseMeshes, markerGroups } = addServerNodes(THREE, globeGroup, points);
  addServerConnectionLines(THREE, globeGroup, points);

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
  applyMarkerScale();

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
      item.mesh.scale.setScalar(0.9 + wave * 0.44);
      item.material.opacity = item.active ? 0.1 + (1 - wave) * 0.12 : 0.035;
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
    applyMarkerScale();
    renderer.render(scene, camera);
  }

  function applyMarkerScale() {
    const markerScale = markerScaleForZoom(zoomRef.current);
    for (const marker of markerGroups) {
      marker.scale.setScalar(markerScale);
    }
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
      status: point.active ? "Active" : "Pending",
      tone: point.active ? "active" : "pending",
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

function addLandCoastlineOverlay(THREE: typeof import("three"), group: import("three").Group) {
  const positions = cachedCoastlinePositions ?? buildCoastlinePositions(THREE);
  cachedCoastlinePositions = positions;
  if (positions.length === 0) return;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  const purpleGlow = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(purpleGlow);

  const cyanEdge = new THREE.LineSegments(
    geometry.clone(),
    new THREE.LineBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(cyanEdge);
}

function buildCoastlinePositions(THREE: typeof import("three")) {
  const positions: number[] = [];
  for (const item of LAND_FEATURE.features) {
    collectGeometryRings(item.geometry, (ring) => {
      for (let index = 1; index < ring.length; index += 1) {
        const previous = ring[index - 1];
        const current = ring[index];
        if (!validLonLat(previous) || !validLonLat(current)) continue;
        if (Math.abs(previous[0] - current[0]) > 35) continue;
        const start = latLngToVector(THREE, previous[1], previous[0], 1.026);
        const end = latLngToVector(THREE, current[1], current[0], 1.026);
        positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
      }
    });
  }
  return new Float32Array(positions);
}

function collectGeometryRings(geometry: Geometry, visit: (ring: number[][]) => void) {
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => visit(ring as number[][]));
    return;
  }
  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => visit(ring as number[][])));
    return;
  }
  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach((child) => collectGeometryRings(child as Geometry, visit));
  }
}

function validLonLat(value: unknown): value is [number, number] {
  return Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]);
}

function addServerNodes(THREE: typeof import("three"), group: import("three").Group, points: GlobePoint[]) {
  const targetMeshes: import("three").Object3D[] = [];
  const markerGroups: import("three").Group[] = [];
  const pulseMeshes: Array<{
    mesh: import("three").Mesh;
    material: import("three").MeshBasicMaterial;
    delay: number;
    active: boolean;
  }> = [];

  points.forEach((point, index) => {
    const position = latLngToVector(THREE, point.lat, point.lng, 1.116);
    const normal = position.clone().normalize();
    const markerGroup = new THREE.Group();
    markerGroup.position.copy(position);
    markerGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: point.active ? 0x22d3ee : 0xf59e0b,
      transparent: true,
      opacity: point.active ? 0.58 : 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(point.active ? 0.025 : 0.019, point.active ? 0.0016 : 0.0012, 8, 38),
      ringMaterial,
    );
    ringMesh.position.set(0, 0, 0.004);
    markerGroup.add(ringMesh);

    const beamMaterial = new THREE.LineBasicMaterial({
      color: point.active ? 0xc084fc : 0xf59e0b,
      transparent: true,
      opacity: point.active ? 0.42 : 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beamGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0.006),
      new THREE.Vector3(0, 0, point.active ? 0.105 : 0.074),
    ]);
    markerGroup.add(new THREE.Line(beamGeometry, beamMaterial));

    const outerGlowMaterial = new THREE.MeshBasicMaterial({
      color: point.active ? 0x67e8f9 : 0xf59e0b,
      transparent: true,
      opacity: point.active ? 0.18 : 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const outerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(point.active ? 0.024 : 0.018, 18, 18),
      outerGlowMaterial,
    );
    outerGlow.position.set(0, 0, 0.04);
    markerGroup.add(outerGlow);

    const nodeMaterial = new THREE.MeshBasicMaterial({
      color: point.active ? 0xc084fc : 0x8b5cf6,
      transparent: true,
      opacity: point.active ? 0.92 : 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const nodeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(point.active ? 0.011 : 0.0085, 18, 18),
      nodeMaterial,
    );
    nodeMesh.position.set(0, 0, 0.052);
    nodeMesh.userData.dznPoint = point;
    markerGroup.add(nodeMesh);

    const pulseMaterial = new THREE.MeshBasicMaterial({
      color: point.active ? 0xa855f7 : 0xf59e0b,
      transparent: true,
      opacity: point.active ? 0.22 : 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pulseMesh = new THREE.Mesh(
      new THREE.TorusGeometry(point.active ? 0.035 : 0.023, point.active ? 0.0014 : 0.001, 8, 42),
      pulseMaterial,
    );
    pulseMesh.position.set(0, 0, 0.008);
    markerGroup.add(pulseMesh);
    pulseMeshes.push({ mesh: pulseMesh, material: pulseMaterial, delay: index * 0.55, active: point.active });

    const hitMesh = new THREE.Mesh(
      new THREE.SphereGeometry(point.active ? 0.055 : 0.045, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    hitMesh.position.set(0, 0, 0.052);
    hitMesh.userData.dznPoint = point;
    markerGroup.add(hitMesh);
    targetMeshes.push(hitMesh);

    markerGroups.push(markerGroup);
    group.add(markerGroup);
  });

  return { targetMeshes, pulseMeshes, markerGroups };
}

function addServerConnectionLines(THREE: typeof import("three"), group: import("three").Group, points: GlobePoint[]) {
  const activePoints = points.filter((point) => point.active);
  if (activePoints.length < 2) return;

  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xa855f7,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  for (let index = 0; index < activePoints.length - 1; index += 1) {
    const startPoint = activePoints[index];
    const endPoint = activePoints[index + 1];
    const start = latLngToVector(THREE, startPoint.lat, startPoint.lng, 1.112);
    const end = latLngToVector(THREE, endPoint.lat, endPoint.lng, 1.112);
    group.add(new THREE.Line(createArcGeometry(THREE, start, end), lineMaterial.clone()));
  }
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
  const canvas = cachedDznGlobeTextureCanvas ?? createDznGlobeTextureCanvas();
  cachedDznGlobeTextureCanvas = canvas;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export const DznOperationalGlobe = memo(DznOperationalGlobeComponent, (previous, next) => (
  globeNodeIdentityKey(previous.nodes) === globeNodeIdentityKey(next.nodes)
));

function createDznGlobeTextureCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const { width, height } = canvas;
  const ocean = ctx.createLinearGradient(0, 0, 0, height);
  ocean.addColorStop(0, "#0a1838");
  ocean.addColorStop(0.36, "#031027");
  ocean.addColorStop(0.72, "#020816");
  ocean.addColorStop(1, "#08163a");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, width, height);

  const oceanGlow = ctx.createRadialGradient(width * 0.54, height * 0.45, height * 0.08, width * 0.54, height * 0.45, width * 0.58);
  oceanGlow.addColorStop(0, "rgba(59, 130, 246, 0.1)");
  oceanGlow.addColorStop(0.52, "rgba(124, 58, 237, 0.05)");
  oceanGlow.addColorStop(1, "rgba(2, 6, 23, 0)");
  ctx.fillStyle = oceanGlow;
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

  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, height * 0.12, width * 0.5, height * 0.48, width * 0.62);
  vignette.addColorStop(0, "rgba(147, 197, 253, 0.05)");
  vignette.addColorStop(0.6, "rgba(2, 7, 19, 0)");
  vignette.addColorStop(1, "rgba(2, 7, 19, 0.34)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  return canvas;
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
  ctx.shadowColor = "rgba(103, 232, 249, 0.48)";
  ctx.shadowBlur = 34;
  ctx.fillStyle = "rgba(20, 31, 74, 0.94)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.fillStyle = "rgba(88, 28, 135, 0.28)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.shadowColor = "rgba(168, 85, 247, 0.9)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.55)";
  ctx.lineWidth = 5.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  path(LAND_FEATURE);
  ctx.shadowColor = "rgba(103, 232, 249, 0.74)";
  ctx.shadowBlur = 9;
  ctx.strokeStyle = "rgba(191, 219, 254, 0.74)";
  ctx.lineWidth = 1.8;
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
  while (accepted < 1800 && attempts < 32000) {
    attempts += 1;
    const x = Math.floor(random() * width);
    const y = Math.floor((0.05 + random() * 0.82) * height);
    if (!isMaskLand(mask, width, x, y)) continue;
    const cyan = random() > 0.72;
    const radius = 0.22 + random() * 0.32;
    ctx.fillStyle = cyan ? "rgba(103, 232, 249, 0.1)" : "rgba(168, 85, 247, 0.12)";
    ctx.shadowColor = cyan ? "rgba(103, 232, 249, 0.12)" : "rgba(168, 85, 247, 0.14)";
    ctx.shadowBlur = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    accepted += 1;
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

function markerScaleForZoom(zoom: number) {
  return clamp(BASE_MARKER_SCALE / Math.pow(zoom, 0.85), MIN_MARKER_SCALE, MAX_MARKER_SCALE);
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

function globeNodeIdentityKey(nodes: DznOperationalGlobeNode[]) {
  return nodes
    .map((node) => [
      node.id,
      node.slug,
      node.display_name ?? node.name,
      node.sync_status,
      node.status,
      node.active ? "1" : "0",
      node.latitude ?? node.lat ?? "",
      node.longitude ?? node.lng ?? "",
      node.location_label ?? node.region ?? "",
    ].join(":"))
    .join("|");
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
