"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type Trivia3DProps = {
  active: boolean;
  difficulty: "recruit" | "operator" | "specialist";
  questionNumber: number;
  correct: number;
  motionRunning: boolean;
  onUnavailable: () => void;
};

type TriviaVisualState = Pick<Trivia3DProps, "active" | "difficulty" | "questionNumber" | "correct">;

export function Trivia3D({ active, difficulty, questionNumber, correct, motionRunning, onUnavailable }: Trivia3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<TriviaVisualState>({ active, difficulty, questionNumber, correct });
  const unavailableRef = useRef(onUnavailable);
  const applyStateRef = useRef<((state: TriviaVisualState) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);

  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);
  useEffect(() => {
    const state = { active, difficulty, questionNumber, correct };
    stateRef.current = state;
    applyStateRef.current?.(state);
    renderRef.current?.();
  }, [active, difficulty, questionNumber, correct]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") {
      unavailableRef.current();
      return;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x041116, 0.06);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    camera.position.set(6.2, 4.65, 8.8);
    camera.lookAt(0, -0.04, 0);

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

    const terrainGeometry = new THREE.PlaneGeometry(7.1, 5.8, 28, 22);
    const terrainPosition = terrainGeometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < terrainPosition.count; index++) {
      const x = terrainPosition.getX(index);
      const y = terrainPosition.getY(index);
      const ridge = Math.sin(x * 1.28) * Math.cos(y * 1.08) * 0.18;
      const escarpment = Math.sin(x * 2.5 + y * 1.4) * 0.07;
      const bowl = -Math.min(0.12, (x * x + y * y) * 0.008);
      terrainPosition.setZ(index, ridge + escarpment + bowl);
    }
    terrainGeometry.computeVertexNormals();
    const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0x12393d, emissive: 0x08242a, emissiveIntensity: 0.95, metalness: 0.34, roughness: 0.64, transparent: true, opacity: 0.87, side: THREE.DoubleSide });
    geometries.push(terrainGeometry); materials.push(terrainMaterial);
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = -0.4;
    deck.add(terrain);

    const contourGeometry = new THREE.PlaneGeometry(7.15, 5.85, 10, 8);
    const contourMaterial = new THREE.MeshBasicMaterial({ color: 0x8ffff0, transparent: true, opacity: 0.17, wireframe: true, side: THREE.DoubleSide });
    geometries.push(contourGeometry); materials.push(contourMaterial);
    const contour = new THREE.Mesh(contourGeometry, contourMaterial);
    contour.rotation.x = -Math.PI / 2;
    contour.position.y = -0.33;
    deck.add(contour);

    const routeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.2, -0.24, 1.62), new THREE.Vector3(-1.68, -0.14, 0.56), new THREE.Vector3(-0.54, -0.08, 0.88),
      new THREE.Vector3(0.5, -0.12, -0.32), new THREE.Vector3(1.58, -0.1, -0.88), new THREE.Vector3(3.05, -0.2, -1.52),
    ]);
    const routeGeometry = new THREE.BufferGeometry().setFromPoints(routeCurve.getPoints(72));
    const routeMaterial = new THREE.LineBasicMaterial({ color: 0x75fff0, transparent: true, opacity: 0.7 });
    geometries.push(routeGeometry); materials.push(routeMaterial);
    const route = new THREE.Line(routeGeometry, routeMaterial);
    route.position.y = 0.05;
    deck.add(route);

    const relayGeometry = new THREE.CylinderGeometry(0.09, 0.13, 0.72, 6);
    const relayMaterial = new THREE.MeshStandardMaterial({ color: 0x1d5960, emissive: 0x0c6e75, emissiveIntensity: 1.18, metalness: 0.76, roughness: 0.24 });
    const relayCapGeometry = new THREE.OctahedronGeometry(0.145, 0);
    const relayCapMaterial = new THREE.MeshStandardMaterial({ color: 0xc0fff6, emissive: 0x28d7c1, emissiveIntensity: 2, metalness: 0.7, roughness: 0.17 });
    geometries.push(relayGeometry, relayCapGeometry); materials.push(relayMaterial, relayCapMaterial);
    const relays: THREE.Mesh[] = [];
    for (const [index, point] of [new THREE.Vector3(-2.7, 0, 1.35), new THREE.Vector3(-0.65, 0, 0.76), new THREE.Vector3(1.35, 0, -0.72), new THREE.Vector3(2.85, 0, -1.44)].entries()) {
      const relay = new THREE.Mesh(relayGeometry, relayMaterial);
      relay.position.set(point.x, 0.02, point.z);
      relay.userData.offset = index * 0.72;
      deck.add(relay);
      const relayCap = new THREE.Mesh(relayCapGeometry, relayCapMaterial);
      relayCap.position.set(point.x, 0.48, point.z);
      relayCap.userData.offset = index * 0.72;
      deck.add(relayCap);
      relays.push(relayCap);
    }

    const sweepGeometry = new THREE.RingGeometry(0.38, 0.44, 48);
    const sweepMaterial = new THREE.MeshBasicMaterial({ color: 0x99fff5, transparent: true, opacity: 0.52, side: THREE.DoubleSide });
    geometries.push(sweepGeometry); materials.push(sweepMaterial);
    const sweep = new THREE.Mesh(sweepGeometry, sweepMaterial);
    sweep.rotation.x = -Math.PI / 2;
    sweep.position.set(0.36, -0.28, -0.18);
    deck.add(sweep);

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
      const palette = {
        recruit: { primary: 0x62f1df, secondary: 0x0b887d, route: 0x75fff0 },
        operator: { primary: 0xf1c56e, secondary: 0x986119, route: 0xffda83 },
        specialist: { primary: 0xbe99ff, secondary: 0x663bb4, route: 0xd3b7ff },
      }[state.difficulty];
      const colour = state.active ? palette.primary : 0x6a9898;
      const highlightedPad = (Math.max(1, state.questionNumber) - 1) % pads.length;
      coreMaterial.color.setHex(colour);
      coreMaterial.emissive.setHex(state.active ? palette.secondary : 0x1d4b4e);
      coreMaterial.emissiveIntensity = state.active ? 1.62 + Math.min(state.correct, 4) * 0.12 : 0.62;
      ringMaterial.color.setHex(colour);
      ringMaterial.opacity = state.active ? 0.78 : 0.32;
      edgeMaterial.color.setHex(state.active ? 0x65f5e0 : 0x52827e);
      particleMaterial.color.setHex(colour);
      particleMaterial.opacity = state.active ? 0.52 + Math.min(state.correct, 4) * 0.04 : 0.18;
      terrainMaterial.color.setHex(state.active ? 0x153f43 : 0x163136);
      terrainMaterial.emissive.setHex(state.active ? palette.secondary : 0x173535);
      terrainMaterial.emissiveIntensity = state.active ? 0.78 : 0.24;
      contourMaterial.color.setHex(colour);
      contourMaterial.opacity = state.active ? 0.21 : 0.06;
      routeMaterial.color.setHex(state.active ? palette.route : 0x527d7b);
      routeMaterial.opacity = state.active ? 0.84 : 0.2;
      relayMaterial.emissive.setHex(state.active ? palette.secondary : 0x16474a);
      relayCapMaterial.color.setHex(colour);
      relayCapMaterial.emissive.setHex(state.active ? palette.secondary : 0x16474a);
      sweepMaterial.color.setHex(colour);
      sweepMaterial.opacity = state.active ? 0.52 : 0.12;
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
      relays.forEach(relay => { relay.position.y = 0.48 + Math.sin(elapsed * 1.58 + relay.userData.offset) * 0.06; });
      particles.rotation.y = elapsed * 0.048;
      grid.rotation.z = elapsed * 0.015;
      contour.rotation.z = elapsed * -0.012;
      sweep.scale.setScalar(1 + Math.sin(elapsed * 1.7) * 0.11);
      sweep.material.opacity = 0.35 + Math.sin(elapsed * 1.7) * 0.12;
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
