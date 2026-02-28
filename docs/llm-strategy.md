# LLM Strategy

Design decisions around how the module interacts with the local LLM.

## Target Model Size

The module is designed for small models (3B–8B parameters, e.g. `llama3.2`). This drives every prompt and schema decision — we cannot rely on the model being smart enough to handle complex multi-field generation in one shot.

## Constrained JSON Output

Ollama's `format` parameter accepts a JSON Schema that constrains the model's output structure. Every group provides a schema via `schema()`. This eliminates most JSON parsing failures and invented field names.

Schemas are kept minimal — only the fields the group needs, with enums for constrained values. No nested schemas deeper than two levels.

## Focused Prompts Over Monolithic

An early prototype used a single monolithic prompt that dumped the entire Foundry item schema and asked the model to fill everything at once. This produced unreliable results with small models — the model would hallucinate field names, mix up enum values, or get confused by the schema's complexity.

The wave pipeline replaced this with focused prompts that each handle one small task. Each prompt includes only the enum values and benchmarks relevant to that task. This dramatically improved output quality.

The original monolithic approach is preserved in `scripts/prompt-template.js` (currently unused) for reference.

## D&D 5e Benchmarks in Prompts

Prompts include concrete D&D 5e reference data (e.g. "dagger 1d4, shortsword 1d6, longsword 1d8") rather than asking the model to recall this from training data. Small models have unreliable recall of specific game mechanics, so inline benchmarks act as grounding.

For NPC generation, CR benchmark tables (CR vs expected HP/AC/damage) are included so the model produces stat blocks that are mechanically appropriate for the target CR.

## Deterministic Calculations

Some values are computed deterministically rather than asking the LLM:
- **Item price** — derived from rarity using the DMG price table with random variation
- **HP max** — computed from the HP formula (e.g. "8d8+16" → 52)

This avoids the model producing internally inconsistent values (e.g. HP formula that doesn't match the stated HP max).

## Model Memory Management

- `keep_alive: -1` during the pipeline keeps the model loaded between waves
- `keep_alive: 0` on the final call unloads the model immediately
- This ensures zero memory impact during play while avoiding reload cost between waves

## Error Handling

- If JSON parsing fails, `parsed` is `null` — the caller handles it
- Per-group failures don't abort the pipeline; only if all groups fail does generation error
- No automatic retry loop — errors are surfaced in the chat for the GM to address conversationally
