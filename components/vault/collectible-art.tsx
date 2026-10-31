"use client";

import { Crown, Play, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { VaultCatalogItem, VaultEffect } from "@/lib/vault";
import styles from "./vault-cabinet.module.css";

const EFFECT_COLOURS: Record<VaultEffect, string> = {
  none: "#bc9bda", void: "#b48bff", ember: "#f0a76b", toxic: "#9cdb83",
  frost: "#8cdef0", signal: "#b4a1ff", gold: "#e5c683",
};

export function collectibleStyle(item: VaultCatalogItem): CSSProperties {
  return { "--item-glow": EFFECT_COLOURS[item.effect] } as CSSProperties;
}

export function CollectibleArt({ item, motion = false }: { item: VaultCatalogItem; motion?: boolean }) {
  const index = item.artIndex;
  const directArtwork = item.artUrl?.startsWith("/store/cards/") ? item.artUrl : null;
  return (
    <>
      {item.kind === "scene" ? (
        <div aria-hidden="true" className={styles.sceneArt}>
          <div className={styles.sceneDoor} /><div className={styles.sceneFloor} />
          <span>DZN VAULT<strong>{item.name}</strong></span>
        </div>
      ) : directArtwork ? (
        <div aria-hidden="true" className={styles.art} style={{ backgroundImage: `url(${directArtwork})`, backgroundPosition: "center", backgroundSize: "contain" }} />
      ) : index !== null && Number.isInteger(index) && index >= 0 && index < 6 ? (
        <div aria-hidden="true" className={styles.art} style={{
          backgroundImage: "url('/vault/dzn-atlas.webp')",
          backgroundPosition: `${(index % 3) * 50}% ${Math.floor(index / 3) * 100}%`,
        }} />
      ) : (
        <div aria-hidden="true" className={styles.artFallback}><Crown /><span>DZN<br />SUPPORTER</span></div>
      )}
      {motion && item.effect !== "none" ? <><div aria-hidden="true" className={styles.mist} /><div aria-hidden="true" className={styles.shine} /></> : null}
    </>
  );
}

export function CollectibleHero({ item, motion = false, revealing = false }: { item: VaultCatalogItem; motion?: boolean; revealing?: boolean }) {
  return (
    <div className={styles.displayBay} style={collectibleStyle(item)}>
      <div className={`${styles.heroCard} ${revealing && motion ? styles.revealing : ""}`}>
        <CollectibleArt item={item} motion={motion} />
        <div className={styles.cardCaption}><span>{item.edition}</span><strong>{item.name}</strong></div>
      </div>
    </div>
  );
}

export function VaultInspector({ item, motion, onClose }: { item: VaultCatalogItem | null; motion: boolean; onClose: () => void }) {
  return item ? <OpenVaultInspector key={item.id} item={item} motion={motion} onClose={onClose} /> : null;
}

function OpenVaultInspector({ item, motion, onClose }: { item: VaultCatalogItem; motion: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.showModal();
    closeButton.current?.focus();
    return () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
      node.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [item]);

  function finishReveal() {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    setRevealing(false);
    setAnnouncement("Your collectible is ready to inspect.");
  }

  function reveal() {
    if (!motion) { setAnnouncement("Collectible revealed. Motion is paused."); return; }
    if (revealTimer.current) clearTimeout(revealTimer.current);
    setRevealing(true);
    setAnnouncement("Playing collectible reveal.");
    revealTimer.current = setTimeout(finishReveal, 1400);
  }

  return (
    <dialog ref={dialog} className={`${styles.dialog} ${!motion ? styles.motionOff : ""}`} aria-labelledby="vault-inspector-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className={styles.dialogHeader}>
        <h2 id="vault-inspector-title">Inspect {item.name}</h2>
        <button ref={closeButton} className={styles.button} type="button" onClick={onClose}><X aria-hidden="true" />Close</button>
      </header>
      <div className={styles.stage} style={collectibleStyle(item)}>
        <CollectibleHero item={item} motion={motion} revealing={revealing} />
        <div className={styles.inspection}>
          <p className={styles.eyebrow}>{item.rarity} / {item.kind}</p>
          <h2>{item.name}</h2>
          <p className={styles.description}>{item.description}</p>
          <p className={styles.provenance}><span><ShieldCheck aria-hidden="true" />{item.edition}</span></p>
          {item.availability === "preview" ? <p className={styles.notice}>Design preview. This edition is not available to buy or claim.</p> : null}
          <div className={styles.actions}>
            <button className={`${styles.button} ${styles.primary}`} type="button" onClick={reveal} disabled={revealing}><Play aria-hidden="true" />Play reveal</button>
            {revealing ? <button className={styles.button} type="button" onClick={finishReveal}>Skip reveal</button> : null}
          </div>
          <p className={styles.hint}>Layered collectible artwork with atmospheric effects.</p>
          <p className={styles.status} role="status" aria-live="polite">{announcement}</p>
        </div>
      </div>
    </dialog>
  );
}
