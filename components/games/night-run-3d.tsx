"use client";

import { useEffect, useRef } from "react";
import * as ThreeModule from "three";
import type { NightRunIntensity, NightRunLane } from "@/lib/games-night-run";

// Three's recursive declaration graph can exceed the TypeScript checker stack in this large client bundle.
/* eslint-disable @typescript-eslint/no-explicit-any */
const THREE: any = ThreeModule;

type NightRun3DProps = {
  safeLane: NightRunLane | null;
  active: boolean;
  disabled: boolean;
  motionRunning: boolean;
  requiresRecon: boolean;
  scannerAvailable: boolean;
  intensity: NightRunIntensity;
  gatesCleared: number;
  totalGates: number;
  collisions: number;
  onDrive: (lane: NightRunLane) => void;
};

const LANES: { id: NightRunLane; x: number; label: string }[] = [
  { id: "left", x: -3.15, label: "Left" },
  { id: "centre", x: 0, label: "Centre" },
  { id: "right", x: 3.15, label: "Right" },
];

export function NightRun3D({ safeLane, active, disabled, motionRunning, requiresRecon, scannerAvailable, intensity, gatesCleared, totalGates, collisions, onDrive }: NightRun3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const driveRef = useRef(onDrive);
  const disabledRef = useRef(disabled);

  useEffect(() => { driveRef.current = onDrive; }, [onDrive]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof WebGLRenderingContext === "undefined") return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070a1a, 0.038);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 110);
    camera.position.set(9.5, 7.6, 13.5);
    camera.lookAt(0, 0.25, -2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.dataset.dznNightRunCanvas = "true";
    renderer.domElement.dataset.dznNightRunRecon = scannerAvailable ? "masked" : requiresRecon ? "cleared" : "none";
    renderer.domElement.dataset.dznNightRunIntensity = intensity;
    renderer.domElement.dataset.dznNightRunGate = String(Math.min(totalGates, gatesCleared + 1));
    renderer.domElement.dataset.dznNightRunHull = String(Math.max(0, 100 - collisions * 50));
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);
    const backgroundScene = new THREE.Scene();
    const backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    backgroundCamera.position.z = 1;
    renderer.autoClear = false;
    const renderFrame = () => {
      renderer.clear();
      renderer.render(backgroundScene, backgroundCamera);
      renderer.clearDepth();
      renderer.render(scene, camera);
    };

    scene.add(new THREE.HemisphereLight(0x98b8ff, 0x0a0817, 2.6));
    const moon = new THREE.DirectionalLight(0x899bff, 3.6);
    moon.position.set(-7, 13, 8);
    scene.add(moon);
    const alert = new THREE.PointLight(0xc035ff, 16, 20, 1.6);
    alert.position.set(0, 3.6, -4.2);
    scene.add(alert);
    const cityGlow = new THREE.PointLight(0x318fff, 8, 28, 1.7);
    cityGlow.position.set(-6, 4.5, -7);
    scene.add(cityGlow);
    const districtGlow = new THREE.PointLight(0xff568f, 6, 22, 1.8);
    districtGlow.position.set(7, 3.3, -9);
    scene.add(districtGlow);

    const environment = new THREE.Group();
    environment.rotation.y = -0.04;
    scene.add(environment);
    const disposables: { dispose: () => void }[] = [];
    const materials: { dispose: () => void }[] = [];
    const textures: { dispose: () => void }[] = [];

    // Original district art is cropped like `background-size: cover`, preserving its aspect
    // ratio at every canvas size. The live road, gates, rain, lights, and hazards remain
    // real Three.js objects in front of it.
    const districtTexture = new THREE.TextureLoader().load("/images/games/night-run-district-v2.png", () => {
      // Reduced-motion mode intentionally has no continuous render loop, so a loaded
      // backdrop needs one explicit frame to appear after the first static render.
      renderFrame();
    });
    districtTexture.colorSpace = THREE.SRGBColorSpace;
    textures.push(districtTexture);
    const districtBackdropGeometry = new THREE.PlaneGeometry(2, 2);
    const districtBackdropMaterial = new THREE.MeshBasicMaterial({ map: districtTexture, depthTest: false, depthWrite: false });
    disposables.push(districtBackdropGeometry); materials.push(districtBackdropMaterial);
    const districtBackdrop = new THREE.Mesh(districtBackdropGeometry, districtBackdropMaterial);
    backgroundScene.add(districtBackdrop);
    const updateDistrictCrop = (width: number, height: number) => {
      const viewportAspect = width / height;
      const imageAspect = 16 / 9;
      if (viewportAspect >= imageAspect) {
        const repeatY = imageAspect / viewportAspect;
        districtTexture.repeat.set(1, repeatY);
        districtTexture.offset.set(0, (1 - repeatY) / 2);
        renderer.domElement.dataset.dznNightRunBackdropFit = "crop-y";
      } else {
        const repeatX = viewportAspect / imageAspect;
        districtTexture.repeat.set(repeatX, 1);
        districtTexture.offset.set((1 - repeatX) / 2, 0);
        renderer.domElement.dataset.dznNightRunBackdropFit = "crop-x";
      }
      districtTexture.needsUpdate = true;
    };

    const roadGeometry = new THREE.PlaneGeometry(12.8, 26, 1, 1);
    const roadTexture = createRoadTexture();
    textures.push(roadTexture);
    roadTexture.wrapS = THREE.RepeatWrapping;
    roadTexture.wrapT = THREE.RepeatWrapping;
    roadTexture.repeat.set(1.25, 3.6);
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x42689a,
      emissive: 0x07122f,
      emissiveIntensity: 0.9,
      metalness: 0.86,
      roughness: 0.25,
      map: roadTexture,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });
    disposables.push(roadGeometry); materials.push(roadMaterial);
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.z = -4.2;
    environment.add(road);

    const shoulderGeometry = new THREE.PlaneGeometry(23, 27);
    const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x060915, metalness: 0.22, roughness: 0.94, transparent: true, opacity: 0.22, depthWrite: false });
    disposables.push(shoulderGeometry); materials.push(shoulderMaterial);
    const shoulder = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
    shoulder.rotation.x = -Math.PI / 2;
    shoulder.position.set(0, -0.035, -4.4);
    environment.add(shoulder);

    const laneLines = new THREE.Group();
    for (const x of [-1.58, 1.58]) {
      const geometry = new THREE.BoxGeometry(0.055, 0.02, 25);
      const material = new THREE.MeshBasicMaterial({ color: 0x42cbff, transparent: true, opacity: 0.52 });
      disposables.push(geometry); materials.push(material);
      const line = new THREE.Mesh(geometry, material);
      line.position.set(x, 0.025, -4.25);
      laneLines.add(line);
    }
    environment.add(laneLines);

    const speedMarkers = new THREE.Group();
    const markerGeometry = new THREE.BoxGeometry(0.34, 0.025, 1.15);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x94eaff, transparent: true, opacity: 0.54 });
    disposables.push(markerGeometry); materials.push(markerMaterial);
    const roadMarkers: any[] = [];
    for (let index = 0; index < 18; index++) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set([-2.55, 0, 2.55][index % 3], 0.035, 8 - Math.floor(index / 3) * 3.4);
      marker.userData.seed = index;
      speedMarkers.add(marker);
      roadMarkers.push(marker);
    }
    environment.add(speedMarkers);

    // The detailed city belongs to the original district scene rather than placeholder
    // foreground blocks. Keeping the live layer to route-critical objects makes the
    // gate state easy to read without obscuring the city art.

    const signGeometry = new THREE.PlaneGeometry(1.7, 0.66);
    disposables.push(signGeometry);
    const signLabels = ["DZN//", "RELAY", "NIGHT", "PULSE", "ECHO", "RUN"];
    for (let index = 0; index < signLabels.length; index++) {
      const signTexture = createNeonSignTexture(signLabels[index], index % 2 ? "#67d7ff" : "#e377ff");
      textures.push(signTexture);
      const signMaterial = new THREE.MeshBasicMaterial({ map: signTexture, transparent: true, opacity: 0.94, depthWrite: false });
      materials.push(signMaterial);
      const sign = new THREE.Mesh(signGeometry, signMaterial);
      const side = index % 2 ? -1 : 1;
      sign.position.set(side * (6.35 + (index % 3) * 1.08), 2.3 + (index % 2) * 1.16, 3.6 - Math.floor(index / 2) * 4.2);
      sign.rotation.y = side * Math.PI / 2;
      sign.userData.seed = index;
      environment.add(sign);
    }

    // The player convoy is deliberately built in-scene rather than represented by a
    // single placeholder box: a low rally chassis, plated cabin, running gear, signal
    // mast and reactive tail lamps make the route read as an actual escape vehicle.
    const vehicle = new THREE.Group();
    const vehicleGeometry = new THREE.BoxGeometry(1.28, 0.28, 2.1);
    const vehicleMaterial = new THREE.MeshStandardMaterial({ color: 0x1c6fbb, emissive: 0x062a65, emissiveIntensity: 1.25, metalness: 0.9, roughness: 0.19 });
    const bumperGeometry = new THREE.BoxGeometry(1.42, 0.16, 0.22);
    const bumperMaterial = new THREE.MeshStandardMaterial({ color: 0x111b2d, metalness: 0.92, roughness: 0.26 });
    const cabinGeometry = new THREE.BoxGeometry(0.82, 0.36, 0.9);
    const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x071226, emissive: 0x0c509f, emissiveIntensity: 1.15, metalness: 0.76, roughness: 0.13 });
    const wingGeometry = new THREE.BoxGeometry(1.66, 0.06, 0.4);
    const wheelGeometry = new THREE.CylinderGeometry(0.27, 0.27, 0.18, 12);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x06070c, roughness: 0.62, metalness: 0.31 });
    const hubMaterial = new THREE.MeshStandardMaterial({ color: 0x74e9ff, emissive: 0x166a93, emissiveIntensity: 1.65, metalness: 0.9, roughness: 0.17 });
    const exhaustGeometry = new THREE.CylinderGeometry(0.065, 0.09, 0.33, 10);
    const signalGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8);
    const headlightGeometry = new THREE.BoxGeometry(0.22, 0.08, 0.04);
    const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xbef7ff, transparent: true, opacity: 0.95 });
    const tailLightMaterial = new THREE.MeshBasicMaterial({ color: 0xff4f91, transparent: true, opacity: 0.92 });
    disposables.push(vehicleGeometry, bumperGeometry, cabinGeometry, wingGeometry, wheelGeometry, exhaustGeometry, signalGeometry, headlightGeometry);
    materials.push(vehicleMaterial, bumperMaterial, cabinMaterial, wheelMaterial, hubMaterial, headlightMaterial, tailLightMaterial);
    const vehicleBody = new THREE.Mesh(vehicleGeometry, vehicleMaterial);
    vehicleBody.position.y = 0.31;
    vehicle.add(vehicleBody);
    const frontBumper = new THREE.Mesh(bumperGeometry, bumperMaterial);
    frontBumper.position.set(0, 0.25, -1.06);
    vehicle.add(frontBumper);
    const rearBumper = frontBumper.clone();
    rearBumper.position.z = 1.06;
    vehicle.add(rearBumper);
    const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
    cabin.position.set(0, 0.62, -0.1);
    vehicle.add(cabin);
    const wing = new THREE.Mesh(wingGeometry, bumperMaterial);
    wing.position.set(0, 0.62, 0.93);
    vehicle.add(wing);
    const vehicleLights: any[] = [];
    for (const x of [-0.43, 0.43]) {
      for (const z of [-0.71, 0.73]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.22, z);
        vehicle.add(wheel);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.185, 10), hubMaterial);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(x + (x < 0 ? -0.004 : 0.004), 0.22, z);
        vehicle.add(hub);
        disposables.push(hub.geometry);
      }
      const headlamp = new THREE.Mesh(headlightGeometry, headlightMaterial);
      headlamp.position.set(x, 0.4, -1.17);
      vehicle.add(headlamp);
      const tailLamp = new THREE.Mesh(headlightGeometry, tailLightMaterial);
      tailLamp.position.set(x, 0.4, 1.17);
      vehicle.add(tailLamp);
      vehicleLights.push(tailLamp);
    }
    for (const x of [-0.34, 0.34]) {
      const exhaust = new THREE.Mesh(exhaustGeometry, hubMaterial);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(x, 0.25, 1.15);
      vehicle.add(exhaust);
    }
    const mast = new THREE.Mesh(signalGeometry, hubMaterial);
    mast.position.set(0, 1.15, 0.12);
    vehicle.add(mast);
    const mastBeacon = new THREE.PointLight(0x69eaff, 2.8, 3.6, 2);
    mastBeacon.position.set(0, 1.4, 0.12);
    vehicle.add(mastBeacon);
    const exhaustLight = new THREE.PointLight(0x439dff, 4.6, 4.5, 2);
    exhaustLight.position.set(0, 0.35, 1.45);
    vehicle.add(exhaustLight);
    vehicle.position.set(0, 0, 5.6);
    environment.add(vehicle);

    const pursuerGeometry = new THREE.BoxGeometry(0.74, 0.2, 1.28);
    const pursuerCabinGeometry = new THREE.BoxGeometry(0.46, 0.2, 0.56);
    const pursuerMaterial = new THREE.MeshStandardMaterial({ color: 0x381445, emissive: 0x4f104f, emissiveIntensity: 1.35, metalness: 0.88, roughness: 0.19 });
    const pursuerCabinMaterial = new THREE.MeshStandardMaterial({ color: 0x16071f, emissive: 0x9d2e9a, emissiveIntensity: 1.2, metalness: 0.76, roughness: 0.14 });
    disposables.push(pursuerGeometry, pursuerCabinGeometry); materials.push(pursuerMaterial, pursuerCabinMaterial);
    const pursuers: any[] = [];
    for (let index = 0; index < 3; index++) {
      const pursuer = new THREE.Group();
      const body = new THREE.Mesh(pursuerGeometry, pursuerMaterial);
      body.position.y = 0.17;
      pursuer.add(body);
      const canopy = new THREE.Mesh(pursuerCabinGeometry, pursuerCabinMaterial);
      canopy.position.set(0, 0.4, -0.05);
      pursuer.add(canopy);
      const interceptorLight = new THREE.PointLight(0xff3b9d, 2.5, 3.2, 2);
      interceptorLight.position.set(0, 0.35, -0.74);
      pursuer.add(interceptorLight);
      pursuer.userData = { index, x: [-4.6, 4.5, 0][index], z: -2.1 - index * 3.2 };
      pursuer.position.set(pursuer.userData.x, 0.02, pursuer.userData.z);
      pursuers.push(pursuer);
      environment.add(pursuer);
    }

    const gateGroup = new THREE.Group();
    const gateHitboxes: any[] = [];
    const gateMaterials = new Map<NightRunLane, any>();
    const gateLights = new Map<NightRunLane, any>();
    const gatePostGeometry = new THREE.BoxGeometry(2.32, 2.9, 0.2);
    const gateBeamGeometry = new THREE.BoxGeometry(2.48, 0.18, 0.28);
    const hitboxGeometry = new THREE.BoxGeometry(2.4, 2.65, 0.58);
    disposables.push(gatePostGeometry, gateBeamGeometry, hitboxGeometry);
    for (const lane of LANES) {
      const masked = scannerAvailable && active;
      const material = new THREE.MeshStandardMaterial({ color: lane.id === safeLane && active ? 0x37e6af : masked ? 0xb55c23 : 0x5b1b89, emissive: lane.id === safeLane && active ? 0x075e44 : masked ? 0x4a1808 : 0x260a50, emissiveIntensity: lane.id === safeLane && active ? 1.38 : masked ? 1.2 : 0.86, metalness: 0.76, roughness: 0.28 });
      const hitboxMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const beamMaterial = new THREE.MeshBasicMaterial({ color: lane.id === safeLane && active ? 0x9fffe2 : masked ? 0xffb45a : 0xc37aff, transparent: true, opacity: lane.id === safeLane && active ? 0.98 : masked ? 0.78 : 0.62 });
      materials.push(material, hitboxMaterial, beamMaterial);
      gateMaterials.set(lane.id, material);
      const leftPost = new THREE.Mesh(gatePostGeometry, material);
      leftPost.scale.x = 0.12;
      leftPost.position.set(lane.x - 1.12, 1.32, -4.1);
      gateGroup.add(leftPost);
      const rightPost = leftPost.clone();
      rightPost.position.x = lane.x + 1.12;
      gateGroup.add(rightPost);
      const beam = new THREE.Mesh(gateBeamGeometry, beamMaterial);
      beam.position.set(lane.x, 2.55, -4.1);
      gateGroup.add(beam);
      const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
      hitbox.position.set(lane.x, 1.28, -4.16);
      hitbox.userData = { lane: lane.id };
      gateGroup.add(hitbox);
      gateHitboxes.push(hitbox);
      const light = new THREE.PointLight(lane.id === safeLane && active ? 0x46ffc1 : 0xba67ff, lane.id === safeLane && active ? 4.8 : 2.2, 6.4, 2);
      light.position.set(lane.x, 1.9, -3.85);
      gateGroup.add(light);
      gateLights.set(lane.id, light);
    }
    environment.add(gateGroup);

    const scannerRingGeometry = new THREE.TorusGeometry(1.28, 0.028, 8, 48);
    const scannerRingMaterial = new THREE.MeshBasicMaterial({ color: 0xffbd63, transparent: true, opacity: scannerAvailable ? 0.9 : 0.18, depthWrite: false });
    disposables.push(scannerRingGeometry); materials.push(scannerRingMaterial);
    const scannerRing = new THREE.Mesh(scannerRingGeometry, scannerRingMaterial);
    scannerRing.rotation.x = Math.PI / 2;
    scannerRing.position.set(0, 0.09, -3.95);
    scannerRing.visible = requiresRecon || scannerAvailable;
    gateGroup.add(scannerRing);

    const rainGeometry = new THREE.BufferGeometry();
    const rainPositions = new Float32Array(480 * 3);
    for (let index = 0; index < rainPositions.length; index += 3) {
      const sample = index / 3;
      rainPositions[index] = ((sample * 37) % 41) - 20;
      rainPositions[index + 1] = ((sample * 19) % 24) * 0.34 + 0.5;
      rainPositions[index + 2] = ((sample * 23) % 42) - 22;
    }
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rainMaterial = new THREE.PointsMaterial({ color: 0x8dc9ff, size: 0.035, transparent: true, opacity: 0.48, depthWrite: false });
    const rain = new THREE.Points(rainGeometry, rainMaterial);
    disposables.push(rainGeometry); materials.push(rainMaterial);
    scene.add(rain);

    const starGeometry = new THREE.BufferGeometry();
    const stars = new Float32Array(270);
    for (let index = 0; index < stars.length; index += 3) {
      const sample = index / 3;
      stars[index] = ((sample * 29) % 31) - 15;
      stars[index + 1] = 2 + ((sample * 17) % 19) * 0.44;
      stars[index + 2] = -22 + ((sample * 13) % 32);
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0x95baff, size: 0.055, transparent: true, opacity: 0.92 });
    disposables.push(starGeometry); materials.push(starMaterial);
    const starField = new THREE.Points(starGeometry, starMaterial);
    scene.add(starField);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    function hitLane(event: PointerEvent) {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      pointerX = pointer.x; pointerY = pointer.y;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(gateHitboxes, false)[0]?.object.userData.lane as NightRunLane | undefined;
    }
    function onPointerMove(event: PointerEvent) {
      const lane = hitLane(event);
      renderer.domElement.style.cursor = lane && active && !disabledRef.current ? "pointer" : "default";
    }
    function onPointerLeave() { renderer.domElement.style.cursor = "default"; }
    function onPointerUp(event: PointerEvent) {
      if (event.button !== 0 || disabledRef.current || !active) return;
      const lane = hitLane(event);
      if (lane) driveRef.current(lane);
    }
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resize = new ResizeObserver(entries => {
      const width = Math.max(1, entries[0]?.contentRect.width ?? mount.clientWidth);
      const height = Math.max(1, entries[0]?.contentRect.height ?? mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updateDistrictCrop(width, height);
      renderFrame();
    });
    resize.observe(mount);

    const started = performance.now();
    function render(time: number) {
      const elapsed = (time - started) / 1_000;
      if (motionRunning) {
        environment.rotation.y += ((-0.04 + pointerX * 0.055) - environment.rotation.y) * 0.03;
        environment.rotation.x += ((pointerY * -0.025) - environment.rotation.x) * 0.025;
        const convoyTargetX = active ? safeLane === "left" ? -0.45 : safeLane === "right" ? 0.45 : 0 : 0;
        vehicle.position.x += (convoyTargetX - vehicle.position.x) * 0.018;
        vehicle.rotation.z = -vehicle.position.x * 0.05;
        vehicle.position.y = Math.sin(elapsed * 3.2) * 0.018;
        vehicle.rotation.y = Math.sin(elapsed * 0.72) * 0.012;
        mastBeacon.intensity = 2.4 + Math.sin(elapsed * 5.8) * 0.78;
        exhaustLight.intensity = active ? 4.4 + Math.sin(elapsed * 9.2) * 1.4 : 1.6;
        vehicleLights.forEach((light, index) => {
          light.material.opacity = intensity === "lockdown" ? 0.58 + Math.sin(elapsed * 10 + index) * 0.34 : 0.92;
        });
        pursuers.forEach((pursuer) => {
          const pressure = intensity === "lockdown" ? 1 : intensity === "pursuit" ? 0.64 : 0.28;
          const targetZ = pursuer.userData.z + pressure * 4.4;
          pursuer.position.z = targetZ + Math.sin(elapsed * 1.7 + pursuer.userData.index) * 0.38;
          pursuer.position.x = pursuer.userData.x + Math.sin(elapsed * 1.28 + pursuer.userData.index * 2.1) * (0.25 + pressure * 0.3);
          pursuer.position.y = 0.06 + Math.sin(elapsed * 2.1 + pursuer.userData.index) * 0.07;
          pursuer.rotation.z = Math.sin(elapsed * 1.28 + pursuer.userData.index * 2.1) * -0.08;
        });
        gateGroup.position.z = Math.sin(elapsed * 1.7) * 0.05;
        roadTexture.offset.y = -(elapsed * 0.36 % 1);
        roadMarkers.forEach((marker, index) => {
          marker.position.z = 7.8 - ((elapsed * 8.6 + index * 3.4) % 20.4);
          marker.material.opacity = 0.28 + (Math.sin(elapsed * 4 + index) + 1) * 0.13;
        });
        alert.intensity = 14 + Math.sin(elapsed * 2.5) * 3;
        const masked = scannerAvailable && active;
        scannerRing.visible = requiresRecon || scannerAvailable;
        scannerRing.material.opacity = masked ? 0.62 + Math.sin(elapsed * 4.2) * 0.22 : requiresRecon ? 0.22 : 0;
        scannerRing.rotation.z = elapsed * (masked ? 1.8 : 0.28);
        scannerRing.scale.setScalar(masked ? 1 + Math.sin(elapsed * 3.6) * 0.08 : 1);
        for (const lane of LANES) {
          const live = lane.id === safeLane && active;
          const material = gateMaterials.get(lane.id)!;
          material.emissiveIntensity = (live ? 1.25 : masked ? 1.1 : 0.7) + Math.sin(elapsed * 3.4 + lane.x) * (live ? 0.24 : masked ? 0.2 : 0.08);
          gateLights.get(lane.id)!.intensity = (live ? 4.6 : masked ? 3.2 : 1.8) + Math.sin(elapsed * 2.8 + lane.x) * 0.45;
        }
        const rainPosition = rainGeometry.attributes.position;
        for (let index = 1; index < rainPosition.array.length; index += 3) {
          rainPosition.array[index] -= 0.16 + ((index / 3) % 7) * 0.011;
          rainPosition.array[index + 1] += 0.07;
          if (rainPosition.array[index] < 0.15) {
            rainPosition.array[index] = 8.4;
            rainPosition.array[index + 1] -= 8;
          }
        }
        rainPosition.needsUpdate = true;
        starField.rotation.y = elapsed * 0.014;
      }
      renderFrame();
      renderer.domElement.dataset.renderFrames = String(Number(renderer.domElement.dataset.renderFrames ?? 0) + 1);
      if (motionRunning) frame = requestAnimationFrame(render);
    }
    render(performance.now());

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      disposables.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active, collisions, gatesCleared, intensity, motionRunning, requiresRecon, safeLane, scannerAvailable, totalGates]);

  return <div ref={mountRef} className="dzn-night-run-3d" data-safe-lane={safeLane ?? "waiting"} />;
}

function createRoadTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#17254a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const sheen = context.createLinearGradient(0, 0, canvas.width, 0);
    sheen.addColorStop(0, "#081127");
    sheen.addColorStop(0.48, "#263a66");
    sheen.addColorStop(1, "#081127");
    context.fillStyle = sheen;
    context.globalAlpha = 0.65;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = 0.24;
    for (let y = 0; y < canvas.height; y += 22) {
      context.fillStyle = y % 44 ? "#95d5ff" : "#7b56ff";
      context.fillRect(18 + (y % 32), y, canvas.width - 36, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createNeonSignTexture(label: string, colour: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 120;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#071025";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = colour;
    context.globalAlpha = 0.8;
    context.lineWidth = 5;
    context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    context.globalAlpha = 1;
    context.shadowColor = colour;
    context.shadowBlur = 18;
    context.fillStyle = colour;
    context.font = "900 47px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
