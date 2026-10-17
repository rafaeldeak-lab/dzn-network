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
    scene.background = new THREE.Color(0x030a0b);
    scene.fog = new THREE.FogExp2(0x06100e, 0.048);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);
    camera.position.set(0, 2.8, 7.9);
    camera.lookAt(0, 1.15, -7.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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
    const terrain = new THREE.Group();
    terrain.rotation.y = -0.04;
    scene.add(terrain);

    const groundGeometry = new THREE.PlaneGeometry(26, 33, 20, 26);
    const groundPosition = groundGeometry.attributes.position;
    for (let index = 0; index < groundPosition.count; index++) {
      const x = groundPosition.getX(index);
      const y = groundPosition.getY(index);
      groundPosition.setZ(index, Math.sin(x * 0.72) * 0.12 + Math.cos(y * 0.43) * 0.16);
    }
    groundGeometry.computeVertexNormals();
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x173225, roughness: 0.96, metalness: 0.06 });
    disposables.push(groundGeometry); materials.push(groundMaterial);
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.05, -8.5);
    terrain.add(ground);

    const laneGeometry = new THREE.PlaneGeometry(6.4, 24);
    const laneMaterial = new THREE.MeshStandardMaterial({ color: 0x2c4734, roughness: 0.88, metalness: 0.08, transparent: true, opacity: 0.9 });
    disposables.push(laneGeometry); materials.push(laneMaterial);
    const lane = new THREE.Mesh(laneGeometry, laneMaterial);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.02, -8.4);
    terrain.add(lane);

    const grassGeometry = new THREE.ConeGeometry(0.07, 0.7, 4);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x3c6e45, roughness: 0.9 });
    disposables.push(grassGeometry); materials.push(grassMaterial);
    for (let index = 0; index < 78; index++) {
      const grass = new THREE.Mesh(grassGeometry, grassMaterial);
      const side = index % 2 ? -1 : 1;
      grass.position.set(side * (3.8 + ((index * 37) % 60) / 20), 0.28, -1 - ((index * 29) % 250) / 10);
      grass.rotation.y = index * 0.84;
      grass.scale.setScalar(0.7 + (index % 4) * 0.12);
      terrain.add(grass);
    }

    const mountainGeometry = new THREE.ConeGeometry(4.2, 6.7, 7);
    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x122d2a, roughness: 0.97, metalness: 0.04 });
    disposables.push(mountainGeometry); materials.push(mountainMaterial);
    for (const [x, z, scale] of [[-8, -19, 1.2], [-2.8, -21.4, 1.5], [4.8, -20.5, 1.35], [9, -18.8, 1.12]] as const) {
      const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
      mountain.position.set(x, 2.6 * scale, z);
      mountain.scale.set(scale, scale, scale);
      terrain.add(mountain);
    }

    const towerGeometry = new THREE.BoxGeometry(0.68, 4.8, 0.68);
    const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x192c24, roughness: 0.71, metalness: 0.45 });
    disposables.push(towerGeometry); materials.push(towerMaterial);
    const tower = new THREE.Mesh(towerGeometry, towerMaterial);
    tower.position.set(5.1, 2.38, -11.5);
    terrain.add(tower);
    const towerLamp = new THREE.PointLight(0xffca72, 4.2, 8, 1.8);
    towerLamp.position.set(5.1, 4.5, -11.2);
    terrain.add(towerLamp);

    const bow = new THREE.Group();
    const bowCurve = new THREE.TorusGeometry(1.3, 0.055, 8, 30, Math.PI);
    const bowMaterial = new THREE.MeshStandardMaterial({ color: 0xad6b32, metalness: 0.35, roughness: 0.42 });
    disposables.push(bowCurve); materials.push(bowMaterial);
    const bowArc = new THREE.Mesh(bowCurve, bowMaterial);
    bowArc.rotation.z = -Math.PI / 2;
    bow.add(bowArc);
    const stringGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.3, 0, 0), new THREE.Vector3(0.12, 0, 0), new THREE.Vector3(1.3, 0, 0)]);
    const stringMaterial = new THREE.LineBasicMaterial({ color: 0xeaffea, transparent: true, opacity: 0.88 });
    disposables.push(stringGeometry); materials.push(stringMaterial);
    bow.add(new THREE.Line(stringGeometry, stringMaterial));
    bow.position.set(-3.15, 1.1, 4.1);
    bow.rotation.z = -0.12;
    scene.add(bow);

    const arrowGeometry = new THREE.CylinderGeometry(0.022, 0.022, 2.2, 7);
    const arrowMaterial = new THREE.MeshStandardMaterial({ color: 0xd5ead8, metalness: 0.48, roughness: 0.3 });
    disposables.push(arrowGeometry); materials.push(arrowMaterial);
    const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(-2.15, 1.1, 4.08);
    scene.add(arrow);

    const targetMeshes: THREE.Mesh[] = [];
    const targetGroups = new Map<RangerRangeTarget, THREE.Group>();
    const targetMaterials = new Map<RangerRangeTarget, THREE.MeshStandardMaterial>();
    const targetLights = new Map<RangerRangeTarget, THREE.PointLight>();
    const targetGeometry = new THREE.CylinderGeometry(0.7, 0.7, 0.12, 24);
    const ringGeometry = new THREE.TorusGeometry(0.69, 0.04, 8, 24);
    const standGeometry = new THREE.CylinderGeometry(0.045, 0.07, 1.5, 7);
    const standMaterial = new THREE.MeshStandardMaterial({ color: 0x5c442b, roughness: 0.72, metalness: 0.18 });
    disposables.push(targetGeometry, ringGeometry, standGeometry); materials.push(standMaterial);
    for (const target of TARGETS) {
      const group = new THREE.Group();
      group.position.set(target.x, 1.1 * target.distance, target.z);
      const material = new THREE.MeshStandardMaterial({ color: 0x425b4a, emissive: 0x07160e, emissiveIntensity: 0.5, roughness: 0.36, metalness: 0.55 });
      materials.push(material); targetMaterials.set(target.id, material);
      const plate = new THREE.Mesh(targetGeometry, material);
      plate.rotation.x = Math.PI / 2;
      plate.userData.target = target.id;
      group.add(plate); targetMeshes.push(plate);
      const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x9ecab0, transparent: true, opacity: 0.45 });
      materials.push(ringMaterial);
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
      terrain.add(group); targetGroups.set(target.id, group);
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
      if (target && target === liveTargetRef.current) fireRef.current(target);
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
        const light = targetLights.get(target.id);
        if (!group || !material || !light) continue;
        const live = target.id === liveTargetRef.current;
        group.position.y = 1.1 * target.distance + (motionRunning ? Math.sin(seconds * 1.5 + target.x) * (live ? 0.13 : 0.035) : 0);
        material.color.setHex(live ? 0xe8c76e : 0x425b4a);
        material.emissive.setHex(live ? 0x8a5214 : 0x07160e);
        material.emissiveIntensity = live ? 1.35 : 0.5;
        light.intensity = live ? 3.3 + (motionRunning ? Math.sin(seconds * 7) * 0.7 : 0) : 0;
      }
      if (motionRunning) {
        terrain.rotation.y = -0.04 + Math.sin(seconds * 0.25) * 0.015;
        reticle.rotation.z = seconds * 0.7;
        reticleMaterial.opacity = 0.5 + Math.sin(seconds * 2.4) * 0.18;
        arrow.position.x = -2.15 + (liveTargetRef.current ? Math.sin(seconds * 3.2) * 0.06 : 0);
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
