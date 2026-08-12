"use client";

import { Copy, Dice5, Plus, RotateCcw, Save, Star, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FullOperatorCard } from "@/components/operators/full-studio/full-operator-card";
import { Operator3dViewer } from "@/components/operators/three/operator-3d-viewer";
import {
  FULL_OPERATOR_CATEGORY_LABELS,
  FULL_OPERATOR_CATALOG,
  FULL_OPERATOR_STUDIO_RAIL,
  getFullOperatorCatalogItems,
  getFullOperatorItem,
} from "@/lib/operators/full-customisation/catalog";
import {
  DZN_OPERATORS_ENGAGEMENT_STORAGE_KEY,
  DZN_OPERATORS_FULL_STUDIO_STORAGE_KEY,
  applyFullOperatorColourTheme,
  buildOperatorMasterySummary,
  buildWeaponMasterySummary,
  createFullOperatorLoadout,
  createFullStudioStorageState,
  deleteFullOperatorLoadout,
  deterministicFullOperatorRandomise,
  duplicateFullOperatorLoadout,
  equipFullOperatorLoadout,
  getDefaultFullOperatorLoadout,
  loadFullStudioPreviewStorage,
  renameFullOperatorLoadout,
  resetFullOperatorCategory,
  resetFullOperatorLoadout,
  saveFullStudioPreviewStorage,
  selectFullOperatorItem,
} from "@/lib/operators/full-customisation/loadouts";
import { FULL_OPERATOR_POWER_SLOTS, type FullOperatorCategory, type FullOperatorLoadout, type FullOperatorStudioSection } from "@/lib/operators/full-customisation/types";

