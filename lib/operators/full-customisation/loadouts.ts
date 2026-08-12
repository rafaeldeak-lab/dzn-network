import {
  FULL_OPERATOR_CATALOG,
  FULL_OPERATOR_DEFAULT_ITEM_IDS,
  getFullOperatorItem,
} from "./catalog";
import {
  FULL_OPERATOR_BODY_PRESETS,
  FULL_OPERATOR_CATEGORIES,
  FULL_OPERATOR_POWER_SLOTS,
  FULL_OPERATOR_PROHIBITED_COMPETITIVE_FIELDS,
  type FullOperatorBodyPresetId,
  type FullOperatorCategory,
  type FullOperatorLoadout,
  type FullOperatorMasterySummary,
  type FullOperatorPowerSlot,
  type FullOperatorStudioStorageState,
  type FullWeaponMasterySummary,
} from "./types";

export const DZN_OPERATORS_FULL_STUDIO_STORAGE_KEY = "dzn:operators:studio:demo:v2";
export const DZN_OPERATORS_LEGACY_STUDIO_STORAGE_KEY = "dzn:operators:demo:v1";
export const DZN_OPERATORS_ENGAGEMENT_STORAGE_KEY = "dzn:operators:engagement:demo:v1";
export const FULL_OPERATOR_DEFAULT_UPDATED_AT = "2026-06-01T00:00:00.000Z";
export const MAX_FULL_OPERATOR_DEMO_LOADOUTS = 10;

export const FULL_OPERATOR_STARTER_LOADOUT_ID = "dzn-full-standard-loadout";

export function getDefaultFullOperatorLoadout(): FullOperatorLoadout {
  const selectedItemIds = { ...FULL_OPERATOR_DEFAULT_ITEM_IDS };
  return {
    id: FULL_OPERATOR_STARTER_LOADOUT_ID,
    displayName: "DZN Standard Tactical Operator",
    callSign: "Signal One",
    titleItemId: selectedItemIds.title,
    featured: true,
    identity: {
      body: {
        preset: "standard",
        height: 50,
        shoulderWidth: 50,
        torsoBuild: 50,
        armBuild: 50,
        legBuild: 50,
      },
      skinToneItemId: selectedItemIds.skin,
      face: {
        presetId: selectedItemIds.face,
        faceWidth: 50,
        jawWidth: 50,
        cheekDefinition: 50,
        noseSize: 50,
        browDefinition: 50,
        eyeSpacing: 50,
        eyeColorItemId: selectedItemIds.eyes,
        eyebrowStyle: "standard-brow",
        scarItemId: selectedItemIds.scars,
        facePaintItemId: selectedItemIds.face_paint,
      },
      hairItemId: selectedItemIds.hair,
      facialHairItemId: selectedItemIds.facial_hair,
      hairColor: "#1f2937",
      facialHairColor: "#1f2937",
    },
    selectedItemIds,
    weapon: {
      primaryWeaponItemId: selectedItemIds.primary_weapon,
      secondaryWeaponItemId: selectedItemIds.secondary_weapon,
      meleeWeaponItemId: selectedItemIds.melee_weapon,
      throwableItemId: selectedItemIds.throwable,
      primarySkinItemId: selectedItemIds.primary_skin,
      secondarySkinItemId: selectedItemIds.secondary_skin,
      opticItemId: selectedItemIds.optic,
      muzzleItemId: selectedItemIds.muzzle,
      stockItemId: selectedItemIds.stock,
      magazineItemId: selectedItemIds.magazine,
      charmItemId: selectedItemIds.weapon_charm,
    },
    powerSlots: {
      power_slot_1: null,
      power_slot_2: null,
      power_slot_3: null,
      power_slot_4: null,
    },
    poseItemId: selectedItemIds.pose,
    cardFrameItemId: selectedItemIds.card_frame,
    cardBackgroundItemId: selectedItemIds.card_background,
    profileAccentItemId: selectedItemIds.profile_accent,
    entranceAnimationItemId: selectedItemIds.entrance_animation,
    victoryAnimationItemId: selectedItemIds.victory_animation,
    updatedAt: FULL_OPERATOR_DEFAULT_UPDATED_AT,
  };
}

