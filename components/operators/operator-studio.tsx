"use client";

import { RotateCcw, Save, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { OperatorAvatar } from "@/components/operators/operator-avatar";
import { OperatorCard } from "@/components/operators/operator-card";
import { OperatorCosmeticGrid } from "@/components/operators/operator-cosmetic-grid";
import { OperatorFairnessNotice } from "@/components/operators/operator-fairness-notice";
import { OperatorLoadoutList } from "@/components/operators/operator-loadout-list";
import { OperatorSlotTabs } from "@/components/operators/operator-slot-tabs";
import { getCatalogItemsForSlot } from "@/lib/operators/catalog";
import { operatorSlotLabel } from "@/lib/operators/labels";
import {
  buildOperatorCardPresentation,
  getDefaultOperatorLoadout,
  sanitizeOperatorLoadout,
  validateOperatorLoadout,
} from "@/lib/operators/loadout";
import {
  DZN_OPERATORS_DEMO_STORAGE_KEY,
  clearOperatorPreviewStorage,
  createPreviewStorageState,
  loadOperatorPreviewStorage,
  saveOperatorPreviewStorage,
} from "@/lib/operators/local-preview";
import {
  OPERATOR_COSMETIC_SLOTS,
  type OperatorCosmeticItem,
  type OperatorCosmeticSlot,
  type OperatorLoadout,
  type OperatorPlanTier,
} from "@/lib/operators/types";

type OperatorStudioProps = {
  demoMode: boolean;
};

export function OperatorStudio({ demoMode }: OperatorStudioProps) {
  const defaultLoadout = useMemo(() => getDefaultOperatorLoadout(), []);
  const [planTier, setPlanTier] = useState<OperatorPlanTier>("free");
  const [activeSlot, setActiveSlot] = useState<OperatorCosmeticSlot>("head");
  const [draftLoadout, setDraftLoadout] = useState<OperatorLoadout>(defaultLoadout);
  const [loadouts, setLoadouts] = useState<OperatorLoadout[]>([defaultLoadout]);
  const [equippedLoadoutId, setEquippedLoadoutId] = useState<string | null>(defaultLoadout.id);
  const [statusMessage, setStatusMessage] = useState("Free mode keeps the standard DZN operator selected.");

  const effectivePlan: OperatorPlanTier = demoMode ? planTier : "free";
  const readOnly = effectivePlan !== "premium";
  const sanitizedDraft = useMemo(() => sanitizeOperatorLoadout(effectivePlan, draftLoadout), [draftLoadout, effectivePlan]);
  const validation = useMemo(() => validateOperatorLoadout(effectivePlan, draftLoadout), [draftLoadout, effectivePlan]);
  const presentation = useMemo(() => buildOperatorCardPresentation(sanitizedDraft), [sanitizedDraft]);
  const equippedLoadout = loadouts.find((loadout) => loadout.id === equippedLoadoutId) ?? sanitizedDraft;
  const equippedPresentation = useMemo(() => buildOperatorCardPresentation(sanitizeOperatorLoadout("premium", equippedLoadout)), [equippedLoadout]);
  const activeItems = useMemo(() => getCatalogItemsForSlot(activeSlot), [activeSlot]);
  const selectedActiveItem = activeItems.find((item) => item.id === sanitizedDraft.selections[activeSlot]) ?? activeItems[0];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!demoMode) {
        setPlanTier("free");
        setDraftLoadout(defaultLoadout);
        setLoadouts([defaultLoadout]);
        setEquippedLoadoutId(defaultLoadout.id);
        setStatusMessage("Demo mode is disabled. Premium state cannot be simulated here.");
        return;
      }

      const stored = loadOperatorPreviewStorage(window.localStorage, true);
      setLoadouts(stored.loadouts);
      setEquippedLoadoutId(stored.equippedLoadoutId);
      setDraftLoadout(stored.loadouts.find((loadout) => loadout.id === stored.equippedLoadoutId) ?? stored.loadouts[0] ?? defaultLoadout);
      setStatusMessage("Premium demo state is local preview only and not an active subscription.");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [defaultLoadout, demoMode]);

  function selectItem(item: OperatorCosmeticItem) {
    if (readOnly) {
      setStatusMessage("Free users keep the standard operator. Premium cosmetics remain locked without changing competition access.");
      return;
    }

    setDraftLoadout((current) => sanitizeOperatorLoadout("premium", {
      ...current,
      displayName: "DZN Operator Preview",
      selections: {
        ...current.selections,
        [item.slot]: item.id,
      },
      updatedAt: new Date().toISOString(),
    }));
    setStatusMessage(`${item.displayName} selected for ${operatorSlotLabel(item.slot)}. Preview only.`);
  }

  function resetToDefault() {
    setDraftLoadout(defaultLoadout);
    if (demoMode) {
      clearOperatorPreviewStorage(typeof window === "undefined" ? null : window.localStorage, true);
      setLoadouts([defaultLoadout]);
      setEquippedLoadoutId(defaultLoadout.id);
      setStatusMessage("Preview loadouts reset. Local demo storage removed.");
    } else {
      setStatusMessage("Standard DZN operator restored.");
    }
  }

  function savePreview() {
    if (!demoMode || effectivePlan !== "premium") {
      setStatusMessage("Save is disabled unless premium demo mode is active. This never represents real entitlement.");
      return;
    }

    const nextLoadout = sanitizeOperatorLoadout("premium", {
      ...draftLoadout,
      id: `preview-${Date.now()}`,
      displayName: `DZN Preview ${loadouts.length}`,
      updatedAt: new Date().toISOString(),
    });
    const nextLoadouts = [...loadouts.filter((loadout) => loadout.id !== defaultLoadout.id), defaultLoadout, nextLoadout].slice(-6);
    const nextState = createPreviewStorageState(nextLoadouts, nextLoadout.id);
    setLoadouts(nextState.loadouts);
    setEquippedLoadoutId(nextState.equippedLoadoutId);
    saveOperatorPreviewStorage(typeof window === "undefined" ? null : window.localStorage, true, nextState);
    setStatusMessage(`Saved ${nextLoadout.displayName} to ${DZN_OPERATORS_DEMO_STORAGE_KEY}. Preview only.`);
  }

  function equipPreview(loadoutId: string) {
    if (!demoMode || effectivePlan !== "premium") {
      setStatusMessage("Equip is disabled outside premium demo mode.");
      return;
    }

    const nextLoadout = loadouts.find((loadout) => loadout.id === loadoutId);
    if (!nextLoadout) {
      setStatusMessage("Preview loadout was unavailable and was ignored safely.");
      return;
    }

    const nextState = createPreviewStorageState(loadouts, nextLoadout.id);
    setEquippedLoadoutId(nextState.equippedLoadoutId);
    setDraftLoadout(nextLoadout);
    saveOperatorPreviewStorage(typeof window === "undefined" ? null : window.localStorage, true, nextState);
    setStatusMessage(`${nextLoadout.displayName} equipped for local preview only.`);
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-5 xl:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <div className="grid gap-5">
          <article className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Operator preview canvas</p>
                <h2 className="mt-1 text-2xl font-black uppercase text-white">{presentation.displayName}</h2>
              </div>
              {demoMode ? (
                <div className="flex rounded-lg border border-white/10 bg-black/24 p-1" aria-label="Demo entitlement mode">
                  {(["free", "premium"] as const).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setPlanTier(tier)}
                      className={`min-h-9 rounded px-3 text-[10px] font-black uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                        effectivePlan === tier ? "bg-cyan-300 text-slate-950" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      {tier === "premium" ? "Premium preview" : "Free"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-4">
              <OperatorAvatar presentation={presentation} size="lg" />
            </div>
            <p className="mt-3 rounded-lg border border-white/10 bg-black/24 p-3 text-xs font-bold leading-5 text-zinc-300" aria-live="polite">
              {statusMessage}
            </p>
          </article>

          <OperatorCard presentation={presentation} compact />
        </div>

        <section className="grid gap-5 rounded-lg border border-white/10 bg-white/[0.035] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">DZN Operator Wardrobe</p>
              <h2 className="mt-1 text-2xl font-black uppercase text-white">Character Studio</h2>
              <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-zinc-300">
                {readOnly
                  ? "Free controls are read-only. Premium catalog items can be inspected as locked, and competition access remains unaffected."
                  : "Premium demo mode can customize all supported slots locally. Production save APIs must recheck subscription entitlement server-side."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={resetToDefault}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs font-black uppercase text-zinc-100 transition hover:border-cyan-300/28 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
              >
                <RotateCcw size={16} aria-hidden="true" />
                Reset
              </button>
              <button
                type="button"
                disabled={readOnly}
                onClick={savePreview}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-cyan-300/26 bg-cyan-300/12 px-4 text-xs font-black uppercase text-cyan-50 transition hover:bg-cyan-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.035] disabled:text-zinc-500"
              >
                <Save size={16} aria-hidden="true" />
                Save preview
              </button>
            </div>
          </div>

          <OperatorSlotTabs activeSlot={activeSlot} onSelectSlot={setActiveSlot} />
          <OperatorCosmeticGrid
            items={activeItems}
            planTier={effectivePlan}
            selectedItemId={sanitizedDraft.selections[activeSlot]}
            readOnly={readOnly}
            onSelectItem={selectItem}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-lg border border-white/10 bg-black/24 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Selected item details</p>
              <h3 className="mt-2 text-xl font-black uppercase text-white">{selectedActiveItem?.displayName ?? "Missing item"}</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">
                {selectedActiveItem?.description ?? "The missing catalog item was ignored and the starter item remains selected."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase text-zinc-300">{operatorSlotLabel(activeSlot)}</span>
                <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase text-zinc-300">{selectedActiveItem?.entitlement ?? "fallback"}</span>
              </div>
            </article>
            <article className="rounded-lg border border-white/10 bg-black/24 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Loadout summary</p>
              <h3 className="mt-2 text-xl font-black uppercase text-white">{validation.valid ? "Valid preview" : "Safe fallback active"}</h3>
              <ul className="mt-3 grid gap-1 text-xs font-bold leading-5 text-zinc-300">
                {OPERATOR_COSMETIC_SLOTS.slice(0, 8).map((slot) => (
                  <li key={slot} className="flex justify-between gap-3 border-b border-white/5 py-1">
                    <span className="text-zinc-500">{operatorSlotLabel(slot)}</span>
                    <span className="truncate text-right text-zinc-100">{presentation.selectedItems[slot].displayName}</span>
                  </li>
                ))}
              </ul>
              {validation.issues.length > 0 ? (
                <p className="mt-3 text-xs font-bold leading-5 text-amber-100">
                  {validation.issues[0]?.message}
                </p>
              ) : null}
            </article>
          </div>
        </section>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <article className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 shrink-0 text-emerald-200" size={22} aria-hidden="true" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">Equipped-loadout preview</p>
              <h2 className="mt-1 text-2xl font-black uppercase text-white">{equippedPresentation.displayName}</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">
                Equipped state here is local preview only. It is not a real purchase, subscription, competition modifier, or server-authoritative entitlement.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <OperatorCard presentation={equippedPresentation} compact />
          </div>
        </article>

        <aside className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 shrink-0 text-cyan-200" size={20} aria-hidden="true" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">Preview loadouts</p>
              <p className="mt-2 text-sm font-bold leading-6 text-zinc-300">
                Stored only when demo mode is enabled. Malformed data resets safely.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <OperatorLoadoutList loadouts={loadouts} equippedLoadoutId={equippedLoadoutId} disabled={readOnly} onEquip={equipPreview} />
          </div>
        </aside>
      </section>

      <OperatorFairnessNotice />
    </div>
  );
}
