"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OutpostRunCell, OutpostRunDirection } from "@/lib/games-outpost-run";

type OutpostRun3DProps = {
  gridSize: number;
  row: number;
  column: number;
  visibleCells: OutpostRunCell[];
  objective: "beacon" | "cache" | "relay";
  intensity: "calibration" | "pressure" | "blackout";
  scanHint: string | null;
  shieldArmed: boolean;
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
  if (kind === "cache") return { tile: 0x654027, emissive: 0x743515, glow: 0xffb46a };
  if (kind === "hazard") return { tile: 0x5d271b, emissive: 0x66180f, glow: 0xff8a5d };
  if (kind === "start") return { tile: 0x4a4725, emissive: 0x4e4210, glow: 0xf6db77 };
  if (kind === "clear") return { tile: 0x204839, emissive: 0x103628, glow: 0x92d6bf };
  return { tile: 0x183740, emissive: 0x0c2931, glow: 0x5d9da7 };
}

export function scanVector(scanHint: string | null) {
  const hint = scanHint?.toLowerCase() ?? "";
  const direction = new THREE.Vector3();
  if (hint.includes("north")) direction.z -= 1;
  if (hint.includes("south")) direction.z += 1;
  if (hint.includes("east")) direction.x += 1;
  if (hint.includes("west")) direction.x -= 1;
  return direction.lengthSq() ? direction.normalize() : new THREE.Vector3(0, 0, -1);
}

