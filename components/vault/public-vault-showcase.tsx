"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicVaultResponse, PublicVaultShowcase as PublicShowcaseData, VaultCatalogItem, VaultScope } from "@/lib/vault";
import { VaultInspector } from "./collectible-art";
import { VaultShowcaseDisplay } from "./vault-showcase-display";
import styles from "./vault-cabinet.module.css";

export function PublicVaultShowcase({ scope, subjectId, displayName }: { scope: VaultScope; subjectId: string; displayName: string }) {
  const [loaded, setLoaded] = useState<{ subject: string; showcase: PublicShowcaseData | null } | null>(null);
  const [motion, setMotion] = useState(false);
  const [inspected, setInspected] = useState<{ subject: string; item: VaultCatalogItem } | null>(null);
  const subject = `${scope}:${subjectId}`;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const endpoint = scope === "player" ? `/api/public/players/${encodeURIComponent(subjectId)}/vault` : `/api/public/servers/${encodeURIComponent(subjectId)}/vault`;
    void fetch(endpoint, { credentials: "omit", cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as PublicVaultResponse : null)
      .then((payload) => { if (!controller.signal.aborted) setLoaded({ subject, showcase: payload?.ok ? payload.showcase : null }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ subject, showcase: null }); });
    return () => controller.abort();
  }, [scope, subjectId, subject]);

  const showcase = loaded?.subject === subject ? loaded.showcase : null;
  if (!showcase || (!showcase.slots.hero && !showcase.slots.scene && !showcase.slots.supporting.some(Boolean))) return null;

  return <section className={`${styles.publicShowcase} ${!motion ? styles.motionOff : ""}`} aria-label={`${displayName} collectible showcase`}>
    <div className={styles.publicHeading}>
      <div><p className={styles.eyebrow}>DZN Vault</p><h2>Collection showcase</h2></div>
      <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={() => setMotion((value) => !value)} aria-pressed={motion}><Sparkles aria-hidden="true" />Effects {motion ? "on" : "off"}</button>
    </div>
    <VaultShowcaseDisplay showcase={showcase} displayName={displayName} scope={scope} motion={motion} onInspect={(item) => setInspected({ subject, item })} />
    <VaultInspector item={inspected?.subject === subject ? inspected.item : null} motion={motion} onClose={() => setInspected(null)} />
  </section>;
}
