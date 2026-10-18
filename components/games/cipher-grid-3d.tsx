"use client";

import { useEffect, useRef } from "react";
import * as ThreeModule from "three";
import type { CipherGridDifficulty } from "@/lib/games-cipher-grid";

// Three's recursive declarations can exceed the TypeScript checker stack in this client bundle.
/* eslint-disable @typescript-eslint/no-explicit-any */
const THREE: any = ThreeModule;

type CipherGrid3DProps = {
  difficulty: CipherGridDifficulty;
  attempts: number;
  solvedGlyphs: number;
  active: boolean;
  motionRunning: boolean;
  onUnavailable: () => void;
};

function glyphTexture(label: string, colour: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.fillStyle = "#06131a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = colour;
  context.globalAlpha = 0.85;
  context.lineWidth = 5;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.globalAlpha = 1;
  context.fillStyle = colour;
  context.textAlign = "center";
  context.font = "700 54px monospace";
  context.fillText(label, 128, 95);
  context.font = "700 14px monospace";
  context.globalAlpha = 0.78;
  context.fillText("DZN // CRYPT", 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function CipherGrid3D({ difficulty, attempts, solvedGlyphs, active, motionRunning, onUnavailable }: CipherGrid3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const unavailableRef = useRef(onUnavailable);
  const renderRef = useRef<(() => void) | null>(null);
  const applyStateRef = useRef<((state: { difficulty: CipherGridDifficulty; attempts: number; solvedGlyphs: number; active: boolean }) => void) | null>(null);
  const stateRef = useRef({ difficulty, attempts, solvedGlyphs, active });

  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);
  useEffect(() => {
    const next = { difficulty, attempts, solvedGlyphs, active };
    stateRef.current = next;
    applyStateRef.current?.(next);
    renderRef.current?.();
  }, [active, attempts, difficulty, solvedGlyphs]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") { unavailableRef.current(); return; }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(7.2, 5.7, 8.8);
    camera.lookAt(0, 0.45, 0);
    let renderer: any;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); }
    catch { unavailableRef.current(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.domElement.dataset.dznCipherGridCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: any[] = [];
    const materials: any[] = [];
    const textures: any[] = [];
    const cleanupResources = () => { geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose()); renderer.dispose(); };
    const state = stateRef.current;
    const signalColour = state.difficulty === "specialist" ? 0xf1bb61 : 0x6fe9dc;
    scene.add(new THREE.HemisphereLight(0xc7fbff, 0x071015, 2.4));
    const key = new THREE.DirectionalLight(0x9eeeff, 2.3); key.position.set(-4, 7, 5); scene.add(key);
    const cipherLight = new THREE.PointLight(signalColour, 14, 14, 1.8); cipherLight.position.set(0, 3.2, 0); scene.add(cipherLight);
    const rimLight = new THREE.PointLight(0x966cff, 7, 14, 1.8); rimLight.position.set(-3.8, 2.2, 2.6); scene.add(rimLight);

    const deck = new THREE.Group();
    deck.rotation.y = -0.13;
    scene.add(deck);
    const floorGeometry = new THREE.CylinderGeometry(4.9, 5.25, 0.24, 10);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x0c2229, emissive: 0x06171c, emissiveIntensity: 0.9, metalness: 0.87, roughness: 0.22 });
    geometries.push(floorGeometry); materials.push(floorMaterial);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial); floor.position.y = -0.36; deck.add(floor);

    const ringGeometry = new THREE.TorusGeometry(4.1, 0.035, 6, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: signalColour, transparent: true, opacity: 0.46, blending: THREE.AdditiveBlending, depthWrite: false });
    geometries.push(ringGeometry); materials.push(ringMaterial);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.rotation.x = Math.PI / 2; ring.position.y = -0.18; deck.add(ring);

    const core = new THREE.Group();
    const coreBaseGeometry = new THREE.CylinderGeometry(0.66, 0.84, 0.3, 8);
    const coreBodyGeometry = new THREE.OctahedronGeometry(0.57, 1);
    const coreBaseMaterial = new THREE.MeshStandardMaterial({ color: 0x18323a, emissive: 0x0a2228, emissiveIntensity: 1.05, metalness: 0.86, roughness: 0.16 });
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0xcafaff, emissive: signalColour, emissiveIntensity: 1.6, metalness: 0.52, roughness: 0.13 });
    geometries.push(coreBaseGeometry, coreBodyGeometry); materials.push(coreBaseMaterial, coreMaterial);
    const coreBase = new THREE.Mesh(coreBaseGeometry, coreBaseMaterial); coreBase.position.y = 0; core.add(coreBase);
    const coreBody = new THREE.Mesh(coreBodyGeometry, coreMaterial); coreBody.position.y = 0.72; core.add(coreBody);
    const coreHaloGeometry = new THREE.TorusGeometry(0.72, 0.026, 6, 42);
    const coreHaloMaterial = new THREE.MeshBasicMaterial({ color: signalColour, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false });
    geometries.push(coreHaloGeometry); materials.push(coreHaloMaterial);
    const coreHalos = [0.32, 0.88].map((height, index) => {
      const halo = new THREE.Mesh(coreHaloGeometry, coreHaloMaterial);
      halo.position.y = height;
      halo.rotation.x = Math.PI / 2;
      halo.rotation.z = index ? Math.PI / 2 : 0;
      core.add(halo);
      return halo;
    });
    deck.add(core);

    const pylonGeometry = new THREE.BoxGeometry(0.22, 2.45, 0.22);
    const pylonCapGeometry = new THREE.OctahedronGeometry(0.28, 0);
    const pylonMaterial = new THREE.MeshStandardMaterial({ color: 0x234148, emissive: 0x0c2a31, emissiveIntensity: 0.78, metalness: 0.85, roughness: 0.2 });
    const pylonGlowMaterial = new THREE.MeshBasicMaterial({ color: 0x6fe9dc, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    geometries.push(pylonGeometry, pylonCapGeometry); materials.push(pylonMaterial, pylonGlowMaterial);
    const pylons: any[] = [];
    for (const [index, angle] of [0.2, 2.3, 4.36].entries()) {
      const group = new THREE.Group();
      group.position.set(Math.sin(angle) * 3.3, 0.86, Math.cos(angle) * 3.3);
      const pylon = new THREE.Mesh(pylonGeometry, pylonMaterial); group.add(pylon);
      const cap = new THREE.Mesh(pylonCapGeometry, pylonGlowMaterial); cap.position.y = 1.45; group.add(cap);
      group.userData.index = index;
      pylons.push({ group, cap });
      deck.add(group);
    }

    const cardGeometry = new THREE.PlaneGeometry(1.15, 0.72);
    geometries.push(cardGeometry);
    const cards: any[] = [];
    for (let index = 0; index < 5; index++) {
      const texture = glyphTexture(["//", "01", "X", "##", "DZN"][index], index % 2 ? "#ad91ff" : "#77f3e3");
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending, depthWrite: false });
      textures.push(texture); materials.push(material);
      const card = new THREE.Mesh(cardGeometry, material);
      const angle = (index / 5) * Math.PI * 2 + 0.18;
      card.position.set(Math.sin(angle) * 2.7, 1.0 + (index % 2) * 0.45, Math.cos(angle) * 2.7);
      card.lookAt(0, 1, 0);
      card.userData = { angle, offset: index * 0.8, material, baseY: card.position.y, baseRotationY: card.rotation.y };
      cards.push(card);
      deck.add(card);
    }

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(72 * 3);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 17) % 17) * 0.45 - 3.6;
      particlePositions[index + 1] = ((sample * 7) % 19) * 0.12 + 0.1;
      particlePositions[index + 2] = ((sample * 29) % 17) * 0.45 - 3.6;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: signalColour, size: 0.035, transparent: true, opacity: 0.52, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial); deck.add(particles);

    const applyState = (next: { difficulty: CipherGridDifficulty; attempts: number; solvedGlyphs: number; active: boolean }) => {
      const nextColour = next.difficulty === "specialist" ? 0xf1bb61 : 0x6fe9dc;
      cipherLight.color.setHex(nextColour);
      ringMaterial.color.setHex(nextColour);
      coreMaterial.emissive.setHex(nextColour);
      coreHaloMaterial.color.setHex(nextColour);
      particleMaterial.color.setHex(nextColour);
      const progress = Math.min(1, (next.solvedGlyphs + next.attempts * 0.25) / (next.difficulty === "specialist" ? 6 : 5));
      coreMaterial.emissiveIntensity = next.active ? 1.2 + progress * 1.8 : 0.58;
      coreHaloMaterial.opacity = next.active ? 0.44 + progress * 0.46 : 0.22;
      particleMaterial.opacity = next.active ? 0.34 + progress * 0.34 : 0.2;
      cards.forEach((card, index) => { card.userData.material.opacity = next.active ? 0.46 + Math.min(0.42, progress + index * 0.03) : 0.24; });
      pylons.forEach(({ cap }, index) => { cap.material = index < Math.max(1, next.solvedGlyphs) ? coreHaloMaterial : pylonGlowMaterial; });
    };
    applyStateRef.current = applyState;
    applyState(state);
    const render = () => renderer.render(scene, camera);
    renderRef.current = render;
    const resize = new ResizeObserver(entries => {
      const width = Math.max(1, entries[0]?.contentRect.width ?? mount.clientWidth);
      const height = Math.max(1, entries[0]?.contentRect.height ?? mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(mount);
    if (!motionRunning) { render(); return () => { resize.disconnect(); applyStateRef.current = null; renderRef.current = null; mount.removeChild(renderer.domElement); cleanupResources(); }; }
    const startedAt = performance.now();
    let frame = 0;
    const animate = (time: number) => {
      const elapsed = (time - startedAt) / 1000;
      deck.rotation.y = -0.13 + Math.sin(elapsed * 0.22) * 0.055;
      ring.rotation.z = elapsed * 0.14;
      coreBody.rotation.y = elapsed * 0.75;
      coreHalos.forEach((halo, index) => { halo.rotation.z = elapsed * (index ? -0.85 : 0.64); });
      cards.forEach(card => { card.position.y = card.userData.baseY + Math.sin(elapsed * 1.35 + card.userData.offset) * 0.12; card.rotation.y = card.userData.baseRotationY + Math.sin(elapsed * 0.65 + card.userData.offset) * 0.24; });
      pylons.forEach(({ cap }, index) => { cap.position.y = 1.45 + Math.sin(elapsed * 1.7 + index) * 0.07; });
      particles.rotation.y = elapsed * 0.045;
      render();
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => { window.cancelAnimationFrame(frame); resize.disconnect(); applyStateRef.current = null; renderRef.current = null; mount.removeChild(renderer.domElement); cleanupResources(); };
  }, [motionRunning]);

  return <div ref={mountRef} className="dzn-cipher-grid-3d" aria-hidden="true" />;
}