export function OutpostRun3D({ gridSize, row, column, visibleCells, objective, intensity, scanHint, shieldArmed, active, disabled, motionRunning, onMove }: OutpostRun3DProps) {
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
    renderer.domElement.dataset.dznOutpostRunIntensity = intensity;
    renderer.domElement.dataset.dznOutpostRunShield = shieldArmed ? "armed" : "offline";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0x77c4c8, 0x030809, 1.8));
    const moon = new THREE.DirectionalLight(0x8ce6df, 2.2);
    moon.position.set(-7, 11, 3);
    scene.add(moon);
    const objectiveColor = objective === "beacon" ? 0xffdc6f : objective === "cache" ? 0xff995f : 0x5cf8e0;
    const threatColor = intensity === "blackout" ? 0xee5c9b : intensity === "pressure" ? 0xffa45d : 0x4ad6d0;
    const signalLight = new THREE.PointLight(objectiveColor, 10, 18, 1.5);
    signalLight.position.set(0, 4.8, 0);
    scene.add(signalLight);
    const weatherLight = new THREE.PointLight(threatColor, intensity === "calibration" ? 1.2 : 3.4, 15, 1.8);
    weatherLight.position.set(-3.8, 2.5, -2.9);
    scene.add(weatherLight);

    const disposables: Array<{ dispose: () => void }> = [];
    const materials: Array<{ dispose: () => void }> = [];
    const landscape = new THREE.Group();
    scene.add(landscape);
    const fieldGeometry = new THREE.CircleGeometry(6.75, 12);
    const fieldMaterial = new THREE.MeshStandardMaterial({ color: 0x123940, emissive: 0x081c24, emissiveIntensity: 0.9, roughness: 0.93, metalness: 0.12 });
    disposables.push(fieldGeometry); materials.push(fieldMaterial);
    const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.35;
    landscape.add(field);
    const ridgeGeometry = new THREE.DodecahedronGeometry(0.8, 0);
    const ridgeMaterial = new THREE.MeshStandardMaterial({ color: 0x163941, emissive: 0x07171d, emissiveIntensity: 0.6, roughness: 0.9, metalness: 0.2 });
    const contourGeometry = new THREE.TorusGeometry(0.95, 0.012, 4, 36);
    const contourMaterial = new THREE.MeshBasicMaterial({ color: 0x4bcfc8, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    disposables.push(ridgeGeometry, contourGeometry); materials.push(ridgeMaterial, contourMaterial);
    for (const [x, z, scale] of [[-4.3, -2.7, 1.2], [4.2, -2.5, 1.32], [-3.9, 3.2, 0.82], [3.8, 3.3, 0.96]] as const) {
      const ridge = new THREE.Mesh(ridgeGeometry, ridgeMaterial);
      ridge.position.set(x, -0.03 + scale * 0.22, z);
      ridge.scale.set(scale * 1.3, scale * 0.8, scale);
      ridge.rotation.set(x * 0.12, z * 0.2, x * 0.09);
      landscape.add(ridge);
      const contour = new THREE.Mesh(contourGeometry, contourMaterial);
      contour.rotation.x = -Math.PI / 2;
      contour.position.set(x, -0.29, z);
      contour.scale.setScalar(scale * 1.12);
      landscape.add(contour);
    }
    const board = new THREE.Group();
    board.rotation.y = -0.27;
    board.scale.setScalar(1);
    scene.add(board);

    const terrainGeometry = new THREE.BoxGeometry(1, 0.3, 1);
    const edgeGeometry = new THREE.EdgesGeometry(terrainGeometry);
    const fogGeometry = new THREE.IcosahedronGeometry(0.31, 1);
    const hazardGeometry = new THREE.ConeGeometry(0.14, 0.54, 4);
    const markerRingGeometry = new THREE.TorusGeometry(0.22, 0.022, 6, 28);
    const towerGeometry = new THREE.CylinderGeometry(0.052, 0.11, 0.76, 8);
    const foundationGeometry = new THREE.CylinderGeometry(0.26, 0.31, 0.11, 8);
    const relayDishGeometry = new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const cacheGeometry = new THREE.BoxGeometry(0.48, 0.28, 0.42);
    const roverBodyGeometry = new THREE.BoxGeometry(0.46, 0.16, 0.58);
    const roverCabGeometry = new THREE.BoxGeometry(0.28, 0.17, 0.27);
    const roverTrackGeometry = new THREE.BoxGeometry(0.11, 0.12, 0.54);
    const roverWheelGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.075, 10);
    const roverDishGeometry = new THREE.TorusGeometry(0.13, 0.018, 6, 20);
    const shieldGeometry = new THREE.SphereGeometry(0.56, 18, 12);
    const scannerGeometry = new THREE.RingGeometry(0.44, 0.47, 42);
    const scannerNeedleGeometry = new THREE.BoxGeometry(0.045, 0.02, 0.78);
    disposables.push(terrainGeometry, edgeGeometry, fogGeometry, hazardGeometry, markerRingGeometry, towerGeometry, foundationGeometry, relayDishGeometry, cacheGeometry, roverBodyGeometry, roverCabGeometry, roverTrackGeometry, roverWheelGeometry, roverDishGeometry, shieldGeometry, scannerGeometry, scannerNeedleGeometry);

    const clickable: THREE.Mesh[] = [];
    const tileGroups = new Map<string, THREE.Group>();
    const tileMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const tileLights = new Map<string, THREE.PointLight>();
    const fogBanks: THREE.Group[] = [];
    const signalRings: THREE.Mesh[] = [];
    const half = (gridSize - 1) / 2;
    for (const cell of cells) {
      const key = cellKey(cell.row, cell.column);
      const group = new THREE.Group();
      const x = (cell.column - half) * 1.14;
      const z = (cell.row - half) * 1.14;
      const elevation = (((cell.row * 7) + (cell.column * 11)) % 5) * 0.048;
      group.position.set(x, elevation, z);
      board.add(group);
      tileGroups.set(key, group);
      const palette = paletteFor(cell.kind);
      const tileMaterial = new THREE.MeshStandardMaterial({ color: palette.tile, emissive: palette.emissive, emissiveIntensity: cell.kind === "unknown" ? 0.32 : 0.48, roughness: 0.72, metalness: 0.29 });
      materials.push(tileMaterial); tileMaterials.set(key, tileMaterial);
      const tile = new THREE.Mesh(terrainGeometry, tileMaterial);
      tile.scale.y = 0.82 + elevation * 2.4;
      tile.position.y = -0.15 * tile.scale.y;
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
        const fogBank = new THREE.Group();
        const fogMaterial = new THREE.MeshStandardMaterial({ color: 0x285d67, emissive: 0x103840, emissiveIntensity: 0.86, transparent: true, opacity: 0.46, roughness: 0.38, metalness: 0.1 });
        materials.push(fogMaterial);
        for (const [offsetX, offsetZ, scale] of [[-0.2, -0.08, 0.9], [0.18, 0.05, 1.12], [0.04, 0.22, 0.76]] as const) {
          const fog = new THREE.Mesh(fogGeometry, fogMaterial);
          fog.position.set(offsetX, 0.19 + scale * 0.09, offsetZ);
          fog.scale.set(scale * 1.25, scale * 0.58, scale);
          fogBank.add(fog);
        }
        group.add(fogBank);
        fogBanks.push(fogBank);
      }
      if (cell.kind === "hazard") {
        const hazardField = new THREE.Group();
        const hazardMaterial = new THREE.MeshStandardMaterial({ color: 0xc84e31, emissive: 0x76190e, emissiveIntensity: 0.78, roughness: 0.44, metalness: 0.42 });
        materials.push(hazardMaterial);
        for (const [offsetX, offsetZ, rotation, scale] of [[0, 0, 0.75, 1], [-0.2, 0.13, 1.8, 0.68], [0.18, -0.15, -0.3, 0.78]] as const) {
          const hazard = new THREE.Mesh(hazardGeometry, hazardMaterial);
          hazard.position.set(offsetX, 0.22, offsetZ); hazard.rotation.y = rotation; hazard.scale.setScalar(scale); hazardField.add(hazard);
        }
        const hazardLight = new THREE.PointLight(0xff8052, 0.58, 1.4, 2);
        hazardLight.position.y = 0.32;
        hazardField.add(hazardLight);
        group.add(hazardField);
      }
      if (cell.kind === "beacon") {
        const structure = new THREE.Group();
        const foundation = new THREE.Mesh(foundationGeometry, new THREE.MeshStandardMaterial({ color: 0x3b3218, emissive: 0x362807, emissiveIntensity: 0.72, roughness: 0.52, metalness: 0.47 }));
        const tower = new THREE.Mesh(towerGeometry, new THREE.MeshStandardMaterial({ color: 0xffda68, emissive: 0xffb52d, emissiveIntensity: 1.45, roughness: 0.22, metalness: 0.65 }));
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffb6, transparent: true, opacity: 0.94 }));
        const ring = new THREE.Mesh(markerRingGeometry, new THREE.MeshBasicMaterial({ color: 0xffe78b, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
        materials.push(foundation.material, tower.material, crown.material, ring.material);
        foundation.position.y = 0.01; tower.position.y = 0.42; crown.position.y = 0.83; ring.position.y = 0.75; ring.rotation.x = Math.PI / 2;
        structure.add(foundation, tower, crown, ring, new THREE.PointLight(0xffcf5a, 1.25, 2.4, 2));
        group.add(structure); signalRings.push(ring);
      }
      if (cell.kind === "cache") {
        const structure = new THREE.Group();
        const crate = new THREE.Mesh(cacheGeometry, new THREE.MeshStandardMaterial({ color: 0x6c3d20, emissive: 0x4d1d0a, emissiveIntensity: 0.82, roughness: 0.48, metalness: 0.55 }));
        const latch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.045), new THREE.MeshStandardMaterial({ color: 0xffc468, emissive: 0xa94d12, emissiveIntensity: 1.35, roughness: 0.24, metalness: 0.7 }));
        const ring = new THREE.Mesh(markerRingGeometry, new THREE.MeshBasicMaterial({ color: 0xffae68, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false }));
        materials.push(crate.material, latch.material, ring.material);
        crate.position.y = 0.16; latch.position.set(0, 0.2, 0.235); ring.position.y = 0.45; ring.rotation.x = Math.PI / 2;
        structure.add(crate, latch, ring, new THREE.PointLight(0xffa25e, 1.12, 2.2, 2));
        group.add(structure); signalRings.push(ring);
      }
      if (cell.kind === "relay") {
        const structure = new THREE.Group();
        const foundation = new THREE.Mesh(foundationGeometry, new THREE.MeshStandardMaterial({ color: 0x123e3c, emissive: 0x0b4d48, emissiveIntensity: 1.0, roughness: 0.44, metalness: 0.6 }));
        const mast = new THREE.Mesh(towerGeometry, new THREE.MeshStandardMaterial({ color: 0x75ffe7, emissive: 0x38d5c0, emissiveIntensity: 1.7, roughness: 0.19, metalness: 0.7 }));
        const dish = new THREE.Mesh(relayDishGeometry, new THREE.MeshStandardMaterial({ color: 0x94fff2, emissive: 0x2cb39f, emissiveIntensity: 1.15, roughness: 0.23, metalness: 0.72, side: THREE.DoubleSide }));
        const ring = new THREE.Mesh(markerRingGeometry, new THREE.MeshBasicMaterial({ color: 0x72ffe9, transparent: true, opacity: 0.84, blending: THREE.AdditiveBlending, depthWrite: false }));
        materials.push(foundation.material, mast.material, dish.material, ring.material);
        foundation.position.y = 0.01; mast.position.y = 0.4; dish.position.set(0, 0.79, 0); dish.rotation.x = -0.95; ring.position.y = 0.58; ring.rotation.x = Math.PI / 2;
        structure.add(foundation, mast, dish, ring, new THREE.PointLight(0x65ffe8, 1.6, 2.7, 2));
        group.add(structure); signalRings.push(ring);
      }
    }

    const player = new THREE.Group();
    const roverMaterial = new THREE.MeshStandardMaterial({ color: 0xd8f6ee, emissive: 0x1fae9b, emissiveIntensity: 0.72, roughness: 0.31, metalness: 0.58 });
    const cabMaterial = new THREE.MeshStandardMaterial({ color: 0x164d56, emissive: 0x0a7d87, emissiveIntensity: 0.92, roughness: 0.18, metalness: 0.67 });
    const trackMaterial = new THREE.MeshStandardMaterial({ color: 0x1e3137, emissive: 0x071217, emissiveIntensity: 0.3, roughness: 0.76, metalness: 0.45 });
    const roverHaloMaterial = new THREE.MeshBasicMaterial({ color: 0x85fff2, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false });
    const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x85d8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
    materials.push(roverMaterial, cabMaterial, trackMaterial, roverHaloMaterial, shieldMaterial);
    const roverBody = new THREE.Mesh(roverBodyGeometry, roverMaterial);
    const roverCab = new THREE.Mesh(roverCabGeometry, cabMaterial);
    roverBody.position.y = 0.26; roverCab.position.set(0, 0.44, -0.05);
    player.add(roverBody, roverCab);
    for (const side of [-1, 1]) {
      const track = new THREE.Mesh(roverTrackGeometry, trackMaterial);
      track.position.set(side * 0.27, 0.17, 0.02);
      player.add(track);
      for (const offset of [-0.17, 0.17]) {
        const wheel = new THREE.Mesh(roverWheelGeometry, trackMaterial);
        wheel.rotation.z = Math.PI / 2; wheel.position.set(side * 0.33, 0.14, offset);
        player.add(wheel);
      }
    }
    const roverMast = new THREE.Mesh(towerGeometry, roverMaterial);
    const roverDish = new THREE.Mesh(roverDishGeometry, roverHaloMaterial);
    const roverHalo = new THREE.Mesh(markerRingGeometry, roverHaloMaterial);
    roverMast.scale.y = 0.47; roverMast.position.set(0, 0.6, 0.12); roverDish.position.set(0, 0.77, 0.12); roverDish.rotation.x = Math.PI / 2; roverHalo.position.y = 0.12; roverHalo.rotation.x = Math.PI / 2;
    player.add(roverMast, roverDish, roverHalo, new THREE.PointLight(0x75ffe8, 1.35, 2.5, 2));
    const shieldBubble = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shieldBubble.position.y = 0.44;
    shieldBubble.visible = shieldArmed;
    player.add(shieldBubble);
    board.add(player);

    const currentTile = tileGroups.get(cellKey(row, column));
    if (currentTile) player.position.copy(currentTile.position);

    const scanner = new THREE.Group();
    const scannerMaterial = new THREE.MeshBasicMaterial({ color: 0x99fff4, transparent: true, opacity: 0.56, blending: THREE.AdditiveBlending, depthWrite: false });
    materials.push(scannerMaterial);
    const scannerRing = new THREE.Mesh(scannerGeometry, scannerMaterial);
    const needle = new THREE.Mesh(scannerNeedleGeometry, scannerMaterial);
    const heading = scanVector(scanHint);
    scannerRing.rotation.x = -Math.PI / 2; scannerRing.position.y = 0.16;
    needle.position.set(heading.x * 0.37, 0.18, heading.z * 0.37);
    needle.rotation.y = Math.atan2(heading.x, heading.z);
    scanner.add(scannerRing, needle); board.add(scanner);
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
        light.intensity = key === playerKey ? 1.7 : adjacent && active ? 0.42 : cell.kind === "relay" || cell.kind === "beacon" || cell.kind === "cache" ? 0.9 : 0;
      }
      scanner.visible = Boolean(scanHint);
      scannerMaterial.opacity = scanHint ? 0.58 : 0;
      signalLight.intensity = intensity === "blackout" ? 12.6 : intensity === "pressure" ? 10.8 : 9.2;
      weatherLight.intensity = intensity === "blackout" ? 4.8 : intensity === "pressure" ? 3.6 : 1.2;
      signalRings.forEach((ring, index) => {
        ring.scale.setScalar(index % 2 ? 0.96 : 1.04);
      });
      shieldBubble.visible = shieldArmed;
      shieldMaterial.opacity = shieldArmed ? 0.1 + (motionRunning ? (Math.sin(seconds * 3.4) + 1) * 0.035 : 0.04) : 0;
      shieldBubble.scale.setScalar(shieldArmed && motionRunning ? 1 + Math.sin(seconds * 2.7) * 0.05 : 1);
      if (motionRunning) {
        board.rotation.y = -0.27 + Math.sin(seconds * 0.24) * 0.025;
        roverBody.position.y = 0.26 + Math.sin(seconds * 2.8) * 0.024;
        roverCab.position.y = 0.44 + Math.sin(seconds * 2.8) * 0.024;
        roverDish.rotation.z = seconds * 1.35;
        roverHalo.rotation.z = seconds * 1.65;
        scanner.scale.setScalar(1 + Math.sin(seconds * 2.4) * 0.1);
        scannerMaterial.opacity = scanHint ? 0.45 + Math.sin(seconds * 3.1) * 0.18 : 0;
        signalLight.intensity += Math.sin(seconds * 2.2) * 2.2;
        weatherLight.intensity += Math.sin(seconds * 1.4) * 0.7;
        signalRings.forEach((ring, index) => {
          ring.rotation.z = seconds * (0.7 + index * 0.11);
          ring.scale.setScalar(1 + Math.sin(seconds * 2.1 + index) * 0.08);
        });
        fogBanks.forEach((bank, index) => {
          bank.position.y = Math.sin(seconds * 0.8 + index) * 0.035;
          bank.rotation.y = Math.sin(seconds * 0.45 + index) * 0.12;
        });
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
  }, [active, column, gridSize, intensity, motionRunning, objective, row, scanHint, shieldArmed, visibleCells]);

  return <div ref={mountRef} className="dzn-outpost-run-3d" data-live={active ? "true" : "false"} data-objective={objective} />;
}
