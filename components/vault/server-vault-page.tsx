"use client";

import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getMe } from "@/components/onboarding/api";
import type { LinkedServer } from "@/components/onboarding/types";
import { VaultCabinet } from "./vault-cabinet";
import styles from "./vault-cabinet.module.css";

export function ServerVaultPage() {
  const [state, setState] = useState<"loading" | "ready" | "login" | "error">("loading");
  const [servers, setServers] = useState<LinkedServer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [requestedUnavailable, setRequestedUnavailable] = useState(false);
  const [returnTo, setReturnTo] = useState("/dashboard/vault");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    const requestedId = new URLSearchParams(window.location.search).get("serverId");
    const nextReturnTo = `/dashboard/vault${requestedId ? `?serverId=${encodeURIComponent(requestedId)}` : ""}`;
    void getMe().then((auth) => {
      if (!active) return;
      setReturnTo(nextReturnTo);
      if (!auth.authenticated) { setState("login"); return; }
      const available = auth.linkedServers?.length ? auth.linkedServers : auth.linkedServer ? [auth.linkedServer] : [];
      setServers(available);
      const match = requestedId ? available.find((item) => item.id === requestedId) : auth.linkedServer ?? available[0];
      setSelectedId(match?.id ?? "");
      setRequestedUnavailable(Boolean(requestedId && !match));
      setState("ready");
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [retryKey]);

  function chooseServer(value: string) {
    setSelectedId(value);
    setRequestedUnavailable(false);
    const next = `/dashboard/vault${value ? `?serverId=${encodeURIComponent(value)}` : ""}`;
    window.history.replaceState(window.history.state, "", next);
    setReturnTo(next);
  }

  return <main className={styles.page}><div className={styles.frame}>
    {state === "loading" ? <div className={styles.loading} role="status"><LoaderCircle aria-hidden="true" />Checking your managed servers...</div> : null}
    {state === "login" || state === "error" ? <section className={`${styles.shell} ${styles.empty}`}>
      <p className={styles.eyebrow}>DZN Vault</p><h1 className={styles.title}>{state === "login" ? "Sign in to open your server vault" : "Your server list is unavailable"}</h1>
      <p className={styles.subtitle}>{state === "login" ? "Use the Discord account that owns your linked DZN server." : "Your server collections have not changed. Try loading the server list again."}</p>
      {state === "login" ? <Link className={`${styles.button} ${styles.primary}`} href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with Discord</Link> : <button type="button" className={styles.button} onClick={() => { setState("loading"); setRetryKey((value) => value + 1); }}><RefreshCw aria-hidden="true" />Try again</button>}
    </section> : null}
    {state === "ready" ? <>
      {servers.length ? <div className={styles.serverPicker}><label htmlFor="vault-server-picker">Server collection</label><select id="vault-server-picker" value={selectedId} onChange={(event) => chooseServer(event.target.value)}><option value="" disabled>Choose your server</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.server_name || server.nitrado_service_name || server.id}</option>)}</select></div> : null}
      {requestedUnavailable ? <p className={styles.notice}>The requested server is not in your managed server list. Choose an available server to continue.</p> : null}
      {selectedId ? <VaultCabinet key={selectedId} scope="server" serverId={selectedId} /> : <section className={`${styles.shell} ${styles.empty}`}><h1 className={styles.title}>{servers.length ? "Choose a server vault" : "No linked server to manage"}</h1><p className={styles.subtitle}>{servers.length ? "Each server has its own collection and saved public showcase." : "Link a server through your dashboard to manage its collection. Your player cabinet is available separately."}</p><div className={styles.actions}><Link className={styles.button} href="/dashboard"><ArrowLeft aria-hidden="true" />Server dashboard</Link><Link className={styles.button} href="/player/cabinet">Open player cabinet</Link></div></section>}
    </> : null}
  </div></main>;
}