export function createFullOperatorLoadout(name = "DZN Operator Loadout"): FullOperatorLoadout {
  const now = new Date(0).toISOString();
  return {
    ...getDefaultFullOperatorLoadout(),
    id: `studio-${stableHash(name).toString(16)}`,
    displayName: cleanName(name, "DZN Operator Loadout"),
    featured: false,
    updatedAt: now,
  };
}

export function renameFullOperatorLoadout(loadout: FullOperatorLoadout, displayName: string): FullOperatorLoadout {
  return sanitizeFullOperatorLoadout({
    ...loadout,
    displayName: cleanName(displayName, loadout.displayName),
    updatedAt: FULL_OPERATOR_DEFAULT_UPDATED_AT,
  }, "premium");
}

export function duplicateFullOperatorLoadout(loadout: FullOperatorLoadout, existing: FullOperatorLoadout[]): FullOperatorLoadout {
  return sanitizeFullOperatorLoadout({
    ...loadout,
    id: uniqueLoadoutId(`${loadout.id}-copy`, existing),
    displayName: cleanName(`${loadout.displayName} Copy`, "DZN Operator Copy"),
    featured: false,
    updatedAt: FULL_OPERATOR_DEFAULT_UPDATED_AT,
  }, "premium");
}

export function deleteFullOperatorLoadout(loadouts: FullOperatorLoadout[], loadoutId: string): FullOperatorLoadout[] {
  const next = loadouts.filter((loadout) => loadout.id !== loadoutId);
  return next.length > 0 ? next.slice(0, MAX_FULL_OPERATOR_DEMO_LOADOUTS) : [getDefaultFullOperatorLoadout()];
}

export function equipFullOperatorLoadout(state: FullOperatorStudioStorageState, loadoutId: string): FullOperatorStudioStorageState {
  const target = state.loadouts.find((loadout) => loadout.id === loadoutId) ?? state.loadouts[0] ?? getDefaultFullOperatorLoadout();
  return createFullStudioStorageState(state.loadouts, target.id, target);
}

export function resetFullOperatorLoadout(): FullOperatorLoadout {
  return getDefaultFullOperatorLoadout();
}

export function resetFullOperatorCategory(loadout: FullOperatorLoadout, category: FullOperatorCategory): FullOperatorLoadout {
  const defaultItemId = FULL_OPERATOR_DEFAULT_ITEM_IDS[category];
  return selectFullOperatorItem(loadout, category, defaultItemId);
}

export function selectFullOperatorItem(loadout: FullOperatorLoadout, category: FullOperatorCategory, itemId: string): FullOperatorLoadout {
  const bodyPreset = category === "body" ? itemId.replace(/^body-/, "") as FullOperatorBodyPresetId : loadout.identity.body.preset;
  return sanitizeFullOperatorLoadout({
    ...loadout,
    identity: {
      ...loadout.identity,
      body: {
        ...loadout.identity.body,
        preset: FULL_OPERATOR_BODY_PRESETS.includes(bodyPreset) ? bodyPreset : loadout.identity.body.preset,
      },
    },
    selectedItemIds: {
      ...loadout.selectedItemIds,
      [category]: itemId,
    },
    updatedAt: FULL_OPERATOR_DEFAULT_UPDATED_AT,
  }, "premium");
}

export function applyFullOperatorColourTheme(loadout: FullOperatorLoadout, seedLabel: string): FullOperatorLoadout {
  const themes = [
    ["#111827", "#1f2937"],
    ["#0f172a", "#164e63"],
    ["#1c1917", "#431407"],
    ["#020617", "#312e81"],
  ];
  const theme = themes[stableHash(seedLabel) % themes.length];
  return {
    ...loadout,
    identity: {
      ...loadout.identity,
      hairColor: theme[0],
      facialHairColor: theme[1],
    },
  };
}

export function deterministicFullOperatorRandomise(loadout: FullOperatorLoadout, seed: string): FullOperatorLoadout {
  let next = loadout;
  for (const category of FULL_OPERATOR_CATEGORIES) {
    const options = FULL_OPERATOR_CATALOG.filter((item) => item.category === category && item.levelRequirement <= 24);
    if (options.length === 0) continue;
    const option = options[stableHash(`${seed}:${category}`) % options.length];
    next = selectFullOperatorItem(next, category, option.id);
  }
  return next;
}

