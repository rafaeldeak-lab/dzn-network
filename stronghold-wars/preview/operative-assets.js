// Rosebud-created, Blender-rigged 3D commanders. The ordinary squad kit still
// derives its equipment level and combat stats from shared building progress.
export const OPERATIVE_MODELS = Object.freeze({
  rivet: 'assets/models/operatives/rivet.glb',
  signal: 'assets/models/operatives/signal.glb',
  remedy: 'assets/models/operatives/remedy.glb',
});

export function operativeAsset(id) {
  return OPERATIVE_MODELS[id] || null;
}
