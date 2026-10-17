import type { HideSeekScene } from "../../lib/games-hide-seek";

export type HideSeekTargetDefinition = { id: string; x: number; y: number; scene: HideSeekScene; clue: string };

// Old sessions retain the scene and coordinates they started with.
export const HIDE_SEEK_LEGACY_TARGETS: readonly HideSeekTargetDefinition[] = [
  { id: "signal-01", x: 151, y: 306, scene: "legacy", clue: "Search the first transmission mast." },
  { id: "signal-02", x: 264, y: 441, scene: "legacy", clue: "Trace the warm-lit service line." },
  { id: "signal-03", x: 355, y: 243, scene: "legacy", clue: "Look beneath the ridge antenna." },
  { id: "signal-04", x: 456, y: 464, scene: "legacy", clue: "Sweep the central utility approach." },
  { id: "signal-05", x: 551, y: 333, scene: "legacy", clue: "Follow the high cable run." },
  { id: "signal-06", x: 651, y: 469, scene: "legacy", clue: "Inspect the right-hand relay route." },
  { id: "signal-07", x: 731, y: 259, scene: "legacy", clue: "Search the upper watch line." },
  { id: "signal-08", x: 826, y: 443, scene: "legacy", clue: "Check the lit perimeter marker." },
  { id: "signal-09", x: 902, y: 304, scene: "legacy", clue: "Watch the eastern ridge." },
  { id: "signal-10", x: 197, y: 696, scene: "legacy", clue: "Search the lower equipment field." },
  { id: "signal-11", x: 521, y: 731, scene: "legacy", clue: "Trace the valley return path." },
  { id: "signal-12", x: 842, y: 699, scene: "legacy", clue: "Inspect the far supply lane." },
] as const;

// New runs use the original reconnaissance scene. Targets are grounded in distinct terrain and equipment details.
export const HIDE_SEEK_RECON_TARGETS: readonly HideSeekTargetDefinition[] = [
  { id: "recon-01", x: 205, y: 258, scene: "recon-v2", clue: "Look below the radar dome and its lower mast." },
  { id: "recon-02", x: 338, y: 385, scene: "recon-v2", clue: "Trace the warm service stairs beside the main tower." },
  { id: "recon-03", x: 486, y: 307, scene: "recon-v2", clue: "A warning lamp rides the transmission spine." },
  { id: "recon-04", x: 538, y: 486, scene: "recon-v2", clue: "Search where the utility sheds meet the wet path." },
  { id: "recon-05", x: 647, y: 584, scene: "recon-v2", clue: "Inspect the floodlit equipment line below the ridge." },
  { id: "recon-06", x: 755, y: 355, scene: "recon-v2", clue: "A dish cuts against the mountain silhouette." },
  { id: "recon-07", x: 889, y: 456, scene: "recon-v2", clue: "A distant cyan relay answers across the valley." },
  { id: "recon-08", x: 828, y: 669, scene: "recon-v2", clue: "Watch the reflection beneath the far treeline." },
  { id: "recon-09", x: 734, y: 781, scene: "recon-v2", clue: "Follow the wet track past the cliffside shelter." },
  { id: "recon-10", x: 407, y: 723, scene: "recon-v2", clue: "A cable descends toward the lower pass." },
  { id: "recon-11", x: 142, y: 706, scene: "recon-v2", clue: "A lantern marks the canvas base camp." },
  { id: "recon-12", x: 947, y: 772, scene: "recon-v2", clue: "Search the eastern approach near stored equipment." },
] as const;

export const HIDE_SEEK_TARGETS: readonly HideSeekTargetDefinition[] = [...HIDE_SEEK_LEGACY_TARGETS, ...HIDE_SEEK_RECON_TARGETS];
export const HIDE_SEEK_TARGET_BY_ID = new Map(HIDE_SEEK_TARGETS.map(target => [target.id, target]));
