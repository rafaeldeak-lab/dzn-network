# Player Link Notifications and History QA

Rendered on 24 September 2026 from the production build for the isolated
player-link notification and history change.

## Covered states

- Pending owner review, including the evidence checklist and Discord avatar.
- Approved decision history with Discord avatar, search, decision filter,
  server filter, and expandable technical details.
- Empty queue and unavailable queue behavior.
- Desktop, mid-width, and mobile layouts at 1440, 900, and 390 pixels.
- No document-level horizontal overflow at any captured width.

`results.json` contains the automated scenario receipt. The Player Hub's
game-account and profile anchor behavior is covered separately by
`scripts/qa-player-hub-profile-state.mjs`, including four viewport widths,
both profile routes, and stable `#game-account` / `#profile-settings` targets.
