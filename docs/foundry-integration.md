# Foundry VTT Integration Notes

Lessons learned and patterns used for integrating with Foundry VTT v13 and the dnd5e system.

## Button Injection

Simsala injects a button into item/NPC sheet headers. There are two ways to add header buttons in Foundry v13:

1. **`getHeaderControlsApplicationV2` hook** — adds to the collapsible controls panel. Doesn't work well: the expanded panel renders differently and click events don't carry `data-action` through properly.

2. **Direct DOM injection via render hook** (what we use) — inject a `<button>` directly into `.window-header` via the `renderItemSheet5e` / `renderNPCActorSheet` hook. Attach the click listener on the element. Check for `.simsala-btn` before injecting to prevent duplicates on re-render.

## ApplicationV2

- `render({ force: true })` is the v13 syntax (not `render(true)` from older versions)
- Render hook signature: `(app, html, context)` — `html` is the content area only; use `app.element` for the full window including header
- `HandlebarsApplicationMixin(ApplicationV2)` provides Handlebars template rendering with the `PARTS` static

## Document Updates

- Items/actors are updated via `document.update(data)` where `data` follows Foundry's nested dot-path or object structure
- NPC actors have embedded items (weapons, feats, spells) that represent actions — these are created via `actor.createEmbeddedDocuments("Item", [...])`
- Actor-level fields (ability scores, HP, AC) go through `update()`; action/spell items go through `createEmbeddedDocuments()`

## dnd5e System Specifics

- Enum values (rarity, damage types, properties, etc.) come from `dnd5e/module/config.mjs`
- Weapon items auto-create an attack activity on `_preCreate` — no need to manually build activities for weapons
- Feat items do NOT auto-create activities — these must be included in the creation data
- NPC creature type uses `system.details.type.value` (not a top-level field)
- AC calculation mode `"natural"` tells the system to use the flat AC value directly
- HP `formula` and `max` are separate fields; we compute `max` deterministically from the formula

## Debugging

- `CONFIG.debug.hooks = true` — logs all hook names as they fire
- Browser caches ES modules aggressively — always Ctrl+Shift+R after JS changes
- Add `console.log("[simsala] main.js loaded")` at top of main.js to confirm code is loaded
