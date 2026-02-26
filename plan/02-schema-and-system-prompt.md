# Plan 02 — Item Schema Reference & System Prompt

**Goal:** Extract the dnd5e item enum values into a static project file, and build the system prompt template that grounds the LLM in the correct data structure. No Ollama wiring yet — this plan produces the static assets consumed by the next plan.

---

## Deliverables

- `data/dnd5e-item-schema.json` — hand-authored enum reference for all relevant item fields, committed to the project
- `scripts/prompt-template.js` — assembles the final system prompt string at runtime by combining the static schema with the live `item.toObject()` document

---

## Part 1 — `data/dnd5e-item-schema.json`

A single JSON file that documents all non-obvious field values. It is the authoritative reference for both the LLM prompt and the validation layer.

All values sourced from `/home/vibo/workspace/dnd5e/module/config.mjs`.

### Sections to include

**Item types** — `type.value` options per item kind:
- `weapon`: `simpleM`, `simpleR`, `martialM`, `martialR`, `natural`, `improv`
- `equipment`: spread of `armorTypes` + `miscEquipmentTypes` (light, medium, heavy, natural, shield, clothing, trinket, vehicle, etc.)
- `consumable`: `ammo`, `poison`, `food`, `scroll`, `wand`, `rod`, `trinket`, `drug` (each may have `subtypes`)
- `tool`: `art`, `game`, `music` (with individual tools as subtypes)
- `loot`: `art`, `gear`, `junk`, `material`, `resource`, `treasure`

**Rarity** — `system.rarity`:
`common`, `uncommon`, `rare`, `veryRare`, `legendary`, `artifact`

**Attunement** — `system.attunement`:
`""` (none), `"required"`, `"optional"`

**Damage types** — used in `damage.base.types`:
`acid`, `bludgeoning`, `cold`, `fire`, `force`, `lightning`, `necrotic`, `piercing`, `poison`, `psychic`, `radiant`, `slashing`, `thunder`

**Valid properties** — `system.properties` (a Set of strings, valid values differ per item type):
- weapon: `ada`, `amm`, `fin`, `fir`, `foc`, `hvy`, `lgt`, `lod`, `mgc`, `rch`, `ret`, `spc`, `thr`, `two`, `ver`
- equipment: `mgc`, `stl`
- consumable: `mgc`

**Price denomination** — `system.price.denomination`:
`cp`, `sp`, `ep`, `gp`, `pp`

**Weight units** — `system.weight.units`:
`lb`, `tn`, `kg`, `Mg`, `oz`

**Damage formula** — `damage.base.formula`: dice expression string, e.g. `"1d8"`, `"2d6 + 3"`

---

## Part 2 — `scripts/prompt-template.js`

A module that exports a single function:

```js
export function buildSystemPrompt(item) { ... }
```

It returns the complete system prompt string by combining:

1. **Role framing** — static text: "You are a D&D 5e game master assistant..."
2. **Schema reference** — the contents of `dnd5e-item-schema.json` embedded as a JSON block
3. **Current item document** — `JSON.stringify(item.toObject(), null, 2)` so the LLM sees the current state and the full field structure
4. **Output instructions** — return only a JSON object containing the fields to update (not the full document). Must be valid JSON. Only use field names that exist in the document.

### Loading the schema file

Use `fetch("modules/simsala/data/dnd5e-item-schema.json")` to load it, or import it statically as a JS object (preferred — avoids an async fetch on every prompt build). Export the schema as a JS object from a companion file `data/dnd5e-item-schema.js`.

---

## Verification

Before moving to plan 03:
1. Open the browser console and manually call `buildSystemPrompt(item)` with a live item document
2. Confirm the output is readable, includes the enum reference, and includes the item's current JSON
3. Copy the prompt into an Ollama chat manually and verify the model returns sensible JSON

---

## Out of Scope

- Sending the prompt to Ollama (plan 03)
- Validation logic (plan 03)
- Chat window UI (plan 03)
