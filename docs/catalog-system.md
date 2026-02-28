# Ability Catalog System

The catalog system organizes compendium items (spells, monster abilities, etc.) into thematic groups for LLM-driven selection. It's designed to scale to thousands of items without overwhelming the LLM's context window.

## Why Not Generate From Scratch?

Small models (3B parameters) produce unreliable results when asked to invent spell mechanics or monster abilities from scratch. They hallucinate field names, invent non-existent spells, and produce mechanically broken stat blocks.

The catalog approach sidesteps this: the LLM only needs to **choose** from existing items, not create them. The actual item data comes from the Foundry compendium, ensuring mechanical correctness.

Additionally, distributing spell/ability data directly would require SRD licensing compliance. Config files contain only names and brief summaries — the full data is loaded from the user's own compendium at runtime.

## Config File Format

JSON files in `data/catalogs/`, one per content source:

```json
{
  "source": "dnd5e.spells",
  "groups": [
    {
      "id": "evocation-damage",
      "description": "Offensive spells that deal direct elemental or force damage",
      "items": [
        { "name": "Fireball", "summary": "3rd level, 8d6 fire, 20ft sphere, DEX save" }
      ]
    }
  ]
}
```

- `source` — Foundry compendium pack ID (e.g. `dnd5e.spells`, `dnd5e.monsterfeatures`)
- `description` — what the LLM sees in step 1 to decide which groups to explore
- `name` — must match the compendium entry exactly (case-insensitive lookup)
- `summary` — brief mechanical description for the LLM to make informed picks

## Map-Reduce Selection Pipeline

Three LLM steps, each seeing only what it needs:

### Step 1 — Map: Group Selection
- Input: NPC context + list of group descriptions (just IDs and descriptions, no individual items)
- Output: which groups to explore + optional refinement prompts (e.g. "fire-themed")
- Prompt size: bounded by number of groups (~25 groups), not number of items

### Step 2 — Explore: Candidate Selection (Parallel)
- For each selected group, in parallel:
  - Input: NPC context + refinement + group's item names/summaries
  - Output: exactly 3 candidates with reasons
- Prompt size: bounded by group size (typically 5–15 items)

### Step 3 — Reduce: Final Assembly
- Input: NPC context + all candidates with reasons + CR budget
- Output: final selection with spellcasting modes and legendary action/resistance counts
- Prompt size: bounded by 3 candidates × number of selected groups

### After Step 3: Compendium Resolution
Code resolves selected names to full Foundry item documents via `CatalogRegistry.resolveItems()`. Missing items are logged and skipped. Spell items get their preparation mode set (atwill/innate/prepared).

## Adding New Content

To add support for a new compendium (e.g. a 3rd-party spell module):

1. Create a new JSON file in `data/catalogs/`
2. Set `source` to the Foundry compendium pack ID
3. Organize items into thematic groups with clear descriptions
4. Each item needs `name` (exact compendium match) and `summary` (brief mechanical note)
5. Register the filename in `CatalogRegistry.loadAll()` (in `scripts/catalog.js`)

No other code changes required. The map-reduce pipeline automatically picks up new groups.

## Current Catalogs

- `srd-spells.json` — SRD spells organized by damage type, school, and role (14 groups)
- `srd-abilities.json` — standard monster abilities: passive traits, breath weapons, actions, reactions, legendary actions (10 groups)
