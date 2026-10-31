"use client";

import { Check, Scan, ShieldCheck } from "lucide-react";
import type { PublicVaultShowcase, VaultCatalogItem, VaultScope } from "@/lib/vault";
import { CollectibleArt, CollectibleHero, collectibleStyle } from "./collectible-art";
import styles from "./vault-cabinet.module.css";

export function VaultShowcaseDisplay({ showcase, displayName, scope, motion, onInspect }: {
  showcase: PublicVaultShowcase;
  displayName: string;
  scope: VaultScope;
  motion: boolean;
  onInspect: (item: VaultCatalogItem) => void;
}) {
  const { hero, supporting, scene } = showcase.slots;
  return (
    <>
      {hero ? (
        <section className={styles.stage} data-scene={scene?.effect ?? "none"} style={collectibleStyle(hero)} aria-label="Featured collectible">
          <CollectibleHero item={hero} motion={motion} />
          <div className={styles.inspection}>
            <div className={styles.identity}>
              <div className={styles.avatar} aria-hidden="true">{displayName.trim().slice(0, 2).toUpperCase()}</div>
              <div><strong>{displayName}</strong><small>{scope === "server" ? "Server showcase" : "Player showcase"}</small></div>
              <span className={styles.ownedTag}><Check aria-hidden="true" />Owned</span>
            </div>
            <p className={styles.eyebrow}>{hero.rarity} / featured {hero.kind}</p>
            <h2>{hero.name}</h2>
            <p className={styles.description}>{hero.description}</p>
            <p className={styles.provenance}><span><ShieldCheck aria-hidden="true" />{hero.edition}</span></p>
            <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => onInspect(hero)}><Scan aria-hidden="true" />Inspect collectible</button></div>
          </div>
        </section>
      ) : null}
      {supporting.some(Boolean) ? <div className={styles.publicSupporting}>
        {supporting.map((item, index) => item ? <article className={styles.item} key={`supporting-${index}`} style={collectibleStyle(item)}>
          <button type="button" className={styles.itemVisual} aria-label={`Inspect ${item.name}`} onClick={() => onInspect(item)}>
            <CollectibleArt item={item} />
            <span className={styles.rarity}>{item.rarity}</span><span className={styles.inspectLabel}><Scan aria-hidden="true" />Inspect</span>
          </button>
          <div className={styles.itemInfo}><h3>{item.name}</h3><p>{item.edition}</p></div>
        </article> : null)}
      </div> : null}
      {scene ? <p className={styles.sceneCaption}>Showcase scene · {scene.name}</p> : null}
    </>
  );
}
