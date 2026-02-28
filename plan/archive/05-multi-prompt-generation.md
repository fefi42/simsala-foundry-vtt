# Plan 05 — Multi-Prompt Field Generation

**Goal:** Replace the single monolithic generation call with a set of small, focused prompts — one per field group. Every relevant field gets populated with something sensible. The DM can always fine-tune manually afterwards; the priority is complete, usable output over perfect output.

**Replaces:** The single `OllamaService.generate` call in `ItemGeneratorApp._generate`. The chat UI, Apply button, and OllamaService itself are unchanged.

---

## Why

Small models (llama3.2 3B) fail at large, multi-constraint tasks. Asking for 20+ fields at once causes:
- Fields dropped silently (e.g. `damage.formula`)
- Constraints forgotten halfway through (schema reference keys leaking into output)
- Hallucinated field names

Each focused call is a task the model can't fail at: "give me a dice expression for this weapon's damage." Either it returns `"1d6"` or it doesn't — trivial to validate.

---

## Field Groups

Each group maps to a set of item fields. Groups are defined per item type — only relevant groups run.

### Group: Identity
**Applies to:** all item types
**Fields:** `name`, `system.rarity`, `system.attunement`, `system.type.value`
**Prompt focus:** Infer the item's name, rarity tier, attunement requirement, and subtype from the description.

### Group: Description
**Applies to:** all item types
**Fields:** `system.description.value`
**Prompt focus:** Write 2–4 sentences of flavour text in the voice of a D&D sourcebook. HTML with `<p>` tags.

### Group: Damage
**Applies to:** weapon, consumable
**Fields:** `system.damage.base.formula`, `system.damage.base.types`, `system.damage.versatile.formula`, `system.damage.versatile.types`
**Prompt focus:** What damage does this weapon deal? Use real 5e weapon benchmarks (dagger 1d4, shortsword 1d6, longsword 1d8/1d10 versatile, greatsword 2d6).

### Group: Properties
**Applies to:** weapon, equipment, consumable, tool, loot
**Fields:** `system.properties` (array of valid keys for this item type)
**Prompt focus:** Which properties apply? Provide the valid key list for this item type directly in the prompt.

### Group: Defense
**Applies to:** equipment (armor/shield only)
**Fields:** `system.armor.value`, `system.strength`
**Prompt focus:** What AC does this armor provide? Use 5e benchmarks (leather 11, chain mail 16, plate 18, shield +2).

### Group: Uses
**Applies to:** consumable
**Fields:** `system.uses.max`, `system.uses.per`
**Prompt focus:** How many charges/uses does this item have and when do they recover?

### Group: Physical
**Applies to:** all physical items
**Fields:** `system.price.value`, `system.price.denomination`, `system.weight.value`
**Prompt focus:** Infer a sensible market value and weight. Use 5e PHB pricing as a benchmark (common ~50gp, uncommon ~500gp, rare ~5000gp, very rare ~50000gp, legendary ~500000gp).

---

## Fields per Item Type

### Weapon

| Request | Fields |
|---|---|
| Identity | `name`, `system.rarity`, `system.attunement`, `system.type.value`, `system.mastery` |
| Description | `system.description.value` |
| Damage | `system.damage.base.formula`, `system.damage.base.types`, `system.damage.versatile.formula`, `system.damage.versatile.types` |
| Properties | `system.properties` — valid keys: `ada`, `amm`, `fin`, `fir`, `foc`, `hvy`, `lgt`, `lod`, `mgc`, `rch`, `ret`, `sil`, `spc`, `thr`, `two`, `ver` |
| Physical | `system.price.value`, `system.price.denomination`, `system.weight.value` |

`system.mastery` valid values: `cleave`, `graze`, `nick`, `push`, `sap`, `slow`, `topple`, `vex`
Each weapon type has a canonical mastery in 5e (e.g. dagger → `nick`, longsword → `sap`, greatsword → `cleave`). The model should infer the most appropriate one from the weapon type and description.

### Equipment

| Request | Fields |
|---|---|
| Identity | `name`, `system.rarity`, `system.attunement`, `system.type.value` |
| Description | `system.description.value` |
| Defense | `system.armor.value`, `system.strength` (min strength required to wear, heavy armor only) |
| Properties | `system.properties` — valid keys: `ada`, `foc`, `mgc`, `stealthDisadvantage` |
| Physical | `system.price.value`, `system.price.denomination`, `system.weight.value` |

### Consumable

