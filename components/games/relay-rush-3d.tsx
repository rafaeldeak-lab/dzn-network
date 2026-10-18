"use client";

import { useEffect, useRef } from "react";
import * as ThreeModule from "three";
import type { RelayRushLane } from "@/lib/games-relay-rush";

// Three's declaration graph can exceed the TypeScript checker stack in this client bundle.
/* eslint-disable @typescript-eslint/no-explicit-any */
const THREE: any = ThreeModule;

type RelayRush3DProps = {
  intensity: string;
  targetLane: RelayRushLane | null;
  active: boolean;
  motionRunning: boolean;
  onUnavailable: () => void;
};

const LANES: RelayRushLane[] = ["left", "centre", "right"];

function palette(intensity: string) {
  if (intensity === "storm") return { primary: 0xf46da8, secondary: 0x6af5ff, floor: 0x211020, fog: 0x100813 };
  if (intensity === "overload") return { primary: 0xffbe61, secondary: 0x7bf4e7, floor: 0x24190e, fog: 0x0c0d0d };
  return { primary: 0x67f0d9, secondary: 0x8bb7ff, floor: 0x07171a, fog: 0x030b0c };
}

export function RelayRush3D({ intensity, targetLane, active, motionRunning, onUnavailable }: RelayRush3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ intensity, targetLane, active });
  const updateRef = useRef<((next: typeof stateRef.current) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const unavailableRef = useRef(onUnavailable);

  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);
  useEffect(() => {
    const next = { intensity, targetLane, active };
    stateRef.current = next;
    updateRef.current?.(next);
    renderRef.current?.();
  }, [active, intensity, targetLane]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") { unavailableRef.current(); return; }
    const scene = new THREE.Scene();
    const initial = stateRef.current;
    const initialPalette = palette(initial.intensity);
    scene.background = new THREE.Color(initialPalette.fog);
    scene.fog = new THREE.FogExp2(initialPalette.fog, 0.088);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
    camera.position.set(6.7, 5.5, 8.6);
    camera.lookAt(0, 0.55, 0);
    let renderer: any;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" }); }
    catch { unavailableRef.current(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.36;
    renderer.domElement.dataset.dznRelayRushCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: any[] = [];
    const materials: any[] = [];
    const dispose = () => { geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); renderer.dispose(); };

    const ambient = new THREE.HemisphereLight(0xa8fff3, 0x030607, 2.25);
    const key = new THREE.DirectionalLight(0xc3fff1, 2.4);
    key.position.set(-4, 7, 5);
    const signalLight = new THREE.PointLight(initialPalette.primary, 17, 13, 1.8);
    signalLight.position.set(0, 3.2, 0);
    const rimLight = new THREE.PointLight(initialPalette.secondary, 9, 12, 1.8);
    rimLight.position.set(-4.2, 2.1, 2.7);
    scene.add(ambient, key, signalLight, rimLight);

    const chamber = new THREE.Group();
    chamber.rotation.y = -0.13;
    scene.add(chamber);
    const platformGeometry = new THREE.CylinderGeometry(5.15, 5.48, 0.36, 12);
    const platformMaterial = new THREE.MeshStandardMaterial({ color: initialPalette.floor, emissive: 0x051113, emissiveIntensity: 0.84, metalness: 0.82, roughness: 0.24 });
    const insetGeometry = new THREE.CylinderGeometry(4.66, 4.91, 0.1, 12);
    const insetMaterial = new THREE.MeshStandardMaterial({ color: 0x172a2a, emissive: 0x07191b, emissiveIntensity: 0.54, metalness: 0.9, roughness: 0.2 });
    const circuitRingGeometry = new THREE.TorusGeometry(4.1, 0.034, 6, 64);
    const circuitRingMaterial = new THREE.MeshBasicMaterial({ color: initialPalette.secondary, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false });
    geometries.push(platformGeometry, insetGeometry, circuitRingGeometry); materials.push(platformMaterial, insetMaterial, circuitRingMaterial);
    const platform = new THREE.Mesh(platformGeometry, platformMaterial); platform.position.y = -0.36; chamber.add(platform);
    const inset = new THREE.Mesh(insetGeometry, insetMaterial); inset.position.y = -0.12; chamber.add(inset);
    const circuitRing = new THREE.Mesh(circuitRingGeometry, circuitRingMaterial); circuitRing.rotation.x = Math.PI / 2; circuitRing.position.y = -0.05; chamber.add(circuitRing);

    const conduitMaterial = new THREE.MeshStandardMaterial({ color: 0x284445, emissive: 0x102f31, emissiveIntensity: 0.72, metalness: 0.85, roughness: 0.2 });
    const conduitGeometry = new THREE.BoxGeometry(0.13, 0.09, 6.9);
    const railGlowMaterial = new THREE.MeshBasicMaterial({ color: initialPalette.secondary, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false });
    const railGlowGeometry = new THREE.BoxGeometry(0.026, 0.025, 6.82);
    geometries.push(conduitGeometry, railGlowGeometry); materials.push(conduitMaterial, railGlowMaterial);
    for (const x of [-2.2, 0, 2.2]) {
      const conduit = new THREE.Mesh(conduitGeometry, conduitMaterial); conduit.position.set(x, -0.02, -0.35); chamber.add(conduit);
      const glow = new THREE.Mesh(railGlowGeometry, railGlowMaterial); glow.position.set(x, 0.043, -0.35); chamber.add(glow);
    }

    const coreBaseGeometry = new THREE.CylinderGeometry(0.58, 0.74, 0.31, 12);
    const coreColumnGeometry = new THREE.CylinderGeometry(0.25, 0.32, 1.62, 10);
    const coreCapGeometry = new THREE.SphereGeometry(0.36, 16, 10);
    const coreRingGeometry = new THREE.TorusGeometry(0.48, 0.032, 6, 36);
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x253838, emissive: 0x0a2425, emissiveIntensity: 0.9, metalness: 0.86, roughness: 0.18 });
    const coreGlowMaterial = new THREE.MeshBasicMaterial({ color: initialPalette.primary, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending, depthWrite: false });
    geometries.push(coreBaseGeometry, coreColumnGeometry, coreCapGeometry, coreRingGeometry); materials.push(coreMaterial, coreGlowMaterial);
    const core = new THREE.Group();
    const coreBase = new THREE.Mesh(coreBaseGeometry, coreMaterial); core.add(coreBase);
    const coreColumn = new THREE.Mesh(coreColumnGeometry, coreMaterial); coreColumn.position.y = 0.83; core.add(coreColumn);
    const coreCap = new THREE.Mesh(coreCapGeometry, coreGlowMaterial); coreCap.position.y = 1.64; core.add(coreCap);
    const coreRings: any[] = [];
    for (const [height, rotation] of [[0.58, 0], [1.18, Math.PI / 2]] as const) {
      const ring = new THREE.Mesh(coreRingGeometry, coreGlowMaterial); ring.position.y = height; ring.rotation.x = Math.PI / 2; ring.rotation.z = rotation; core.add(ring); coreRings.push(ring);
    }
    chamber.add(core);

    const emitterBaseGeometry = new THREE.CylinderGeometry(0.38, 0.5, 0.3, 8);
    const emitterBodyGeometry = new THREE.CylinderGeometry(0.17, 0.24, 1.16, 8);
    const emitterDishGeometry = new THREE.TorusGeometry(0.31, 0.034, 6, 32);
    const emitterCapGeometry = new THREE.SphereGeometry(0.17, 12, 8);
    const emitterMaterial = new THREE.MeshStandardMaterial({ color: 0x304346, emissive: 0x0c2226, emissiveIntensity: 0.64, metalness: 0.88, roughness: 0.18 });
    geometries.push(emitterBaseGeometry, emitterBodyGeometry, emitterDishGeometry, emitterCapGeometry); materials.push(emitterMaterial);
    const emitters = new Map<RelayRushLane, any>();
    for (const [index, lane] of LANES.entries()) {
      const emitter = new THREE.Group();
      emitter.position.set((index - 1) * 2.2, 0.03, 0.58);
      const base = new THREE.Mesh(emitterBaseGeometry, emitterMaterial); emitter.add(base);
      const body = new THREE.Mesh(emitterBodyGeometry, emitterMaterial); body.position.y = 0.63; emitter.add(body);
      const lampMaterial = new THREE.MeshBasicMaterial({ color: initialPalette.secondary, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
      materials.push(lampMaterial);
      const lamp = new THREE.Mesh(emitterCapGeometry, lampMaterial); lamp.position.y = 1.26; emitter.add(lamp);
      const dish = new THREE.Mesh(emitterDishGeometry, lampMaterial); dish.rotation.x = Math.PI / 2; dish.position.y = 1.05; emitter.add(dish);
      const beamGeometry = new THREE.CylinderGeometry(0.025, 0.05, 3.05, 10, 1, true);
      const beamMaterial = new THREE.MeshBasicMaterial({ color: initialPalette.primary, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      geometries.push(beamGeometry); materials.push(beamMaterial);
      const beam = new THREE.Mesh(beamGeometry, beamMaterial); beam.position.set(0, 2.7, -0.18); emitter.add(beam);
      chamber.add(emitter);
      emitters.set(lane, { emitter, lampMaterial, dish, beam, beamMaterial, index });
    }

    const pylonGeometry = new THREE.BoxGeometry(0.2, 1.48, 0.2);
    const pylonMaterial = new THREE.MeshStandardMaterial({ color: 0x394141, emissive: 0x101919, emissiveIntensity: 0.45, metalness: 0.83, roughness: 0.24 });
    geometries.push(pylonGeometry); materials.push(pylonMaterial);
    for (const [x, z] of [[-4.3, -2.5], [4.3, -2.5], [-4.3, 2.5], [4.3, 2.5]] as const) {
      const pylon = new THREE.Mesh(pylonGeometry, pylonMaterial); pylon.position.set(x, 0.38, z); chamber.add(pylon);
    }

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(270);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 17) % 22) * 0.42 - 4.6;
      particlePositions[index + 1] = 0.15 + ((sample * 11) % 17) * 0.11;
      particlePositions[index + 2] = ((sample * 29) % 22) * 0.42 - 4.6;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: initialPalette.primary, size: 0.034, transparent: true, opacity: 0.48, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial); chamber.add(particles);

    const applyState = (next: typeof stateRef.current) => {
      const colors = palette(next.intensity);
      scene.background.setHex(colors.fog); scene.fog.color.setHex(colors.fog);
      signalLight.color.setHex(colors.primary); rimLight.color.setHex(colors.secondary);
      circuitRingMaterial.color.setHex(colors.secondary); railGlowMaterial.color.setHex(colors.secondary);
      coreGlowMaterial.color.setHex(colors.primary); particleMaterial.color.setHex(colors.primary);
      platformMaterial.color.setHex(colors.floor);
      emitters.forEach((visual, lane) => {
        const live = next.active && next.targetLane === lane;
        visual.lampMaterial.color.setHex(live ? 0xfaffff : colors.secondary);
        visual.lampMaterial.opacity = live ? 1 : 0.27;
        visual.beamMaterial.color.setHex(live ? colors.primary : colors.secondary);
        visual.beamMaterial.opacity = live ? 0.47 : 0;
        visual.emitter.scale.setScalar(live ? 1.08 : 1);
      });
    };
    applyState(initial);
    updateRef.current = applyState;
    renderRef.current = () => renderer.render(scene, camera);

    const resize = new ResizeObserver(entries => {
      const width = Math.max(1, entries[0]?.contentRect.width ?? mount.clientWidth);
      const height = Math.max(1, entries[0]?.contentRect.height ?? mount.clientHeight);
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.render(scene, camera);
    });
    resize.observe(mount);
    let frame = 0;
    const cleanUp = () => {
      window.cancelAnimationFrame(frame); resize.disconnect(); mount.removeChild(renderer.domElement); updateRef.current = null; renderRef.current = null; dispose();
    };
    if (!motionRunning) { renderer.render(scene, camera); return cleanUp; }
    const startedAt = performance.now();
    const render = (time: number) => {
      const elapsed = (time - startedAt) / 1000;
      const state = stateRef.current;
      chamber.rotation.y += ((-0.13 + Math.sin(elapsed * 0.23) * 0.035) - chamber.rotation.y) * 0.024;
      circuitRing.rotation.z = elapsed * 0.09;
      coreRings.forEach((ring, index) => { ring.rotation.z = elapsed * (index ? -1.1 : 0.86); ring.material.opacity = 0.62 + Math.sin(elapsed * 2.4 + index) * 0.18; });
      signalLight.intensity = 14 + Math.sin(elapsed * 2.3) * 2.2;
      rimLight.intensity = 7 + Math.sin(elapsed * 1.7 + 1.2) * 1.4;
      emitters.forEach((visual, lane) => {
        const live = state.active && state.targetLane === lane;
        visual.dish.rotation.z = elapsed * (live ? 1.55 : 0.24) * (visual.index % 2 ? -1 : 1);
        if (live) {
          const energy = 0.76 + Math.sin(elapsed * 7.4) * 0.22;
          visual.lampMaterial.opacity = energy;
          visual.beamMaterial.opacity = 0.3 + Math.sin(elapsed * 5.2) * 0.12;
          visual.beam.scale.y = 0.88 + Math.sin(elapsed * 4.4) * 0.1;
        }
      });
      particles.rotation.y = elapsed * 0.045;
      renderer.render(scene, camera); frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);
    return cleanUp;
  }, [motionRunning]);

  return <div ref={mountRef} className="dzn-relay-rush-3d" aria-hidden="true" />;
}
