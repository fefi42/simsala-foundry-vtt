# Foundry VTT — AI Generator Module
## Technical Design Document

---

## 1. Overview

A Foundry VTT v13 module that enables GMs to generate items and NPCs using a locally running LLM via an iterative chat interface. The GM describes what they want in natural language and refines it over multiple turns. The module is designed to have zero performance impact during play — the LLM is only active during active generation.

The module is open source, and community contribution of additional data source support is a first-class design goal.

---

## 2. Architecture

### 2.1 Tech Stack

- **Foundry VTT v13** — module target, uses ApplicationV2
- **Ollama** — local LLM runtime at `localhost:11434`
- **Model** — user-configurable, recommended default: `llama3.2`
- **Language** — JavaScript, no build step

### 2.2 Components

**Module Shell**
Registers context menu hooks on item and actor sheets. Adds a "Generate with AI" entry to the three-dot menu on both entity types. No modifications to sheet layouts or tabs.

**Chat Window (`GeneratorApp`)**
A floating `ApplicationV2` window opened from the context menu. Stays open independently of the entity sheet. Title reflects the attached entity (e.g. "Generate: Cloak of Shadows"). Contains conversation history, text input, send button, apply button, and generation status indicator. Technically supports multiple windows simultaneously but this is not a primary use case.

**Ollama Service (`OllamaService`)**
Stateless service class handling all Ollama API communication. Accepts a message history array and field target, returns a parsed result. Always sends `keep_alive: 0` to unload the model immediately after generation. Uses Ollama's `format` parameter with a JSON schema to constrain output.

**Data Source Manager (`DataSourceManager`)**
Responsible for building reference pools (spells, monster abilities) from available compendium packs based on active user configuration. Runs once when the generation window opens. See section 5 for full design.

**CR Calculator (`CRCalculator`)**
A self-contained implementation of the DMG CR formula. Deterministic, no LLM involvement. Takes a stat block and returns a calculated CR with a breakdown. Used as a validation and feedback tool during NPC generation.

**Prompt Templates**
Separate system prompts for items and NPCs. Static strings assembled once per session. Each wave in the generation pipeline has its own prompt template that receives the appropriate context from previous waves.

**Validation Layer**
Runs after every LLM response. Checks JSON parseability, validates field names against the Foundry schema, and on failure feeds structured error messages back to the model for one retry. On second failure surfaces the raw output to the GM with a warning.

---

## 3. UI Design

### 3.1 Entry Point
"Generate with AI" added to the three-dot context menu of item and actor sheets. Follows Foundry v13 UI conventions so users have zero learning curve.

### 3.2 Chat Window
- Floating window, stays open while GM navigates elsewhere
- Title shows entity name for clear context
- Scrollable conversation history
- Text input and send button
- Status indicator: idle / loading / generating — always visible so GM knows when the model is consuming resources
- Apply button — disabled until at least one generation has completed
- Apply is destructive in the current version — overwrites entity fields without diff or confirmation beyond pressing the button

### 3.3 Approval Flow
Generated result is previewed in the chat window before the GM applies it. The GM iterates via conversation until satisfied, then clicks Apply.

---

## 4. Performance Design

The core constraint is zero impact during play sessions.

- **`keep_alive: 0`** on every Ollama request — model unloads from memory immediately after generation completes
- **Async API calls** — all Ollama requests are non-blocking, Foundry's main thread is never affected
- **No background processes** — the module is fully inert when the chat window is not actively generating
- **Status indicator** — GM always knows when resources are being consumed
- **On-demand only** — model loads on first generation request, unloads immediately after

---

## 5. Data Source System

### 5.1 Design Goals
- SRD content always available as a guaranteed baseline
- Non-SRD content (books purchased by the GM) accessible without requiring manual pre-import
- Community extensible with minimal technical barrier
- Decoupled from any specific third-party module's internals

### 5.2 Configuration
Module settings present a checklist of known data sources. SRD is always-on and greyed out. Additional sources are opt-in. The GM checks what they have access to.

