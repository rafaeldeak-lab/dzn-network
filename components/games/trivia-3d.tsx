"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type Trivia3DProps = {
  active: boolean;
  questionNumber: number;
  correct: number;
  motionRunning: boolean;
  onUnavailable: () => void;
};

type TriviaVisualState = Pick<Trivia3DProps, "active" | "questionNumber" | "correct">;

export function Trivia3D({ active, questionNumber, correct, motionRunning, onUnavailable }: Trivia3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<TriviaVisualState>({ active, questionNumber, correct });
  const unavailableRef = useRef(onUnavailable);
  const applyStateRef = useRef<((state: TriviaVisualState) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);

  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);
  useEffect(() => {
    const state = { active, questionNumber, correct };
    stateRef.current = state;
    applyStateRef.current?.(state);
    renderRef.current?.();
  }, [active, questionNumber, correct]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") {
      unavailableRef.current();
      return;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x041116, 0.06);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 60);
    camera.position.set(5.5, 4.3, 8.1);
    camera.lookAt(0, 0.18, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      unavailableRef.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.domElement.dataset.dznTriviaCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const dispose = () => {
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      renderer.dispose();
    };

    scene.add(new THREE.HemisphereLight(0x76e6f2, 0x05080d, 1.72));
    const key = new THREE.DirectionalLight(0xffba71, 2.3);
    key.position.set(-4, 7, 4);
    scene.add(key);
    const commandLight = new THREE.PointLight(0x32dcca, 12, 12, 1.9);
    commandLight.position.set(0, 2.8, 0.2);
    scene.add(commandLight);
    const alertLight = new THREE.PointLight(0x9a5aff, 7, 9, 1.8);
    alertLight.position.set(3.7, 1.6, -1.7);
    scene.add(alertLight);

    const deck = new THREE.Group();
    deck.rotation.y = -0.16;
    scene.add(deck);
    const tableGeometry = new THREE.CylinderGeometry(4.55, 4.8, 0.32, 48);
    const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x061a20, metalness: 0.84, roughness: 0.28 });
    geometries.push(tableGeometry); materials.push(tableMaterial);
    const table = new THREE.Mesh(tableGeometry, tableMaterial);
    table.position.y = -0.64;
    deck.add(table);

    const edgeGeometry = new THREE.TorusGeometry(4.32, 0.045, 8, 64);
    const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x62f1df, transparent: true, opacity: 0.7 });
    geometries.push(edgeGeometry); materials.push(edgeMaterial);
    const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = -0.45;
    deck.add(edge);

    const coreGeometry = new THREE.IcosahedronGeometry(0.62, 2);
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x64eadd, emissive: 0x087d75, emissiveIntensity: 1.72, metalness: 0.84, roughness: 0.15 });
    geometries.push(coreGeometry); materials.push(coreMaterial);
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.position.y = 0.72;
    deck.add(core);

    const ringGeometry = new THREE.TorusGeometry(1.04, 0.035, 8, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xc7fff8, transparent: true, opacity: 0.76 });
    geometries.push(ringGeometry); materials.push(ringMaterial);
    const rings: THREE.Mesh[] = [];
    for (const [index, rotation] of [[0.72, 0.12, -0.27], [-0.64, 0.44, 0.2], [0.13, -0.75, 0.48]].entries()) {
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.y = 0.72;
      ring.rotation.set(rotation[0], rotation[1], rotation[2]);
      ring.userData.offset = index * 0.8;
      deck.add(ring);
      rings.push(ring);
    }

    const padGeometry = new THREE.CylinderGeometry(0.62, 0.69, 0.13, 6);
    const padMaterials = [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: 0x133940, emissive: 0x0b4448, emissiveIntensity: 0.54, metalness: 0.78, roughness: 0.23 }));
    geometries.push(padGeometry); materials.push(...padMaterials);
    const pads: THREE.Mesh[] = [];
    for (let index = 0; index < 4; index++) {
      const angle = Math.PI / 4 + index * Math.PI / 2;
      const pad = new THREE.Mesh(padGeometry, padMaterials[index]);
      pad.position.set(Math.cos(angle) * 2.65, -0.32, Math.sin(angle) * 2.15);
      pad.rotation.y = angle;
      pad.userData.offset = index * 0.94;
      deck.add(pad);
      pads.push(pad);
    }

    const pillarGeometry = new THREE.CylinderGeometry(0.055, 0.075, 1.42, 8);
    const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x16424a, emissive: 0x0d5c5d, emissiveIntensity: 0.82, metalness: 0.8, roughness: 0.25 });
    const beaconGeometry = new THREE.OctahedronGeometry(0.17, 1);
    const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0x77f2e2, emissive: 0x128f82, emissiveIntensity: 1.8, metalness: 0.72, roughness: 0.16 });
    geometries.push(pillarGeometry, beaconGeometry); materials.push(pillarMaterial, beaconMaterial);
    const beacons: THREE.Mesh[] = [];
    for (let index = 0; index < 6; index++) {
      const angle = index / 6 * Math.PI * 2;
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
      pillar.position.set(Math.cos(angle) * 3.62, 0.02, Math.sin(angle) * 3.62);
      deck.add(pillar);
      const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
      beacon.position.copy(pillar.position);
      beacon.position.y = 0.82;
      beacon.userData.offset = index * 0.72;
      deck.add(beacon);
      beacons.push(beacon);
    }

    const gridGeometry = new THREE.PlaneGeometry(7.6, 7.6, 14, 14);
    const gridMaterial = new THREE.MeshBasicMaterial({ color: 0x2b8a89, transparent: true, opacity: 0.11, wireframe: true, side: THREE.DoubleSide });
    geometries.push(gridGeometry); materials.push(gridMaterial);
    const grid = new THREE.Mesh(gridGeometry, gridMaterial);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -0.44;
    deck.add(grid);

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(128 * 3);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 13) % 29) * 0.28 - 4;
      particlePositions[index + 1] = ((sample * 7) % 17) * 0.13 - 0.14;
      particlePositions[index + 2] = ((sample * 19) % 23) * 0.31 - 3.5;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0x82fff0, size: 0.032, transparent: true, opacity: 0.56, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    deck.add(particles);

    const applyState = (state: TriviaVisualState) => {
      const colour = state.active ? 0x62f1df : 0x6a9898;
      const highlightedPad = (Math.max(1, state.questionNumber) - 1) % pads.length;
      coreMaterial.color.setHex(colour);
      coreMaterial.emissive.setHex(state.active ? 0x0b887d : 0x1d4b4e);
      coreMaterial.emissiveIntensity = state.active ? 1.62 + Math.min(state.correct, 4) * 0.12 : 0.62;
      ringMaterial.color.setHex(colour);
      ringMaterial.opacity = state.active ? 0.78 : 0.32;
      edgeMaterial.color.setHex(state.active ? 0x65f5e0 : 0x52827e);
      particleMaterial.color.setHex(colour);
      particleMaterial.opacity = state.active ? 0.52 + Math.min(state.correct, 4) * 0.04 : 0.18;
      commandLight.intensity = state.active ? 10 + state.questionNumber * 0.52 : 2.8;
      pads.forEach((pad, index) => {
        const material = pad.material as THREE.MeshStandardMaterial;
        const selected = state.active && index === highlightedPad;
        material.color.setHex(selected ? 0x2a7c80 : 0x12373e);
        material.emissive.setHex(selected ? 0x178c86 : 0x0a4045);
        material.emissiveIntensity = selected ? 1.42 : state.active ? 0.48 : 0.16;
      });
      beaconMaterial.emissiveIntensity = state.active ? 1.78 : 0.55;
      gridMaterial.opacity = state.active ? 0.13 : 0.045;
    };
    applyStateRef.current = applyState;
    applyState(stateRef.current);
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

    if (!motionRunning) {
      render();
      return () => {
        resize.disconnect();
        applyStateRef.current = null;
        renderRef.current = null;
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
        dispose();
      };
    }

    const startedAt = performance.now();
    let frame = 0;
    const animate = (time: number) => {
      const elapsed = (time - startedAt) / 1000;
      deck.rotation.y = -0.16 + Math.sin(elapsed * 0.19) * 0.055;
      core.rotation.y = elapsed * 0.84;
      core.position.y = 0.72 + Math.sin(elapsed * 1.58) * 0.09;
      rings.forEach(ring => { ring.rotation.z += 0.008; });
      pads.forEach(pad => { pad.position.y = -0.32 + Math.sin(elapsed * 1.25 + pad.userData.offset) * 0.028; });
      beacons.forEach(beacon => { beacon.position.y = 0.82 + Math.sin(elapsed * 1.9 + beacon.userData.offset) * 0.08; });
      particles.rotation.y = elapsed * 0.048;
      grid.rotation.z = elapsed * 0.015;
      render();
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      applyStateRef.current = null;
      renderRef.current = null;
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      dispose();
    };
  }, [motionRunning]);

  return <div ref={mountRef} className="dzn-trivia-3d" aria-hidden="true" />;
}
