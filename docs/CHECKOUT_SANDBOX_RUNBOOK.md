# Checkout Sandbox

This configuration is a test-only environment for the DZN checkout flow.

## Fixed boundary

- Pages project: `dzn-network-checkout-sandbox`
- URL: `https://dzn-network-checkout-sandbox.pages.dev`
- D1 database: `dzn_network_db_checkout_sandbox_20261025`
- D1 database ID: `e8563ccb-7f30-4950-8137-6a7eb3a8cc3c`
- Production Pages project: `dzn-network`
- Production D1 database ID: `37515c66-2787-49e4-8568-a461517e975e`

The sandbox configuration must never be used with a production Pages project, a production hostname, or the production D1 database. `DZN_LIVE_CHECKOUT_ENABLED` stays `false` in this environment.

Branch-preview hosts under `*.dzn-network.pages.dev` are blocked before any route can use a database binding. The canonical Pages host, public custom domains, and this separate sandbox host are not part of that block.

## Test-only configuration

Add only Stripe test-mode values to the sandbox project:

- `STRIPE_SECRET_KEY` beginning with `sk_test_`
- `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_PRO` created in Stripe test mode
- `STRIPE_WEBHOOK_SECRET` from a Stripe test-mode webhook whose URL is `https://dzn-network-checkout-sandbox.pages.dev/api/stripe/webhook`

Do not copy live Stripe keys, live Price IDs, or a live webhook signing secret to the sandbox. Do not configure Discord bot, notification, or automation secrets for this project.

## Deployment and verification

1. Apply migrations using `wrangler.checkout-sandbox.toml` only after confirming the database ID is the sandbox ID above.
2. In the separate Pages project's Production settings, bind `DB` to the sandbox database and keep the non-secret sandbox variables shown above.
3. From this dedicated sandbox worktree, run `$env:DZN_ALLOW_CHECKOUT_SANDBOX_DEPLOY = "1"; npm run deploy:checkout-sandbox`. Pages direct deployment does not accept `--config` and instead reads the root `wrangler.toml`; this guarded command assembles a short-lived staging directory containing only the sandbox configuration, targets only `dzn-network-checkout-sandbox`, and never replaces the checked-in configuration.
4. Confirm the deployed Pages binding names the sandbox database ID, and confirm `DZN_APP_URL` is the sandbox URL.
5. Configure test-only Stripe values as encrypted Pages secrets, then create a test checkout session.
6. Confirm the Stripe success and cancel links return to the sandbox URL and that the webhook receipt is stored only in the sandbox database.
7. Keep live checkout disabled. A successful test transaction is not authorization to enable production billing.
