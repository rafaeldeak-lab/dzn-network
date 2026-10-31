import type { Metadata } from "next";
import { VaultCabinet } from "@/components/vault/vault-cabinet";
import styles from "@/components/vault/vault-cabinet.module.css";

export const metadata: Metadata = {
  title: "Player Cabinet | DZN Vault",
  description: "Your private DZN collection and the collectibles you choose to showcase.",
  robots: { index: false, follow: false },
};

export default function PlayerCabinetPage() {
  return <main className={styles.page}><div className={styles.frame}><VaultCabinet scope="player" /></div></main>;
}