| Request | Fields |
|---|---|
| Identity | `name`, `system.rarity`, `system.attunement`, `system.type.value` |
| Description | `system.description.value` |
| Damage | `system.damage.base.formula`, `system.damage.base.types` — only generated if the item deals damage (e.g. bomb, acid flask, poison). Skipped for potions, food, scrolls. |
| Uses | `system.uses.max`, `system.uses.per` |
| Properties | `system.properties` — valid keys: `mgc` |
| Physical | `system.price.value`, `system.price.denomination`, `system.weight.value` |

### Tool

| Request | Fields |
|---|---|
| Identity | `name`, `system.rarity`, `system.attunement`, `system.type.value` |
| Description | `system.description.value` |
| Properties | `system.properties` — valid keys: `foc`, `mgc` |
| Physical | `system.price.value`, `system.price.denomination`, `system.weight.value` |

### Loot

| Request | Fields |
|---|---|
| Identity | `name`, `system.rarity`, `system.type.value` |
| Description | `system.description.value` |
| Properties | `system.properties` — valid keys: `mgc` |
| Physical | `system.price.value`, `system.price.denomination`, `system.weight.value` |

> **Note:** `attunement` is not included for loot — loot items cannot be attuned per the dnd5e schema.

---

## Prompt Design

Each group prompt has three parts:
1. **Context** — the GM's description + current item name and type
2. **Task** — one specific instruction with 5e benchmarks or valid values listed inline
3. **Format** — a minimal JSON example showing exactly what to return

No schema reference dump. No full item document. Just what the model needs for that one task.

Each call also uses Ollama's `format` parameter with a tight JSON Schema matching the expected output shape exactly, giving structured output guarantees on top of the prompt.

### Example — Damage group prompt
```
You are a D&D 5e assistant. The GM is creating a weapon.

GM description: "a cursed dagger that deals cold damage"
Item type: weapon (simple melee)

What damage does this weapon deal? Use real 5e benchmarks: dagger 1d4, shortsword 1d6, longsword 1d8, greatsword 2d6.
Damage types: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder.

Return JSON:
{ "formula": "1d4", "types": ["cold"] }
```

### Example — Damage group format schema (Ollama `format` parameter)
```json
{
  "type": "object",
  "properties": {
    "formula": { "type": "string" },
    "types":   { "type": "array", "items": { "type": "string" } }
  },
  "required": ["formula", "types"]
}
```

---

## Model Memory

Each group call is stateless — no conversation history. The GM's description and the current working result (from previous groups or previous turns) are injected directly into each prompt. This is simpler than maintaining a chat history per group.

For multi-turn iteration ("make it more sinister"): all groups re-run with both the original description and the new instruction as context. The previous result is shown as the current state the model should build on.

---

## keep_alive Strategy

Multiple sequential calls loading/unloading the model is slow. Instead:
- All groups except the last use `keep_alive: -1` (keep model loaded)
- The final group uses `keep_alive: 0` (unload after completing)

This loads the model once, runs all groups, then unloads — matching the original performance design intent.

---

## Implementation

### New file: `scripts/field-groups.js`
Defines the groups per item type:
```js
export const FIELD_GROUPS = {
  weapon:     ["identity", "description", "damage", "properties", "physical"],
  equipment:  ["identity", "description", "defense", "properties", "physical"],
  consumable: ["identity", "description", "damage", "uses", "properties", "physical"],
  tool:       ["identity", "description", "properties", "physical"],
  loot:       ["identity", "description", "properties", "physical"],
};
```

And each group's prompt builder function and Ollama format schema.

### Changes to `ItemGeneratorApp._generate`
1. Look up applicable groups for `this.item.type`
2. Run each group call sequentially, using `keep_alive: -1` for all but the last
3. Merge partial results into a single object as calls complete
4. Update the status indicator per group: "Generating name… Generating damage… Generating description…"
5. After all groups complete, run `_sanitize` + `_validateProperties` on the merged result
6. Show final merged JSON in the chat as before

### Changes to `OllamaService.generate`
Add an optional `keepAlive` parameter (default `0`) passed through to `keep_alive` in the request body.

---

## Verification

1. Create a Weapon item, open Simsala, type "a cursed dagger that deals cold damage"
2. Status cycles through each group: "Generating name… Generating description… Generating damage…"
3. Final JSON has all fields populated including `damage.base.formula`
4. Create a Loot item, type "a mysterious gemstone" — Damage and Defense groups do not run
5. Follow-up "make it legendary" — all groups re-run, rarity updates, description adjusts
6. Apply → item updated in Foundry

---

## Out of Scope

- Per-group retry on failure (treat a failed group as empty, continue)
- Parallel group execution (sequential is simpler and avoids model reload churn)
- Streaming output per group
