import { getDefaultOperatorLoadout, sanitizeOperatorLoadout } from "./loadout";
import type { OperatorLoadout, OperatorPreviewStorageState } from "./types";

export const DZN_OPERATORS_DEMO_STORAGE_KEY = "dzn:operators:demo:v1";

export function createPreviewStorageState(loadouts: OperatorLoadout[], equippedLoadoutId: string | null): OperatorPreviewStorageState {
  const safeLoadouts = loadouts.length > 0 ? loadouts.map((loadout) => sanitizeOperatorLoadout("premium", loadout)) : [getDefaultOperatorLoadout()];
  const safeEquipped = safeLoadouts.some((loadout) => loadout.id === equippedLoadoutId) ? equippedLoadoutId : safeLoadouts[0]?.id ?? null;

  return {
    version: 1,
    note: "preview_only_non_authoritative",
    loadouts: safeLoadouts,
    equippedLoadoutId: safeEquipped,
  };
}

export function parseOperatorPreviewStorage(raw: string | null): OperatorPreviewStorageState {
  if (!raw) return createPreviewStorageState([getDefaultOperatorLoadout()], getDefaultOperatorLoadout().id);

  try {
    const parsed = JSON.parse(raw) as Partial<OperatorPreviewStorageState>;
    if (parsed.version !== 1 || parsed.note !== "preview_only_non_authoritative" || !Array.isArray(parsed.loadouts)) {
      return createPreviewStorageState([getDefaultOperatorLoadout()], getDefaultOperatorLoadout().id);
    }

    return createPreviewStorageState(parsed.loadouts, typeof parsed.equippedLoadoutId === "string" ? parsed.equippedLoadoutId : null);
  } catch {
    return createPreviewStorageState([getDefaultOperatorLoadout()], getDefaultOperatorLoadout().id);
  }
}

export function loadOperatorPreviewStorage(storage: Pick<Storage, "getItem"> | null | undefined, demoMode: boolean): OperatorPreviewStorageState {
  if (!demoMode || !storage) return createPreviewStorageState([getDefaultOperatorLoadout()], getDefaultOperatorLoadout().id);

  try {
    return parseOperatorPreviewStorage(storage.getItem(DZN_OPERATORS_DEMO_STORAGE_KEY));
  } catch {
    return createPreviewStorageState([getDefaultOperatorLoadout()], getDefaultOperatorLoadout().id);
  }
}

export function saveOperatorPreviewStorage(
  storage: Pick<Storage, "setItem"> | null | undefined,
  demoMode: boolean,
  state: OperatorPreviewStorageState,
): boolean {
  if (!demoMode || !storage) return false;

  try {
    storage.setItem(DZN_OPERATORS_DEMO_STORAGE_KEY, JSON.stringify(createPreviewStorageState(state.loadouts, state.equippedLoadoutId)));
    return true;
  } catch {
    return false;
  }
}

export function clearOperatorPreviewStorage(storage: Pick<Storage, "removeItem"> | null | undefined, demoMode: boolean): boolean {
  if (!demoMode || !storage) return false;

  try {
    storage.removeItem(DZN_OPERATORS_DEMO_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
