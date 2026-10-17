"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { RangerRangeTarget } from "@/lib/games-ranger-range";

type RangerRange3DProps = {
  safeTarget: RangerRangeTarget | null;
  active: boolean;
  disabled: boolean;
  motionRunning: boolean;
  onFire: (target: RangerRangeTarget) => void;
};

const TARGETS: Array<{ id: RangerRangeTarget; x: number; z: number; distance: number }> = [
  { id: "ridge", x: -4.8, z: -10.8, distance: 1.18 },
  { id: "ruins", x: -2.25, z: -7.4, distance: 0.88 },
  { id: "road", x: 0, z: -12.4, distance: 1.34 },
  { id: "treeline", x: 2.5, z: -8.1, distance: 0.96 },
  { id: "tower", x: 4.65, z: -10.1, distance: 1.14 },
  { id: "ravine", x: 1.4, z: -5.8, distance: 0.72 },
];

export function RangerRange3D({ safeTarget, active, disabled, motionRunning, onFire }: RangerRange3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const fireRef = useRef(onFire);
  const disabledRef = useRef(disabled);
  const liveTargetRef = useRef<RangerRangeTarget | null>(safeTarget);

  useEffect(() => { fireRef.current = onFire; }, [onFire]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { liveTargetRef.current = active ? safeTarget : null; }, [active, safeTarget]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);
    camera.position.set(0, 2.8, 7.9);
    camera.lookAt(0, 1.15, -7.4);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      // The DOM controls below the scene remain the accessible fallback when WebGL is unavailable.
      mount.style.display = "none";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.domElement.dataset.dznRangerRangeCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xa6d6c1, 0x07100b, 2.25));
    const sun = new THREE.DirectionalLight(0xffdb9b, 2.9);
    sun.position.set(-8, 11, 4);
    scene.add(sun);
    const rangeLight = new THREE.PointLight(0x4fe5b5, 11, 22, 1.7);
    rangeLight.position.set(0, 2.5, 2);
    scene.add(rangeLight);

    const disposables: Array<{ dispose: () => void }> = [];
    const materials: Array<{ dispose: () => void }> = [];
    const targetMeshes: THREE.Mesh[] = [];
    const targetGroups = new Map<RangerRangeTarget, THREE.Group>();
    const targetMaterials = new Map<RangerRangeTarget, THREE.MeshStandardMaterial>();
    const targetRingMaterials = new Map<RangerRangeTarget, THREE.MeshBasicMaterial>();
    const targetLights = new Map<RangerRangeTarget, THREE.PointLight>();
    const targetGeometry = new THREE.CylinderGeometry(0.7, 0.7, 0.12, 24);
    const ringGeometry = new THREE.TorusGeometry(0.69, 0.04, 8, 24);
    const standGeometry = new THREE.CylinderGeometry(0.045, 0.07, 1.5, 7);
    const standMaterial = new THREE.MeshStandardMaterial({ color: 0x5c442b, roughness: 0.72, metalness: 0.18 });
    disposables.push(targetGeometry, ringGeometry, standGeometry); materials.push(standMaterial);
    for (const target of TARGETS) {
      const group = new THREE.Group();
      group.position.set(target.x, 1.1 * target.distance, target.z);
      const material = new THREE.MeshStandardMaterial({ color: 0x425b4a, emissive: 0x07160e, emissiveIntensity: 0.5, roughness: 0.36, metalness: 0.55, transparent: true, opacity: 0 });
      materials.push(material); targetMaterials.set(target.id, material);
      const plate = new THREE.Mesh(targetGeometry, material);
      plate.rotation.x = Math.PI / 2;
      plate.userData.target = target.id;
      group.add(plate); targetMeshes.push(plate);
      const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x9ecab0, transparent: true, opacity: 0.45 });
      materials.push(ringMaterial); targetRingMaterials.set(target.id, ringMaterial);
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.z = 0.065;
      group.add(ring);
      const stand = new THREE.Mesh(standGeometry, standMaterial);
      stand.position.y = -0.75;
      group.add(stand);
      const light = new THREE.PointLight(0x51dca6, 0, 4.2, 2);
      light.position.z = 0.35;
      group.add(light);
      targetLights.set(target.id, light);
      scene.add(group); targetGroups.set(target.id, group);
    }

    const reticleGeometry = new THREE.RingGeometry(0.17, 0.2, 32);
    const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0xd9f9b8, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
    disposables.push(reticleGeometry); materials.push(reticleMaterial);
    const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
    reticle.position.set(0, 1.35, -7.1);
    scene.add(reticle);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const updatePointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    };
    const onPointerMove = (event: PointerEvent) => {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(targetMeshes, false)[0]?.object as THREE.Mesh | undefined;
      renderer.domElement.style.cursor = hit?.userData.target === liveTargetRef.current && !disabledRef.current ? "crosshair" : "default";
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || disabledRef.current) return;
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(targetMeshes, false)[0]?.object as THREE.Mesh | undefined;
      const target = hit?.userData.target as RangerRangeTarget | undefined;
      // Selection is intentionally scored by the existing server action. Dropping a wrong
      // canvas click would make the 3D input easier than the accessible target deck.
      if (target && liveTargetRef.current) fireRef.current(target);
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
      for (const target of TARGETS) {
        const group = targetGroups.get(target.id);
        const material = targetMaterials.get(target.id);
        const ringMaterial = targetRingMaterials.get(target.id);
        const light = targetLights.get(target.id);
        if (!group || !material || !ringMaterial || !light) continue;
        const live = target.id === liveTargetRef.current;
        group.position.y = 1.1 * target.distance + (motionRunning ? Math.sin(seconds * 1.5 + target.x) * (live ? 0.13 : 0.035) : 0);
        material.color.setHex(live ? 0xe8c76e : 0x425b4a);
        material.emissive.setHex(live ? 0x8a5214 : 0x07160e);
        material.emissiveIntensity = live ? 1.35 : 0.5;
        material.opacity = live ? 0.8 : 0;
        ringMaterial.color.setHex(live ? 0xffe8a0 : 0x9ecab0);
        ringMaterial.opacity = live ? 0.96 : 0;
        light.intensity = live ? 3.3 + (motionRunning ? Math.sin(seconds * 7) * 0.7 : 0) : 0;
      }
      if (motionRunning) {
        reticle.rotation.z = seconds * 0.7;
        reticleMaterial.opacity = 0.5 + Math.sin(seconds * 2.4) * 0.18;
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
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
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
  }, [active, motionRunning, safeTarget]);

  return <div ref={mountRef} className="dzn-ranger-range-3d" data-live={active && safeTarget ? "true" : "false"} />;
}
