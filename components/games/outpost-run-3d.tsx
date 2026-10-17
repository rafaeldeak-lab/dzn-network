"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OutpostRunCell, OutpostRunDirection } from "@/lib/games-outpost-run";

type OutpostRun3DProps = {
  gridSize: number;
  row: number;
  column: number;
  visibleCells: OutpostRunCell[];
  objective: "beacon" | "relay";
  scanHint: string | null;
  active: boolean;
  disabled: boolean;
  motionRunning: boolean;
  onMove: (direction: OutpostRunDirection) => void;
};

type CellKind = OutpostRunCell["kind"] | "unknown";
type GridCell = { row: number; column: number; kind: CellKind };

const DIRECTION_BY_OFFSET: Record<string, OutpostRunDirection> = {
  "-1:0": "north", "0:1": "east", "1:0": "south", "0:-1": "west",
};

function cellKey(row: number, column: number) { return `${row}:${column}`; }

function directionForCell(row: number, column: number, targetRow: number, targetColumn: number) {
  return DIRECTION_BY_OFFSET[`${targetRow - row}:${targetColumn - column}`] ?? null;
}

function paletteFor(kind: CellKind) {
  if (kind === "relay") return { tile: 0x17665f, emissive: 0x0d776c, glow: 0x78ffe8 };
  if (kind === "beacon") return { tile: 0x655520, emissive: 0x745b10, glow: 0xffea8a };
  if (kind === "hazard") return { tile: 0x5d271b, emissive: 0x66180f, glow: 0xff8a5d };
  if (kind === "start") return { tile: 0x4a4725, emissive: 0x4e4210, glow: 0xf6db77 };
  if (kind === "clear") return { tile: 0x204839, emissive: 0x103628, glow: 0x92d6bf };
  return { tile: 0x183740, emissive: 0x0c2931, glow: 0x5d9da7 };
}

