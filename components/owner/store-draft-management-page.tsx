"use client";

import {
  AlertTriangle,
  ArrowLeft,
  FilePlus2,
  Home,
  LoaderCircle,
  PackageOpen,
  ClipboardCheck,
  RefreshCw,
  ShieldCheck,
  Store,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProductType = "supporter_pack" | "profile_theme" | "calling_card_pack" | "chat_cosmetic_pack" | "group_branding_pack" | "event_presentation_theme";
type FulfilmentKind = "supporter_card" | "cosmetic_entitlement" | "profile_frame" | "chat_badge" | "theme_pack" | "event_theme";
type DraftStatus = "draft" | "review";
type Product = {
  id: string;
  product_key: string;
  name: string;
  description: string;
  product_type: ProductType;
  fulfilment_kind: FulfilmentKind;
  status: DraftStatus;
  created_at: string;
  updated_at: string;
};
type Price = {
  id: string;
  product_id: string;
  currency: "gbp";
  unit_amount_minor: number;
  status: DraftStatus;
  created_at: string;
};
type CatalogPayload = {
  ok?: boolean;
  products?: Product[];
  prices?: Price[];
  page?: { hasMore: boolean; nextCursor: string | null };
  error?: string;
  message?: string;
  errors?: Array<{ message?: string }>;
};
type FormState = {
  productKey: string;
  name: string;
  description: string;
  productType: ProductType;
  fulfilmentKind: FulfilmentKind;
  amount: string;
  status: DraftStatus;
};

const TYPE_OPTIONS: Array<{ value: ProductType; label: string }> = [
  { value: "supporter_pack", label: "Supporter pack" },
  { value: "profile_theme", label: "Profile theme" },
  { value: "calling_card_pack", label: "Calling card pack" },
  { value: "chat_cosmetic_pack", label: "Chat cosmetic pack" },
  { value: "group_branding_pack", label: "Group branding pack" },
  { value: "event_presentation_theme", label: "Event presentation theme" },
];

const FULFILMENT_OPTIONS: Record<ProductType, Array<{ value: FulfilmentKind; label: string }>> = {
  supporter_pack: [{ value: "supporter_card", label: "Supporter card" }],
  profile_theme: [
    { value: "theme_pack", label: "Theme pack" },
    { value: "profile_frame", label: "Profile frame" },
    { value: "cosmetic_entitlement", label: "Cosmetic entitlement" },
  ],
  calling_card_pack: [{ value: "cosmetic_entitlement", label: "Cosmetic entitlement" }],
  chat_cosmetic_pack: [
    { value: "chat_badge", label: "Chat badge" },
    { value: "cosmetic_entitlement", label: "Cosmetic entitlement" },
  ],
  group_branding_pack: [{ value: "cosmetic_entitlement", label: "Cosmetic entitlement" }],
  event_presentation_theme: [
    { value: "event_theme", label: "Event theme" },
    { value: "cosmetic_entitlement", label: "Cosmetic entitlement" },
  ],
};

const EMPTY_FORM: FormState = {
  productKey: "",
  name: "",
  description: "",
  productType: "supporter_pack",
  fulfilmentKind: "supporter_card",
  amount: "",
  status: "draft",
};

export function StoreDraftManagementPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "disabled" | "blocked" | "error">("loading");
  const [busy, setBusy] = useState<"create" | "more" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async (cursor?: string, options?: { keepNotice?: boolean }) => {
    const sequence = ++requestSequence.current;
    if (cursor) setBusy("more");
    else setState("loading");
    if (!options?.keepNotice) setNotice(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/owner/store/catalog?${params}`, { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => null) as CatalogPayload | null;
      if (sequence !== requestSequence.current) return;
      if (response.status === 401 || response.status === 403) { setState("blocked"); return; }
      if (response.status === 404 && payload?.error === "STORE_DRAFT_ADMIN_DISABLED") { setState("disabled"); return; }
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "Store drafts could not be loaded.");
      setProducts((current) => cursor ? mergeById(current, payload.products ?? []) : payload.products ?? []);
      setPrices((current) => cursor ? mergeById(current, payload.prices ?? []) : payload.prices ?? []);
      setNextCursor(payload.page?.nextCursor ?? null);
      setState("ready");
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setNotice(error instanceof Error ? error.message : "Store drafts could not be loaded.");
      setState("error");
    } finally {
      if (sequence === requestSequence.current) setBusy(null);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const pricesByProduct = useMemo(() => {
    const grouped = new Map<string, Price[]>();
    for (const price of prices) grouped.set(price.product_id, [...(grouped.get(price.product_id) ?? []), price]);
    return grouped;
  }, [prices]);

  function setProductType(productType: ProductType) {
    setForm((current) => ({ ...current, productType, fulfilmentKind: FULFILMENT_OPTIONS[productType][0].value }));
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const unitAmountMinor = parseGbp(form.amount);
    if (unitAmountMinor === null) { setNotice("Enter a valid GBP price between £0.01 and £10,000.00."); return; }
    setBusy("create");
    setNotice(null);
    try {
      const response = await fetch("/api/owner/store/catalog", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product: {
            productKey: form.productKey,
            name: form.name,
            description: form.description,
            productType: form.productType,
            fulfilmentKind: form.fulfilmentKind,
            status: form.status,
          },
          price: { currency: "gbp", unitAmountMinor, status: form.status },
        }),
      });
      const payload = await response.json().catch(() => null) as CatalogPayload | null;
      if (!response.ok || !payload?.ok) {
        const validationMessage = payload?.errors?.map((error) => error.message).filter(Boolean).join(" ");
        throw new Error(validationMessage || payload?.message || "The Store draft was not saved.");
      }
      setForm(EMPTY_FORM);
      setNotice("Draft saved. It remains private, inactive, and disconnected from payments.");
      await load(undefined, { keepNotice: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Store draft was not saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#02050b] px-3 py-4 text-zinc-100 sm:px-5 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <header className="border-b border-cyan-300/20 pb-5">
          <nav className="flex flex-wrap gap-2">
            <Link href="/owner" className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><ArrowLeft size={14} />Command Centre</Link>
            <Link href="/" className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-black"><Home size={14} />Home</Link>
            <Link href="/owner/store/reconciliation" className="inline-flex items-center gap-2 rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs font-black text-amber-100"><ClipboardCheck size={14} />Review queue</Link>
            <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100"><RefreshCw size={14} />Refresh</button>
          </nav>
          <div className="mt-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">Private platform-owner workspace</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">Store draft manager</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Prepare account-bound cosmetic and supporter products without publishing a Store or connecting a payment path.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Boundary label="Public Store" />
              <Boundary label="Checkout" />
              <Boundary label="Payments" />
              <Boundary label="Fulfilment" />
            </div>
          </div>
        </header>

        {notice ? <p role="status" className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-sm font-bold text-cyan-50">{notice}</p> : null}

        {state !== "ready" ? <StatePanel state={state} /> : (
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(340px,0.82fr)_minmax(0,1.18fr)]">
            <section className="min-w-0 rounded-lg border border-white/10 bg-black/35 p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><FilePlus2 size={20} /></div>
                <div><h2 className="font-black">Create a private draft</h2><p className="mt-1 text-xs leading-5 text-zinc-500">Only safe, account-bound cosmetics and supporter recognition are accepted.</p></div>
              </div>
              <form onSubmit={createDraft} className="mt-4 grid gap-3">
                <Field label="Product name"><input required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Founding Supporter Pack" className={inputClass} /></Field>
                <Field label="Product key"><input required minLength={3} maxLength={81} pattern="[a-z0-9][a-z0-9-]{2,80}" value={form.productKey} onChange={(event) => setForm((current) => ({ ...current, productKey: slug(event.target.value) }))} placeholder="dzn-founding-supporter-pack" className={inputClass} /></Field>
                <Field label="Description"><textarea required minLength={10} maxLength={1000} rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe the permanent account-bound cosmetic contents." className={`${inputClass} min-h-28 resize-y py-3`} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Product type"><select value={form.productType} onChange={(event) => setProductType(event.target.value as ProductType)} className={inputClass}>{TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                  <Field label="Account entitlement"><select value={form.fulfilmentKind} onChange={(event) => setForm((current) => ({ ...current, fulfilmentKind: event.target.value as FulfilmentKind }))} className={inputClass}>{FULFILMENT_OPTIONS[form.productType].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Draft price (GBP)"><div className="relative"><span className="absolute left-3 top-2.5 text-zinc-500">£</span><input required inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="10.00" className={`${inputClass} pl-7`} /></div></Field>
                  <Field label="Workflow stage"><select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as DraftStatus }))} className={inputClass}><option value="draft">Draft</option><option value="review">Ready for review</option></select></Field>
                </div>
                <div className="rounded-md border border-emerald-300/15 bg-emerald-300/[0.05] p-3 text-xs leading-5 text-emerald-100"><ShieldCheck className="mr-2 inline" size={15} />Every saved item remains inactive, account-bound, guaranteed, and unable to change XP, rankings, rewards, events, eligibility, or gameplay.</div>
                <button type="submit" disabled={busy !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-4 text-sm font-black text-cyan-100 disabled:opacity-50">{busy === "create" ? <LoaderCircle className="animate-spin" size={17} /> : <FilePlus2 size={17} />}{busy === "create" ? "Saving draft..." : "Save private draft"}</button>
              </form>
            </section>

            <section className="min-w-0 rounded-lg border border-white/10 bg-black/35 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="flex items-center gap-2 font-black"><Store size={18} className="text-cyan-300" />Private catalog drafts</h2><p className="mt-1 text-xs text-zinc-500">{products.length} inactive {products.length === 1 ? "item" : "items"}</p></div><span className="rounded-md border border-amber-300/20 bg-amber-300/[0.07] px-2.5 py-1.5 text-[10px] font-black uppercase text-amber-200">Not public</span></div>
              <div className="mt-4 grid gap-2">
                {products.length === 0 ? <EmptyState /> : products.map((product) => <DraftRow key={product.id} product={product} prices={pricesByProduct.get(product.id) ?? []} />)}
              </div>
              {nextCursor ? <button type="button" disabled={busy !== null} onClick={() => void load(nextCursor)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-4 text-xs font-black text-zinc-200 disabled:opacity-50">{busy === "more" ? <LoaderCircle className="animate-spin" size={15} /> : <PackageOpen size={15} />}Load more drafts</button> : null}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function Boundary({ label }: { label: string }) { return <div className="min-w-24 rounded-md border border-red-400/20 bg-red-400/[0.06] px-3 py-2"><p className="text-[9px] font-black uppercase text-zinc-500">{label}</p><p className="mt-0.5 text-xs font-black text-red-200">Off</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-xs font-black text-zinc-300"><span>{label}</span>{children}</label>; }
function DraftRow({ product, prices }: { product: Product; prices: Price[] }) { const price = prices[0]; return <article className="grid gap-3 rounded-md border border-white/10 bg-white/[0.025] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-black text-white">{product.name}</h3><span className={`rounded px-2 py-1 text-[9px] font-black uppercase ${product.status === "review" ? "bg-violet-300/10 text-violet-200" : "bg-zinc-700/40 text-zinc-300"}`}>{product.status}</span></div><p className="mt-1 break-all text-[10px] font-bold text-cyan-300/70">{product.product_key}</p><p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{product.description}</p><p className="mt-2 text-[10px] text-zinc-500">{labelFor(product.product_type)} · {labelFor(product.fulfilment_kind)} · Updated {formatDate(product.updated_at)}</p></div><div className="sm:text-right"><p className="text-xl font-black text-white">{price ? formatPrice(price.unit_amount_minor) : "No price"}</p><p className="mt-1 text-[9px] font-black uppercase text-amber-200">Inactive draft</p></div></article>; }
function EmptyState() { return <div className="rounded-md border border-dashed border-white/10 p-10 text-center"><PackageOpen className="mx-auto text-zinc-600" /><p className="mt-3 font-black">No Store drafts yet</p><p className="mt-1 text-xs text-zinc-500">Create the first private catalog item using the form.</p></div>; }
function StatePanel({ state }: { state: "loading" | "disabled" | "blocked" | "error" }) { const content = state === "loading" ? { icon: LoaderCircle, title: "Loading private drafts", body: "Checking the protected Store draft workspace." } : state === "disabled" ? { icon: ShieldCheck, title: "Store draft workspace is off", body: "The Store and its owner draft controls remain disabled. No catalog is public and no payment path is active." } : state === "blocked" ? { icon: AlertTriangle, title: "Platform-owner access required", body: "Sign in with the authorized platform-owner Discord account to open this workspace." } : { icon: AlertTriangle, title: "Store drafts are unavailable", body: "The private draft workspace could not be loaded in this environment." }; const Icon = content.icon; return <section className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-8 text-center"><Icon className={`mx-auto text-amber-300 ${state === "loading" ? "animate-spin" : ""}`} /><p className="mt-3 font-black">{content.title}</p><p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-zinc-400">{content.body}</p></section>; }

const inputClass = "h-11 w-full rounded-md border border-white/10 bg-[#070b13] px-3 text-sm font-normal text-white outline-none focus:border-cyan-300/50";
function mergeById<T extends { id: string }>(current: T[], next: T[]) { const values = new Map(current.map((item) => [item.id, item])); for (const item of next) values.set(item.id, item); return [...values.values()]; }
function parseGbp(value: string) { const normalized = value.trim(); if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(normalized)) return null; const [pounds, pence = ""] = normalized.split("."); const minor = Number(pounds) * 100 + Number(pence.padEnd(2, "0")); return minor >= 1 && minor <= 1_000_000 ? minor : null; }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+/, "").slice(0, 81); }
function labelFor(value: string) { return value.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "); }
function formatPrice(minor: number) { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100); }
function formatDate(value: string) { const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value; const date = new Date(normalized); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
