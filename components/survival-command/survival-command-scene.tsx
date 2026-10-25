"use client";

import type { SurvivalCommandDailyDirective, SurvivalCommandExpedition, SurvivalCommandLoadout, SurvivalCommandSector } from "../../lib/survival-command";
import Image from "next/image";

type SceneState = {
  selectedSector: SurvivalCommandSector;
  selectedLoadout: SurvivalCommandLoadout;
  expedition: SurvivalCommandExpedition | null;
  dailyDirective: (SurvivalCommandDailyDirective & { completed: boolean }) | null;
};

type Props = SceneState & { motionRunning: boolean; onUnavailable: () => void };

const nodes: Array<{ key: SurvivalCommandSector; label: string }> = [
  { key: "perimeter", label: "Perimeter" },
  { key: "rail_yard", label: "Rail Yard" },
  { key: "radio_ridge", label: "Radio Ridge" },
  { key: "blacksite", label: "Blacksite" },
];

export function SurvivalCommandScene({ selectedSector, selectedLoadout, expedition, dailyDirective, motionRunning, onUnavailable }: Props) {
  void onUnavailable;
  return <div
    className="dzn-survival-command-scene"
    data-sector={selectedSector}
    data-loadout={selectedLoadout}
    data-expedition={Boolean(expedition)}
    data-directive={Boolean(dailyDirective && !dailyDirective.completed)}
    data-motion={motionRunning}
    aria-hidden="true"
  >
    <div className="dzn-survival-command-scene__terrain" />
    <div className="dzn-survival-command-scene__route dzn-survival-command-scene__route--north" />
    <div className="dzn-survival-command-scene__route dzn-survival-command-scene__route--south" />
    <div className="dzn-survival-command-scene__signal" />
    <Image className="dzn-survival-command-scene__asset dzn-survival-command-scene__asset--hq" src="/media/stronghold/rosebud/hq_l01.webp" alt="" width={960} height={960} sizes="(max-width: 720px) 54vw, 32vw" />
    <Image className="dzn-survival-command-scene__asset dzn-survival-command-scene__asset--tower" src="/media/stronghold/rosebud/watchtower_l01.webp" alt="" width={960} height={960} sizes="(max-width: 720px) 38vw, 18vw" />
    <Image className="dzn-survival-command-scene__asset dzn-survival-command-scene__asset--comms" src="/media/stronghold/rosebud/comms_l01.webp" alt="" width={960} height={960} sizes="(max-width: 720px) 42vw, 20vw" />
    <Image className="dzn-survival-command-scene__asset dzn-survival-command-scene__asset--forge" src="/media/stronghold/rosebud/forge_l01.webp" alt="" width={960} height={960} sizes="(max-width: 720px) 55vw, 27vw" />
    {nodes.map(node => <span key={node.key} className="dzn-survival-command-scene__node" data-sector={node.key} data-selected={node.key === selectedSector}><i /><b>{node.label}</b></span>)}
    <span className="dzn-survival-command-scene__convoy"><i /><b>Field team</b></span>
  </div>;
}
