# Architecture Overview

Simsala is a Foundry VTT v13 module that generates D&D 5e content (items and NPCs) through a local LLM (Ollama). The GM describes what they want in a chat window, the module breaks generation into focused steps, and the results are applied to the Foundry document.

## System Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  Foundry VTT (browser)                                       │
│                                                              │
│  ┌──────────────┐     ┌───────────────────────────────────┐  │
│  │  Item Sheet  │────▶│  ItemGeneratorApp                 │  │
│  │  NPC Sheet   │     │  (ApplicationV2 window)           │  │
│  └──────────────┘     │                                   │  │
│   Hook injects        │  ┌─────────────────────────────┐  │  │
│   button into         │  │  Wave Pipeline               │  │  │
│   sheet header        │  │  (sequential waves,          │  │  │
│                       │  │   parallel groups)           │  │  │
│                       │  │                              │  │  │
│                       │  │  Waves 1–6: standard groups  │  │  │
│                       │  │  Wave 7: catalog selection   │  │  │
│                       │  │          (map-reduce)        │  │  │
│                       │  └──────┬────────────┬─────────┘  │  │
│                       └─────────┼────────────┼────────────┘  │
│                                 │            │               │
│  ┌────────────────┐   ┌────────▼─────┐  ┌───▼────────────┐  │
│  │  field-groups  │   │ OllamaService│  │ CatalogRegistry │  │
│  │  npc-groups    │   │ (stateless)  │  │ (config-driven) │  │
│  └────────────────┘   └────────┬─────┘  └───┬────────────┘  │
│                                │            │               │
│  ┌──────────────────┐          │    ┌───────▼────────────┐  │
│  │ data/catalogs/   │──────────┼───▶│ Foundry Compendium │  │
│  │ (JSON configs)   │          │    │ (dnd5e.spells etc.) │  │
│  └──────────────────┘          │    └────────────────────┘  │
└────────────────────────────────┼─────────────────────────────┘
                                 │
                        ┌────────▼────────┐
                        │  Ollama (local)  │
                        │  localhost:11434 │
                        └─────────────────┘
```

## Core Components

### Entry Point (`main.js`)

Registers settings on `init`, loads ability catalogs on `ready`, and uses render hooks (`renderItemSheet5e`, `renderNPCActorSheet`) to inject a button into sheet headers via DOM manipulation. The button opens `ItemGeneratorApp` for the sheet's document.

### Generator Window (`ItemGeneratorApp.js`)

A single `ApplicationV2` class that handles both items and NPCs. It routes to the correct pipeline based on `document.type` (`"npc"` vs item types like `"weapon"`, `"equipment"`, etc.).

Responsibilities:
- Owns the chat UI (message history, input, status indicator)
- Orchestrates the wave pipeline (sequential waves, parallel groups within a wave)
- Accumulates two types of results: **actor updates** (merged via `mergeDeep`) and **embedded items** (accumulated as a list)
- Applies actor updates via `document.update()` and embedded items via `createEmbeddedDocuments()`
- Tracks generated items with `flags.simsala.generated = true` so re-apply can replace them

### Wave Pipeline

Generation is split into **waves** — sequential steps where each wave depends on prior results. Within a wave, multiple **groups** can run in parallel when independent.

Each standard group defines three methods:
- `schema()` — JSON Schema sent to Ollama to constrain output
- `buildPrompt(context, docType, prior)` — constructs the LLM prompt using GM input and prior wave results
- `mapResult(result, docType, prior)` — transforms LLM JSON into a Foundry update object (can include `_embedded` key for embedded items)

The `catalogSelection` group is special — it bypasses the normal schema/prompt/mapResult flow and runs its own multi-step LLM pipeline internally.

See [wave-pipeline.md](wave-pipeline.md) for details.

### OllamaService (`OllamaService.js`)

Stateless HTTP wrapper around `POST /api/chat`. Accepts messages, a JSON schema for constrained output, and a `keepAlive` parameter. Returns `{ parsed, raw }` — the parsed JSON and the raw response text.

### Group Registries

- `field-groups.js` — item generation groups (identity, description, damage, properties, defense, uses, physical)
- `npc-groups.js` — NPC generation groups (concept, mechanical, coreStats, savesSkills, sensesLanguages, description, attacks, catalogSelection)

### Ability Catalog System

- `data/catalogs/*.json` — config files that organize compendium items into thematic groups. Each file references a Foundry compendium pack and contains only item names and brief summaries (no item data — loaded from compendium at runtime for legal reasons).
- `scripts/catalog.js` — `CatalogRegistry` class that loads configs and resolves item names to full Foundry documents from compendium packs.
- `scripts/catalog-selection.js` — LLM-driven map-reduce pipeline for selecting abilities from the catalog (see [catalog-system.md](catalog-system.md)).

### Data Reference (`data/dnd5e-item-schema.js`)

Static enum values (rarity, attunement, damage types, weapon properties, etc.) sourced from the dnd5e system's `config.mjs`. Used in prompts and validation. Must be updated manually when the dnd5e system updates.

## Data Flow

### Items
1. GM types a description → `_generate()` runs 2-wave item pipeline
2. Wave 1: identity (name, rarity, type). Wave 2: parallel (description, damage, properties, etc.)
3. Results deep-merged → displayed in chat → GM clicks Apply → `document.update()`

### NPCs
1. GM types a description → `_generate()` runs 7-wave NPC pipeline
2. Waves 1–5: stat block (concept → mechanical → stats → saves/senses → description)
3. Wave 6: attack generation (natural weapons, multiattack) → embedded weapon items
4. Wave 7: catalog selection (map-reduce) → embedded ability/spell items from compendium
5. Actor update applied via `document.update()`, embedded items via `createEmbeddedDocuments()`
6. Follow-up messages include both actor data and ability names for refinement
