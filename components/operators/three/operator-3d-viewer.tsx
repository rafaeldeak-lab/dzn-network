"use client";

import dynamic from "next/dynamic";

import type { FullOperatorLoadout } from "@/lib/operators/full-customisation/types";

const Operator3dCanvas = dynamic(
  () => import("./operator-3d-canvas").then((module) => module.Operator3dCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[34rem] place-items-center rounded-lg border border-emerald-300/20 bg-[linear-gradient(180deg,#06121c,#02030a)]">
        <div className="text-center">
          <div className="mx-auto h-44 w-24 animate-pulse rounded-t-[44px] border border-cyan-300/20 bg-cyan-300/10" />
          <p className="mt-4 text-xs font-black uppercase tracking-[0.16em] text-cyan-100">Loading procedural Operator rig</p>
        </div>
      </div>
    ),
  },
);

export function Operator3dViewer({
  loadout,
  turntable,
  onTurntableChange,
}: {
  loadout: FullOperatorLoadout;
  turntable: boolean;
  onTurntableChange: (enabled: boolean) => void;
}) {
  return <Operator3dCanvas loadout={loadout} turntable={turntable} onTurntableChange={onTurntableChange} />;
}
