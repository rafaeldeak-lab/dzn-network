import { safeReturnTo } from "./oauth";
import type { Env } from "./types";

export const STRIPE_API_VERSION = "2026-02-25.clover";

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  customer?: string | null;
  subscription?: string | null;
  metadata?: Record<string, string | null> | null;
};

export type StripePortalSession = {
  id: string;
  url: string;
};

export type StripeSubscription = {
  id: string;
  customer: string | { id: string };
  status: string;
  current_period_start?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  items?: {
    data?: Array<{
      price?: {
        id?: string | null;
      } | null;
    }>;
  };
};

export type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

export function getAppUrl(env: Env, request: Request) {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function billingRedirectUrl(env: Env, request: Request, returnTo: string | null, status: "success" | "cancelled") {
  const appUrl = getAppUrl(env, request);
  const safePath = safeReturnTo(returnTo, "/dashboard");
  const url = new URL(safePath, appUrl);
  url.searchParams.set("billing", status);
  return url.toString();
}

export async function stripeFormRequest<T>(env: Env, path: string, params: Record<string, string | number | boolean | null | undefined>): Promise<T> {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe is not configured.");
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    body.set(key, String(value));
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
    },
    body,
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message || "Stripe request failed.");
  }
  return data;
}

export async function verifyStripeWebhook(request: Request, webhookSecret: string): Promise<StripeEvent> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) throw new Error("Missing Stripe signature.");
  const body = await request.text();
  const timestamp = signature.split(",").find((part) => part.startsWith("t="))?.slice(2);
  const expected = signature
    .split(",")
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestamp || expected.length === 0) throw new Error("Invalid Stripe signature.");

  const signedPayload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const actual = [...new Uint8Array(signatureBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!expected.some((candidate) => timingSafeEqual(candidate, actual))) {
    throw new Error("Stripe signature verification failed.");
  }

  return JSON.parse(body) as StripeEvent;
}

export function stripeId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

export function stripeTimestamp(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export function stripeSubscriptionPriceId(subscription: StripeSubscription) {
  return subscription.items?.data?.[0]?.price?.id ?? null;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
