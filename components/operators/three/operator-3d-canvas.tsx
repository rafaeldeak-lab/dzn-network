"use client";

import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { OperatorWebglFallback } from "@/components/operators/three/operator-webgl-fallback";
import { getCameraPosition, type OperatorCameraView } from "@/lib/operators/three/operator-camera";
import { buildProceduralOperatorModel, disposeOperatorModel } from "@/lib/operators/three/operator-model-builder";
import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

type Operator3dCanvasProps = {
  loadout: FullOperatorLoadout;
  turntable: boolean;
  onTurntableChange: (enabled: boolean) => void;
};

export function Operator3dCanvas({ loadout, turntable, onTurntableChange }: Operator3dCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    model?: Awaited<ReturnType<typeof buildProceduralOperatorModel>>;
    renderer?: import("three").WebGLRenderer;
    scene?: import("three").Scene;
    camera?: import("three").PerspectiveCamera;
    frame?: number;
    rotation: number;
    zoom: number;
    pointer?: { x: number; rotation: number };
    visible: boolean;
    reducedMotion: boolean;
  }>({ rotation: 0, zoom: 5.4, visible: true, reducedMotion: false });
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [view, setView] = useState<OperatorCameraView>("front");

  const setCameraView = useCallback((nextView: OperatorCameraView) => {
    setView(nextView);
    const state = stateRef.current;
    if (!state.camera) return;
    const [x, y, z] = getCameraPosition(nextView);
    state.camera.position.set(x, y, z);
    state.camera.lookAt(0, 1.05, 0);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const canvas = document.createElement("canvas");
      const available = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
      setWebglAvailable(available);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!webglAvailable || !mountRef.current) return;
    let cancelled = false;
    const mount = mountRef.current;
    const state = stateRef.current;
    state.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    async function setup() {
      const THREE = await import("three");
      if (cancelled || !mountRef.current) return;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#02030a");
      const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 100);
      camera.position.set(...getCameraPosition(view));
      camera.lookAt(0, 1.05, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.shadowMap.enabled = true;
      mount.replaceChildren(renderer.domElement);
      renderer.domElement.setAttribute("aria-label", `${loadout.displayName} interactive 3D tactical DZN Operator preview`);
      renderer.domElement.setAttribute("role", "img");

      scene.add(new THREE.AmbientLight("#dbeafe", 1.6));
      const key = new THREE.DirectionalLight("#a7f3d0", 2.8);
      key.position.set(3, 5, 4);
      key.castShadow = true;
      scene.add(key);
      const rim = new THREE.DirectionalLight("#22d3ee", 2);
      rim.position.set(-4, 2, -3);
      scene.add(rim);

      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(1.65, 1.85, 0.08, 64),
        new THREE.MeshStandardMaterial({ color: "#052e2b", emissive: "#064e3b", emissiveIntensity: 0.36, roughness: 0.42, metalness: 0.28 }),
      );
      platform.name = "dzn_holographic_platform";
      platform.position.set(0, -0.61, 0);
      platform.receiveShadow = true;
      scene.add(platform);

      const model = await buildProceduralOperatorModel(loadout);
      if (cancelled) {
        disposeOperatorModel(model);
        return;
      }
      model.position.y = -0.05;
      scene.add(model);

      Object.assign(state, { renderer, scene, camera, model });
      animate();
    }

    function animate() {
      const current = stateRef.current;
      if (!current.renderer || !current.scene || !current.camera) return;
      if (current.visible && !document.hidden) {
        if (current.model) {
          if (turntable && !current.reducedMotion) current.rotation += 0.006;
          current.model.rotation.y = current.rotation;
          if (!current.reducedMotion) current.model.position.y = -0.05 + Math.sin(performance.now() / 900) * 0.015;
        }
        current.renderer.render(current.scene, current.camera);
      }
      current.frame = window.requestAnimationFrame(animate);
    }

    setup();

    const resizeObserver = new ResizeObserver(() => {
      const current = stateRef.current;
      if (!mountRef.current || !current.renderer || !current.camera) return;
      current.camera.aspect = mountRef.current.clientWidth / Math.max(1, mountRef.current.clientHeight);
      current.camera.updateProjectionMatrix();
      current.renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    });
    resizeObserver.observe(mount);

    const intersection = new IntersectionObserver(([entry]) => {
      stateRef.current.visible = Boolean(entry?.isIntersecting);
    });
    intersection.observe(mount);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      intersection.disconnect();
      const current = stateRef.current;
      if (current.frame) window.cancelAnimationFrame(current.frame);
      if (current.model && current.scene) {
        current.scene.remove(current.model);
        disposeOperatorModel(current.model);
      }
      current.renderer?.dispose();
      mount.replaceChildren();
      stateRef.current = { rotation: current.rotation, zoom: current.zoom, visible: true, reducedMotion: current.reducedMotion };
    };
  }, [loadout, turntable, view, webglAvailable]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    stateRef.current.pointer = { x: event.clientX, rotation: stateRef.current.rotation };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pointer = stateRef.current.pointer;
    if (!pointer) return;
    stateRef.current.rotation = pointer.rotation + (event.clientX - pointer.x) / 180;
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    stateRef.current.pointer = undefined;
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const state = stateRef.current;
    state.zoom = Math.min(7, Math.max(3.8, state.zoom + event.deltaY / 450));
    state.camera?.position.setLength(state.zoom);
    state.camera?.lookAt(0, 1.05, 0);
  }

  if (!webglAvailable) return <OperatorWebglFallback loadout={loadout} />;

  return (
    <div className="relative min-h-[34rem] overflow-hidden rounded-lg border border-emerald-300/20 bg-[#02030a]">
      <div
        ref={mountRef}
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_80%,rgba(34,197,94,.18),transparent_34%),linear-gradient(180deg,rgba(34,211,238,.08),transparent_34%,rgba(0,0,0,.32))]" />
      <div className="absolute left-3 top-3 flex flex-wrap gap-2">
        {(["front", "rear", "left", "right"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setCameraView(entry)}
            className={`min-h-9 rounded border px-3 text-[10px] font-black uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${view === entry ? "border-cyan-300/60 bg-cyan-300/20 text-cyan-50" : "border-white/10 bg-black/45 text-zinc-300"}`}
          >
            {entry}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            stateRef.current.rotation = 0;
            setCameraView("front");
          }}
          className="inline-flex min-h-9 items-center gap-2 rounded border border-white/10 bg-black/45 px-3 text-[10px] font-black uppercase text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Reset
        </button>
        <button
          type="button"
          onClick={() => onTurntableChange(!turntable)}
          className={`min-h-9 rounded border px-3 text-[10px] font-black uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${turntable ? "border-emerald-300/55 bg-emerald-300/18 text-emerald-50" : "border-white/10 bg-black/45 text-zinc-300"}`}
        >
          Turntable {turntable ? "on" : "off"}
        </button>
      </div>
      <p className="absolute bottom-3 left-3 right-3 rounded border border-white/10 bg-black/62 p-2 text-[10px] font-black uppercase text-zinc-300">
        Drag to rotate. Wheel or pinch to zoom. Cosmetic preview only.
      </p>
    </div>
  );
}
