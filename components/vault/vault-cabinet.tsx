"use client";

import { ArrowLeft, Check, Eye, EyeOff, Gift, LoaderCircle, LockKeyhole, Plus, RefreshCw, Save, Scan, ShieldCheck, Sparkles, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VAULT_CATALOG, type VaultCabinetResponse, type VaultCatalogItem, type VaultOwnedItem, type VaultScope, type VaultSlots } from "@/lib/vault";
import { CollectibleArt, CollectibleHero, VaultInspector, collectibleStyle } from "./collectible-art";
import { VaultOpeningExperience } from "./vault-opening-experience";
import { VaultShowcaseDisplay } from "./vault-showcase-display";
import { addVaultItem, draftFromShowcase, emptyVaultDraft, featureVaultItem, isVaultDraftChanged, mergeVaultOwnershipRefresh, ownedShowcaseProjection, removeVaultItem, type VaultDraft } from "./vault-state";
import styles from "./vault-cabinet.module.css";

type LoadState = { status: "loading" | "ready" | "login" | "unavailable" | "forbidden" | "error"; message: string };
type VaultError = { error?: string; message?: string };
type View = "collection" | "designs" | "saved";

export function VaultCabinet({ scope, serverId }: { scope: VaultScope; serverId?: string }) {
  const endpoint = scope === "player" ? "/api/player/vault" : `/api/servers/${encodeURIComponent(serverId ?? "")}/vault`;
  const returnTo = scope === "player" ? "/player/cabinet" : `/dashboard/vault${serverId ? `?serverId=${encodeURIComponent(serverId)}` : ""}`;
  const [state, setState] = useState<LoadState>({ status: "loading", message: "Opening your cabinet..." });
  const [data, setData] = useState<VaultCabinetResponse | null>(null);
  const [draft, setDraft] = useState<VaultDraft>(emptyVaultDraft);
  const [view, setView] = useState<View>("collection");
  const [inspected, setInspected] = useState<VaultCatalogItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "claim" | "reload" | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [motion, setMotion] = useState(false);
  const [showWelcomeFlow, setShowWelcomeFlow] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    void fetch(endpoint, { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as VaultCabinetResponse & VaultError | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !payload?.ok) { setState(loadFailure(response.status, payload?.message)); return; }
        setData(payload);
        setDraft(draftFromShowcase(payload.showcase));
        setSelectedId(payload.showcase.slots.hero ?? payload.items.find((item) => item.catalog.kind !== "scene")?.id ?? null);
        setShowWelcomeFlow(payload.welcomeAvailable);
        setState({ status: "ready", message: "" });
        setError("");
        setConflict(false);
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", message: "Your cabinet could not be loaded. Your saved collection has not changed." }); });
    return () => controller.abort();
  }, [endpoint, loadKey]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  function retry() {
    setState({ status: "loading", message: "Opening your cabinet..." });
    setLoadKey((value) => value + 1);
  }

  async function mutate(kind: "save" | "claim"): Promise<boolean> {
    if (busy || !data || (kind === "claim" && !data.welcomeAvailable)) return false;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setBusy(kind); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: kind === "claim" ? "POST" : "PUT",
        credentials: "include", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "claim" ? { action: "claim_welcome" } : {
          expectedVersion: data.showcase.version, published: draft.published, slots: draft.slots,
        }),
      });
      const payload = await response.json().catch(() => null) as VaultCabinetResponse & VaultError | null;
      if (controller.signal.aborted) return false;
      if (response.status === 409) {
        setConflict(true);
        setError("Your saved showcase changed in another session. Your draft is still here. Load the latest saved version before applying your changes.");
        return false;
      }
      if (response.status === 401) {
        setError("Your session expired. Sign in again before saving. Your draft remains on this page.");
        return false;
      }
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || (response.status === 503 ? "Ownership could not be verified right now. Your saved showcase is unchanged; try again shortly." : "The request could not be completed. Your saved showcase is unchanged."));
      }
      if (kind === "save") {
        setData(payload);
        setDraft(draftFromShowcase(payload.showcase));
        setConflict(false);
        setMessage(payload.showcase.published ? "Showcase saved. Your selected items can appear wherever your public profile is enabled." : "Showcase saved privately. It is hidden from visitors.");
      } else {
        setData((current) => current ? mergeVaultOwnershipRefresh(current, payload) : payload);
        if (payload.showcase.version !== data.showcase.version) {
          setConflict(true);
          setError("Your welcome set was claimed, but the saved showcase changed in another session. Your draft is still here. Load the latest saved version before applying your changes.");
        }
        setMessage("Your free welcome collectible and scene are now permanently in your cabinet. Choose what to showcase, then save.");
        setSelectedId(payload.items.find((item) => item.source === "welcome" && item.catalog.kind !== "scene")?.id ?? null);
      }
      return true;
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Your request could not be completed.");
      return false;
    } finally { if (!controller.signal.aborted) setBusy(null); }
  }

  async function reloadLatest() {
    if (busy) return;
    const controller = new AbortController();
    activeRequest.current?.abort(); activeRequest.current = controller; setBusy("reload");
    try {
      const response = await fetch(endpoint, { credentials: "include", cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as VaultCabinetResponse | null;
      if (!response.ok || !payload?.ok) throw new Error("The latest saved version is unavailable. Your draft is unchanged.");
      if (controller.signal.aborted) return;
      setData(payload); setConflict(false); setError("");
      setMessage("Latest saved version loaded. Your draft is unchanged. Review Saved showcase, then save when ready.");
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to load the latest saved version."); }
    finally { if (!controller.signal.aborted) setBusy(null); }
  }

  function toggleItem(item: VaultOwnedItem) {
    if (busy) return;
    const selected = draft.slots.hero === item.id || draft.slots.scene === item.id || draft.slots.supporting.includes(item.id);
    const next = selected ? removeVaultItem(draft.slots, item.id) : addVaultItem(draft.slots, item);
    if (!next) { setMessage("Your five collectible positions are full. Remove an item before adding another; the sixth position is reserved for a scene."); return; }
    setDraft((current) => ({ ...current, slots: next }));
    setMessage(`${item.catalog.name} ${selected ? "removed from" : "added to"} your draft. Save showcase to apply the change.`);
  }

  function featureItem(item: VaultOwnedItem) {
    if (busy) return;
    const next = featureVaultItem(draft.slots, item);
    if (!next) { setMessage("Remove a displayed collectible before featuring this item."); return; }
    setDraft((current) => ({ ...current, slots: next }));
    setSelectedId(item.id);
    setMessage(`${item.catalog.name} is featured in your draft. Save showcase to publish the change.`);
  }

  const designs = VAULT_CATALOG.filter((item) => item.scopes.includes(scope) && item.availability === "preview");
  const welcome = VAULT_CATALOG.find((item) => item.scopes.includes(scope) && item.availability === "welcome" && item.kind !== "scene");
  const selected = data?.items.find((item) => item.id === selectedId) ?? data?.items.find((item) => item.catalog.kind !== "scene");
  const selectedDesign = designs.find((item) => item.id === designId) ?? designs[0];
  const hero = view === "designs" ? selectedDesign : selected?.catalog ?? welcome;
  const dirty = Boolean(data && isVaultDraftChanged(draft, data.showcase));
  const ownedScenes = data?.items.filter((item) => item.catalog.kind === "scene") ?? [];
  const profilePath = safeProfilePath(data?.publicProfilePath);

  return <div className={`${styles.shell} ${!motion ? styles.motionOff : ""}`}>
    <nav className={styles.routeLinks} aria-label="Vault navigation">
      <Link href={scope === "player" ? "/player" : "/dashboard"}><ArrowLeft aria-hidden="true" />{scope === "player" ? "Player Hub" : "Server dashboard"}</Link>
      <Link href={scope === "player" ? "/dashboard/vault" : "/player/cabinet"}>{scope === "player" ? "Server vault" : "Player cabinet"}</Link>
      <Link href="/store">DZN Store</Link>
      <span className={styles.scopeLabel}><LockKeyhole aria-hidden="true" />{scope === "player" ? "Private player collection" : "Private server collection"}</span>
    </nav>
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>DZN Vault / {scope === "player" ? "Player cabinet" : "Server vault"}</p><h1 className={styles.title}>{scope === "player" ? "Your collection. Your legacy." : "Earned together. Displayed with pride."}</h1></div>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={() => setMotion((value) => !value)} aria-pressed={motion}><Sparkles aria-hidden="true" />Effects {motion ? "on" : "off"}</button>
        {data ? <button type="button" className={styles.button} onClick={() => setView(view === "saved" ? "collection" : "saved")}><Eye aria-hidden="true" />{view === "saved" ? "Back to cabinet" : "Saved showcase"}</button> : null}
      </div>
    </div>
    {state.status === "loading" ? <div className={styles.loading} role="status"><LoaderCircle aria-hidden="true" />{state.message}</div> : null}
    {state.status !== "loading" && state.status !== "ready" ? <section className={styles.empty}>
      <h2>{state.status === "login" ? "Sign in to open your cabinet" : state.status === "forbidden" ? "This vault belongs to another owner" : "Your vault is unavailable"}</h2>
      <p>{state.message}</p>
      <div className={styles.actions}>{state.status === "login" ? <Link className={`${styles.button} ${styles.primary}`} href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with Discord</Link> : <button type="button" className={styles.button} onClick={retry}><RefreshCw aria-hidden="true" />Try again</button>}<Link className={styles.button} href="/store">Explore DZN collections</Link></div>
    </section> : null}
    {state.status === "ready" && data && showWelcomeFlow && welcome ? <VaultOpeningExperience
      scope={scope}
      reward={welcome}
      displayName={data.displayName}
      motion={motion}
      busy={busy === "claim"}
      claimed={!data.welcomeAvailable}
      onClaim={() => mutate("claim")}
      onContinue={() => { setShowWelcomeFlow(false); setMessage("Welcome collection revealed. Your cabinet is ready to customise."); }}
    /> : null}
    {state.status === "ready" && data && !showWelcomeFlow ? <>
      {view !== "saved" ? <nav className={styles.tabs} aria-label="Cabinet views"><button type="button" aria-pressed={view === "collection"} onClick={() => setView("collection")}>Your collection</button><button type="button" aria-pressed={view === "designs"} onClick={() => setView("designs")}>Design gallery</button><span>{data.items.length} owned {data.items.length === 1 ? "item" : "items"}</span></nav> : null}
      {data.purchaseSource === "unavailable" && view !== "saved" ? <p className={styles.notice}>Purchased items cannot be verified right now. They are not shown here until the ownership check is available again. Your free and earned collection is still available.</p> : null}
      {view === "saved" ? <>
        <div className={styles.sectionHeading}><h2>Saved showcase preview</h2><span>{dirty ? "Your unsaved draft is private" : "Your last saved selection"}</span></div>
        {!data.publicProfileEnabled ? <p className={styles.notice}>{scope === "player" ? "Your public player profile is disabled. Enable it in Privacy & Sharing when you want visitors to see this showcase." : "This server does not currently have an enabled public profile. Your collection remains saved privately."} {scope === "player" ? <Link href="/player/profile#profile-settings">Open Privacy &amp; Sharing</Link> : null}</p> : null}
        {data.showcase.published ? <VaultShowcaseDisplay showcase={ownedShowcaseProjection(data.items, data.showcase.slots)} displayName={data.displayName} scope={scope} motion={motion} onInspect={setInspected} /> : <p className={styles.empty}>Your showcase is hidden. Select items in your cabinet, enable the public showcase and save when ready.</p>}
        {profilePath && data.publicProfileEnabled ? <Link className={styles.button} href={profilePath}><Eye aria-hidden="true" />Open public profile</Link> : null}
      </> : <>
        {hero ? <section className={styles.stage} data-scene={data.items.find((item) => item.id === draft.slots.scene)?.catalog.effect ?? "none"} style={collectibleStyle(hero)} aria-label={view === "designs" ? "Collectible design preview" : "Collectible inspection"}>
          <CollectibleHero item={hero} motion={motion} />
          <div className={styles.inspection}>
            <div className={styles.identity}><div className={styles.avatar} aria-hidden="true">{data.displayName.trim().slice(0, 2).toUpperCase()}</div><div><strong>{data.displayName}</strong><small>{scope === "server" ? "Server-owned collection" : "Your personal collection"}</small></div><span className={`${styles.ownedTag} ${view === "designs" || !selected ? styles.previewTag : ""}`}>{view === "designs" ? "Preview" : selected ? <><Check aria-hidden="true" />Owned</> : "Free welcome set"}</span></div>
            <p className={styles.eyebrow}>{hero.rarity} / {hero.kind}</p><h2>{hero.name}</h2><p className={styles.description}>{hero.description}</p>
            <p className={styles.provenance}><span><ShieldCheck aria-hidden="true" />{hero.edition}</span>{selected && view === "collection" ? <span>{sourceLabel(selected.source)} · {formatDate(selected.acquiredAt)}</span> : null}</p>
            <div className={styles.actions}>
              {view === "collection" && selected ? <><button type="button" className={`${styles.button} ${styles.primary}`} disabled={Boolean(busy) || draft.slots.hero === selected.id || selected.catalog.kind === "scene"} onClick={() => featureItem(selected)}><Star aria-hidden="true" />{draft.slots.hero === selected.id ? "Featured in draft" : "Make featured"}</button><button type="button" className={styles.button} disabled={Boolean(busy)} onClick={() => toggleItem(selected)}>{isSelected(draft.slots, selected.id) ? <EyeOff aria-hidden="true" /> : <Plus aria-hidden="true" />}{isSelected(draft.slots, selected.id) ? "Remove from showcase" : "Add to showcase"}</button></> : null}
              {view === "collection" && !selected && data.welcomeAvailable ? <button type="button" className={`${styles.button} ${styles.primary}`} disabled={Boolean(busy)} onClick={() => void mutate("claim")}><Gift aria-hidden="true" />{busy === "claim" ? "Claiming your set..." : "Claim free welcome set"}</button> : null}
              <button type="button" className={styles.button} onClick={() => setInspected(hero)}><Scan aria-hidden="true" />Inspect</button>
            </div>
            <p className={styles.hint}>{view === "designs" ? "Concept edition · preview only · no checkout" : selected ? "Your public profile changes only when you save your showcase." : "One free collectible and a cabinet scene. Claiming never publishes your profile."}</p>
          </div>
        </section> : null}
        {view === "collection" ? <>
          {data.welcomeAvailable && selected ? <div className={styles.notice}><p>Your free welcome set is ready to join this collection.</p><div className={styles.actions}><button type="button" className={styles.button} disabled={Boolean(busy)} onClick={() => void mutate("claim")}><Gift aria-hidden="true" />{busy === "claim" ? "Claiming..." : "Claim free welcome set"}</button></div></div> : null}
          <div className={styles.sectionHeading}><h2>Your public showcase</h2><span>1 featured · 4 display · 1 scene</span></div>
          <div className={styles.saveRow}>
            <label className={styles.publishCheck}><input type="checkbox" checked={draft.published} disabled={Boolean(busy)} onChange={(event) => setDraft((value) => ({ ...value, published: event.target.checked }))} />Make this showcase public</label>
            <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void mutate("save")} disabled={!dirty || Boolean(busy) || conflict}><Save aria-hidden="true" />{busy === "save" ? "Saving showcase..." : "Save showcase"}</button>
          </div>
          <p className={styles.hint}>{dirty ? "Unsaved changes. Visitors still see your last saved selection." : data.showcase.published ? "Your saved selection is ready for your public profile." : "Your collection is private. You decide when to publish a showcase."}</p>
          <div className={styles.shelf}>
            <ShowcaseSlot label="Featured" id={draft.slots.hero} items={data.items} disabled={Boolean(busy)} onRemove={(id) => setDraft((current) => ({ ...current, slots: removeVaultItem(current.slots, id) }))} />
            {draft.slots.supporting.map((id, index) => <ShowcaseSlot key={index} label={`Display ${index + 1}`} id={id} items={data.items} disabled={Boolean(busy)} onRemove={(value) => setDraft((current) => ({ ...current, slots: removeVaultItem(current.slots, value) }))} />)}
            <ShowcaseSlot label="Scene" id={draft.slots.scene} items={data.items} disabled={Boolean(busy)} onRemove={(id) => setDraft((current) => ({ ...current, slots: removeVaultItem(current.slots, id) }))} />
          </div>
          {ownedScenes.length ? <div className={styles.slotChoices}><label htmlFor="vault-scene">Cabinet scene</label><select id="vault-scene" value={draft.slots.scene ?? ""} disabled={Boolean(busy)} onChange={(event) => setDraft((current) => ({ ...current, slots: { ...current.slots, scene: event.target.value || null } }))}><option value="">No scene</option>{ownedScenes.map((item) => <option key={item.id} value={item.id}>{item.catalog.name}</option>)}</select></div> : null}
          <div className={styles.sectionHeading}><h2>Permanent collection</h2><span>{scope === "player" ? "Account-owned collectibles" : "Collectibles belong to this server"}</span></div>
          {data.items.length ? <div className={styles.inventory}>{data.items.map((item) => <article key={item.id} className={`${styles.item} ${isSelected(draft.slots, item.id) ? styles.itemSelected : ""}`} style={collectibleStyle(item.catalog)}>
            <button className={styles.itemVisual} type="button" aria-label={`Select ${item.catalog.name}`} onClick={() => { setSelectedId(item.id); setMessage(`Inspecting ${item.catalog.name}.`); }}><CollectibleArt item={item.catalog} /><span className={styles.rarity}>{item.catalog.rarity}</span><span className={styles.inspectLabel}><Scan aria-hidden="true" />Select</span></button>
            <div className={styles.itemInfo}><h3>{item.catalog.name}</h3><p>{item.catalog.edition}</p><p>{sourceLabel(item.source)}</p></div>
            <button type="button" className={styles.itemButton} aria-pressed={isSelected(draft.slots, item.id)} disabled={Boolean(busy)} onClick={() => toggleItem(item)}>{isSelected(draft.slots, item.id) ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}{isSelected(draft.slots, item.id) ? "In draft showcase" : "Showcase"}</button>
          </article>)}</div> : <p className={styles.empty}>Your cabinet is empty. Claim your free welcome set to start your collection.</p>}
        </> : <>
          <div className={styles.sectionHeading}><h2>Future editions</h2><span>Design previews · not owned or available to purchase</span></div>
          <div className={styles.inventory}>{designs.map((item) => <article key={item.id} className={styles.item} style={collectibleStyle(item)}><button type="button" className={styles.itemVisual} aria-label={`Preview ${item.name}`} onClick={() => { setDesignId(item.id); setInspected(item); }}><CollectibleArt item={item} /><span className={styles.rarity}>{item.rarity}</span><span className={styles.inspectLabel}><Scan aria-hidden="true" />Preview</span></button><div className={styles.itemInfo}><h3>{item.name}</h3><p>{item.edition}</p></div></article>)}</div>
        </>}
      </>}
      {error ? <div className={`${styles.notice} ${styles.error}`} role="alert"><p>{error}</p>{conflict ? <div className={styles.actions}><button type="button" className={styles.button} disabled={Boolean(busy)} onClick={() => void reloadLatest()}><RefreshCw aria-hidden="true" />{busy === "reload" ? "Loading latest..." : "Load latest and keep my draft"}</button></div> : null}{error.includes("session expired") ? <Link className={styles.button} href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in again</Link> : null}</div> : null}
      <p className={styles.status} role="status" aria-live="polite">{message}</p>
    </> : null}
    <footer className={styles.footer}><strong>DZN ORIGINALS</strong><span>Cosmetic collectibles · your collection stays separate from competitive results</span></footer>
    <VaultInspector item={inspected} motion={motion} onClose={() => setInspected(null)} />
  </div>;
}

function ShowcaseSlot({ label, id, items, disabled, onRemove }: { label: string; id: string | null; items: VaultOwnedItem[]; disabled: boolean; onRemove: (id: string) => void }) {
  const item = items.find((value) => value.id === id);
  return <div className={`${styles.slot} ${!item ? styles.slotEmpty : ""}`}>
    <small>{label}</small>
    {item ? <><div className={styles.slotArtwork}><CollectibleArt item={item.catalog} /></div><strong>{item.catalog.name}</strong><button className={styles.removeSlot} type="button" disabled={disabled} aria-label={`Remove ${item.catalog.name} from ${label}`} onClick={() => onRemove(item.id)}>Remove</button></> : <><Plus aria-hidden="true" /><strong>{id ? "Item unavailable" : "Empty position"}</strong>{id ? <button className={styles.removeSlot} type="button" disabled={disabled} onClick={() => onRemove(id)}>Clear position</button> : null}</>}
  </div>;
}

function isSelected(slots: VaultSlots, id: string) { return slots.hero === id || slots.scene === id || slots.supporting.includes(id); }
function sourceLabel(source: VaultOwnedItem["source"]) { return source === "purchase" ? "Purchased" : source === "welcome" ? "Welcome gift" : "Earned reward"; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Owned" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(date); }
function safeProfilePath(value: string | null | undefined) { return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : null; }
function loadFailure(status: number, message?: string): LoadState {
  if (status === 401) return { status: "login", message: "Connect your Discord account to view your own collection. Player cabinets do not require an owner plan." };
  if (status === 403) return { status: "forbidden", message: message || "Only this server's verified owner can manage its collection." };
  if (status === 404) return { status: "unavailable", message: "DZN Vault is not available in this environment yet. Your existing purchases and profile settings are unchanged." };
  if (status === 503) return { status: "unavailable", message: message || "Your collection cannot be verified right now. Please try again shortly." };
  return { status: "error", message: message || "Your cabinet could not be loaded. Your saved collection has not changed." };
}
