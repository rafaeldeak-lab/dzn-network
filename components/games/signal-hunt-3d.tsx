"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type SignalHunt3DProps = {
  active: boolean;
  foundCount: number;
  misses: number;
  scanPoint: { x: number; y: number };
  motionRunning: boolean;
  onUnavailable: () => void;
};

type HuntVisualState = Pick<SignalHunt3DProps, "active" | "foundCount" | "misses" | "scanPoint">;

export function SignalHunt3D({ active, foundCount, misses, scanPoint, motionRunning, onUnavailable }: SignalHunt3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HuntVisualState>({ active, foundCount, misses, scanPoint });
  const unavailableRef = useRef(onUnavailable);
  const applyStateRef = useRef<((state: HuntVisualState) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    const state = { active, foundCount, misses, scanPoint };
    stateRef.current = state;
    applyStateRef.current?.(state);
    renderRef.current?.();
  }, [active, foundCount, misses, scanPoint]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (typeof WebGLRenderingContext === "undefined") {
      unavailableRef.current();
      return;
    }

    const scene = new THREE.Scene();
    const overlayScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 70);
    camera.position.set(0, 7.2, 9.8);
    camera.lookAt(0, -0.25, 0);
    const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    overlayCamera.position.z = 2;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch {
      unavailableRef.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.dataset.dznSignalHuntCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const dispose = () => {
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      renderer.dispose();
    };

    const horizon = new THREE.GridHelper(14, 14, 0x67e4d5, 0x1a6663);
    horizon.position.y = -1.05;
    geometries.push(horizon.geometry);
    if (Array.isArray(horizon.material)) materials.push(...horizon.material);
    else materials.push(horizon.material);
    const horizonMaterial = (Array.isArray(horizon.material) ? horizon.material[0] : horizon.material) as THREE.LineBasicMaterial;
    horizonMaterial.transparent = true;
    horizonMaterial.opacity = 0.28;
    scene.add(horizon);

    const scanner = new THREE.Group();
    overlayScene.add(scanner);
    const ringGeometry = new THREE.TorusGeometry(0.065, 0.0048, 8, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x7df8e7, transparent: true, opacity: 0.92 });
    geometries.push(ringGeometry); materials.push(ringMaterial);
    const scanRing = new THREE.Mesh(ringGeometry, ringMaterial);
    scanner.add(scanRing);
    const outerRing = new THREE.Mesh(ringGeometry, ringMaterial);
    outerRing.scale.setScalar(1.85);
    outerRing.material = ringMaterial.clone();
    (outerRing.material as THREE.MeshBasicMaterial).opacity = 0.34;
    materials.push(outerRing.material as THREE.Material);
    scanner.add(outerRing);
    const beamGeometry = new THREE.ConeGeometry(0.06, 0.22, 24, 1, true);
    const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x52dacb, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
    geometries.push(beamGeometry); materials.push(beamMaterial);
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.y = 0.02;
    scanner.add(beam);

    const mastGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8);
    const mastMaterial = new THREE.MeshBasicMaterial({ color: 0x8af9ee, transparent: true, opacity: 0.62 });
    geometries.push(mastGeometry); materials.push(mastMaterial);
    for (let index = 0; index < 4; index++) {
      const angle = index / 4 * Math.PI * 2 + 0.24;
      const mast = new THREE.Mesh(mastGeometry, mastMaterial);
      mast.position.set(Math.cos(angle) * 4.8, -0.5, Math.sin(angle) * 3.1);
      mast.rotation.z = Math.sin(angle) * 0.24;
      scene.add(mast);
    }

    const routeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-6.2, -0.8, 2.8), new THREE.Vector3(-3.8, -0.6, 1.55), new THREE.Vector3(-1.5, -0.74, 2.25),
      new THREE.Vector3(0.6, -0.48, 0.7), new THREE.Vector3(3.1, -0.7, 1.3), new THREE.Vector3(6.4, -0.84, -1.7),
    ]);
    const routeMaterial = new THREE.LineDashedMaterial({ color: 0xe0b066, dashSize: 0.28, gapSize: 0.18, transparent: true, opacity: 0.68 });
    geometries.push(routeGeometry); materials.push(routeMaterial);
    const route = new THREE.Line(routeGeometry, routeMaterial);
    route.computeLineDistances();
    scene.add(route);

    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(116 * 3);
    for (let index = 0; index < particlePositions.length; index += 3) {
      const sample = index / 3;
      particlePositions[index] = ((sample * 11) % 23) * 0.58 - 6.4;
      particlePositions[index + 1] = ((sample * 7) % 17) * 0.08 - 0.48;
      particlePositions[index + 2] = ((sample * 13) % 19) * 0.42 - 3.9;
    }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0x90fff1, size: 0.035, transparent: true, opacity: 0.54, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const applyState = (state: HuntVisualState) => {
      // The scanner is an orthographic overlay: these values exactly match the reticle's percentage grid.
      const x = state.scanPoint.x / 1000 * 2 - 1;
      const y = 1 - state.scanPoint.y / 1000 * 2;
      const warning = Math.min(1, state.misses / 6);
      const activeColour = warning > 0.58 ? 0xffbb70 : 0x6ff4e0;
      scanner.position.set(x, y, 0);
      ringMaterial.color.setHex(state.active ? activeColour : 0x7c9e9d);
      ringMaterial.opacity = state.active ? 0.9 : 0.35;
      beamMaterial.color.setHex(state.active ? activeColour : 0x5a8784);
      beamMaterial.opacity = state.active ? 0.1 + state.foundCount * 0.025 : 0.035;
      (outerRing.material as THREE.MeshBasicMaterial).color.setHex(activeColour);
      (outerRing.material as THREE.MeshBasicMaterial).opacity = state.active ? 0.34 : 0.14;
      particleMaterial.color.setHex(state.active ? activeColour : 0x70a8a1);
      particleMaterial.opacity = state.active ? 0.48 + state.foundCount * 0.035 : 0.18;
      routeMaterial.color.setHex(warning > 0.58 ? 0xf5a85d : 0xd8d195);
      horizonMaterial.color.setHex(state.active ? 0x58d6cb : 0x477775);
      horizonMaterial.opacity = state.active ? 0.32 : 0.18;
    };
    applyStateRef.current = applyState;
    applyState(stateRef.current);
    const render = () => {
      renderer.clear();
      renderer.render(scene, camera);
      renderer.clearDepth();
      renderer.render(overlayScene, overlayCamera);
    };
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
      scanRing.rotation.z = elapsed * 0.55;
      outerRing.rotation.z = -elapsed * 0.3;
      outerRing.scale.setScalar(1.6 + Math.sin(elapsed * 1.35) * 0.28);
      beam.scale.y = 0.92 + Math.sin(elapsed * 1.9) * 0.1;
      particles.rotation.y = elapsed * 0.026;
      route.rotation.y = Math.sin(elapsed * 0.45) * 0.035;
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

  return <div ref={mountRef} className="dzn-signal-hunt-3d" aria-hidden="true" />;
}
