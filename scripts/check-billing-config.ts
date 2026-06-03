const checks = [
  ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY, true],
  ["STRIPE_WEBHOOK_SECRET", process.env.STRIPE_WEBHOOK_SECRET, true],
  ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, false],
  ["STRIPE_PRICE_STARTER", process.env.STRIPE_PRICE_STARTER, false],
  ["STRIPE_PRICE_PRO", process.env.STRIPE_PRICE_PRO, false],
  ["STRIPE_PRICE_PREMIUM", process.env.STRIPE_PRICE_PREMIUM, false],
  ["NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL, false],
  ["DZN_APP_URL", process.env.DZN_APP_URL, false],
  ["DZN_CRON_SECRET", process.env.DZN_CRON_SECRET, true],
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
