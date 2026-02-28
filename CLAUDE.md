# Simsala — Foundry VTT AI Item Generator

A Foundry VTT v13 module for generating D&D 5e item data via a local LLM (Ollama).

See [plan/foundry-ai-item-generator.md](plan/foundry-ai-item-generator.md) for the full spec.

---

## Workflow

- Bigger implementation steps are planned first as a markdown document under `plan/` before any code is written.
- Once a plan is reviewed and approved, it is implemented.
- Take small, verifiable steps.

## Docs Index

- [docs/architecture.md](docs/architecture.md) — High-level system overview, component diagram, data flow
- [docs/wave-pipeline.md](docs/wave-pipeline.md) — How generation is split into sequential waves of focused LLM calls
- [docs/llm-strategy.md](docs/llm-strategy.md) — Why prompts are designed the way they are, model memory management
- [docs/foundry-integration.md](docs/foundry-integration.md) — Foundry v13 / dnd5e patterns, gotchas, and debugging tips

## Tech Stack

- Foundry VTT v13, ApplicationV2
- Ollama on `localhost:11434`
- Plain JavaScript (no build step)
- D&D 5e system
