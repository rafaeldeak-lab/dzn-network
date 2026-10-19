"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { RangerRangeCourse, RangerRangeTarget, RangerRangeWind } from "@/lib/games-ranger-range";

type RangerRange3DProps = {
  safeTarget: RangerRangeTarget | null;
  wind: RangerRangeWind | null;
  course: RangerRangeCourse | "legacy";
  active: boolean;
  sightReady: boolean;
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

export function RangerRange3D({ safeTarget, wind, course, active, sightReady, disabled, motionRunning, onFire }: RangerRange3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const fireRef = useRef(onFire);
  const disabledRef = useRef(disabled);
  const liveTargetRef = useRef<RangerRangeTarget | null>(safeTarget);
  const windRef = useRef<RangerRangeWind | null>(wind);
  const courseRef = useRef<RangerRangeCourse | "legacy">(course);
  const sightReadyRef = useRef(sightReady);

  useEffect(() => { fireRef.current = onFire; }, [onFire]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { liveTargetRef.current = active ? safeTarget : null; }, [active, safeTarget]);
  useEffect(() => { windRef.current = active ? wind : null; }, [active, wind]);
  useEffect(() => { courseRef.current = course; }, [course]);
  useEffect(() => { sightReadyRef.current = sightReady; }, [sightReady]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const showFallback = () => {
      mount.dataset.webglFallback = "true";
      mount.style.display = "block";
      mount.style.minHeight = "318px";
    };
    if (typeof WebGLRenderingContext === "undefined") {
      showFallback();
      return;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07100b, 0.035);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);
    camera.position.set(0, 2.8, 7.9);
    camera.lookAt(0, 1.15, -7.4);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      // Keep a visible, dimensioned art fallback and the DOM target deck when WebGL cannot initialise.
      showFallback();
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

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 42, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x112018, roughness: 0.95, metalness: 0.02, transparent: true, opacity: 0.72 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -9);
    scene.add(ground);

    // Readable landmarks and foreground depth keep the range spatially legible.
    const ridgeGeometry = new THREE.DodecahedronGeometry(1, 1);
    const ridgeMaterial = new THREE.MeshStandardMaterial({ color: 0x17291f, roughness: 0.92, metalness: 0.04 });
    const ridgeLocations = [
      [-8.8, 1.7, -14.8, 2.6, 1.8, 2.2], [-5.5, 1.15, -16.1, 1.8, 1.3, 1.6], [5.8, 1.5, -15.5, 2.1, 1.7, 1.9], [9.2, 1.8, -13.8, 2.8, 2.1, 2.2],
    ] as const;
    for (const [x, y, z, scaleX, scaleY, scaleZ] of ridgeLocations) {
      const ridge = new THREE.Mesh(ridgeGeometry, ridgeMaterial);
      ridge.position.set(x, y, z);
      ridge.scale.set(scaleX, scaleY, scaleZ);
      scene.add(ridge);
    }
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 18),
      new THREE.MeshStandardMaterial({ color: 0x2b3029, roughness: 0.94, metalness: 0.03, transparent: true, opacity: 0.82 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = 0.07;
    road.position.set(0.35, 0.012, -8.8);
    scene.add(road);
    const treeTrunkGeometry = new THREE.CylinderGeometry(0.045, 0.085, 0.82, 6);
    const treeFoliageGeometry = new THREE.ConeGeometry(0.34, 1.35, 7);
    const treeTrunkMaterial = new THREE.MeshStandardMaterial({ color: 0x312115, roughness: 0.95 });
    const treeFoliageMaterial = new THREE.MeshStandardMaterial({ color: 0x123123, roughness: 0.88, metalness: 0.01 });
    const pineLocations = [
      [-8.6, -4.6, 0.95], [-7.4, -7.8, 1.24], [-6.2, -12.6, 1.54], [-5.3, -9.3, 0.82], [-3.8, -14.2, 1.35], [-2.5, -11.4, 0.9],
      [2.8, -14.4, 1.48], [4.2, -8.5, 0.88], [5.9, -12.4, 1.52], [7.3, -7.6, 1.12], [8.5, -13.2, 1.62], [9.4, -5.5, 1.04],
    ] as const;
    for (const [x, z, scale] of pineLocations) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(treeTrunkGeometry, treeTrunkMaterial);
      trunk.position.y = 0.41;
      const foliage = new THREE.Mesh(treeFoliageGeometry, treeFoliageMaterial);
      foliage.position.y = 1.08;
      tree.add(trunk, foliage);
      tree.position.set(x, 0, z);
      tree.scale.setScalar(scale);
      scene.add(tree);
    }
    const towerGroup = new THREE.Group();
    towerGroup.position.set(-6.65, 0, -10.6);
    const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x3d3227, roughness: 0.82, metalness: 0.18 });
    for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 2.45, 6), towerMaterial);
      leg.position.set(x, 1.22, z);
      towerGroup.add(leg);
    }
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.54, 1.14), new THREE.MeshStandardMaterial({ color: 0x28342d, roughness: 0.68, metalness: 0.24 }));
    cabin.position.y = 2.55;
    towerGroup.add(cabin);
    const towerLamp = new THREE.PointLight(0xe6a84c, 2.4, 7.5, 2);
    towerLamp.position.set(0, 2.55, 0.52);
    towerGroup.add(towerLamp);
    scene.add(towerGroup);

    const bowGroup = new THREE.Group();
    bowGroup.position.set(-1.2, 0.65, 3.05);
    bowGroup.rotation.set(-0.08, 0.2, -0.06);
    const bowMaterial = new THREE.MeshStandardMaterial({ color: 0x9a5b2d, roughness: 0.44, metalness: 0.08 });
    const bowCore = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.72, 8), bowMaterial);
    bowGroup.add(bowCore);
    const upperLimb = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.34, 0), new THREE.Vector3(-0.35, 0.95, -0.08), new THREE.Vector3(-0.12, 1.65, -0.16),
    ]), 18, 0.052, 8, false);
    const lowerLimb = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.34, 0), new THREE.Vector3(-0.35, -0.95, -0.08), new THREE.Vector3(-0.12, -1.65, -0.16),
    ]), 18, 0.052, 8, false);
    bowGroup.add(new THREE.Mesh(upperLimb, bowMaterial), new THREE.Mesh(lowerLimb, bowMaterial));
    const stringGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.12, 1.65, -0.16), new THREE.Vector3(0.19, 0, 0.08), new THREE.Vector3(-0.12, -1.65, -0.16),
    ]);
    const stringMaterial = new THREE.LineBasicMaterial({ color: 0xe5f8d6, transparent: true, opacity: 0.84 });
    bowGroup.add(new THREE.Line(stringGeometry, stringMaterial));
    scene.add(bowGroup);

    const arrowGroup = new THREE.Group();
    arrowGroup.position.set(-1.01, 0.64, 2.65);
    const arrowMaterial = new THREE.MeshStandardMaterial({ color: 0xb39b75, roughness: 0.4, metalness: 0.16 });
    const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.6, 6), arrowMaterial);
    arrowShaft.rotation.x = Math.PI / 2;
    arrowGroup.add(arrowShaft);
    const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0xcad6d4, roughness: 0.24, metalness: 0.8 }));
    arrowHead.rotation.x = Math.PI / 2;
    arrowHead.position.z = -0.9;
    arrowGroup.add(arrowHead);
    const fletching = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.28), new THREE.MeshStandardMaterial({ color: 0x50dbc5, emissive: 0x0f403b, emissiveIntensity: 0.7 }));
    fletching.position.z = 0.56;
    arrowGroup.add(fletching);
    scene.add(arrowGroup);

    const windGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.45, 1.5, -4.8), new THREE.Vector3(-0.35, 1.68, -5.2), new THREE.Vector3(0.8, 1.46, -5.6),
    ]);
    const windMaterial = new THREE.LineBasicMaterial({ color: 0x72d9db, transparent: true, opacity: 0 });
    const windRibbon = new THREE.Line(windGeometry, windMaterial);
    scene.add(windRibbon);
    const windTrails = [-0.42, 0.32].map(offset => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.8, 1.15 + offset, -3.9), new THREE.Vector3(-0.35, 1.3 + offset, -5.45), new THREE.Vector3(1.55, 1.08 + offset, -6.35),
      ]);
      const material = new THREE.LineBasicMaterial({ color: 0x9bcfd8, transparent: true, opacity: 0 });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      return { line, material };
    });

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
    let releasedAt = 0;
    const onPointerMove = (event: PointerEvent) => {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(targetMeshes, false)[0]?.object as THREE.Mesh | undefined;
      renderer.domElement.style.cursor = hit?.userData.target === liveTargetRef.current && sightReadyRef.current && !disabledRef.current ? "crosshair" : "default";
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || disabledRef.current) return;
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(targetMeshes, false)[0]?.object as THREE.Mesh | undefined;
      const target = hit?.userData.target as RangerRangeTarget | undefined;
      // Selection is intentionally scored by the existing server action. Dropping a wrong
      // canvas click would make the 3D input easier than the accessible target deck.
      if (target && liveTargetRef.current && sightReadyRef.current) {
        releasedAt = performance.now();
        fireRef.current(target);
      }
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
      const activeCourse = courseRef.current;
      for (const target of TARGETS) {
        const group = targetGroups.get(target.id);
        const material = targetMaterials.get(target.id);
        const ringMaterial = targetRingMaterials.get(target.id);
        const light = targetLights.get(target.id);
        if (!group || !material || !ringMaterial || !light) continue;
        const live = target.id === liveTargetRef.current;
        const movement = activeCourse === "gale" ? 2.3 : activeCourse === "blackout" ? 1.95 : 1.5;
        group.position.y = 1.1 * target.distance + (motionRunning ? Math.sin(seconds * movement + target.x) * (live ? 0.13 : 0.035) : 0);
        material.color.setHex(live ? 0xe8c76e : 0x425b4a);
        material.emissive.setHex(live ? 0x8a5214 : 0x07160e);
        material.emissiveIntensity = live ? 1.35 : 0.5;
        material.opacity = live ? 0.8 : 0;
        ringMaterial.color.setHex(live ? 0xffe8a0 : 0x9ecab0);
        ringMaterial.opacity = live ? 0.96 : 0;
        light.intensity = live ? 3.3 + (motionRunning ? Math.sin(seconds * 7) * 0.7 : 0) : 0;
      }
      const activeWind = windRef.current;
      const direction = activeWind === "left" ? -1 : activeWind === "right" ? 1 : 0;
      windRibbon.visible = Boolean(activeWind);
      windMaterial.opacity = activeWind === "calm" ? 0.18 : 0.52;
      windMaterial.color.setHex(activeWind === "left" ? 0x76aaf1 : activeWind === "right" ? 0xebc36f : 0x8ab8ae);
      windTrails.forEach(({ line, material }, index) => {
        line.visible = Boolean(activeWind && activeWind !== "calm");
        material.opacity = activeWind && activeWind !== "calm" ? 0.16 + index * 0.08 : 0;
        material.color.setHex(activeWind === "left" ? 0x76aaf1 : 0xebc36f);
        line.position.x = motionRunning && activeWind !== "calm" ? Math.sin(seconds * (2.1 + index * 0.35) + index) * 0.22 * direction : 0;
      });
      if (motionRunning && activeWind !== "calm") {
        windRibbon.position.x = Math.sin(seconds * 2.4) * 0.15 * direction;
        windRibbon.rotation.z = Math.sin(seconds * 2.8) * 0.07 * direction;
        bowGroup.rotation.z = -0.06 + Math.sin(seconds * 3.3) * 0.018 * direction;
      } else {
        windRibbon.position.x = 0;
        windRibbon.rotation.z = 0;
        bowGroup.rotation.z = -0.06;
      }
      const arrowElapsed = releasedAt ? time - releasedAt : 0;
      if (arrowElapsed > 0 && arrowElapsed < 560) {
        arrowGroup.visible = true;
        arrowGroup.position.z = 2.65 - arrowElapsed * 0.022;
        arrowGroup.position.x = -1.01 + direction * Math.min(1.4, arrowElapsed * 0.0018);
      } else {
        arrowGroup.visible = arrowElapsed === 0 || arrowElapsed >= 560;
        arrowGroup.position.set(-1.01, 0.64, 2.65);
      }
      if (motionRunning) {
        reticle.rotation.z = seconds * 0.7;
        reticleMaterial.opacity = activeCourse === "blackout" ? 0.36 + Math.sin(seconds * 4.2) * 0.16 : 0.5 + Math.sin(seconds * 2.4) * 0.18;
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

  return <div ref={mountRef} className="dzn-ranger-range-3d" data-live={active && safeTarget ? "true" : "false"} style={{ display: "block" }} />;
}
