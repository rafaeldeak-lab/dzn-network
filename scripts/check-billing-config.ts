const checks = [
  ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY, true],
  ["STRIPE_WEBHOOK_SECRET", process.env.STRIPE_WEBHOOK_SECRET, true],
  ["NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID", process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID, false],
  ["NEXT_PUBLIC_STRIPE_PRO_PRICE_ID", process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID, false],
  ["NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID", process.env.NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID, false],
  ["NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID", process.env.NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID, false],
  ["NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL, false],
] as const;

for (const [name, value, secret] of checks) {
  const present = typeof value === "string" && value.trim().length > 0;
  const suffix = present && !secret && value ? ` (${maskPublicValue(value)})` : "";
  console.log(`${name} present? ${present ? "yes" : "no"}${suffix}`);
}

console.log("DZN billing config check complete.");

function maskPublicValue(value: string) {
  const trimmed = value.trim();
  return trimmed.length <= 4 ? "set" : `...${trimmed.slice(-4)}`;
}
