"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CommandCentreBuildingView } from "../../lib/command-centre";

type CommandCentre3DProps = {
  buildings: CommandCentreBuildingView[];
  active: boolean;
  motionRunning: boolean;
  onUnavailable: () => void;
};

type VisualState = Pick<CommandCentre3DProps, "buildings" | "active">;

const layout = {
  headquarters: { x: 0, z: 0, colour: 0x74e8d9, emissive: 0x0d6f69 },
  workshop: { x: -2.5, z: 0.7, colour: 0xffb86b, emissive: 0x88501e },
  watchtower: { x: 2.45, z: -0.35, colour: 0xb884ff, emissive: 0x5d2b9b },
  communications: { x: 0.9, z: 2.2, colour: 0x79b9ff, emissive: 0x174f99 },
} as const;

export function CommandCentre3D({ buildings, active, motionRunning, onUnavailable }: CommandCentre3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<VisualState>({ buildings, active });
  const unavailableRef = useRef(onUnavailable);
  const applyStateRef = useRef<((state: VisualState) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);

  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);
  useEffect(() => {
    const next = { buildings, active };
    stateRef.current = next;
    applyStateRef.current?.(next);
    renderRef.current?.();
  }, [active, buildings]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") {
      unavailableRef.current();
      return;
    }
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03080c, 0.055);
    const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 50);
    camera.position.set(7.5, 7, 9.2);
    camera.lookAt(0, 0.5, 0);
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
    renderer.toneMappingExposure = 1.55;
    renderer.domElement.dataset.dznCommandCentreCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const tracked: Array<{ building: string; body: THREE.Mesh; cap: THREE.Mesh; halo: THREE.Mesh; construction: THREE.LineSegments; glow: THREE.PointLight }> = [];
    const root = new THREE.Group();
    root.rotation.y = -0.3;
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0x9cf5ff, 0x05131b, 2.25));
    const key = new THREE.DirectionalLight(0xffd3a8, 2.8);
    key.position.set(-5, 9, 5);
    scene.add(key);
    const aqua = new THREE.PointLight(0x35f0d1, 13, 13, 1.8);
    aqua.position.set(-1.5, 3.8, 2.7);
    scene.add(aqua);
    const violet = new THREE.PointLight(0xa767ff, 10, 10, 2);
    violet.position.set(4, 2.8, -2);
    scene.add(violet);

    const floorGeometry = new THREE.CylinderGeometry(5.2, 5.7, 0.18, 6);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x0d3542, emissive: 0x062b36, emissiveIntensity: 0.7, metalness: 0.82, roughness: 0.33 });
    geometries.push(floorGeometry); materials.push(floorMaterial);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = -0.25;
    root.add(floor);

    const perimeterGeometry = new THREE.TorusGeometry(4.7, 0.035, 8, 72);
    const perimeterMaterial = new THREE.MeshBasicMaterial({ color: 0x4bdfcd, transparent: true, opacity: 0.45 });
    geometries.push(perimeterGeometry); materials.push(perimeterMaterial);
    const perimeter = new THREE.Mesh(perimeterGeometry, perimeterMaterial);
    perimeter.position.y = -0.13;
    perimeter.rotation.x = Math.PI / 2;
    root.add(perimeter);

    const roadGeometry = new THREE.PlaneGeometry(7.5, 0.22);
    const roadMaterial = new THREE.MeshBasicMaterial({ color: 0x3bcfbd, transparent: true, opacity: 0.18 });
    geometries.push(roadGeometry); materials.push(roadMaterial);
    for (const rotation of [0, Math.PI / 3, -Math.PI / 3]) {
      const road = new THREE.Mesh(roadGeometry, roadMaterial);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = rotation;
      road.position.y = -0.12;
      root.add(road);
    }

    const baseGeometry = new THREE.CylinderGeometry(0.88, 1.02, 0.22, 6);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x125261, emissive: 0x07313d, emissiveIntensity: 0.7, metalness: 0.82, roughness: 0.27 });
    const bodyGeometry = new THREE.BoxGeometry(1.15, 1, 1.08);
    const capGeometry = new THREE.CylinderGeometry(0.52, 0.64, 0.16, 6);
    const constructionGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.34, 1.56, 1.28));
    geometries.push(baseGeometry, bodyGeometry, capGeometry, constructionGeometry); materials.push(baseMaterial);

    for (const building of Object.keys(layout) as Array<keyof typeof layout>) {
      const point = layout[building];
      const group = new THREE.Group();
      group.position.set(point.x, 0, point.z);
      root.add(group);
      const base = new THREE.Mesh(baseGeometry, baseMaterial);
      base.position.y = 0;
      group.add(base);
      const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x1a5260, emissive: point.emissive, emissiveIntensity: 0.72, metalness: 0.84, roughness: 0.2 });
      const capMaterial = new THREE.MeshStandardMaterial({ color: point.colour, emissive: point.emissive, emissiveIntensity: 2.1, metalness: 0.75, roughness: 0.12 });
      const haloMaterial = new THREE.MeshBasicMaterial({ color: point.colour, transparent: true, opacity: 0.55 });
      const constructionMaterial = new THREE.LineBasicMaterial({ color: 0xffd268, transparent: true, opacity: 0 });
      materials.push(bodyMaterial, capMaterial, haloMaterial, constructionMaterial);
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      const cap = new THREE.Mesh(capGeometry, capMaterial);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.025, 6, 36), haloMaterial);
      const construction = new THREE.LineSegments(constructionGeometry, constructionMaterial);
      geometries.push((halo.geometry as THREE.BufferGeometry));
      body.position.y = 0.62;
      cap.position.y = 1.2;
      halo.position.y = 1.34;
      halo.rotation.x = Math.PI / 2;
      construction.position.y = 0.63;
      group.add(body, cap, halo, construction);
      const glow = new THREE.PointLight(point.colour, 1.6, 3.2, 2);
      glow.position.set(0, 1.5, 0);
      group.add(glow);
      if (building === "watchtower") {
        const antennaGeometry = new THREE.CylinderGeometry(0.025, 0.04, 1.5, 6);
        const antennaMaterial = new THREE.MeshStandardMaterial({ color: 0xc3faff, emissive: 0x146b85, emissiveIntensity: 0.9, metalness: 0.85, roughness: 0.18 });
        geometries.push(antennaGeometry); materials.push(antennaMaterial);
        const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
        antenna.position.y = 2.02;
        group.add(antenna);
      }
      tracked.push({ building, body, cap, halo, construction, glow });
    }

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(92 * 3);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 17) % 41) * 0.24 - 4.8;
      particlePositions[index + 1] = ((sample * 11) % 19) * 0.12 + 0.06;
      particlePositions[index + 2] = ((sample * 7) % 37) * 0.24 - 4.3;
    }
    const particleMaterial = new THREE.PointsMaterial({ color: 0x9bfaf0, size: 0.03, transparent: true, opacity: 0.52, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    root.add(particles);

    const applyState = (state: VisualState) => {
      for (const item of tracked) {
        const current = state.buildings.find(entry => entry.building === item.building);
        const level = current?.level ?? 0;
        const constructing = Boolean(current?.targetLevel);
        item.body.scale.y = Math.max(0.2, 0.58 + level * 0.17);
        item.body.position.y = 0.23 + item.body.scale.y / 2;
        item.cap.position.y = 0.24 + item.body.scale.y + 0.08;
        item.halo.position.y = item.cap.position.y + 0.12;
        item.construction.scale.y = 0.72 + Math.max(level, 1) * 0.18;
        item.construction.position.y = 0.34 + item.construction.scale.y / 2;
        const bodyMaterial = item.body.material as THREE.MeshStandardMaterial;
        const capMaterial = item.cap.material as THREE.MeshStandardMaterial;
        const constructionMaterial = item.construction.material as THREE.LineBasicMaterial;
        bodyMaterial.emissiveIntensity = state.active ? 0.6 + level * 0.18 : 0.16;
        capMaterial.emissiveIntensity = state.active ? 1.42 + level * 0.32 : 0.25;
        (item.halo.material as THREE.MeshBasicMaterial).opacity = state.active ? 0.3 + level * 0.07 : 0.06;
        item.glow.intensity = state.active ? 1.1 + level * 0.42 : 0.12;
        constructionMaterial.opacity = constructing ? 0.82 : 0;
      }
      perimeterMaterial.opacity = state.active ? 0.48 : 0.16;
      particleMaterial.opacity = state.active ? 0.52 : 0.18;
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
        geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); renderer.dispose();
      };
    }
    const startedAt = performance.now();
    let frame = 0;
    const animate = (time: number) => {
      const elapsed = (time - startedAt) / 1000;
      root.rotation.y = -0.3 + Math.sin(elapsed * 0.11) * 0.065;
      perimeter.rotation.z = elapsed * 0.05;
      particles.rotation.y = elapsed * 0.035;
      tracked.forEach((item, index) => {
        item.halo.rotation.z = elapsed * (0.2 + index * 0.025);
        item.halo.position.y = item.cap.position.y + 0.12 + Math.sin(elapsed * 1.4 + index) * 0.025;
      });
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
      geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); renderer.dispose();
    };
  }, [motionRunning]);

  return <div ref={mountRef} className="dzn-command-centre-3d" aria-hidden="true" />;
}
