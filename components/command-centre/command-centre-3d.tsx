"use client";

import type { CommandCentreBuildingView } from "../../lib/command-centre";
import Image from "next/image";

type CommandCentre3DProps = {
  buildings: CommandCentreBuildingView[];
  active: boolean;
  motionRunning: boolean;
  onUnavailable: () => void;
};

type StrongholdBuilding = "headquarters" | "workshop" | "watchtower" | "communications";

const presentation: Array<{ key: StrongholdBuilding; asset: string; label: string }> = [
  { key: "headquarters", asset: "/media/stronghold/rosebud/hq_l01.webp", label: "Headquarters" },
  { key: "workshop", asset: "/media/stronghold/rosebud/forge_l01.webp", label: "Workshop" },
  { key: "watchtower", asset: "/media/stronghold/rosebud/watchtower_l01.webp", label: "Watchtower" },
  { key: "communications", asset: "/media/stronghold/rosebud/comms_l01.webp", label: "Communications" },
];

// The Rosebud renders remain a resilient presentation layer. Progression and upgrades
// stay authoritative in the existing Command Centre API and are reflected as levels.
export function CommandCentre3D({ buildings, active, motionRunning, onUnavailable }: CommandCentre3DProps) {
  void onUnavailable;
  const byBuilding = new Map(buildings.map(building => [building.building, building]));

  return <div className="dzn-command-centre-3d" data-active={active} data-motion={motionRunning} aria-hidden="true">
    <div className="dzn-command-centre-3d__grid" />
    <div className="dzn-command-centre-3d__beacon" />
    {presentation.map(({ key, asset, label }) => {
      const building = byBuilding.get(key);
      const level = Math.max(0, building?.level ?? 0);
      return <figure key={key} className="dzn-command-centre-3d__asset" data-building={key} data-established={level > 0} data-building-level={Math.min(level, 5)}>
        <Image src={asset} alt="" width={960} height={960} sizes="(max-width: 980px) 48vw, 28vw" />
        <figcaption>{label}<span>{active ? `Level ${level}` : "Awaiting command"}</span></figcaption>
      </figure>;
    })}
  </div>;
}