### 5.3 Source Registry (`compendium-sources.json`)
A JSON config file at a predictable path in the module. This is the contribution point for community additions — no JavaScript knowledge required to add a new source.

```json
[
  {
    "id": "srd",
    "label": "D&D 5e SRD",
    "default": true,
    "locked": true,
    "packs": {
      "spells": ["dnd5e.spells"],
      "monsterAbilities": []
    }
  },
  {
    "id": "plutonium",
    "label": "Plutonium (5etools)",
    "packs": {
      "spells": ["plutonium.spells-phb", "plutonium.spells-xge", "plutonium.spells-tce"],
      "monsterAbilities": ["plutonium.bestiary-phb"]
    }
  },
  {
    "id": "kobold-press-tob",
    "label": "Tome of Beasts (Kobold Press)",
    "packs": {
      "spells": ["koboldpress-5e-monster-core.spells"],
      "monsterAbilities": ["koboldpress-5e-monster-core.monsters"]
    }
  }
]
```

### 5.4 Runtime Behavior
At window open, `DataSourceManager` queries `game.packs` for all packs listed under active sources, builds a lightweight index (name, level, school, damage type for spells; name, tags, CR range for monster abilities), and passes a filtered subset of this index into each relevant generation prompt. Pack IDs not present in the world are silently skipped.

### 5.5 Community Contribution Process
1. Open `compendium-sources.json`
2. Find the pack IDs of your compendium module (visible in Foundry's compendium sidebar or the module's `module.json`)
3. Add an entry following the existing structure
4. Open a pull request

This is documented prominently in the README as the primary contribution pathway.

---

## 6. Item Generation Pipeline

The current production approach, retained as-is given its proven success.

### 6.1 Principles
- Pre-selected set of fields relevant to Foundry's item data model
- Fields generated in dependency order — fields that other fields depend on are generated first
- Queries run in parallel within each wave
- LLM handles one wave at a time to stay within reliable output size
- Static calculations run after LLM generation for deterministic values

### 6.2 Waves

**Wave 1 — Identity**
Name, item type, rarity. Everything else depends on these.

**Wave 2 — Mechanics**
Damage, range, properties, attunement requirement, charges. Receives wave 1 output as context.

**Wave 3 — Description**
Flavor text, lore, appearance. Receives waves 1 and 2 as context so description is coherent with the mechanics and name.

**Wave 4 — Static Calculations**
Price (based on rarity table), weight, any other deterministically derivable values. No LLM involved.

**Wave 5 — Validation & Approval**
JSON validated against Foundry item schema. Errors fed back to LLM for one retry. Result previewed in chat for GM approval before apply.

---

## 7. NPC Generation Pipeline

### 7.1 Principles
Same wave-based dependency approach as items. Flavor is generated first and acts as a creative brief that all subsequent waves reference. Mechanics serve the fantasy, not the reverse. CR is a target that is validated against the DMG formula after mechanical generation, not an input that mechanically constrains early waves.

### 7.2 Reference Pools
Before generation begins, `DataSourceManager` builds two pools from active sources:
- **Spell pool** — indexed by name, level, school, damage type, save type
- **Monster ability pool** — indexed by name, type (trait/action/reaction/legendary), relevant tags (e.g. "breath weapon", "aura", "regeneration")

These pools are passed as context in wave 4.

### 7.3 Reflavoring as a First-Class Concept
Both spells and monster abilities are reflavored to fit the creature. The data model maintains two distinct representations:

- **Mechanical template** — the original unmodified stat block entry, used for CR calculation and validation
- **Flavored presentation** — reflavored name and description generated by the LLM, used on the sheet and at the table

Reflavoring never alters mechanics. A "Fireball" reflavored as "Void Eruption" with necrotic damage is a separate mechanical consideration (damage type change) that must be explicitly requested and validated, not an implicit consequence of renaming.

### 7.4 Waves

**Wave 1 — Concept & Flavor**
Name, creature type, role (bruiser, controller, skirmisher, support, etc.), CR target, personality traits, lore, thematic keywords (e.g. "shadow", "fire", "undead corruption"). This is almost entirely creative and forms the brief for all subsequent waves.

