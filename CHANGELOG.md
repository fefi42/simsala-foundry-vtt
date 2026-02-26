# Changelog

## 0.1.0 — MVP

Initial release.

### Features

- **AI item generation** — type a description, get a fully populated D&D 5e item
- **Multi-prompt architecture** — one focused LLM call per field group for reliable output from small models (3B–8B)
- **Supported item types** — weapon, equipment, consumable, tool, loot
- **Generated fields per type:**
  - All types: name, rarity, type, description, properties, price, weight
  - Weapon: damage formula + types, versatile damage, mastery
  - Equipment: AC value, minimum strength requirement
  - Consumable: damage (if applicable), uses/charges
- **Multi-turn refinement** — follow-up messages refine the previous result
- **Apply button** — writes generated data directly to the Foundry item document
- **Fully local** — no internet connection or subscription required; runs via Ollama
- **Zero play impact** — Ollama only uses resources during active generation
