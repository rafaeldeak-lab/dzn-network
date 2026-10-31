"use client";

import { Check, ChevronRight, Gift, LockKeyhole, Sparkles } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { VaultCatalogItem, VaultScope } from "@/lib/vault";
import { VAULT_REWARD_ART_ROADMAP_SUMMARY } from "@/lib/vault-reward-roadmap";
import { CollectibleHero, collectibleStyle } from "./collectible-art";
import styles from "./vault-cabinet.module.css";

type OpeningStage = "select" | "charging" | "ready" | "revealed";

type CacheOption = {
  id: string;
  name: string;
  tier: "Origin" | "Elite" | "Mythic";
  description: string;
  art: string;
  tone: "signal" | "ember" | "gold";
  available: boolean;
};

const CACHE_OPTIONS: readonly CacheOption[] = [
  {
    id: "signal-cache", name: "Signal Cache", tier: "Origin",
    description: "Your free DZN welcome collection, held safely until you choose to open it.",
    art: "/vault/caches/signal-cache-v1.png", tone: "signal", available: true,
  },
  {
    id: "cinder-reliquary", name: "Cinder Reliquary", tier: "Elite",
    description: "A future earned-reward cache. Its ember treatment is a preview, not a purchasable item.",
    art: "/vault/caches/cinder-reliquary-v1.png", tone: "ember", available: false,
  },
  {
    id: "sovereign-vault", name: "Sovereign Vault", tier: "Mythic",
    description: "A future seasonal cache. Kept locked until its original artwork and reward rules are ready.",
    art: "/vault/caches/sovereign-vault-v1.png", tone: "gold", available: false,
  },
];

