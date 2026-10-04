# Public Profile Social Metadata

Public player links now rewrite the exported profile shell with per-profile crawler metadata derived only from `readPublicPlayerProfileByHandle`, the same consent-aware public projection used by the visible page.

Published profiles receive a bounded public display name, public summary signals, canonical URL, Open Graph tags, Twitter large-card tags and existing local DZN artwork. Canonical and image URLs are pinned to `https://dayz-network.com` rather than trusting the incoming host. Hidden, missing, invalid or unavailable profiles receive generic DZN metadata and `noindex,nofollow`. The route remains `no-store`, removes stale content length plus the static shell's ETag and Last-Modified validators before rewriting HTML, and never stores share activity.

Discord IDs, DZN user IDs, raw player IDs, hidden sections, raw award evidence, payment state and owner state are not used. A Discord-connected signal appears only when the public projection confirms the player's separate Discord identity consent. The social-card image is the local `dzn-cinematic-survivor.png` asset; no remote image or tracking request is introduced.

This release rebuilds the still-valid behavior from legacy PRs #86-#90 on current `main`. It makes no migration, feature-flag, billing, Stripe, Discord-delivery, Nitrado or production configuration change.
