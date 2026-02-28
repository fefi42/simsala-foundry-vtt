# Plan 01 — Chat Window Scaffold

**Goal:** Get a working Foundry VTT module that opens a basic chat window from an item sheet's context menu. No AI functionality. Proves the module loads correctly and the ApplicationV2 window works.

---

## Deliverables

- Module loads in Foundry without errors
- "Generate with AI" appears in the item sheet header context menu (three-dot menu)
- Clicking it opens a floating ApplicationV2 window titled "Generate: <item name>"
- Window has placeholder UI (empty shell is fine)

---

## File Structure

```
simsala-foundry-vtt/
  module.json
  scripts/
    main.js           ← module entry point, registers hooks
    ItemGeneratorApp.js  ← ApplicationV2 window class
  templates/
    item-generator.hbs   ← Handlebars template for the window
  styles/
    simsala.css          ← minimal styles (can be empty for now)
```

---

## Steps

### 1. `module.json`

Standard Foundry v13 module manifest. Key fields:
- `id`: `simsala`
- `title`: `Simsala – AI Item Generator`
- `version`: `0.1.0`
- `compatibility`: minimum `13`, verified `13`
- `esmodules`: `["scripts/main.js"]`
- `styles`: `["styles/simsala.css"]`
- `languages`: none for now
- `flags`: none

### 2. `scripts/ItemGeneratorApp.js`

Extend `ApplicationV2` (with `HandlebarsApplicationMixin`).

- `DEFAULT_OPTIONS`: set `id`, `window.title`, `position` (width ~500, height ~600)
- `PARTS`: reference `item-generator.hbs`
- Constructor accepts the `item` document and stores it
- Window title dynamically set to `"Generate: ${item.name}"`
- `_prepareContext()` returns `{ itemName: item.name }` (enough for the placeholder)

### 3. `templates/item-generator.hbs`

Minimal placeholder:
```html
<div class="simsala-generator">
  <p>AI Item Generator for <strong>{{itemName}}</strong></p>
</div>
```

### 4. `scripts/main.js`

- Import `ItemGeneratorApp`
- Hook into `getItemSheetHeaderButtons` (Foundry v13 hook for adding header buttons/context menu entries) to inject the "Generate with AI" action
- On click: instantiate `ItemGeneratorApp` with the item and call `.render(true)`

> **Note:** Foundry v13 uses `getItemSheetHeaderButtons` or the ApplicationV2 equivalent `getHeaderControls`. Verify which hook is correct for item sheets in v13 during implementation — may need a quick check against Foundry's API.

### 5. `styles/simsala.css`

Empty file for now (module must declare it if listed in `module.json`).

---

## Verification

1. Place module folder in Foundry's `Data/modules/` directory
2. Enable module in a world with the dnd5e system
3. Open any item sheet
4. Three-dot menu contains "Generate with AI"
5. Clicking it opens the window with the item name displayed
6. No console errors

---

## Out of Scope for This Step

- Ollama integration
- Conversation UI (input field, message history, Apply button)
- Settings registration
- Any actual generation logic