export function sanitizeFullOperatorLoadout(loadout: FullOperatorLoadout, planTier: "free" | "premium" = "premium"): FullOperatorLoadout {
  if (planTier === "free") return getDefaultFullOperatorLoadout();

  const bodyPreset = FULL_OPERATOR_BODY_PRESETS.includes(loadout.identity?.body?.preset as FullOperatorBodyPresetId)
    ? loadout.identity.body.preset
    : "standard";

  const selectedItemIds: Partial<Record<FullOperatorCategory, string>> = {};
  for (const category of FULL_OPERATOR_CATEGORIES) {
    const selected = getFullOperatorItem(loadout.selectedItemIds?.[category]);
    selectedItemIds[category] = selected && selected.category === category && selected.compatibleBodyPresets.includes(bodyPreset)
      ? selected.id
      : FULL_OPERATOR_DEFAULT_ITEM_IDS[category];
  }

  const sanitized: FullOperatorLoadout = {
    id: cleanId(loadout.id, FULL_OPERATOR_STARTER_LOADOUT_ID),
    displayName: cleanName(loadout.displayName, "DZN Operator Loadout"),
    callSign: cleanName(loadout.callSign, "Signal One").slice(0, 24),
    titleItemId: selectedItemIds.title ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.title,
    featured: Boolean(loadout.featured),
    identity: {
      body: {
        preset: bodyPreset,
        height: clamp(loadout.identity?.body?.height, 0, 100, 50),
        shoulderWidth: clamp(loadout.identity?.body?.shoulderWidth, 0, 100, 50),
        torsoBuild: clamp(loadout.identity?.body?.torsoBuild, 0, 100, 50),
        armBuild: clamp(loadout.identity?.body?.armBuild, 0, 100, 50),
        legBuild: clamp(loadout.identity?.body?.legBuild, 0, 100, 50),
      },
      skinToneItemId: selectedItemIds.skin ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.skin,
      face: {
        presetId: selectedItemIds.face ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.face,
        faceWidth: clamp(loadout.identity?.face?.faceWidth, 0, 100, 50),
        jawWidth: clamp(loadout.identity?.face?.jawWidth, 0, 100, 50),
        cheekDefinition: clamp(loadout.identity?.face?.cheekDefinition, 0, 100, 50),
        noseSize: clamp(loadout.identity?.face?.noseSize, 0, 100, 50),
        browDefinition: clamp(loadout.identity?.face?.browDefinition, 0, 100, 50),
        eyeSpacing: clamp(loadout.identity?.face?.eyeSpacing, 0, 100, 50),
        eyeColorItemId: selectedItemIds.eyes ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.eyes,
        eyebrowStyle: cleanId(loadout.identity?.face?.eyebrowStyle, "standard-brow"),
        scarItemId: selectedItemIds.scars ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.scars,
        facePaintItemId: selectedItemIds.face_paint ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.face_paint,
      },
      hairItemId: selectedItemIds.hair ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.hair,
      facialHairItemId: selectedItemIds.facial_hair ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.facial_hair,
      hairColor: cleanHex(loadout.identity?.hairColor, "#1f2937"),
      facialHairColor: cleanHex(loadout.identity?.facialHairColor, "#1f2937"),
    },
    selectedItemIds,
    weapon: {
      primaryWeaponItemId: selectedItemIds.primary_weapon ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.primary_weapon,
      secondaryWeaponItemId: selectedItemIds.secondary_weapon ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.secondary_weapon,
      meleeWeaponItemId: selectedItemIds.melee_weapon ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.melee_weapon,
      throwableItemId: selectedItemIds.throwable ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.throwable,
      primarySkinItemId: selectedItemIds.primary_skin ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.primary_skin,
      secondarySkinItemId: selectedItemIds.secondary_skin ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.secondary_skin,
      opticItemId: selectedItemIds.optic ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.optic,
      muzzleItemId: selectedItemIds.muzzle ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.muzzle,
      stockItemId: selectedItemIds.stock ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.stock,
      magazineItemId: selectedItemIds.magazine ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.magazine,
      charmItemId: selectedItemIds.weapon_charm ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.weapon_charm,
    },
    powerSlots: sanitizePowerSlots(loadout.powerSlots),
    poseItemId: selectedItemIds.pose ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.pose,
    cardFrameItemId: selectedItemIds.card_frame ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.card_frame,
    cardBackgroundItemId: selectedItemIds.card_background ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.card_background,
    profileAccentItemId: selectedItemIds.profile_accent ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.profile_accent,
    entranceAnimationItemId: selectedItemIds.entrance_animation ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.entrance_animation,
    victoryAnimationItemId: selectedItemIds.victory_animation ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.victory_animation,
    updatedAt: cleanTimestamp(loadout.updatedAt),
  };

  assertNoFullOperatorCompetitiveFields(sanitized);
  return sanitized;
}

