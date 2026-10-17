"use client";

import { useEffect, useRef } from "react";
import * as ThreeModule from "three";
import type { EchoArrayIntensity, EchoArrayNode } from "@/lib/games-echo-array";

/* eslint-disable @typescript-eslint/no-explicit-any */
const THREE: any = ThreeModule;

type EchoArray3DProps = {
  intensity: EchoArrayIntensity;
  litNode: EchoArrayNode | null;
  inputOpen: boolean;
  disabled: boolean;
  motionRunning: boolean;
  onSelect: (node: EchoArrayNode) => void;
  onUnavailable: () => void;
};

const NODES: Array<{ id: EchoArrayNode; x: number; z: number; color: number }> = [
  { id: "north", x: 0, z: -2.35, color: 0x57dfff },
  { id: "east", x: 2.35, z: 0, color: 0xaa82ff },
  { id: "south", x: 0, z: 2.35, color: 0xf4ce62 },
  { id: "west", x: -2.35, z: 0, color: 0xffa45c },
];

const INTENSITY_TINT: Record<EchoArrayIntensity, number> = { scan: 0x62f0dc, echo: 0xffce72, blackout: 0xff7ab6 };

export function EchoArray3D({ intensity, litNode, inputOpen, disabled, motionRunning, onSelect, onUnavailable }: EchoArray3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onSelect);
  const disabledRef = useRef(disabled);
  const unavailableRef = useRef(onUnavailable);
  const stateRef = useRef({ intensity, litNode, inputOpen });
  const renderRef = useRef<(() => void) | null>(null);
  const applyStateRef = useRef<((state: { intensity: EchoArrayIntensity; litNode: EchoArrayNode | null; inputOpen: boolean }) => void) | null>(null);

  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);
  useEffect(() => {
    const nextState = { intensity, litNode, inputOpen };
    stateRef.current = nextState;
    applyStateRef.current?.(nextState);
    renderRef.current?.();
  }, [inputOpen, intensity, litNode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (typeof WebGLRenderingContext === "undefined") { unavailableRef.current(); return; }
    const initialState = stateRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05090e);
    scene.fog = new THREE.FogExp2(0x05090e, 0.1);
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.set(5.9, 6.5, 7.7);
    camera.lookAt(0, 0.3, 0);
    let renderer: any;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true }); }
    catch { unavailableRef.current(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.domElement.dataset.dznEchoArrayCanvas = "true";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometries: any[] = [];
    const materials: any[] = [];
    const dispose = () => { geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); renderer.dispose(); };
    scene.add(new THREE.HemisphereLight(0xd9fbff, 0x071014, 2.3));
    const key = new THREE.DirectionalLight(0x9deef2, 3.1); key.position.set(-3, 7, 5); scene.add(key);
    const accent = new THREE.PointLight(INTENSITY_TINT[initialState.intensity], 16, 13, 1.9); accent.position.set(0, 3, 0); scene.add(accent);
    const chamber = new THREE.Group(); chamber.rotation.y = -0.12; scene.add(chamber);
    const baseGeometry = new THREE.CylinderGeometry(4.25, 4.6, 0.34, 10);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x0d1c23, emissive: 0x061117, emissiveIntensity: 0.85, metalness: 0.76, roughness: 0.28 });
    geometries.push(baseGeometry); materials.push(baseMaterial);
    const base = new THREE.Mesh(baseGeometry, baseMaterial); base.position.y = -0.42; chamber.add(base);
    const ringGeometry = new THREE.TorusGeometry(3.7, 0.045, 8, 64);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: INTENSITY_TINT[initialState.intensity], transparent: true, opacity: 0.72 });
    geometries.push(ringGeometry); materials.push(ringMaterial);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.rotation.x = Math.PI / 2; ring.position.y = -0.22; chamber.add(ring);
    const coreGeometry = new THREE.OctahedronGeometry(0.54, 1);
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0xd5ffff, emissive: INTENSITY_TINT[initialState.intensity], emissiveIntensity: 1.8, metalness: 0.62, roughness: 0.18 });
    geometries.push(coreGeometry); materials.push(coreMaterial);
    const core = new THREE.Mesh(coreGeometry, coreMaterial); core.position.y = 0.46; chamber.add(core);
    const nodeGeometry = new THREE.OctahedronGeometry(0.47, 1);
    const pedestalGeometry = new THREE.CylinderGeometry(0.38, 0.54, 0.34, 8);
    geometries.push(nodeGeometry, pedestalGeometry);
    const hitboxes: any[] = [];
    const visuals: any[] = [];
    NODES.forEach(node => {
      const group = new THREE.Group(); group.position.set(node.x, 0, node.z);
      const pedestalMaterial = new THREE.MeshStandardMaterial({ color: 0x10222b, emissive: 0x07131a, emissiveIntensity: 0.45, metalness: 0.76, roughness: 0.28 });
      const nodeMaterial = new THREE.MeshStandardMaterial({ color: node.color, emissive: node.color, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.22 });
      materials.push(pedestalMaterial, nodeMaterial);
      const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial); pedestal.position.y = 0.04; group.add(pedestal);
      const prism = new THREE.Mesh(nodeGeometry, nodeMaterial); prism.position.y = 0.5; group.add(prism);
      const haloGeometry = new THREE.TorusGeometry(0.68, 0.026, 6, 32);
      const haloMaterial = new THREE.MeshBasicMaterial({ color: node.color, transparent: true, opacity: 0.45 });
      geometries.push(haloGeometry); materials.push(haloMaterial);
      const halo = new THREE.Mesh(haloGeometry, haloMaterial); halo.rotation.x = Math.PI / 2; halo.position.y = 0.22; group.add(halo);
      const hitboxGeometry = new THREE.SphereGeometry(0.7, 12, 8);
      const hitboxMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      geometries.push(hitboxGeometry); materials.push(hitboxMaterial);
      const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial); hitbox.position.y = 0.42; hitbox.userData = { id: node.id, group, selectable: false }; group.add(hitbox);
      hitboxes.push(hitbox); visuals.push({ id: node.id, color: node.color, prism, nodeMaterial, pedestalMaterial, halo, haloMaterial, hitbox }); chamber.add(group);
    });
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(192);
    for (let index = 0; index < particlePositions.length; index += 3) { const sample = index / 3; particlePositions[index] = ((sample * 17) % 18) * 0.42 - 3.8; particlePositions[index + 1] = 0.3 + ((sample * 7) % 22) * 0.11; particlePositions[index + 2] = ((sample * 29) % 18) * 0.42 - 3.8; }
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({ color: INTENSITY_TINT[initialState.intensity], size: 0.032, transparent: true, opacity: 0.55, depthWrite: false });
    geometries.push(particleGeometry); materials.push(particleMaterial);
    const particles = new THREE.Points(particleGeometry, particleMaterial); scene.add(particles);
    const applyState = (state: { intensity: EchoArrayIntensity; litNode: EchoArrayNode | null; inputOpen: boolean }) => {
      const tint = INTENSITY_TINT[state.intensity];
      accent.color.setHex(tint); ringMaterial.color.setHex(tint); coreMaterial.emissive.setHex(tint); particleMaterial.color.setHex(tint);
      visuals.forEach(visual => {
        const lit = state.litNode === visual.id;
        visual.nodeMaterial.emissiveIntensity = lit ? 2.5 : state.inputOpen ? 1.05 : 0.48;
        visual.pedestalMaterial.emissive.setHex(lit ? visual.color : 0x07131a);
        visual.pedestalMaterial.emissiveIntensity = lit ? 0.85 : 0.42;
        visual.haloMaterial.opacity = lit ? 0.95 : state.inputOpen ? 0.6 : 0.3;
        visual.hitbox.userData.selectable = state.inputOpen;
      });
    };
    applyStateRef.current = applyState; applyState(initialState);
    renderRef.current = () => renderer.render(scene, camera);
    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    let armed: { id: number; node: EchoArrayNode; x: number; y: number; moved: boolean } | null = null; let hovered: any = null; let pointerX = 0; let pointerY = 0; let frame = 0;
    const hit = (event: PointerEvent) => { const bounds = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1; pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1; pointerX = pointer.x; pointerY = pointer.y; raycaster.setFromCamera(pointer, camera); return raycaster.intersectObjects(hitboxes, false)[0]?.object as any; };
    const move = (event: PointerEvent) => { if (!event.isPrimary) return; if (armed && armed.id === event.pointerId && Math.hypot(event.clientX - armed.x, event.clientY - armed.y) > 8) armed.moved = true; const next = hit(event) ?? null; if (hovered !== next) { if (hovered?.userData.group) hovered.userData.group.scale.setScalar(1); hovered = next; if (hovered?.userData.selectable) hovered.userData.group.scale.setScalar(1.08); renderer.render(scene, camera); } renderer.domElement.style.cursor = hovered?.userData.selectable && !disabledRef.current ? "pointer" : "default"; };
    const down = (event: PointerEvent) => { if (!event.isPrimary || event.button !== 0 || disabledRef.current || armed) return; const next = hit(event); armed = next?.userData.selectable ? { id: event.pointerId, node: next.userData.id, x: event.clientX, y: event.clientY, moved: false } : null; if (armed && renderer.domElement.setPointerCapture) renderer.domElement.setPointerCapture(event.pointerId); };
    const up = (event: PointerEvent) => { if (!event.isPrimary) return; const started = armed; armed = null; if (event.button !== 0 || disabledRef.current || !started || started.id !== event.pointerId || started.moved) return; const next = hit(event); if (next?.userData.selectable && next.userData.id === started.node) selectRef.current(started.node); };
    const leave = () => { if (hovered?.userData.group) { hovered.userData.group.scale.setScalar(1); renderer.render(scene, camera); } hovered = null; renderer.domElement.style.cursor = "default"; };
    const cancel = (event: PointerEvent) => { if (event.isPrimary) armed = null; };
    renderer.domElement.addEventListener("pointermove", move); renderer.domElement.addEventListener("pointerleave", leave); renderer.domElement.addEventListener("pointerdown", down); renderer.domElement.addEventListener("pointerup", up); renderer.domElement.addEventListener("pointercancel", cancel);
    const resize = new ResizeObserver(entries => { const width = Math.max(1, entries[0]?.contentRect.width ?? mount.clientWidth); const height = Math.max(1, entries[0]?.contentRect.height ?? mount.clientHeight); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.render(scene, camera); }); resize.observe(mount);
    const cleanup = () => { window.cancelAnimationFrame(frame); resize.disconnect(); renderer.domElement.removeEventListener("pointermove", move); renderer.domElement.removeEventListener("pointerleave", leave); renderer.domElement.removeEventListener("pointerdown", down); renderer.domElement.removeEventListener("pointerup", up); renderer.domElement.removeEventListener("pointercancel", cancel); applyStateRef.current = null; renderRef.current = null; mount.removeChild(renderer.domElement); dispose(); };
    if (!motionRunning) { renderer.render(scene, camera); return cleanup; }
    const start = performance.now(); const render = (time: number) => { const elapsed = (time - start) / 1000; chamber.rotation.y += ((-0.12 + pointerX * 0.11) - chamber.rotation.y) * 0.03; chamber.rotation.x += ((pointerY * -0.045) - chamber.rotation.x) * 0.025; ring.rotation.z = elapsed * 0.14; core.rotation.y = elapsed * 0.8; visuals.forEach((visual, index) => { visual.prism.position.y = 0.5 + Math.sin(elapsed * 2.2 + index) * 0.06; visual.halo.rotation.z = elapsed * (0.7 + index * 0.08); }); particles.rotation.y = elapsed * 0.05; renderer.render(scene, camera); frame = window.requestAnimationFrame(render); };
    frame = window.requestAnimationFrame(render); return cleanup;
  }, [motionRunning]);

  return <div ref={mountRef} className="dzn-echo-array-3d" aria-hidden="true" />;
}
