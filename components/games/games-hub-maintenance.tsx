import Link from "next/link";
import { ArrowRight, MessageCircle, Radio, Wrench } from "lucide-react";

import { SiteHomeLink } from "@/components/site-header";
import styles from "./games-hub-maintenance.module.css";

export function GamesHubMaintenance() {
  return (
    <main className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.content}>
        <nav className={styles.navigation} aria-label="DZN Network">
          <SiteHomeLink className={styles.homeLink} />
          <div className={styles.navigationActions}>
            <Link href="/community" prefetch={false}><MessageCircle size={16} />Community</Link>
            <Link href="/updates" prefetch={false}>DZN Updates<ArrowRight size={16} /></Link>
          </div>
        </nav>

        <section className={styles.notice} aria-labelledby="games-maintenance-title">
          <div className={styles.statusLine}><Radio size={15} aria-hidden="true" />MAINTENANCE WINDOW</div>
          <span className={styles.icon}><Wrench size={28} aria-hidden="true" /></span>
          <p className={styles.eyebrow}>DZN / PLAYER ARCADE</p>
          <h1 id="games-maintenance-title">Games Hub is under maintenance.</h1>
          <p className={styles.summary}>The current arcade is closed while DZN rebuilds it into deeper, more polished releases. Existing verified player records remain protected. Nothing has been reset.</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/community" prefetch={false}><MessageCircle size={17} />Visit Community</Link>
            <Link className={styles.secondaryAction} href="/updates" prefetch={false}>Read DZN Updates<ArrowRight size={17} /></Link>
          </div>
        </section>

        <p className={styles.footer}>New game releases will be announced through DZN Updates when they are ready to play.</p>
      </div>
    </main>
  );
}
