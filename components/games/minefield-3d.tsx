"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { GameView } from "@/lib/games-hub";

type Minefield3DProps = {
  game: GameView;
  tool: "reveal" | "flag" | "scan";
  disabled: boolean;
  motionRunning: boolean;
  onMove: (x: number, y: number, tool: "reveal" | "flag" | "scan") => void;
  onUnsupported: () => void;
};

const TILE_COLORS = {
  hidden: 0x12323a,
  flag: 0xd59a32,
  mine: 0xe04444,
  open: 0x17313a,
};

export function Minefield3D({ game, tool, disabled, motionRunning, onMove, onUnsupported }: Minefield3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef(onMove);
  const toolRef = useRef(tool);
  const disabledRef = useRef(disabled);
  const unsupportedRef = useRef(onUnsupported);

  useEffect(() => { moveRef.current = onMove; }, [onMove]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { unsupportedRef.current = onUnsupported; }, [onUnsupported]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const showGridFallback = () => {
      mount.dataset.webglFallback = "true";
      unsupportedRef.current();
    };
    if (typeof WebGLRenderingContext === "undefined") {
      showGridFallback();
      return;
    }

    const size = game.cells.length;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02070b, 0.022);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180);
    camera.position.set(size * 0.74, size * 0.9, size * 0.98);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      showGridFallback();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.dataset.dznMinefieldCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xa7efff, 0x0a0d12, 1.35));
    const keyLight = new THREE.DirectionalLight(0xc8f7ff, 3.1);
    keyLight.position.set(-size * 0.35, size, size * 0.5);
    scene.add(keyLight);
    const warningLight = new THREE.PointLight(0xff4d6d, 18, size * 1.5, 1.8);
    warningLight.position.set(size * 0.35, 2.4, -size * 0.2);
    scene.add(warningLight);

    const field = new THREE.Group();
    field.rotation.y = -0.08;
    scene.add(field);

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(size + 1.2, 0.42, size + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x071319, metalness: 0.76, roughness: 0.48 }),
    );
    platform.position.y = -0.38;
    field.add(platform);

    const platformEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(platform.geometry),
      new THREE.LineBasicMaterial({ color: 0x4ae6ff, transparent: true, opacity: 0.55 }),
    );
    platformEdges.position.copy(platform.position);
    field.add(platformEdges);

    const grid = new THREE.GridHelper(size + 0.3, size, 0x27e8ff, 0x17343e);
    grid.position.y = -0.14;
    field.add(grid);

    const sectorBeacons = new THREE.Group();
    const beaconGeometry = new THREE.OctahedronGeometry(0.16, 1);
    const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0x6ff4ff, emissive: 0x087b95, emissiveIntensity: 1.6, metalness: 0.72, roughness: 0.25 });
    const beaconLights: THREE.PointLight[] = [];
    const beaconRadius = size * 0.63;
    for (const [index, [x, z]] of [[-1, -1], [1, -1], [1, 1], [-1, 1]].entries()) {
      const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
      beacon.position.set(x * beaconRadius, 0.25, z * beaconRadius);
      beacon.rotation.y = index * Math.PI / 4;
      sectorBeacons.add(beacon);
      const beaconLight = new THREE.PointLight(index % 2 ? 0xa66cff : 0x50ecff, 2.6, size * 0.86, 2);
      beaconLight.position.set(beacon.position.x, 0.38, beacon.position.z);
      field.add(beaconLight);
      beaconLights.push(beaconLight);
    }
    field.add(sectorBeacons);

    const tileGeometry = new THREE.BoxGeometry(0.82, 0.18, 0.82);
    const tileMeshes: THREE.Mesh[] = [];
    const labelTextures: THREE.Texture[] = [];
    const tileMaterials: THREE.Material[] = [];
    const markerGeometries: THREE.BufferGeometry[] = [];
    const markerMaterials: THREE.Material[] = [];

    const scanKeys = new Set(game.scans.map(scan => `${scan.x}:${scan.y}`));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const value = game.cells[y][x];
        const state = typeof value === "number" ? "open" : value;
        const material = new THREE.MeshStandardMaterial({
          color: TILE_COLORS[state],
          emissive: state === "hidden" ? 0x06232b : state === "open" ? 0x05252e : TILE_COLORS[state],
          emissiveIntensity: state === "mine" ? 1.15 : state === "flag" ? 0.54 : 0.2,
          metalness: state === "hidden" ? 0.72 : 0.4,
          roughness: state === "hidden" ? 0.34 : 0.58,
        });
        tileMaterials.push(material);
        const tile = new THREE.Mesh(tileGeometry, material);
        tile.position.set(x - (size - 1) / 2, value === "hidden" || value === "flag" ? 0.04 : -0.03, y - (size - 1) / 2);
        tile.userData = { x, y, state, selectable: value === "hidden" || value === "flag", scanUsed: scanKeys.has(`${x}:${y}`) };
        field.add(tile);
        tileMeshes.push(tile);

        if (typeof value === "number" && value > 0) {
          const texture = numberTexture(value);
          labelTextures.push(texture);
          const numberMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
          markerMaterials.push(numberMaterial);
          const sprite = new THREE.Sprite(numberMaterial);
          sprite.position.set(tile.position.x, 0.28, tile.position.z);
          sprite.scale.set(0.48, 0.48, 0.48);
          field.add(sprite);
        } else if (value === "flag") {
          const poleGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.46, 8);
          const flagGeometry = new THREE.ConeGeometry(0.2, 0.42, 3);
          const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xffcf5b, emissive: 0x9a4d00, emissiveIntensity: 0.7 });
          markerGeometries.push(poleGeometry, flagGeometry); markerMaterials.push(markerMaterial);
          const pole = new THREE.Mesh(poleGeometry, markerMaterial); pole.position.set(tile.position.x, 0.34, tile.position.z); field.add(pole);
          const marker = new THREE.Mesh(flagGeometry, markerMaterial); marker.rotation.z = -Math.PI / 2; marker.position.set(tile.position.x + 0.13, 0.53, tile.position.z); field.add(marker);
        } else if (value === "mine") {
          const mineGeometry = new THREE.IcosahedronGeometry(0.27, 1);
          const mineMaterial = new THREE.MeshStandardMaterial({ color: 0x2b0508, emissive: 0xff203d, emissiveIntensity: 1.45, metalness: 0.65, roughness: 0.26 });
          markerGeometries.push(mineGeometry); markerMaterials.push(mineMaterial);
          const mine = new THREE.Mesh(mineGeometry, mineMaterial); mine.position.set(tile.position.x, 0.28, tile.position.z); field.add(mine);
        }
      }
    }

    const scanMarkers = new THREE.Group();
    const scanMarkerGeometry = new THREE.RingGeometry(0.24, 0.29, 32);
    const scanMarkerMaterials: THREE.MeshBasicMaterial[] = [];
    for (const scan of game.scans) {
      const intensity = scan.threats / 9;
      const color = intensity > 0.55 ? 0xff8a57 : intensity > 0.22 ? 0xffd166 : 0x4cf4d8;
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      scanMarkerMaterials.push(material);
      const marker = new THREE.Mesh(scanMarkerGeometry, material);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(scan.x - (size - 1) / 2, 0.2, scan.y - (size - 1) / 2);
      marker.userData = { scan, seed: scan.x * 13 + scan.y * 7 };
      scanMarkers.add(marker);
    }
    field.add(scanMarkers);

    const drone = new THREE.Group();
    const droneBodyMaterial = new THREE.MeshStandardMaterial({ color: 0x182b34, emissive: 0x0b8fa9, emissiveIntensity: 1.1, metalness: 0.8, roughness: 0.22 });
    const droneGlowMaterial = new THREE.MeshBasicMaterial({ color: 0x66f5ff, transparent: true, opacity: 0.76, blending: THREE.AdditiveBlending, depthWrite: false });
    const droneBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.16, 12), droneBodyMaterial);
    droneBody.rotation.x = Math.PI / 2;
    drone.add(droneBody);
    const droneArmGeometry = new THREE.BoxGeometry(0.72, 0.025, 0.04);
    const droneArms = new THREE.Mesh(droneArmGeometry, droneBodyMaterial);
    droneArms.rotation.y = Math.PI / 4;
    drone.add(droneArms);
    const droneLens = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), droneGlowMaterial);
    droneLens.position.y = -0.1;
    drone.add(droneLens);
    const droneLight = new THREE.PointLight(0x50ecff, 3.8, size * 0.68, 2);
    drone.add(droneLight);
    const latestScan = game.scans[game.scans.length - 1];
    drone.position.set(latestScan ? latestScan.x - (size - 1) / 2 : 0, 1.2, latestScan ? latestScan.y - (size - 1) / 2 : 0);
    field.add(drone);

    const scanMaterial = new THREE.MeshBasicMaterial({ color: 0x3cecff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    const scanGeometry = new THREE.PlaneGeometry(size, 0.12);
    const scan = new THREE.Mesh(scanGeometry, scanMaterial);
    scan.rotation.x = -Math.PI / 2;
    scan.position.set(0, 0.25, -size / 2);
    field.add(scan);

    const scannerMaterial = new THREE.MeshBasicMaterial({ color: 0x42eaff, transparent: true, opacity: 0.23, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const scanner = new THREE.Mesh(new THREE.RingGeometry(size * 0.13, size * 0.15, 48), scannerMaterial);
    scanner.rotation.x = -Math.PI / 2;
    scanner.position.y = 0.18;
    field.add(scanner);

    const perimeterGeometry = new THREE.TorusGeometry(size * 0.67, 0.028, 8, 96);
    const perimeterMaterial = new THREE.MeshBasicMaterial({ color: 0x54eaff, transparent: true, opacity: 0.46, blending: THREE.AdditiveBlending, depthWrite: false });
    const perimeter = new THREE.Mesh(perimeterGeometry, perimeterMaterial);
    perimeter.rotation.x = -Math.PI / 2;
    perimeter.position.y = 0.08;
    field.add(perimeter);

    const driftGeometry = new THREE.BufferGeometry();
    const driftPositions = new Float32Array(210 * 3);
    for (let index = 0; index < driftPositions.length; index += 3) {
      const sample = index / 3;
      driftPositions[index] = ((sample * 31) % 23) - 11;
      driftPositions[index + 1] = 0.3 + ((sample * 17) % 29) * 0.1;
      driftPositions[index + 2] = ((sample * 19) % 25) - 12;
    }
    driftGeometry.setAttribute("position", new THREE.BufferAttribute(driftPositions, 3));
    const driftMaterial = new THREE.PointsMaterial({ color: 0x9cecff, size: 0.028, transparent: true, opacity: 0.48, depthWrite: false });
    const drift = new THREE.Points(driftGeometry, driftMaterial);
    scene.add(drift);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: THREE.Mesh | null = null;
    let pointerX = 0;
    let pointerY = 0;
    let frame = 0;

    function setPointer(event: PointerEvent) {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      pointerX = pointer.x;
      pointerY = pointer.y;
    }

    function hitTile(event: PointerEvent, action = toolRef.current) {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(tileMeshes, false).find(hit => {
        const tile = hit.object as THREE.Mesh;
        return tile.userData.selectable && (action !== "scan" || (tile.userData.state === "hidden" && !tile.userData.scanUsed));
      })?.object as THREE.Mesh | undefined;
    }

    function onPointerMove(event: PointerEvent) {
      const next = hitTile(event) ?? null;
      if (hovered !== next) {
        if (hovered) hovered.scale.setScalar(1);
        hovered = next;
        if (hovered) hovered.scale.setScalar(1.08);
      }
      renderer.domElement.style.cursor = next && !disabledRef.current ? "crosshair" : "default";
    }

    function onPointerLeave() {
      if (hovered) hovered.scale.setScalar(1);
      hovered = null;
      renderer.domElement.style.cursor = "default";
    }

    function onPointerUp(event: PointerEvent) {
      if (disabledRef.current || event.button !== 0) return;
      const tile = hitTile(event);
      if (tile) moveRef.current(tile.userData.x, tile.userData.y, toolRef.current);
    }

    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
      if (disabledRef.current) return;
      const tile = hitTile(event as PointerEvent, "flag");
      if (tile) moveRef.current(tile.userData.x, tile.userData.y, "flag");
    }

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const resize = new ResizeObserver(entries => {
      const width = Math.max(1, entries[0]?.contentRect.width ?? mount.clientWidth);
      const height = Math.max(1, entries[0]?.contentRect.height ?? mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
    resize.observe(mount);

    const start = performance.now();
    function render(time: number) {
      const elapsed = (time - start) / 1000;
      if (motionRunning) {
        field.rotation.y += ((-0.08 + pointerX * 0.035) - field.rotation.y) * 0.04;
        field.rotation.x += ((pointerY * -0.018) - field.rotation.x) * 0.04;
        scan.position.z = ((elapsed * 1.65) % (size + 1)) - size / 2;
        scanMaterial.opacity = 0.12 + Math.sin(elapsed * 2.4) * 0.05;
        warningLight.intensity = 16 + Math.sin(elapsed * 2.1) * 3;
        scanner.scale.setScalar(0.72 + ((Math.sin(elapsed * 2.1) + 1) * 0.16));
        scanner.rotation.z = elapsed * 0.4;
        scannerMaterial.opacity = 0.13 + Math.sin(elapsed * 2.1) * 0.08;
        perimeter.rotation.z = -elapsed * 0.18;
        perimeterMaterial.opacity = 0.3 + Math.sin(elapsed * 1.7) * 0.12;
        sectorBeacons.rotation.y = elapsed * 0.1;
        beaconLights.forEach((light, index) => { light.intensity = 1.9 + Math.sin(elapsed * 2.5 + index * 0.9) * 0.7; });
        drone.position.y = 1.04 + Math.sin(elapsed * 3.2) * 0.08;
        drone.rotation.y = elapsed * 0.76;
        droneLens.scale.setScalar(0.9 + Math.sin(elapsed * 4.8) * 0.12);
        scanMarkers.children.forEach((child) => {
          const marker = child as THREE.Mesh;
          const seed = marker.userData.seed as number;
          const pulse = 0.94 + Math.sin(elapsed * 2.8 + seed) * 0.12;
          marker.scale.setScalar(pulse);
          (marker.material as THREE.MeshBasicMaterial).opacity = 0.56 + Math.sin(elapsed * 2.2 + seed) * 0.2;
        });
        for (let index = 0; index < driftPositions.length; index += 3) {
          driftPositions[index] += 0.004 + ((index / 3) % 3) * 0.001;
          driftPositions[index + 2] += 0.007;
          if (driftPositions[index] > 12) driftPositions[index] = -12;
          if (driftPositions[index + 2] > 12) driftPositions[index + 2] = -12;
        }
        (driftGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
      renderer.render(scene, camera);
      renderer.domElement.dataset.renderFrames = String(Number(renderer.domElement.dataset.renderFrames ?? 0) + 1);
      if (motionRunning) frame = requestAnimationFrame(render);
    }
    render(performance.now());

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      tileGeometry.dispose(); scanGeometry.dispose(); scanner.geometry.dispose(); platform.geometry.dispose(); platformEdges.geometry.dispose(); beaconGeometry.dispose(); perimeterGeometry.dispose(); driftGeometry.dispose(); scanMarkerGeometry.dispose(); droneBody.geometry.dispose(); droneArmGeometry.dispose(); droneLens.geometry.dispose();
      tileMaterials.forEach(material => material.dispose()); markerMaterials.forEach(material => material.dispose());
      markerGeometries.forEach(geometry => geometry.dispose()); labelTextures.forEach(texture => texture.dispose()); scanMarkerMaterials.forEach(material => material.dispose());
      (platform.material as THREE.Material).dispose(); (platformEdges.material as THREE.Material).dispose(); beaconMaterial.dispose(); scanMaterial.dispose(); scannerMaterial.dispose(); perimeterMaterial.dispose(); driftMaterial.dispose(); droneBodyMaterial.dispose(); droneGlowMaterial.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [game, motionRunning]);

  return <div ref={mountRef} className="dzn-minefield-3d" data-game-id={game.id} data-game-version={game.version} />;
}

function numberTexture(value: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, 128, 128);
    context.fillStyle = value > 4 ? "#ff8095" : value > 2 ? "#ffd36a" : "#6ff4ff";
    context.font = "900 82px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = context.fillStyle;
    context.shadowBlur = 14;
    context.fillText(String(value), 64, 68);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