export function isFullOperatorItemCompatible(loadout: FullOperatorLoadout, itemId: string): boolean {
  const item = getFullOperatorItem(itemId);
  if (!item) return false;
  return item.compatibleBodyPresets.includes(loadout.identity.body.preset);
}

export function createFullStudioStorageState(
  loadouts: FullOperatorLoadout[],
  equippedLoadoutId?: string,
  draftLoadout?: FullOperatorLoadout,
): FullOperatorStudioStorageState {
  const hasFeatured = loadouts.some((loadout) => loadout.featured);
  const safeLoadouts = (loadouts.length > 0 ? loadouts : [getDefaultFullOperatorLoadout()])
    .slice(0, MAX_FULL_OPERATOR_DEMO_LOADOUTS)
    .map((loadout, index) => sanitizeFullOperatorLoadout({
      ...loadout,
      featured: hasFeatured ? Boolean(loadout.featured) : index === 0,
    }, "premium"));
  const equipped = safeLoadouts.find((loadout) => loadout.id === equippedLoadoutId) ?? safeLoadouts[0];
  const draft = sanitizeFullOperatorLoadout(draftLoadout ?? equipped, "premium");
  const featured = safeLoadouts.find((loadout) => loadout.featured) ?? equipped;
  return {
    version: 2,
    note: "preview_only_non_authoritative",
    loadouts: safeLoadouts,
    equippedLoadoutId: equipped.id,
    draftLoadout: draft,
    featuredLoadoutId: featured.id,
  };
}

export function parseFullStudioStorage(value: string | null): FullOperatorStudioStorageState {
  if (!value) return createFullStudioStorageState([getDefaultFullOperatorLoadout()]);
  try {
    const parsed = JSON.parse(value) as Partial<FullOperatorStudioStorageState>;
    if (parsed.version !== 2 || parsed.note !== "preview_only_non_authoritative") {
      return createFullStudioStorageState([getDefaultFullOperatorLoadout()]);
    }
    return createFullStudioStorageState(
      Array.isArray(parsed.loadouts) ? parsed.loadouts as FullOperatorLoadout[] : [getDefaultFullOperatorLoadout()],
      typeof parsed.equippedLoadoutId === "string" ? parsed.equippedLoadoutId : undefined,
      parsed.draftLoadout as FullOperatorLoadout | undefined,
    );
  } catch {
    return createFullStudioStorageState([getDefaultFullOperatorLoadout()]);
  }
}

export function migrateLegacyOperatorStudioState(value: string | null): FullOperatorStudioStorageState {
  if (!value) return createFullStudioStorageState([getDefaultFullOperatorLoadout()]);
  try {
    const legacy = JSON.parse(value) as { loadouts?: Array<{ displayName?: string; id?: string }> };
    const legacyLoadouts = Array.isArray(legacy.loadouts) && legacy.loadouts.length > 0
      ? legacy.loadouts.slice(0, 3).map((loadout, index) => ({
        ...getDefaultFullOperatorLoadout(),
        id: cleanId(loadout.id, `legacy-${index + 1}`),
        displayName: cleanName(loadout.displayName, `Legacy DZN Loadout ${index + 1}`),
        featured: index === 0,
      }))
      : [getDefaultFullOperatorLoadout()];
    return createFullStudioStorageState(legacyLoadouts, legacyLoadouts[0].id);
  } catch {
    return createFullStudioStorageState([getDefaultFullOperatorLoadout()]);
  }
}

export function loadFullStudioPreviewStorage(storage: Storage | null, demoMode: boolean): FullOperatorStudioStorageState {
  if (!storage || !demoMode) return createFullStudioStorageState([getDefaultFullOperatorLoadout()]);
  const current = storage.getItem(DZN_OPERATORS_FULL_STUDIO_STORAGE_KEY);
  if (current) return parseFullStudioStorage(current);
  return migrateLegacyOperatorStudioState(storage.getItem(DZN_OPERATORS_LEGACY_STUDIO_STORAGE_KEY));
}

