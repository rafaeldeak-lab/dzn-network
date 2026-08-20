set -euo pipefail
echo "Wrangler version: $(npx wrangler --version)"
echo "Selected workflow ref: ${CANDIDATE_REF}"
echo "Selected branch: ${CANDIDATE_BRANCH}"
echo "Selected commit: ${CANDIDATE_SHA}"
echo "Preview D1 database name: ${PREVIEW_DB_NAME}"
echo "Preview Pages project name: ${PREVIEW_PROJECT_NAME}"
echo "Cloudflare preview token present: yes"

node <<'NODE'
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN;
function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}
function category(errors) {
  const first = Array.isArray(errors) ? errors[0] : null;
  return {
    code: first?.code ?? "unknown",
    message: first?.message ? String(first.message).replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]") : "unknown",
  };
}
async function cloudflare(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { success: false, errors: [{ code: `http_${response.status}`, message: "non_json_response" }] };
  }
  return { response, parsed };
}
void (async () => {
  const verify = await cloudflare("/user/tokens/verify");
  if (!verify.response.ok || verify.parsed.success !== true) {
    const error = category(verify.parsed.errors);
    console.log(`Cloudflare token verify success=false code=${error.code} category=${error.message}`);
    console.error("Cloudflare token invalid or expired.");
    process.exit(1);
  }
  console.log("Cloudflare token verify success=true");
  const d1 = await cloudflare(`/accounts/${accountId}/d1/database?per_page=100`);
  if (!d1.response.ok || d1.parsed.success !== true) {
    const error = category(d1.parsed.errors);
    console.log(`Cloudflare D1 list success=false code=${error.code} category=${error.message}`);
    console.error("Cloudflare token lacks D1/account permission.");
    process.exit(1);
  }
  const databases = Array.isArray(d1.parsed.result) ? d1.parsed.result : d1.parsed.result?.databases ?? [];
  console.log("Cloudflare D1 list success=true");
  for (const database of databases) {
    console.log(`D1 database: ${database?.name ?? "unnamed"} id=${maskId(database?.uuid ?? database?.id ?? "")}`);
  }
})().catch((error) => {
  console.error(error?.message ?? "Cloudflare auth diagnostic failed.");
  process.exit(1);
});
NODE