export function FullOperatorStudio({ demoMode }: { demoMode: boolean }) {
  const [state, setState] = useState(() => createFullStudioStorageState([getDefaultFullOperatorLoadout()]));
  const [activeSection, setActiveSection] = useState<FullOperatorStudioSection>("wardrobe");
  const [activeCategory, setActiveCategory] = useState<FullOperatorCategory>("helmet");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [turntable, setTurntable] = useState(true);
  const [message, setMessage] = useState("Full Studio is preview-only. Demo state is not a subscription or production entitlement.");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setState(loadFullStudioPreviewStorage(window.localStorage, demoMode));
      if (!demoMode) setMessage("Demo mode is disabled. Full Studio remains read-only and local state is not authoritative.");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [demoMode]);

  const draft = state.draftLoadout;
  const equippedLoadout = state.loadouts.find((loadout) => loadout.id === state.equippedLoadoutId) ?? state.loadouts[0] ?? draft;
  const featuredLoadout = state.loadouts.find((loadout) => loadout.id === state.featuredLoadoutId) ?? state.loadouts.find((loadout) => loadout.featured) ?? equippedLoadout;
  const draftDifferenceCount = useMemo(() => countDraftDifferences(draft, equippedLoadout), [draft, equippedLoadout]);
  const selectedItem = getFullOperatorItem(draft.selectedItemIds[activeCategory]);
  const items = useMemo(() => {
    return getFullOperatorCatalogItems(activeCategory).filter((item) => {
      if (rarityFilter !== "all" && item.rarity !== rarityFilter) return false;
      if (ownedOnly && item.levelRequirement > 24) return false;
      return true;
    });
  }, [activeCategory, ownedOnly, rarityFilter]);
  const mastery = buildOperatorMasterySummary(12840, FULL_OPERATOR_CATALOG.filter((item) => item.levelRequirement <= 24).map((item) => item.id));
  const weaponMastery = buildWeaponMasterySummary(draft.weapon.primaryWeaponItemId, 4200);

  function persist(nextDraft: FullOperatorLoadout, nextLoadouts = state.loadouts, equippedId = state.equippedLoadoutId) {
    const next = createFullStudioStorageState(nextLoadouts, equippedId, nextDraft);
    setState(next);
    saveFullStudioPreviewStorage(typeof window === "undefined" ? null : window.localStorage, demoMode, next);
  }

  function selectItem(itemId: string) {
    const item = getFullOperatorItem(itemId);
    if (!item) return;
    const next = selectFullOperatorItem(draft, item.category, item.id);
    persist(next);
    setMessage(`${item.displayName} equipped in draft. ${item.fixedUnlockSource}.`);
  }

  function updateBodyControl(key: keyof FullOperatorLoadout["identity"]["body"], value: number | string) {
    const next = {
      ...draft,
      identity: {
        ...draft.identity,
        body: {
          ...draft.identity.body,
          [key]: value,
        },
      },
    } as FullOperatorLoadout;
    persist(next);
  }

  function updateFaceControl(key: keyof FullOperatorLoadout["identity"]["face"], value: number | string) {
    persist({
      ...draft,
      identity: {
        ...draft.identity,
        face: {
          ...draft.identity.face,
          [key]: value,
        },
      },
    });
  }

  function createNewLoadout() {
    if (!demoMode) {
      setMessage("Create is disabled outside demo mode. Browser state never represents a purchase.");
      return;
    }
    const created = createFullOperatorLoadout(`DZN Loadout ${state.loadouts.length + 1}`);
    persist(created, [created, ...state.loadouts].slice(0, 10), created.id);
    setMessage("Created a new preview-only loadout. Production saves require a future server-authoritative API.");
  }

  function renameDraftName(displayName: string) {
    const renamed = renameFullOperatorLoadout(draft, displayName);
    const nextLoadouts = state.loadouts.map((loadout) => loadout.id === renamed.id ? renamed : loadout);
    persist(renamed, nextLoadouts, state.equippedLoadoutId);
  }

  function discardDraftChanges() {
    persist(equippedLoadout, state.loadouts, state.equippedLoadoutId);
    setMessage("Discarded draft changes and restored the equipped preview loadout.");
  }

  function chooseFeaturedLoadout(loadoutId: string) {
    const target = state.loadouts.find((loadout) => loadout.id === loadoutId);
    if (!target) return;
    const nextLoadouts = [target, ...state.loadouts.filter((loadout) => loadout.id !== loadoutId)]
      .map((loadout, index) => ({ ...loadout, featured: index === 0 }));
    persist(draft, nextLoadouts, state.equippedLoadoutId);
    setMessage(`${target.displayName} is now the featured local preview loadout.`);
  }

  function saveDraft() {
    if (!demoMode) {
      setMessage("Save is disabled outside demo mode. Browser state never represents a purchase.");
      return;
    }
    const existing = state.loadouts.filter((loadout) => loadout.id !== draft.id);
    const nextLoadouts = [draft, ...existing].slice(0, 10);
    persist(draft, nextLoadouts, draft.id);
    setMessage(`Saved preview loadout to ${DZN_OPERATORS_FULL_STUDIO_STORAGE_KEY}. Engagement state remains in ${DZN_OPERATORS_ENGAGEMENT_STORAGE_KEY}.`);
  }

  function duplicateDraft() {
    const copy = duplicateFullOperatorLoadout(draft, state.loadouts);
    persist(copy, [copy, ...state.loadouts].slice(0, 10), copy.id);
    setMessage("Duplicated loadout locally. No production write occurred.");
  }

  function deleteDraft() {
    const nextLoadouts = deleteFullOperatorLoadout(state.loadouts, draft.id);
    persist(nextLoadouts[0], nextLoadouts, nextLoadouts[0].id);
    setMessage("Deleted local preview loadout safely.");
  }

  function equipDraft() {
    const next = equipFullOperatorLoadout(createFullStudioStorageState([draft, ...state.loadouts], draft.id, draft), draft.id);
    setState(next);
    saveFullStudioPreviewStorage(typeof window === "undefined" ? null : window.localStorage, demoMode, next);
    setMessage("Equipped preview loadout locally. Production entitlement must be verified server-side in a future phase.");
  }

  function setPower(slot: (typeof FULL_OPERATOR_POWER_SLOTS)[number], itemId: string | null) {
    persist({
      ...draft,
      powerSlots: {
        ...draft.powerSlots,
        [slot]: itemId,
      },
    });
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-emerald-300/20 bg-[#06101d] p-4 shadow-[0_24px_90px_rgba(0,0,0,.45)]">
        <div className="flex flex-wrap gap-2">
          {(["wardrobe", "loadout", "progression", "identity"] as const).map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setActiveSection(section)}
              className={`min-h-11 rounded-lg border px-4 text-xs font-black uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${activeSection === section ? "border-emerald-300/45 bg-emerald-300/16 text-emerald-50" : "border-white/10 bg-black/24 text-zinc-300"}`}
            >
              {section}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[260px_minmax(360px,.75fr)_minmax(420px,1fr)_360px]">
        <aside className="grid content-start gap-4 rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <h2 className="text-xl font-black uppercase text-white">DZN Wardrobe Rail</h2>
          {FULL_OPERATOR_STUDIO_RAIL.map((group) => (
            <div key={group.group} className="grid gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">{group.group}</p>
              <div className="grid gap-1">
                {group.categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={`min-h-10 rounded border px-3 text-left text-[11px] font-black uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${activeCategory === category ? "border-cyan-300/50 bg-cyan-300/14 text-white" : "border-white/10 bg-black/24 text-zinc-400"}`}
                  >
                    {FULL_OPERATOR_CATEGORY_LABELS[category]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <section className="grid content-start gap-4 rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Catalog grid</p>
            <h2 className="mt-1 text-2xl font-black uppercase text-white">{FULL_OPERATOR_CATEGORY_LABELS[activeCategory]}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {["all", "starter", "field", "rare", "elite", "legendary"].map((rarity) => (
              <button key={rarity} type="button" onClick={() => setRarityFilter(rarity)} className={`min-h-9 rounded border px-3 text-[10px] font-black uppercase ${rarityFilter === rarity ? "border-amber-300/50 bg-amber-300/15 text-amber-50" : "border-white/10 bg-black/24 text-zinc-400"}`}>
                {rarity}
              </button>
            ))}
            <button type="button" onClick={() => setOwnedOnly(!ownedOnly)} className={`min-h-9 rounded border px-3 text-[10px] font-black uppercase ${ownedOnly ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-black/24 text-zinc-400"}`}>
              Owned/demo
            </button>
          </div>
          <div className="grid max-h-[38rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {items.map((item) => {
              const selected = draft.selectedItemIds[item.category] === item.id || Object.values(draft.powerSlots).includes(item.id);
              const locked = item.levelRequirement > 24;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => item.category === "power" ? setPower(FULL_OPERATOR_POWER_SLOTS.find((slot) => !draft.powerSlots[slot]) ?? "power_slot_1", item.id) : selectItem(item.id)}
                  className={`min-h-32 rounded-lg border p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${selected ? "border-cyan-300/60 bg-cyan-300/12" : "border-white/10 bg-black/24"} ${locked ? "opacity-70" : ""}`}
                  aria-pressed={selected}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded border border-white/10" style={{ background: item.material.primary }}>
                      <span className="h-3 w-7 rounded-full" style={{ background: item.material.accent }} />
                    </span>
                    <span className="text-right text-[10px] font-black uppercase text-zinc-400">{item.rarity}</span>
                  </div>
                  <p className="mt-3 text-sm font-black uppercase text-white">{item.displayName}</p>
                  <p className="mt-1 text-[11px] font-bold leading-4 text-zinc-400">{locked ? `Locked - level ${item.levelRequirement}. ` : "Unlocked. "}{item.fixedUnlockSource}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid content-start gap-4">
          <Operator3dViewer loadout={draft} turntable={turntable} onTurntableChange={setTurntable} />
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Selected item</p>
                <h2 className="mt-1 text-2xl font-black uppercase text-white">{selectedItem?.displayName ?? "Power slot selection"}</h2>
                <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">{selectedItem?.description ?? "Choose one of four cosmetic power slots. Powers affect aura, card visuals, and identity only."}</p>
              </div>
              <button type="button" onClick={equipDraft} className="min-h-11 rounded-lg border border-emerald-300/35 bg-emerald-300/15 px-4 text-xs font-black uppercase text-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">Equip preview</button>
            </div>
          </article>

          <IdentityControls draft={draft} updateBodyControl={updateBodyControl} updateFaceControl={updateFaceControl} />
        </section>

        <aside className="grid content-start gap-4">
          <FullOperatorCard loadout={draft} playerName="Rafael" level={mastery.totalOperatorLevel} rank={mastery.rankLabel} variant="compact" />
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Loadout Summary</p>
            <label className="mt-2 grid gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">
              Loadout name
              <input
                value={draft.displayName}
                onChange={(event) => renameDraftName(event.currentTarget.value)}
                className="min-h-11 rounded border border-white/10 bg-black/30 px-3 text-sm font-black uppercase tracking-normal text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                aria-label="Rename current DZN Operator loadout"
              />
            </label>
            <SummaryRow label="Draft compare" value={draftDifferenceCount === 0 ? "Matches equipped" : `${draftDifferenceCount} differences`} />
            <SummaryRow label="Featured" value={featuredLoadout.displayName} />
            <SummaryRow label="Primary" value={getFullOperatorItem(draft.weapon.primaryWeaponItemId)?.displayName ?? "Unknown"} />
            <SummaryRow label="Secondary" value={getFullOperatorItem(draft.weapon.secondaryWeaponItemId)?.displayName ?? "Unknown"} />
            <SummaryRow label="Melee" value={getFullOperatorItem(draft.weapon.meleeWeaponItemId)?.displayName ?? "Unknown"} />
            <SummaryRow label="Throwable" value={getFullOperatorItem(draft.weapon.throwableItemId)?.displayName ?? "Unknown"} />
            {FULL_OPERATOR_POWER_SLOTS.map((slot, index) => (
              <div key={slot} className="mt-2 flex items-center justify-between gap-3 rounded border border-white/10 bg-black/24 p-2">
                <span className="text-[10px] font-black uppercase text-zinc-500">Power {index + 1}</span>
                <span className="truncate text-xs font-black uppercase text-zinc-100">{getFullOperatorItem(draft.powerSlots[slot])?.displayName ?? "Empty"}</span>
                {draft.powerSlots[slot] ? <button type="button" onClick={() => setPower(slot, null)} className="text-[10px] font-black uppercase text-red-200">Clear</button> : null}
              </div>
            ))}
          </article>

          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Saved loadouts</p>
            <div className="mt-3 grid gap-2">
              {state.loadouts.map((loadout) => {
                const isEquipped = loadout.id === state.equippedLoadoutId;
                const isFeatured = loadout.id === featuredLoadout.id;
                return (
                  <div key={loadout.id} className="rounded border border-white/10 bg-black/24 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-black uppercase text-white">{loadout.displayName}</p>
                      <span className="text-[10px] font-black uppercase text-zinc-500">{isEquipped ? "Equipped" : isFeatured ? "Featured" : "Preview"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => persist(loadout, state.loadouts, state.equippedLoadoutId)} className="min-h-9 rounded border border-white/10 bg-white/[0.05] px-2 text-[10px] font-black uppercase text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">Open</button>
                      <button type="button" onClick={() => chooseFeaturedLoadout(loadout.id)} className="min-h-9 rounded border border-amber-300/25 bg-amber-300/10 px-2 text-[10px] font-black uppercase text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200">Feature</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">Progression</p>
            <SummaryRow label="Operator level" value={String(mastery.totalOperatorLevel)} />
            <SummaryRow label="Unlocked" value={`${mastery.unlockedItemCount}/${mastery.totalCatalogCount}`} />
            <SummaryRow label="Next unlock" value={mastery.nextUnlock} />
            <SummaryRow label="Weapon mastery" value={`Level ${weaponMastery.masteryLevel}`} />
            <SummaryRow label="Next weapon unlock" value={weaponMastery.nextCosmeticUnlock} />
          </article>
        </aside>
      </section>

      <section className="sticky bottom-3 z-30 rounded-lg border border-emerald-300/20 bg-[#06101d]/95 p-3 shadow-[0_18px_60px_rgba(0,0,0,.44)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-black uppercase text-zinc-300" aria-live="polite">{message}</p>
          <div className="flex flex-wrap gap-2">
            <Action icon={Plus} label="Create" onClick={createNewLoadout} />
            <Action icon={Dice5} label="Seed randomise" onClick={() => persist(deterministicFullOperatorRandomise(draft, "dzn-phase-3"))} />
            <Action icon={Save} label="Save loadout" onClick={saveDraft} />
            <Action icon={Copy} label="Duplicate" onClick={duplicateDraft} />
            <Action icon={Undo2} label="Discard draft" onClick={discardDraftChanges} />
            <Action icon={RotateCcw} label="Reset category" onClick={() => persist(resetFullOperatorCategory(draft, activeCategory))} />
            <Action icon={RotateCcw} label="Reset all" onClick={() => persist(resetFullOperatorLoadout())} />
            <Action icon={Trash2} label="Delete" onClick={deleteDraft} />
            <button type="button" onClick={() => persist(applyFullOperatorColourTheme(draft, draft.displayName))} className="inline-flex min-h-10 items-center gap-2 rounded border border-cyan-300/30 bg-cyan-300/10 px-3 text-[10px] font-black uppercase text-cyan-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"><Star size={14} aria-hidden="true" />Theme</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function IdentityControls({
  draft,
  updateBodyControl,
  updateFaceControl,
}: {
  draft: FullOperatorLoadout;
  updateBodyControl: (key: keyof FullOperatorLoadout["identity"]["body"], value: number | string) => void;
  updateFaceControl: (key: keyof FullOperatorLoadout["identity"]["face"], value: number | string) => void;
}) {
  const bodyControls: Array<[keyof FullOperatorLoadout["identity"]["body"], string]> = [
    ["height", "Height"],
    ["shoulderWidth", "Shoulder width"],
    ["torsoBuild", "Torso build"],
    ["armBuild", "Arm build"],
    ["legBuild", "Leg build"],
  ];
  const faceControls: Array<[keyof FullOperatorLoadout["identity"]["face"], string]> = [
    ["faceWidth", "Face width"],
    ["jawWidth", "Jaw width"],
    ["cheekDefinition", "Cheek definition"],
    ["noseSize", "Nose size"],
    ["browDefinition", "Brow definition"],
    ["eyeSpacing", "Eye spacing"],
  ];
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Identity sliders</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {bodyControls.map(([key, label]) => (
          <Slider key={key} label={label} value={Number(draft.identity.body[key])} onChange={(value) => updateBodyControl(key, value)} />
        ))}
        {faceControls.map(([key, label]) => (
          <Slider key={key} label={label} value={Number(draft.identity.face[key])} onChange={(value) => updateFaceControl(key, value)} />
        ))}
      </div>
    </article>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase text-zinc-300">
      <span className="flex justify-between gap-3"><span>{label}</span><span>{value}</span></span>
      <input aria-label={label} type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} className="accent-cyan-300" />
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex justify-between gap-3 rounded border border-white/10 bg-black/24 p-2">
      <span className="text-[10px] font-black uppercase text-zinc-500">{label}</span>
      <span className="min-w-0 truncate text-right text-xs font-black uppercase text-zinc-100">{value}</span>
    </div>
  );
}

function countDraftDifferences(draft: FullOperatorLoadout, equipped: FullOperatorLoadout): number {
  let count = 0;
  for (const category of Object.keys(draft.selectedItemIds) as Array<keyof FullOperatorLoadout["selectedItemIds"]>) {
    if (draft.selectedItemIds[category] !== equipped.selectedItemIds[category]) count += 1;
  }
  for (const slot of FULL_OPERATOR_POWER_SLOTS) {
    if (draft.powerSlots[slot] !== equipped.powerSlots[slot]) count += 1;
  }
  if (JSON.stringify(draft.identity) !== JSON.stringify(equipped.identity)) count += 1;
  if (JSON.stringify(draft.weapon) !== JSON.stringify(equipped.weapon)) count += 1;
  if (draft.poseItemId !== equipped.poseItemId) count += 1;
  if (draft.cardFrameItemId !== equipped.cardFrameItemId) count += 1;
  if (draft.cardBackgroundItemId !== equipped.cardBackgroundItemId) count += 1;
  if (draft.profileAccentItemId !== equipped.profileAccentItemId) count += 1;
  return count;
}

function Action({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-10 items-center gap-2 rounded border border-white/10 bg-black/28 px-3 text-[10px] font-black uppercase text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">
      <Icon size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
