# Simsala — Foundry VTT AI Item Generator

A Foundry VTT v13 module for generating D&D 5e item data via a local LLM (Ollama).

See [plan/foundry-ai-item-generator.md](plan/foundry-ai-item-generator.md) for the full spec.

---

## Workflow

- Bigger implementation steps are planned first as a markdown document under `plan/` before any code is written.
- Once a plan is reviewed and approved, it is implemented.
- Take small, verifiable steps.

## Tech Stack

- Foundry VTT v13, ApplicationV2
- Ollama on `localhost:11434`
- Plain JavaScript (no build step)
- D&D 5e system
