"use client";

import Link from "next/link";
import { Check, LoaderCircle, PackageCheck, ReceiptText, RefreshCw, ShieldCheck, ShoppingBag } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type CatalogProduct = {
  publication_id: string;
  product_key: string;
  name: string;
  description: string;
  product_type: string;
  fulfilment_kind: string;
  currency: string;
  unit_amount_minor: number;
  stock_mode: "unlimited" | "finite";
  stock_limit: number | null;
  reserved_quantity: number;
  sold_quantity: number;
  lifetime_limit_per_account: number;
};

type Purchase = {
  id: string;
  order_number: string;
  status: string;
  currency: string;
  total_amount_minor: number;
  created_at: string;
  product_name: string;
  receipt_number: string | null;
  receipt_status: string | null;
  issued_at: string | null;
};

export function Storefront() {
  const [state, setState] = useState<"loading" | "ready" | "closed" | "error">("loading");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const retryKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/store/catalog", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { products?: CatalogProduct[]; checkoutEnabled?: boolean } | null;
      if (response.status === 404) { setState("closed"); return; }
      if (!response.ok || !payload) throw new Error("Store unavailable");
      setProducts(Array.isArray(payload.products) ? payload.products : []);
      setCheckoutEnabled(payload.checkoutEnabled === true);
      setState("ready");
      const purchasesResponse = await fetch("/api/store/purchases", { cache: "no-store", credentials: "include" });
      if (purchasesResponse.ok) {
        const purchasesPayload = await purchasesResponse.json().catch(() => null) as { purchases?: Purchase[] } | null;
        setPurchases(Array.isArray(purchasesPayload?.purchases) ? purchasesPayload.purchases : []);
      } else setPurchases([]);
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function buy(product: CatalogProduct) {
    if (busyId || !checkoutEnabled) return;
    setBusyId(product.publication_id);
    setMessage("");
    const requestKey = retryKeys.current.get(product.publication_id) ?? crypto.randomUUID();
    retryKeys.current.set(product.publication_id, requestKey);
    try {
      const response = await fetch("/api/store/orders", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicationId: product.publication_id, requestKey }),
      });
      const payload = await response.json().catch(() => null) as { checkout?: { url?: string }; message?: string; error?: string } | null;
      if (response.status === 401) {
        window.location.assign(`/login?returnTo=${encodeURIComponent("/store")}`);
        return;
      }
      if (!response.ok || !payload?.checkout?.url) throw new Error(payload?.message ?? "Checkout is unavailable. No payment was started.");
      window.location.assign(payload.checkout.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout is unavailable. No payment was started.");
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#03050d] text-white">
      <section className="relative overflow-hidden border-b border-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/media/server-wars-logo/dzn-server-wars-logo-poster-v2.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,5,13,0.98),rgba(3,5,13,0.82),rgba(3,5,13,0.45))]" />
        <div className="relative mx-auto flex min-h-72 w-full max-w-7xl items-end px-4 py-10 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase text-cyan-200">DZN Store</p>
            <h1 className="mt-2 text-4xl font-black uppercase sm:text-5xl">Support the network. Keep competition fair.</h1>
            <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-zinc-300">Account-bound supporter items and profile cosmetics. Purchases never add XP, spins, rank, score, event access or competitive eligibility.</p>
            <div className="mt-6 flex flex-wrap gap-3 text-xs font-black uppercase text-emerald-100">
              <span className="inline-flex items-center gap-2 border border-emerald-300/30 bg-emerald-300/10 px-3 py-2"><ShieldCheck className="h-4 w-4" aria-hidden="true" />No gameplay advantage</span>
              <span className="inline-flex items-center gap-2 border border-cyan-300/30 bg-cyan-300/10 px-3 py-2"><ReceiptText className="h-4 w-4" aria-hidden="true" />Account receipts</span>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="store-products" className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
          <div><p className="text-xs font-black uppercase text-violet-200">Available now</p><h2 id="store-products" className="mt-1 text-2xl font-black uppercase">Store items</h2></div>
          <button type="button" onClick={() => void load()} disabled={state === "loading"} className="inline-flex min-h-11 items-center gap-2 border border-white/15 px-4 text-sm font-bold text-zinc-200 hover:border-cyan-300/40 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${state === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />Refresh
          </button>
        </div>

        {state === "loading" ? <StoreStatus icon={LoaderCircle} title="Loading Store" detail="Checking the current catalog and checkout status." spinning /> : null}
        {state === "closed" ? <StoreStatus icon={ShoppingBag} title="Store opening soon" detail="The public Store is not open yet. No payment can be started from this page." /> : null}
        {state === "error" ? <StoreStatus icon={RefreshCw} title="Store temporarily unavailable" detail="The catalog could not be checked. No payment has been started." /> : null}
        {state === "ready" && products.length === 0 ? <StoreStatus icon={PackageCheck} title="No items published" detail="There are no Store items available right now." /> : null}

        {state === "ready" && products.length ? (
          <div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => {
              const remaining = product.stock_mode === "finite" ? Math.max(0, Number(product.stock_limit) - product.reserved_quantity - product.sold_quantity) : null;
              return <article key={product.publication_id} className="flex min-h-80 flex-col border border-cyan-300/20 bg-[#080d1a] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
                <div className="flex items-start justify-between gap-4"><span className="grid h-11 w-11 place-items-center border border-violet-300/30 bg-violet-300/10 text-violet-100"><ShoppingBag className="h-5 w-5" aria-hidden="true" /></span><span className="text-xs font-black uppercase text-zinc-500">{label(product.product_type)}</span></div>
                <h3 className="mt-5 text-xl font-black uppercase">{product.name}</h3>
                <p className="mt-3 flex-1 text-sm font-semibold leading-6 text-zinc-400">{product.description}</p>
                <div className="mt-5 border-y border-white/10 py-4">
                  <p className="text-3xl font-black text-cyan-100">{money(product.unit_amount_minor, product.currency)}</p>
                  <p className="mt-1 text-xs font-bold text-zinc-500">One-time, account-bound purchase</p>
                  {remaining !== null ? <p className="mt-2 text-xs font-black uppercase text-amber-200">{remaining} remaining</p> : null}
                </div>
                <button type="button" disabled={!checkoutEnabled || busyId !== null || remaining === 0} onClick={() => void buy(product)} className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 bg-cyan-300 px-4 text-sm font-black uppercase text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400">
                  {busyId === product.publication_id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                  {busyId === product.publication_id ? "Opening secure checkout" : checkoutEnabled ? "Buy with Stripe" : "Checkout paused"}
                </button>
              </article>;
            })}
          </div>
        ) : null}
        {message ? <p role="alert" className="mt-5 border border-red-300/30 bg-red-300/10 p-4 text-sm font-semibold text-red-100">{message}</p> : null}
      </section>

      {purchases.length ? <section aria-labelledby="purchase-history" className="border-t border-white/10 bg-[#070a13] py-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 id="purchase-history" className="text-2xl font-black uppercase">Your purchases</h2>
          <div className="mt-5 divide-y divide-white/10 border-y border-white/10">
            {purchases.map((purchase) => <div key={purchase.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <div><p className="font-black text-white">{purchase.product_name}</p><p className="mt-1 text-xs font-bold text-zinc-500">{purchase.order_number}</p></div>
              <p className="text-sm font-black text-cyan-100">{money(purchase.total_amount_minor, purchase.currency)}</p>
              <div className="sm:text-right"><p className="text-xs font-black uppercase text-emerald-200">{label(purchase.status)}</p><p className="mt-1 text-xs text-zinc-500">{purchase.receipt_number ?? "Receipt pending"}</p></div>
            </div>)}
          </div>
        </div>
      </section> : null}

      <footer className="border-t border-white/10 py-8"><div className="mx-auto flex w-full max-w-7xl flex-wrap gap-x-6 gap-y-3 px-4 text-sm font-bold text-cyan-200 sm:px-6 lg:px-8"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refunds">Refunds and cancellations</Link></div></footer>
    </main>
  );
}

function StoreStatus({ icon: Icon, title, detail, spinning = false }: { icon: typeof ShoppingBag; title: string; detail: string; spinning?: boolean }) {
  return <div className="mt-7 flex min-h-36 items-center gap-4 border border-white/10 bg-white/[0.02] p-5"><span className="grid h-11 w-11 shrink-0 place-items-center border border-cyan-300/25 text-cyan-100"><Icon className={`h-5 w-5 ${spinning ? "animate-spin" : ""}`} aria-hidden="true" /></span><div><h3 className="font-black uppercase">{title}</h3><p className="mt-1 text-sm font-semibold leading-6 text-zinc-400">{detail}</p></div></div>;
}
function money(amount: number, currency: string) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100); }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
