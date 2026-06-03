# DZN Badge Asset System

Phase 4A stores individual production visual assets under `public/` so public profiles, server cards, leaderboards, discovery views, and owner previews can load each badge, frame, and theme directly.

Showcase poster images are reference boards only. They must not be sliced or depended on as runtime badge assets.

## Folder Structure

```text
public/badges/
public/badges/reputation/
public/badges/premium/
public/badges/combat/
public/badges/community/
public/badges/founder/
public/badges/crowns/
public/badges/seasonal/
public/badges/legendary/
public/frames/
public/themes/
```

Asset manifests:

```text
public/badges/badge-assets.json
public/frames/frame-assets.json
public/themes/theme-assets.json
```

## Naming Rules

- Badge codes use `snake_case`: `premium_server`, `king_of_pvp`, `summer_champion`.
- Badge filenames use `kebab-case`: `premium-server.svg`, `king-of-pvp.svg`, `summer-champion.svg`.
- Animated badge filenames append `-animated`: `premium-server-animated.svg`.
- Frame filenames use the frame key: `premium.svg`, `premium-animated.svg`.
- Theme banner filenames use `kebab-case`: `neon-city.svg`, `night-ops.svg`.

## SVG Rules

Badge SVGs:

- use `viewBox="0 0 256 256"`
- include `<title>`
- include `role="img"`
- use transparent backgrounds
- do not embed raster images or base64
- do not reference remote images, fonts, scripts, or stylesheets

Theme SVGs:

- use `viewBox="0 0 1200 420"`
- include `<title>`
- include `role="img"`
- stay lightweight and CSS/SVG-only

Animated SVGs must keep motion subtle. Use glow, shimmer, sparks, fire aura, electric flicker, crown shine, seasonal sparkle, legendary aura, or premium glow. Include reduced-motion handling inside animated SVGs when motion is present.

## Adding A Badge

1. Add static and animated SVG files to the right folder.
2. Add a manifest entry in `public/badges/badge-assets.json`.
3. Add or update the visual mapping in `lib/badges/visuals.ts`.
4. Run:

```bash
npm run check:badge-assets
npm run test:badge-visual-system
```

Example manifest entry:

```json
{
  "premium_server": {
    "code": "premium_server",
    "category": "premium",
    "rarity": "premium",
    "staticIconUrl": "/badges/premium/premium-server.svg",
    "animatedIconUrl": "/badges/premium/premium-server-animated.svg",
    "animationType": "premium",
    "glowColour": "#facc15",
    "imageAlt": "DZN Premium Server badge"
  }
}
```

## Adding A Frame

1. Add `public/frames/<key>.svg`.
2. Add `public/frames/<key>-animated.svg` if the frame supports motion.
3. Add a manifest entry in `public/frames/frame-assets.json`.
4. Map the frame in `lib/badges/visuals.ts`.

Frame SVGs should be transparent-center overlays that can sit around a server avatar or public card preview. CSS-driven frames remain the fallback.

## Adding A Theme

1. Add `public/themes/<key>.svg`.
2. Optionally add `public/themes/<key>-animated.svg`.
3. Add a manifest entry in `public/themes/theme-assets.json`.
4. Map the theme in `lib/badges/visuals.ts`.

Theme banners should be wide scene placeholders with DZN-dark styling and a clear color palette. They must not depend on external images.

## Validation

Run:

```bash
npm run check:badge-assets
```

The validator checks:

- every static badge URL exists
- every configured animated badge URL exists
- every frame asset exists
- every theme asset exists
- visual mappings do not point at missing files
- public server visual API wiring still emits the visual fields
- SVGs contain titles and do not embed base64 or remote URLs

## Runtime Notes

- Frontend badge components keep lazy loading enabled.
- Badge components provide alt text, focusable tooltips, and reduced-motion support.
- Paid plan visuals affect presentation and discovery treatment only; they do not manipulate competitive leaderboard rank.
- Crown badges remain live prestige badges and can transfer. Asset changes must not alter crown holder logic.
