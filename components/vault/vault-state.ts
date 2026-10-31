import { emptyVaultSlots, type PublicVaultShowcase, type VaultCabinetResponse, type VaultOwnedItem, type VaultShowcase, type VaultSlots } from "@/lib/vault";

export type VaultDraft = Pick<VaultShowcase, "published" | "slots">;

export function copyVaultSlots(slots: VaultSlots): VaultSlots {
  return { hero: slots.hero, supporting: [...slots.supporting], scene: slots.scene };
}

export function draftFromShowcase(showcase: VaultShowcase): VaultDraft {
  return { published: showcase.published, slots: copyVaultSlots(showcase.slots) };
}

export function isVaultDraftChanged(draft: VaultDraft, showcase: VaultShowcase): boolean {
  return draft.published !== showcase.published || JSON.stringify(draft.slots) !== JSON.stringify(showcase.slots);
}

export function mergeVaultOwnershipRefresh(current: VaultCabinetResponse, refreshed: VaultCabinetResponse): VaultCabinetResponse {
  // A claim refreshes ownership, but must not silently advance the revision that
  // the local draft was based on. Only an explicit reload or save rebases it.
  return { ...refreshed, showcase: current.showcase };
}

export function removeVaultItem(slots: VaultSlots, id: string): VaultSlots {
  return {
    hero: slots.hero === id ? null : slots.hero,
    supporting: slots.supporting.map((value) => value === id ? null : value) as VaultSlots["supporting"],
    scene: slots.scene === id ? null : slots.scene,
  };
}

export function addVaultItem(slots: VaultSlots, item: VaultOwnedItem): VaultSlots | null {
  if (item.catalog.kind === "scene") return { ...copyVaultSlots(slots), scene: item.id };
  if (slots.hero === item.id || slots.supporting.includes(item.id)) return copyVaultSlots(slots);
  if (!slots.hero) return { ...copyVaultSlots(slots), hero: item.id };
  const index = slots.supporting.indexOf(null);
  if (index === -1) return null;
  const next = copyVaultSlots(slots);
  next.supporting[index] = item.id;
  return next;
}

export function featureVaultItem(slots: VaultSlots, item: VaultOwnedItem): VaultSlots | null {
  if (item.catalog.kind === "scene") return null;
  const next = copyVaultSlots(slots);
  if (next.hero === item.id) return next;
  const position = next.supporting.indexOf(item.id);
  if (position >= 0) next.supporting[position] = next.hero;
  else if (next.hero) {
    const available = next.supporting.indexOf(null);
    if (available === -1) return null;
    next.supporting[available] = next.hero;
  }
  next.hero = item.id;
  return next;
}

export function ownedShowcaseProjection(items: VaultOwnedItem[], slots: VaultSlots): PublicVaultShowcase {
  const owned = new Map(items.map((item) => [item.id, item.catalog]));
  const safeItem = (id: string | null, scene: boolean) => {
    const item = id ? owned.get(id) : undefined;
    return item && (item.kind === "scene") === scene ? item : null;
  };
  return { slots: {
    hero: safeItem(slots.hero, false),
    supporting: slots.supporting.map((id) => safeItem(id, false)) as PublicVaultShowcase["slots"]["supporting"],
    scene: safeItem(slots.scene, true),
  } };
}

export function emptyVaultDraft(): VaultDraft { return { published: false, slots: emptyVaultSlots() }; }