export function VaultOpeningExperience({
  scope,
  reward,
  displayName,
  motion,
  busy,
  claimed,
  onClaim,
  onContinue,
}: {
  scope: VaultScope;
  reward: VaultCatalogItem;
  displayName: string;
  motion: boolean;
  busy: boolean;
  claimed: boolean;
  onClaim: () => Promise<boolean>;
  onContinue: () => void;
}) {
  const [stage, setStage] = useState<OpeningStage>(claimed ? "revealed" : "select");
  const [selectedId, setSelectedId] = useState("signal-cache");
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = CACHE_OPTIONS.find((cache) => cache.id === selectedId) ?? CACHE_OPTIONS[0];

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const visibleStage: OpeningStage = claimed ? "revealed" : stage;

  function beginOpening() {
    if (!selected.available || claimed) return;
    if (!motion) {
      setStage("ready");
      setAnnouncement("Signal Cache primed. Motion is paused; reveal is ready.");
      return;
    }
    setStage("charging");
    setAnnouncement("Signal Cache unlocking. Violet signal energy is building.");
    timer.current = setTimeout(() => {
      setStage("ready");
      setAnnouncement("Cache unlocked. Your welcome collection is ready to reveal.");
    }, 2600);
  }

  async function revealCollection() {
    setAnnouncement("Verifying and placing your free welcome collection in your private cabinet.");
    const success = await onClaim();
    if (success) {
      setStage("revealed");
      setAnnouncement("Welcome collection revealed and permanently placed in your cabinet.");
    }
  }

  return <section className={`${styles.opening} ${styles[`opening${visibleStage[0].toUpperCase()}${visibleStage.slice(1)}`]} ${!motion ? styles.motionOff : ""}`} aria-labelledby="vault-opening-title">
    <div className={styles.openingBackdrop} aria-hidden="true"><span /><span /><span /></div>
    <header className={styles.openingHeader}>
      <div><p className={styles.eyebrow}>DZN Vault / First unlock</p><h2 id="vault-opening-title">Open your first cache</h2><p>{scope === "player" ? "A private reward journey, then your Player Cabinet." : "A private reward journey, then your Server Vault."}</p></div>
      <div className={styles.openingBadges}><span className={styles.openingGuarantee}><LockKeyhole aria-hidden="true" />Cosmetic only · no competitive advantage</span><span>{VAULT_REWARD_ART_ROADMAP_SUMMARY.collections} lines · {VAULT_REWARD_ART_ROADMAP_SUMMARY.plannedEditions} future editions</span></div>
    </header>

    {visibleStage === "select" ? <>
      <div className={styles.cacheGrid} aria-label="Reward cache selection">
        {CACHE_OPTIONS.map((cache) => <button key={cache.id} type="button" className={`${styles.cacheOption} ${styles[`cache${cache.tone[0].toUpperCase()}${cache.tone.slice(1)}`]} ${selectedId === cache.id ? styles.cacheSelected : ""}`} aria-pressed={selectedId === cache.id} onClick={() => { setSelectedId(cache.id); setAnnouncement(cache.available ? `${cache.name} selected.` : `${cache.name} is not available yet.`); }}>
          <span className={styles.cacheArt}><Image src={cache.art} alt="" fill sizes="(max-width: 660px) 92px, (max-width: 960px) 124px, 108px" /></span>
          <span className={styles.cacheCopy}><small>{cache.tier} cache</small><strong>{cache.name}</strong><em>{cache.available ? "Free welcome unlock" : "Future edition · locked"}</em></span>
          {!cache.available ? <LockKeyhole aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        </button>)}
      </div>
      <div className={styles.openingAction}>
        <div><strong>{selected.name}</strong><p>{selected.description}</p></div>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!selected.available} onClick={beginOpening}><Gift aria-hidden="true" />Begin unlock <ChevronRight aria-hidden="true" /></button>
      </div>
    </> : null}

    {visibleStage === "charging" || visibleStage === "ready" ? <div className={styles.openingSequence}>
      <div className={styles.cacheChamber} data-tone={selected.tone}>
        <div className={styles.cacheRings} aria-hidden="true"><i /><i /><i /></div>
        <div className={styles.cacheSmoke} aria-hidden="true"><i /><i /><i /></div>
        <Image className={styles.openingCache} src={selected.art} alt="A closed Signal Cache" width={456} height={330} priority />
        <div className={styles.cacheBurst} aria-hidden="true" />
      </div>
      <div className={styles.sequenceCopy}>
        <p className={styles.eyebrow}>{visibleStage === "charging" ? "Unlocking cache" : "Signal confirmed"}</p>
        <h3>{visibleStage === "charging" ? "Reading the signal…" : "Your collection is ready."}</h3>
        <p>{visibleStage === "charging" ? "The cache is building to a reveal. This visual sequence does not grant anything until you confirm the final reveal." : "Reveal permanently adds the free welcome collectible and scene to your private cabinet. It will not make your profile public."}</p>
        {visibleStage === "charging" ? <div className={styles.openingProgress} aria-label="Unlocking in progress"><span /></div> : <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => void revealCollection()}><Sparkles aria-hidden="true" />{busy ? "Revealing…" : "Reveal my collection"}</button><button type="button" className={styles.button} onClick={() => setStage("select")}>Back to caches</button></div>}
      </div>
    </div> : null}

    {visibleStage === "revealed" ? <div className={styles.rewardReveal} style={collectibleStyle(reward)}>
      <div className={styles.rewardFlare} aria-hidden="true" /><div className={styles.rewardParticles} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className={styles.revealCard}><CollectibleHero item={reward} motion={motion} revealing /></div>
      <div className={styles.revealCopy}>
        <p className={styles.eyebrow}><Check aria-hidden="true" />Collection unlocked</p><h3>{reward.name}</h3><p>{reward.description}</p><p className={styles.revealMeta}>{reward.edition} · {reward.rarity} · permanently in {displayName}&apos;s {scope === "player" ? "Player Cabinet" : "Server Vault"}</p>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onContinue}>Enter my cabinet <ChevronRight aria-hidden="true" /></button>
      </div>
    </div> : null}
    <p className={styles.status} role="status" aria-live="polite">{announcement}</p>
  </section>;
}
