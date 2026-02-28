# Wave Pipeline

The wave pipeline is the core generation strategy. It breaks content generation into small, focused LLM calls instead of asking for everything at once. This is critical because small models (3B parameter) produce much better output when given a single focused task per call.

## Structure

A pipeline is defined by two exports:
- **Waves** — an array of arrays. Each inner array lists group names to run in that wave. Single-element = sequential, multi-element = parallel.
- **Groups** — an object mapping group names to `{ label, schema(), buildPrompt(), mapResult() }`.

## Execution

```
for each wave:
  if single group:
    run sequentially, keep model loaded (keep_alive: -1)
  if multiple groups:
    run all in parallel via Promise.allSettled, keep model loaded
  merge result into accumulator via mergeDeep

after all waves:
  send empty request with keep_alive: 0 to unload model
```

### Why keep_alive works this way

`keep_alive: -1` keeps the model in GPU memory between waves, avoiding the ~5s reload cost per wave. Only the final call uses `keep_alive: 0` to free memory. This is important because Foundry must not be impacted during play — the model should only occupy resources during active generation.

## Item Pipeline

Two waves. Identity first (name, rarity, type), then everything else in parallel (description, damage, properties, etc.). Items are simpler because fields are mostly independent.

```
Wave 1: [identity]           — sequential
Wave 2: [description, damage, properties, defense, uses, physical] — parallel
```

Which groups run depends on item type (e.g. weapons get `damage` but not `defense`; equipment gets `defense` but not `damage`). See `ITEM_TYPE_GROUPS` in `field-groups.js`.

## NPC Pipeline

Seven waves. NPCs have deep dependencies — you can't set HP without knowing size and CON, can't choose skills without knowing ability scores. Waves 6–7 produce embedded items rather than actor update fields.

```
Wave 1: [concept]                        — name, CR, creature type
Wave 2: [mechanical]                     — size, immunities, movement
Wave 3: [coreStats]                      — abilities, AC, HP
Wave 4: [savesSkills, sensesLanguages]   — parallel, both depend on waves 1–3
Wave 5: [description]                    — biography, needs full stat context
Wave 6: [attacks]                        — generated natural weapons (embedded weapon items)
Wave 7: [catalogSelection]              — abilities/spells from compendium (map-reduce pipeline)
```

### Embedded Items vs Actor Updates

Waves 1–5 return actor update objects merged via `mergeDeep()`. Waves 6–7 return `_embedded.Item` arrays — these are accumulated separately and applied via `createEmbeddedDocuments()` on apply. The `_embedded` key is extracted from `mapResult()` output before merging.

### Catalog Selection (Wave 7)

The `catalogSelection` group bypasses the normal schema→prompt→LLM→mapResult flow. Instead it delegates to `runCatalogSelection()` which runs a 3-step LLM pipeline internally (map → explore → reduce). See [catalog-system.md](catalog-system.md) for details.

## Deep Merge Strategy

Results are accumulated via `mergeDeep()`. Arrays are always replaced (not merged by index) because array-merging creates nonsensical results for fields like damage types or language lists. Objects are recursively merged.

## Prior Context

Each group's `buildPrompt()` receives `prior` — the accumulated result from all previous waves. This lets later waves reference earlier decisions (e.g. the description wave knows the creature's name, CR, size, and ability scores).

## Prompt Design

Prompts are kept focused and include:
- The GM's original description
- Prior wave context (creature name, CR, etc.)
- Valid enum values inline (not a schema dump)
- D&D 5e benchmarks for calibration (e.g. CR vs HP/AC tables)
- A concrete JSON example of the expected output

This approach works much better with small models than dumping the full schema and asking for everything at once.

## Adding New Groups

1. Define the group in the appropriate registry (`field-groups.js` or `npc-groups.js`)
2. Add it to the wave array in the correct position (respecting dependencies)
3. Each group must implement `label`, `schema()`, `buildPrompt()`, `mapResult()`
4. `mapResult()` returns a Foundry update object that will be deep-merged