export function OutpostRun3D({ gridSize, row, column, visibleCells, objective, scanHint, active, disabled, motionRunning, onMove }: OutpostRun3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef(onMove);
  const disabledRef = useRef(disabled);
  const activeRef = useRef(active);

  useEffect(() => { moveRef.current = onMove; }, [onMove]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") return;

    const known = new Map(visibleCells.map(cell => [cellKey(cell.row, cell.column), cell.kind]));
    const cells: GridCell[] = Array.from({ length: gridSize * gridSize }, (_, index) => {
      const cellRow = Math.floor(index / gridSize);
      const cellColumn = index % gridSize;
      return { row: cellRow, column: cellColumn, kind: known.get(cellKey(cellRow, cellColumn)) ?? "unknown" };
    });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02080d);
    scene.fog = new THREE.FogExp2(0x071015, 0.085);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 42);
    camera.position.set(5.2, 6.25, 6.75);
    camera.zoom = 1;
    camera.lookAt(0, 0, -0.15);
    camera.updateProjectionMatrix();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      mount.style.display = "none";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.52;
    renderer.domElement.dataset.dznOutpostRunCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0x77c4c8, 0x030809, 1.8));
    const moon = new THREE.DirectionalLight(0x8ce6df, 2.2);
    moon.position.set(-7, 11, 3);
    scene.add(moon);
    const signalLight = new THREE.PointLight(objective === "beacon" ? 0xffdc6f : 0x5cf8e0, 10, 18, 1.5);
    signalLight.position.set(0, 4.8, 0);
    scene.add(signalLight);

    const disposables: Array<{ dispose: () => void }> = [];
    const materials: Array<{ dispose: () => void }> = [];
    const landscape = new THREE.Group();
    scene.add(landscape);
    const fieldGeometry = new THREE.CircleGeometry(6.5, 8);
    const fieldMaterial = new THREE.MeshStandardMaterial({ color: 0x15414a, emissive: 0x0c3039, emissiveIntensity: 0.82, roughness: 0.93, metalness: 0.12 });
    disposables.push(fieldGeometry); materials.push(fieldMaterial);
    const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.35;
    landscape.add(field);
    const ridgeGeometry = new THREE.DodecahedronGeometry(0.8, 0);
    const ridgeMaterial = new THREE.MeshStandardMaterial({ color: 0x173941, emissive: 0x07171d, emissiveIntensity: 0.6, roughness: 0.9, metalness: 0.2 });
    disposables.push(ridgeGeometry); materials.push(ridgeMaterial);
    for (const [x, z, scale] of [[-4.3, -2.7, 1.2], [4.2, -2.5, 1.32], [-3.9, 3.2, 0.82], [3.8, 3.3, 0.96]] as const) {
      const ridge = new THREE.Mesh(ridgeGeometry, ridgeMaterial);
      ridge.position.set(x, -0.03 + scale * 0.22, z);
      ridge.scale.set(scale * 1.3, scale * 0.8, scale);
      ridge.rotation.set(x * 0.12, z * 0.2, x * 0.09);
      landscape.add(ridge);
    }
    const board = new THREE.Group();
    board.rotation.y = -0.27;
    board.scale.setScalar(1);
    scene.add(board);

    const terrainGeometry = new THREE.BoxGeometry(1, 0.23, 1);
    const edgeGeometry = new THREE.EdgesGeometry(terrainGeometry);
    const unitGeometry = new THREE.ConeGeometry(0.19, 0.56, 5);
    const unitRingGeometry = new THREE.TorusGeometry(0.28, 0.034, 6, 28);
    const beaconGeometry = new THREE.CylinderGeometry(0.08, 0.13, 0.78, 8);
    const beaconRingGeometry = new THREE.TorusGeometry(0.22, 0.022, 6, 28);
    const hazardGeometry = new THREE.ConeGeometry(0.16, 0.5, 4);
    disposables.push(terrainGeometry, edgeGeometry, unitGeometry, unitRingGeometry, beaconGeometry, beaconRingGeometry, hazardGeometry);

    const clickable: THREE.Mesh[] = [];
    const tileGroups = new Map<string, THREE.Group>();
    const tileMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const tileLights = new Map<string, THREE.PointLight>();
    const half = (gridSize - 1) / 2;
    for (const cell of cells) {
      const key = cellKey(cell.row, cell.column);
      const group = new THREE.Group();
      const x = (cell.column - half) * 1.14;
      const z = (cell.row - half) * 1.14;
      const elevation = (((cell.row * 7) + (cell.column * 11)) % 5) * 0.034;
      group.position.set(x, elevation, z);
      board.add(group);
      tileGroups.set(key, group);
      const palette = paletteFor(cell.kind);
      const tileMaterial = new THREE.MeshStandardMaterial({ color: palette.tile, emissive: palette.emissive, emissiveIntensity: cell.kind === "unknown" ? 0.32 : 0.48, roughness: 0.72, metalness: 0.29 });
      materials.push(tileMaterial); tileMaterials.set(key, tileMaterial);
      const tile = new THREE.Mesh(terrainGeometry, tileMaterial);
      tile.position.y = -0.12;
      tile.userData = { row: cell.row, column: cell.column };
      group.add(tile); clickable.push(tile);
      const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: palette.glow, transparent: true, opacity: cell.kind === "unknown" ? 0.16 : 0.38 }));
      materials.push(edges.material as THREE.LineBasicMaterial);
      edges.position.y = 0.01;
      group.add(edges);
      const light = new THREE.PointLight(palette.glow, cell.kind === "unknown" ? 0.12 : 0.2, 1.8, 2);
      light.position.y = 0.2;
      group.add(light); tileLights.set(key, light);

      if (cell.kind === "unknown") {
        const fog = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.42, 0.88), new THREE.MeshStandardMaterial({ color: 0x16424d, emissive: 0x0d313b, emissiveIntensity: 0.7, transparent: true, opacity: 0.58, roughness: 0.4, metalness: 0.16 }));
        disposables.push(fog.geometry); materials.push(fog.material);
        fog.position.y = 0.16;
        group.add(fog);
      }
      if (cell.kind === "hazard") {
        const hazard = new THREE.Mesh(hazardGeometry, new THREE.MeshStandardMaterial({ color: 0xbc4d2e, emissive: 0x701b0d, emissiveIntensity: 0.7, roughness: 0.44, metalness: 0.42 }));
        materials.push(hazard.material); hazard.position.y = 0.22; hazard.rotation.y = 0.75; group.add(hazard);
      }
      if (cell.kind === "beacon" || cell.kind === "relay") {
        const markerColor = cell.kind === "beacon" ? 0xffe78b : 0x72ffe9;
        const marker = new THREE.Mesh(beaconGeometry, new THREE.MeshStandardMaterial({ color: markerColor, emissive: markerColor, emissiveIntensity: 1.7, roughness: 0.22, metalness: 0.55 }));
        const markerRing = new THREE.Mesh(beaconRingGeometry, new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: 0.74, blending: THREE.AdditiveBlending, depthWrite: false }));
        materials.push(marker.material, markerRing.material);
        marker.position.y = 0.38; markerRing.position.y = 0.55; markerRing.rotation.x = Math.PI / 2;
        group.add(marker, markerRing);
      }
    }

    const player = new THREE.Group();
    const unitMaterial = new THREE.MeshStandardMaterial({ color: 0xe7fff8, emissive: 0x37cbb7, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.52 });
    const unitRingMaterial = new THREE.MeshBasicMaterial({ color: 0x85fff2, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false });
    materials.push(unitMaterial, unitRingMaterial);
    const unit = new THREE.Mesh(unitGeometry, unitMaterial);
    const unitRing = new THREE.Mesh(unitRingGeometry, unitRingMaterial);
    unit.position.y = 0.37; unitRing.position.y = 0.12; unitRing.rotation.x = Math.PI / 2;
    player.add(unit, unitRing); board.add(player);

    const currentTile = tileGroups.get(cellKey(row, column));
    if (currentTile) player.position.copy(currentTile.position);

    const scanner = new THREE.Group();
    const scannerGeometry = new THREE.RingGeometry(0.44, 0.47, 42);
    const scannerMaterial = new THREE.MeshBasicMaterial({ color: 0x99fff4, transparent: true, opacity: 0.56, blending: THREE.AdditiveBlending, depthWrite: false });
    disposables.push(scannerGeometry); materials.push(scannerMaterial);
    const scannerRing = new THREE.Mesh(scannerGeometry, scannerMaterial);
    scannerRing.rotation.x = -Math.PI / 2; scannerRing.position.y = 0.16;
    scanner.add(scannerRing); board.add(scanner);
    if (currentTile) scanner.position.copy(currentTile.position);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const updatePointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    };
    const targetFromEvent = (event: PointerEvent) => {
      updatePointer(event); raycaster.setFromCamera(pointer, camera);
      const mesh = raycaster.intersectObjects(clickable, false)[0]?.object as THREE.Mesh | undefined;
      if (!mesh) return null;
      const nextRow = mesh.userData.row as number;
      const nextColumn = mesh.userData.column as number;
      return directionForCell(row, column, nextRow, nextColumn);
    };
    const onPointerMove = (event: PointerEvent) => {
      const direction = targetFromEvent(event);
      renderer.domElement.style.cursor = direction && activeRef.current && !disabledRef.current ? "crosshair" : "default";
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || disabledRef.current || !activeRef.current) return;
      const direction = targetFromEvent(event);
      if (direction) moveRef.current(direction);
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resize = new ResizeObserver(entries => {
      const width = Math.max(1, entries[0]?.contentRect.width ?? mount.clientWidth);
      const height = Math.max(1, entries[0]?.contentRect.height ?? mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
    resize.observe(mount);

    const started = performance.now();
    let frame = 0;
    const render = (time: number) => {
      const seconds = (time - started) / 1000;
      const playerKey = cellKey(row, column);
      for (const cell of cells) {
        const key = cellKey(cell.row, cell.column);
        const material = tileMaterials.get(key);
        const light = tileLights.get(key);
        if (!material || !light) continue;
        const adjacent = Boolean(directionForCell(row, column, cell.row, cell.column));
        const palette = paletteFor(cell.kind);
        material.emissive.setHex(palette.emissive);
        material.emissiveIntensity = key === playerKey ? 1.25 : adjacent && active ? 0.92 : cell.kind === "unknown" ? 0.48 : 0.62;
        light.color.setHex(palette.glow);
        light.intensity = key === playerKey ? 1.7 : adjacent && active ? 0.42 : cell.kind === "relay" || cell.kind === "beacon" ? 0.9 : 0;
      }
      scanner.visible = Boolean(scanHint);
      if (motionRunning) {
        board.rotation.y = -0.27 + Math.sin(seconds * 0.24) * 0.025;
        unit.position.y = 0.37 + Math.sin(seconds * 2.8) * 0.035;
        unitRing.rotation.z = seconds * 1.8;
        scanner.scale.setScalar(1 + Math.sin(seconds * 2.4) * 0.1);
        scannerMaterial.opacity = scanHint ? 0.45 + Math.sin(seconds * 3.1) * 0.18 : 0;
        signalLight.intensity = 9 + Math.sin(seconds * 2.2) * 2.2;
      }
      renderer.render(scene, camera);
      if (motionRunning) frame = requestAnimationFrame(render);
    };
    render(performance.now());

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach(item => item.dispose()); else material.dispose();
        }
      });
      disposables.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active, column, gridSize, motionRunning, objective, row, scanHint, visibleCells]);

  return <div ref={mountRef} className="dzn-outpost-run-3d" data-live={active ? "true" : "false"} data-objective={objective} />;
}
