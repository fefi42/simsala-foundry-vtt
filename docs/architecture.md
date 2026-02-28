# Architecture Overview

Simsala is a Foundry VTT v13 module that generates D&D 5e content (items and NPCs) through a local LLM (Ollama). The GM describes what they want in a chat window, the module breaks generation into focused steps, and the results are applied to the Foundry document.

## System Diagram

```
┌─────────────────────────────────────────────────────┐
│  Foundry VTT (browser)                              │
│                                                     │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │  Item Sheet  │────▶│  ItemGeneratorApp        │  │
│  │  NPC Sheet   │     │  (ApplicationV2 window)  │  │
│  └──────────────┘     │                          │  │
│   Hook injects        │  ┌────────────────────┐  │  │
│   button into         │  │  Wave Pipeline      │  │  │
│   sheet header        │  │  (sequential waves, │  │  │
│                       │  │   parallel groups)  │  │  │
│                       │  └────────┬───────────┘  │  │
│                       └───────────┼──────────────┘  │
│                                   │                 │
│  ┌────────────────┐     ┌─────────▼──────────┐      │
│  │  field-groups  │     │  OllamaService     │      │
│  │  npc-groups    │     │  (stateless HTTP)   │      │
│  │                │     └─────────┬──────────┘      │
│  │  schema()      │              │                  │
│  │  buildPrompt() │              │                  │
│  │  mapResult()   │              │                  │
│  └────────────────┘              │                  │
└──────────────────────────────────┼──────────────────┘
                                   │
                          ┌────────▼────────┐
                          │  Ollama (local)  │
                          │  localhost:11434 │
                          └─────────────────┘
```

## Core Components

### Entry Point (`main.js`)

Registers settings on `init` and uses render hooks (`renderItemSheet5e`, `renderNPCActorSheet`) to inject a button into sheet headers via DOM manipulation. The button opens `ItemGeneratorApp` for the sheet's document.

### Generator Window (`ItemGeneratorApp.js`)

A single `ApplicationV2` class that handles both items and NPCs. It routes to the correct pipeline based on `document.type` (`"npc"` vs item types like `"weapon"`, `"equipment"`, etc.).

Responsibilities:
- Owns the chat UI (message history, input, status indicator)
- Orchestrates the wave pipeline (sequential waves, parallel groups within a wave)
- Accumulates results via deep merge across waves
- Applies final result to the Foundry document

### Wave Pipeline

Generation is split into **waves** — sequential steps where each wave depends on prior results. Within a wave, multiple **groups** can run in parallel when independent.

Each group defines three methods:
- `schema()` — JSON Schema sent to Ollama to constrain output
- `buildPrompt(context, docType, prior)` — constructs the LLM prompt using GM input and prior wave results
- `mapResult(result, docType, prior)` — transforms LLM JSON into a Foundry update object

See [wave-pipeline.md](wave-pipeline.md) for details.

### OllamaService (`OllamaService.js`)

Stateless HTTP wrapper around `POST /api/chat`. Accepts messages, a JSON schema for constrained output, and a `keepAlive` parameter. Returns `{ parsed, raw }` — the parsed JSON and the raw response text.

### Group Registries

- `field-groups.js` — item generation groups (identity, description, damage, properties, defense, uses, physical)
- `npc-groups.js` — NPC generation groups (concept, mechanical, coreStats, savesSkills, sensesLanguages, description)

### Data Reference (`data/dnd5e-item-schema.js`)

Static enum values (rarity, attunement, damage types, weapon properties, etc.) sourced from the dnd5e system's `config.mjs`. Used in prompts and validation. Must be updated manually when the dnd5e system updates.

## Data Flow

1. GM types a description in the chat window
2. `_onSend()` captures input, calls `_generate(context)`
3. `_generate()` resolves the pipeline and iterates waves
4. Each group builds a focused prompt, sends it to Ollama, and maps the response
5. Results are deep-merged across waves into a single update object
6. The merged result is displayed as JSON in the chat
7. GM clicks Apply → `document.update(result)` writes to the Foundry document
8. Follow-up messages include the previous result as context for refinement