export function saveFullStudioPreviewStorage(storage: Storage | null, demoMode: boolean, state: FullOperatorStudioStorageState): void {
  if (!storage || !demoMode) return;
  storage.setItem(DZN_OPERATORS_FULL_STUDIO_STORAGE_KEY, JSON.stringify(createFullStudioStorageState(state.loadouts, state.equippedLoadoutId, state.draftLoadout)));
}

export function clearFullStudioPreviewStorage(storage: Storage | null, demoMode: boolean): void {
  if (!storage || !demoMode) return;
  storage.removeItem(DZN_OPERATORS_FULL_STUDIO_STORAGE_KEY);
}

export function buildOperatorMasterySummary(xp: number, unlockedItemIds: string[]): FullOperatorMasterySummary {
  const safeXp = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  const totalOperatorLevel = Math.max(1, Math.floor(safeXp / 700) + 1);
  const nextUnlock = FULL_OPERATOR_CATALOG.find((item) => item.levelRequirement > totalOperatorLevel)?.displayName ?? "All preview unlocks visible";
  return {
    totalOperatorLevel,
    rankLabel: totalOperatorLevel >= 24 ? "DZN Icon" : totalOperatorLevel >= 16 ? "Sentinel" : totalOperatorLevel >= 8 ? "Vanguard" : "Operator",
    xp: safeXp,
    nextUnlock,
    unlockedItemCount: Math.min(new Set(unlockedItemIds).size, FULL_OPERATOR_CATALOG.length),
    totalCatalogCount: FULL_OPERATOR_CATALOG.length,
  };
}

export function buildWeaponMasterySummary(weaponItemId: string, xp: number): FullWeaponMasterySummary {
  const level = Math.max(1, Math.floor(Math.max(0, xp) / 400) + 1);
  const unlockedSkinIds = FULL_OPERATOR_CATALOG.filter((item) => (item.category === "primary_skin" || item.category === "secondary_skin") && item.levelRequirement <= level + 2).map((item) => item.id);
  const unlockedCharmIds = FULL_OPERATOR_CATALOG.filter((item) => item.category === "weapon_charm" && item.levelRequirement <= level + 2).map((item) => item.id);
  return {
    weaponItemId: getFullOperatorItem(weaponItemId)?.id ?? FULL_OPERATOR_DEFAULT_ITEM_IDS.primary_weapon,
    masteryLevel: level,
    unlockedSkinIds,
    unlockedCharmIds,
    nextCosmeticUnlock: FULL_OPERATOR_CATALOG.find((item) => item.kind === "attachment" && item.levelRequirement > level)?.displayName ?? "All preview attachments visible",
  };
}

export function assertNoFullOperatorCompetitiveFields(value: unknown): void {
  const seen = new Set<unknown>();
  function visit(node: unknown, path: string) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if ((FULL_OPERATOR_PROHIBITED_COMPETITIVE_FIELDS as readonly string[]).includes(key)) {
        throw new Error(`Prohibited full operator competitive field detected at ${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  }
  visit(value, "fullOperator");
}

function sanitizePowerSlots(slots: Partial<Record<FullOperatorPowerSlot, string | null>> | undefined): Record<FullOperatorPowerSlot, string | null> {
  return Object.fromEntries(FULL_OPERATOR_POWER_SLOTS.map((slot) => {
    const item = getFullOperatorItem(slots?.[slot]);
    return [slot, item?.category === "power" ? item.id : null];
  })) as Record<FullOperatorPowerSlot, string | null>;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function cleanId(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[a-z0-9:_-]{2,90}$/i.test(value) ? value : fallback;
}

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, 48) : fallback;
}

function cleanHex(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function cleanTimestamp(value: unknown): string {
  if (typeof value !== "string") return FULL_OPERATOR_DEFAULT_UPDATED_AT;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : FULL_OPERATOR_DEFAULT_UPDATED_AT;
}

function uniqueLoadoutId(seed: string, existing: FullOperatorLoadout[]): string {
  const ids = new Set(existing.map((loadout) => loadout.id));
  let candidate = cleanId(seed.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-"), `copy-${stableHash(seed).toString(16)}`);
  let index = 2;
  while (ids.has(candidate)) {
    candidate = `${candidate}-${index}`;
    index += 1;
  }
  return candidate;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}