**Wave 2 — Mechanical Identity**
Size, alignment, damage types, damage immunities/resistances/vulnerabilities, condition immunities, movement types. Translates flavor into mechanical identity without touching numbers. Informed directly by wave 1 thematic keywords.

**Wave 3 — Core Stats**
Ability scores, AC, HP, speed. Constrained by CR target and mechanical identity from waves 1 and 2. First CR sanity check runs here — calculated CR is surfaced to GM as informational.

**Wave 4 — Actions & Abilities**
Multiattack, attacks, special abilities selected from monster ability pool, spell list selected from spell pool. LLM receives both pools filtered by wave 1 thematic keywords and wave 2 mechanical identity. For each selection the LLM produces a reflavored name and description. Original mechanical template is preserved separately.

**Wave 5 — Derived Stats**
Saving throw proficiencies, skill proficiencies, passive perception, languages, challenge rating. Full DMG CR formula runs here against the complete stat block.

**Wave 6 — CR Validation & Correction**
Calculated CR compared against wave 1 target. If discrepancy exceeds 1 CR tier, the delta is fed back to the LLM as a correction prompt targeting the most impactful adjustments (HP, AC, DPR). GM is shown both target and calculated CR throughout so they can make informed decisions during iteration.

**Wave 7 — Approval**
Full stat block previewed in chat. GM iterates via conversation if needed. Apply populates the actor sheet destructively.

---

## 8. CR Calculation

Self-contained implementation of the DMG CR formula. No external dependencies, no LLM involvement. Runs client-side in JavaScript.

**Inputs:** HP, AC, resistances/immunities (applied as HP multiplier), damage per round, attack bonus or spell save DC

**Process:**
1. Calculate effective HP (raw HP adjusted for resistances/immunities)
2. Look up defensive CR from HP table, adjust for AC deviation from expected
3. Calculate offensive CR from DPR table, adjust for attack bonus/save DC deviation
4. Average defensive and offensive CR
5. Return calculated CR and per-component breakdown for transparency

The breakdown is shown to the GM in the chat window so they understand what's driving the CR and can make targeted adjustments through conversation.

---

## 9. Error Handling

| Scenario | Behavior |
|---|---|
| Ollama not running | Clear error in chat: "Could not connect to Ollama at localhost:11434" |
| Model not found | Error with hint to run `ollama pull <model>` |
| Invalid JSON returned | Structured error fed back to model, one retry |
| Second consecutive failure | Raw output shown in chat with warning, GM can proceed manually |
| Missing fields | Valid fields accepted, missing fields left as Foundry defaults, noted in chat |
| CR discrepancy > 1 tier | Delta fed back to LLM as targeted correction prompt |
| Compendium pack not found | Silently skipped, generation proceeds with available sources |
| Network timeout | Error in chat, generation state reset to idle |

---

## 10. Module Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| Ollama base URL | String | `http://localhost:11434` | Allows pointing to remote Ollama instance |
| Model name | String | `llama3.2` | Free text, any installed Ollama model |
| Active data sources | Checklist | SRD only | Drives compendium pool construction |
| System prompt override | Textarea | — | Optional, replaces default prompt for power users |

---

## 11. Out of Scope (Current Version)

- Non-destructive apply / field diff view
- Actor/NPC support beyond this design document (implementation is next phase)
- Compendium integration or saving generated entities to compendiums
- RAG / world-aware context
- Conversation history persistence on entity
- Field locking during iteration
- Image generation
- Player-facing features — GM only

---

## 12. Pre-Implementation Tasks (NPC Phase)

1. Extract and document the full Foundry v13 dnd5e actor data schema for NPCs
2. Identify and document pack IDs for the most common compendium sources (SRD, Plutonium, common Kobold Press modules)
3. Prototype wave prompts manually in Ollama before wiring into the module
4. Implement and unit test the DMG CR formula with known monster stat blocks as ground truth
5. Define the monster ability index schema — what fields need to be indexed from bestiary compendiums to support the wave 4 prompt
