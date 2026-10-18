"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type WordChain3DProps = {
  active: boolean;
  turn: number;
  motionRunning: boolean;
  onUnavailable: () => void;
};

export function WordChain3D({ active, turn, motionRunning, onUnavailable }: WordChain3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef({ active, turn });
  const unavailableRef = useRef(onUnavailable);
  const applyStateRef = useRef<((state: { active: boolean; turn: number }) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    gameStateRef.current = { active, turn };
    applyStateRef.current?.({ active, turn });
    renderRef.current?.();
  }, [active, turn]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (typeof WebGLRenderingContext === "undefined") {
      unavailableRef.current();
      return;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x061117, 0.052);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(6.8, 4.6, 9.4);
    camera.lookAt(0, 0.2, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      unavailableRef.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.dataset.dznWordChainCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const dispose = () => {
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      renderer.dispose();
    };

    scene.add(new THREE.HemisphereLight(0x74ddef, 0x081013, 1.85));
    const key = new THREE.DirectionalLight(0xffc27a, 2.5);
    key.position.set(-4, 8, 5);
    scene.add(key);
    const relayLight = new THREE.PointLight(0x4cead1, 11, 13, 1.8);
    relayLight.position.set(0, 2.4, 0.8);
    scene.add(relayLight);
    const warningLight = new THREE.PointLight(0xffa14c, 7, 10, 2);
    warningLight.position.set(-3.4, 1.5, 1.8);
    scene.add(warningLight);

    const deck = new THREE.Group();
    deck.rotation.y = -0.12;
    scene.add(deck);

    const tableGeometry = new THREE.CylinderGeometry(4.6, 4.9, 0.34, 48);
    const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x07171b, metalness: 0.82, roughness: 0.34 });
    geometries.push(tableGeometry); materials.push(tableMaterial);
    const table = new THREE.Mesh(tableGeometry, tableMaterial);
    table.position.y = -0.56;
    deck.add(table);

    const trimGeometry = new THREE.TorusGeometry(4.38, 0.045, 8, 48);
    const trimMaterial = new THREE.MeshBasicMaterial({ color: 0x48d9cc, transparent: true, opacity: 0.7 });
    geometries.push(trimGeometry); materials.push(trimMaterial);
    const trim = new THREE.Mesh(trimGeometry, trimMaterial);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = -0.37;
    deck.add(trim);

    const coreGeometry = new THREE.IcosahedronGeometry(0.58, 2);
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x2ae1cc, emissive: 0x0b756f, emissiveIntensity: 1.65, metalness: 0.82, roughness: 0.18 });
    geometries.push(coreGeometry); materials.push(coreMaterial);
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.position.y = 0.62;
    deck.add(core);

    const ringGeometry = new THREE.TorusGeometry(1.08, 0.035, 8, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x8cfbf1, transparent: true, opacity: 0.76 });
    geometries.push(ringGeometry); materials.push(ringMaterial);
    const rings: THREE.Mesh[] = [];
    for (const [index, rotation] of [[0.7, 0.15, -0.25], [-0.62, 0.48, 0.2], [0.12, -0.72, 0.46]].entries()) {
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.y = 0.62;
      ring.rotation.set(rotation[0], rotation[1], rotation[2]);
      ring.userData.offset = index * 0.75;
      deck.add(ring);
      rings.push(ring);
    }

    const pylonGeometry = new THREE.BoxGeometry(0.22, 1.25, 0.22);
    const pylonMaterial = new THREE.MeshStandardMaterial({ color: 0x143337, emissive: 0x0c4344, emissiveIntensity: 0.7, metalness: 0.78, roughness: 0.25 });
    const capGeometry = new THREE.OctahedronGeometry(0.16, 1);
    const capMaterial = new THREE.MeshStandardMaterial({ color: 0x6df2e3, emissive: 0x127d74, emissiveIntensity: 1.8, metalness: 0.7, roughness: 0.18 });
    geometries.push(pylonGeometry, capGeometry); materials.push(pylonMaterial, capMaterial);
    const pylons: THREE.Mesh[] = [];
    for (let index = 0; index < 6; index++) {
      const angle = index / 6 * Math.PI * 2;
      const pylon = new THREE.Mesh(pylonGeometry, pylonMaterial);
      pylon.position.set(Math.cos(angle) * 2.75, 0.04, Math.sin(angle) * 2.75);
      deck.add(pylon);
      const cap = new THREE.Mesh(capGeometry, capMaterial);
      cap.position.copy(pylon.position);
      cap.position.y = 0.76;
      cap.userData.offset = index * 0.84;
      deck.add(cap);
      pylons.push(cap);
    }

    const tileGeometry = new THREE.BoxGeometry(1.02, 0.12, 0.72);
    const tileMaterials = [0x125861, 0x184852, 0x3b3c2b].map(color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.54, metalness: 0.74, roughness: 0.22 }));
    geometries.push(tileGeometry); materials.push(...tileMaterials);
    const tiles: THREE.Mesh[] = [];
    for (let index = 0; index < 8; index++) {
      const angle = -1.22 + index * 0.35;
      const tile = new THREE.Mesh(tileGeometry, tileMaterials[index % tileMaterials.length]);
      tile.position.set(Math.cos(angle) * 3.68, -0.23 + (index % 2) * 0.07, Math.sin(angle) * 3.68);
      tile.rotation.y = -angle + Math.PI / 2;
      tile.userData.offset = index * 0.44;
      deck.add(tile);
      tiles.push(tile);
    }

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(96 * 3);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 11) % 19) * 0.42 - 3.8;
      particlePositions[index + 1] = ((sample * 7) % 17) * 0.11 + 0.05;
      particlePositions[index + 2] = ((sample * 13) % 19) * 0.42 - 3.8;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0x86f9e9, size: 0.035, transparent: true, opacity: 0.58, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.position.y = -0.15;
    deck.add(particles);

    const applyState = (state: { active: boolean; turn: number }) => {
      const colour = state.active ? 0x4cead1 : 0x8caaa8;
      coreMaterial.color.setHex(colour);
      coreMaterial.emissive.setHex(state.active ? 0x117c75 : 0x17393a);
      coreMaterial.emissiveIntensity = state.active ? 1.82 : 0.72;
      ringMaterial.color.setHex(colour);
      ringMaterial.opacity = state.active ? 0.82 : 0.38;
      trimMaterial.color.setHex(state.active ? 0x55ead8 : 0x557270);
      particleMaterial.color.setHex(colour);
      particleMaterial.opacity = state.active ? 0.58 : 0.24;
      relayLight.intensity = state.active ? 12 + Math.min(5, state.turn * 0.2) : 3.2;
      tiles.forEach((tile, index) => {
        const material = tile.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = state.active ? 0.78 + (index + state.turn) % 3 * 0.14 : 0.22;
      });
    };
    applyStateRef.current = applyState;
    applyState(gameStateRef.current);
    const render = () => renderer.render(scene, camera);
    renderRef.current = render;
    let frame = 0;
    const resize = new ResizeObserver(entries => {
      const width = Math.max(1, entries[0]?.contentRect.width ?? mount.clientWidth);
      const height = Math.max(1, entries[0]?.contentRect.height ?? mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(mount);
    if (!motionRunning) {
      render();
      return () => {
        resize.disconnect();
        applyStateRef.current = null;
        renderRef.current = null;
        mount.removeChild(renderer.domElement);
        dispose();
      };
    }
    const startedAt = performance.now();
    const animate = (time: number) => {
      const elapsed = (time - startedAt) / 1000;
      deck.rotation.y = -0.12 + Math.sin(elapsed * 0.2) * 0.05;
      core.rotation.y = elapsed * 0.82;
      core.position.y = 0.62 + Math.sin(elapsed * 1.55) * 0.08;
      rings.forEach((ring, index) => { ring.rotation.z += (index % 2 ? -1 : 1) * 0.008; });
      pylons.forEach(cap => { cap.position.y = 0.76 + Math.sin(elapsed * 1.8 + cap.userData.offset) * 0.07; });
      tiles.forEach(tile => { tile.position.y = -0.23 + Math.sin(elapsed * 1.15 + tile.userData.offset) * 0.035; });
      particles.rotation.y = elapsed * 0.045;
      render();
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      applyStateRef.current = null;
      renderRef.current = null;
      mount.removeChild(renderer.domElement);
      dispose();
    };
  }, [motionRunning]);

  return <div ref={mountRef} className="dzn-word-chain-3d" aria-hidden="true" />;
}
