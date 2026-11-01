"use client";

import { useEffect, useRef } from "react";
import { startEventsAtmosphere } from "./events-atmosphere";

export function EventAtmosphere() {
  const scene = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    return startEventsAtmosphere(canvas.current, (time: number, duration: number) => {
      const phase = Math.PI * 2 * time / duration;
      const zoom = 1.025 + .0675 * (1 - Math.cos(phase));
      if (scene.current) scene.current.style.transform = `translate(${7 * Math.sin(phase)}px, ${2.5 * Math.sin(phase * 2)}px) scale(${zoom})`;
    });
  }, []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={scene} data-events-atmosphere className="absolute inset-0 origin-[75%_35%]" style={{ transform: "scale(1.025)" }}>
        <img src="/media/competition-centre/competition-centre-hero-v1.png" alt="" className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 object-cover" />
        <canvas ref={canvas} className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 object-cover" />
      </div>
    </div>
  );
}
