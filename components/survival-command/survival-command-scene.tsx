"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { SurvivalCommandExpedition, SurvivalCommandSector } from "../../lib/survival-command";

type SceneState = { selectedSector: SurvivalCommandSector; expedition: SurvivalCommandExpedition | null };
type Props = SceneState & { motionRunning: boolean; onUnavailable: () => void };

const sectorLayout: Record<SurvivalCommandSector, { x: number; z: number; colour: number }> = {
  perimeter: { x: -2.45, z: 1.45, colour: 0x5eead4 },
  rail_yard: { x: 2.25, z: 1.4, colour: 0xffb65f },
  radio_ridge: { x: -2.0, z: -2.0, colour: 0x91a7ff },
  blacksite: { x: 2.35, z: -1.85, colour: 0xec71a8 },
};

export function SurvivalCommandScene({ selectedSector, expedition, motionRunning, onUnavailable }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<SceneState>({ selectedSector, expedition });
  const applyStateRef = useRef<((state: SceneState) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const unavailableRef = useRef(onUnavailable);

  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);
  useEffect(() => {
    const next = { selectedSector, expedition };
    stateRef.current = next;
    applyStateRef.current?.(next);
    renderRef.current?.();
  }, [expedition, selectedSector]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") {
      unavailableRef.current();
      return;
    }
    const mountElement = mount;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x071014, 0.072);
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 44);
    camera.position.set(8.4, 8.2, 10.8);
    camera.lookAt(0, 0.1, 0);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      unavailableRef.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.34;
    renderer.domElement.dataset.dznSurvivalCommandCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mountElement.appendChild(renderer.domElement);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const root = new THREE.Group();
    root.rotation.y = -0.27;
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0xb9e7ff, 0x071312, 2.35));
    const key = new THREE.DirectionalLight(0xffc38f, 2.3);
    key.position.set(-6, 9, 5);
    scene.add(key);
    const cyanLight = new THREE.PointLight(0x4de8d6, 12, 14, 1.8);
    cyanLight.position.set(-1, 2.9, 1.5);
    scene.add(cyanLight);
    const violetLight = new THREE.PointLight(0x748dff, 9, 10, 2);
    violetLight.position.set(4, 3.3, -2.5);
    scene.add(violetLight);

    const groundGeometry = new THREE.CylinderGeometry(6.25, 7, 0.28, 8);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x12363a, emissive: 0x061b22, emissiveIntensity: 0.75, metalness: 0.78, roughness: 0.38 });
    geometries.push(groundGeometry); materials.push(groundMaterial);
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.position.y = -0.27;
    root.add(ground);

    const wireGeometry = new THREE.RingGeometry(5.6, 5.64, 8, 1);
    const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x467b83, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
    geometries.push(wireGeometry); materials.push(wireMaterial);
    const wire = new THREE.Mesh(wireGeometry, wireMaterial);
    wire.rotation.x = -Math.PI / 2;
    wire.position.y = -0.11;
    root.add(wire);

    const mountainGeometry = new THREE.ConeGeometry(0.85, 1.8, 5);
    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x163436, emissive: 0x061517, emissiveIntensity: 0.48, roughness: 0.9, metalness: 0.08 });
    geometries.push(mountainGeometry); materials.push(mountainMaterial);
    for (const [x, z, height] of [[-4.2, -3.5, 0.8], [-3.35, -3.9, 1.2], [3.85, -3.6, 1.05], [4.25, 2.9, 0.85], [-4.4, 3.1, 1.1]]) {
      const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
      mountain.position.set(x, height * 0.34 - 0.22, z);
      mountain.scale.set(1.25, height, 1.15);
      mountain.rotation.y = (x + z) * 0.3;
      root.add(mountain);
    }

    const commandGeometry = new THREE.CylinderGeometry(0.83, 1.12, 0.35, 6);
    const commandMaterial = new THREE.MeshStandardMaterial({ color: 0x1f5d5a, emissive: 0x0d4b4b, emissiveIntensity: 1.1, metalness: 0.82, roughness: 0.28 });
    const command = new THREE.Mesh(commandGeometry, commandMaterial);
    geometries.push(commandGeometry); materials.push(commandMaterial);
    command.position.y = 0.05;
    root.add(command);
    const towerGeometry = new THREE.CylinderGeometry(0.15, 0.28, 1.5, 6);
    const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x9eece2, emissive: 0x159d8d, emissiveIntensity: 1.6, metalness: 0.78, roughness: 0.17 });
    geometries.push(towerGeometry); materials.push(towerMaterial);
    const tower = new THREE.Mesh(towerGeometry, towerMaterial);
    tower.position.y = 0.88;
    root.add(tower);

    const routeMaterial = new THREE.LineBasicMaterial({ color: 0x315f69, transparent: true, opacity: 0.62 });
    const selectedRouteMaterial = new THREE.LineBasicMaterial({ color: 0x84fbeb, transparent: true, opacity: 0.91 });
    materials.push(routeMaterial, selectedRouteMaterial);
    const routeLines = new Map<SurvivalCommandSector, THREE.Line>();
    const sectorNodes: Array<{ key: SurvivalCommandSector; node: THREE.Group; core: THREE.Mesh; beacon: THREE.Mesh; light: THREE.PointLight }> = [];
    const nodeBaseGeometry = new THREE.CylinderGeometry(0.56, 0.72, 0.16, 6);
    const nodeCoreGeometry = new THREE.BoxGeometry(0.56, 0.46, 0.56);
    const beaconGeometry = new THREE.OctahedronGeometry(0.18, 0);
    geometries.push(nodeBaseGeometry, nodeCoreGeometry, beaconGeometry);
    for (const keyName of Object.keys(sectorLayout) as SurvivalCommandSector[]) {
      const point = sectorLayout[keyName];
      const routeGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(point.x, 0.03, point.z)]);
      geometries.push(routeGeometry);
      const route = new THREE.Line(routeGeometry, routeMaterial);
      root.add(route);
      routeLines.set(keyName, route);
      const node = new THREE.Group();
      node.position.set(point.x, 0, point.z);
      root.add(node);
      const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x1a4b51, emissive: 0x082a30, emissiveIntensity: 0.7, metalness: 0.78, roughness: 0.28 });
      const coreMaterial = new THREE.MeshStandardMaterial({ color: point.colour, emissive: point.colour, emissiveIntensity: 1.6, metalness: 0.68, roughness: 0.2 });
      const beaconMaterial = new THREE.MeshBasicMaterial({ color: point.colour, transparent: true, opacity: 0.82 });
      materials.push(plateMaterial, coreMaterial, beaconMaterial);
      const plate = new THREE.Mesh(nodeBaseGeometry, plateMaterial);
      const core = new THREE.Mesh(nodeCoreGeometry, coreMaterial);
      const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
      core.position.y = 0.29;
      beacon.position.y = 0.75;
      node.add(plate, core, beacon);
      const light = new THREE.PointLight(point.colour, 1.8, 3.2, 2);
      light.position.y = 0.78;
      node.add(light);
      sectorNodes.push({ key: keyName, node, core, beacon, light });
    }

    const convoy = new THREE.Group();
    const chassisGeometry = new THREE.BoxGeometry(0.42, 0.16, 0.65);
    const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0xffd78e, emissive: 0x925725, emissiveIntensity: 0.9, metalness: 0.72, roughness: 0.24 });
    const wheelGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.08, 6);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x101a1d, roughness: 0.8 });
    geometries.push(chassisGeometry, wheelGeometry); materials.push(chassisMaterial, wheelMaterial);
    const chassis = new THREE.Mesh(chassisGeometry, chassisMaterial);
    chassis.position.y = 0.18;
    convoy.add(chassis);
    for (const x of [-0.18, 0.18]) for (const z of [-0.24, 0.24]) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.position.set(x, 0.1, z);
      wheel.rotation.z = Math.PI / 2;
      convoy.add(wheel);
    }
    const convoyLight = new THREE.PointLight(0xffb65f, 1.2, 2.2, 2);
    convoyLight.position.set(0, 0.33, -0.34);
    convoy.add(convoyLight);
    convoy.visible = false;
    root.add(convoy);

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(140 * 3);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 17) % 53) * 0.205 - 5.35;
      particlePositions[index + 1] = ((sample * 11) % 31) * 0.105 + 0.03;
      particlePositions[index + 2] = ((sample * 7) % 47) * 0.215 - 4.95;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0xb5f6eb, size: 0.025, transparent: true, opacity: 0.46, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    root.add(particles);

    const applyState = (state: SceneState) => {
      const travel = state.expedition?.state === "in-transit" ? state.expedition : null;
      for (const entry of sectorNodes) {
        const selected = entry.key === state.selectedSector;
        const active = entry.key === state.expedition?.sector;
        entry.node.scale.setScalar(selected ? 1.17 : 1);
        (entry.core.material as THREE.MeshStandardMaterial).emissiveIntensity = selected ? 2.25 : active ? 1.85 : 0.72;
        (entry.beacon.material as THREE.MeshBasicMaterial).opacity = selected ? 0.98 : active ? 0.8 : 0.35;
        entry.light.intensity = selected ? 2.8 : active ? 2.2 : 0.52;
        routeLines.get(entry.key)!.material = selected || active ? selectedRouteMaterial : routeMaterial;
      }
      const end = travel ? sectorLayout[travel.sector] : null;
      convoy.visible = Boolean(end);
      if (end) convoy.userData.route = end;
      (tower.material as THREE.MeshStandardMaterial).emissiveIntensity = state.expedition?.state === "ready" ? 2.35 : 1.45;
    };
    applyStateRef.current = applyState;
    applyState(stateRef.current);
    const render = () => renderer.render(scene, camera);
    renderRef.current = render;
    const resize = new ResizeObserver(entries => {
      const width = Math.max(1, entries[0]?.contentRect.width ?? mountElement.clientWidth);
      const height = Math.max(1, entries[0]?.contentRect.height ?? mountElement.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(mountElement);
    if (!motionRunning) {
      render();
      return () => dispose();
    }
    const startedAt = performance.now();
    let frame = 0;
    const animate = (time: number) => {
      const elapsed = (time - startedAt) / 1000;
      root.rotation.y = -0.27 + Math.sin(elapsed * 0.12) * 0.055;
      particles.rotation.y = elapsed * 0.025;
      wire.rotation.z = elapsed * 0.025;
      for (const entry of sectorNodes) {
        entry.beacon.rotation.y = elapsed * 0.8;
        entry.beacon.position.y = 0.75 + Math.sin(elapsed * 1.35 + entry.node.position.x) * 0.035;
      }
      if (convoy.visible && convoy.userData.route) {
        const target = convoy.userData.route as { x: number; z: number };
        const progress = (Math.sin(elapsed * 0.72) + 1) / 2;
        convoy.position.set(target.x * progress, 0, target.z * progress);
        convoy.rotation.y = Math.atan2(target.x, target.z);
      }
      render();
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);

    function dispose() {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      applyStateRef.current = null;
      renderRef.current = null;
      if (renderer.domElement.parentNode === mountElement) mountElement.removeChild(renderer.domElement);
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      renderer.dispose();
    }
    return dispose;
  }, [motionRunning]);

  return <div ref={mountRef} className="dzn-survival-command-scene" aria-hidden="true" />;
}
