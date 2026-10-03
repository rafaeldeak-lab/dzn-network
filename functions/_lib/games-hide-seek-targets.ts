export type HideSeekTargetDefinition = { id: string; x: number; y: number };

// Stable, visually fair slots on the original DZN outpost scene. The server selects four per round.
export const HIDE_SEEK_TARGETS: readonly HideSeekTargetDefinition[] = [
  { id: "signal-01", x: 151, y: 306 },
  { id: "signal-02", x: 264, y: 441 },
  { id: "signal-03", x: 355, y: 243 },
  { id: "signal-04", x: 456, y: 464 },
  { id: "signal-05", x: 551, y: 333 },
  { id: "signal-06", x: 651, y: 469 },
  { id: "signal-07", x: 731, y: 259 },
  { id: "signal-08", x: 826, y: 443 },
  { id: "signal-09", x: 902, y: 304 },
  { id: "signal-10", x: 197, y: 696 },
  { id: "signal-11", x: 521, y: 731 },
  { id: "signal-12", x: 842, y: 699 },
] as const;

export const HIDE_SEEK_TARGET_BY_ID = new Map(HIDE_SEEK_TARGETS.map(target => [target.id, target]));
