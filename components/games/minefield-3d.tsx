"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { GameView } from "@/lib/games-hub";

type Minefield3DProps = {
  game: GameView;
  tool: "reveal" | "flag";
  disabled: boolean;
  motionRunning: boolean;
  onMove: (x: number, y: number, tool: "reveal" | "flag") => void;
};

const TILE_COLORS = {
  hidden: 0x12323a,
  flag: 0xd59a32,
  mine: 0xe04444,
  open: 0x17313a,
};

export function Minefield3D({ game, tool, disabled, motionRunning, onMove }: Minefield3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef(onMove);
  const toolRef = useRef(tool);
  const disabledRef = useRef(disabled);

  useEffect(() => { moveRef.current = onMove; }, [onMove]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") return;

    const size = game.cells.length;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03080d);
    scene.fog = new THREE.FogExp2(0x03080d, 0.026);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180);
    camera.position.set(size * 0.74, size * 0.9, size * 0.98);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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

    const grid = new THREE.GridHelper(size + 0.3, size, 0x27e8ff, 0x17343e);
    grid.position.y = -0.14;
    field.add(grid);

    const tileGeometry = new THREE.BoxGeometry(0.82, 0.18, 0.82);
    const tileMeshes: THREE.Mesh[] = [];
    const labelTextures: THREE.Texture[] = [];
    const tileMaterials: THREE.Material[] = [];
    const markerGeometries: THREE.BufferGeometry[] = [];
    const markerMaterials: THREE.Material[] = [];

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
        tile.userData = { x, y, selectable: value === "hidden" || value === "flag" };
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

    const scanMaterial = new THREE.MeshBasicMaterial({ color: 0x3cecff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
    const scanGeometry = new THREE.PlaneGeometry(size, 0.12);
    const scan = new THREE.Mesh(scanGeometry, scanMaterial);
    scan.rotation.x = -Math.PI / 2;
    scan.position.set(0, 0.25, -size / 2);
    field.add(scan);

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

    function hitTile(event: PointerEvent) {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(tileMeshes, false).find(hit => hit.object.userData.selectable)?.object as THREE.Mesh | undefined;
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
      const tile = hitTile(event as PointerEvent);
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
      tileGeometry.dispose(); scanGeometry.dispose(); platform.geometry.dispose();
      tileMaterials.forEach(material => material.dispose()); markerMaterials.forEach(material => material.dispose());
      markerGeometries.forEach(geometry => geometry.dispose()); labelTextures.forEach(texture => texture.dispose());
      (platform.material as THREE.Material).dispose(); scanMaterial.dispose(); renderer.dispose(); renderer.domElement.remove();
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
