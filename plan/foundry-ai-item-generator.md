# Foundry VTT – AI Item Generator Module
## Technical & Functional Specification (POC)

---

## Overview

A Foundry VTT v13 module that allows a GM to generate item data using a locally running LLM via an iterative chat interface. The GM describes a magic item in natural language and refines it over multiple turns. When satisfied, they apply the result directly to the item sheet.

The module is designed to have zero performance impact during play. The LLM is only loaded into memory during active generation and unloaded immediately after.

The module is designed for DnD 5e specifically.
---

## Scope (POC)

- **In scope:** Items only (weapons, armor, equipment, consumables, loot)
- **Out of scope:** Actors/NPCs, spell generation, compendium integration, diff/merge on apply. Actors NPCs is a future iteration concern.
- **Apply behavior:** Destructive. Generated data overwrites existing item fields without confirmation beyond the user pressing the Apply button. Non-destructive apply is a future iteration concern.

---

## Tech Stack

- **Foundry VTT v13** — module target, uses ApplicationV2 for the chat window
- **Ollama** — local LLM runtime, expected to be running on `localhost:11434`
- **LLM model** — user-configurable in module settings, recommended default: `llama3.2` or `deepseek-r1`
- **Language:** JavaScript (standard Foundry module, no build step preferred for POC simplicity)

---

## Architecture

### Components

**1. Module Shell**
Standard Foundry module (`module.json`). Registers hooks to inject a "Generate Item" entry into the context menu (three-dot menu) of item sheets. No modifications to item sheet tabs or layouts.

**2. Chat Window (`ItemGeneratorApp`)**
A floating `ApplicationV2` window. Opened from the context menu, it stays open independently of the item sheet — the GM can navigate away and the window remains. The window title displays the name of the attached item (e.g. *"Generate: Cloak of Shadows"*) so context is always clear.

Contains:
- Scrollable conversation history
- Text input field
- Send button
- Apply button (disabled until at least one generation has completed)
- A status indicator showing whether Ollama is currently active/loading/idle

One window per item. Multiple windows can technically be open but this is not a primary use case.

**3. Ollama Service (`OllamaService`)**
A stateless service class responsible for all communication with the Ollama API. Accepts a message history array and returns a parsed result. Not responsible for storing conversation state — that lives in the window.

Key behaviors:
- Sends requests to `http://localhost:11434/api/chat`
- Always includes `keep_alive: 0` to unload the model from memory immediately after generation completes
- Uses Ollama's `format` parameter with a JSON schema to constrain output structure
- Passes the full conversation history on every request so the model retains context across turns

**4. Prompt Template**
A static system prompt, assembled once when the chat window opens. Contains:
- Role framing (5e GM assistant)
- The full Foundry v13 item data schema as a reference
- Instructions to only fill fields relevant to the item type described
- Instructions to return valid JSON matching the schema
- Guidance on 5e conventions (rarity tiers, attunement, common property patterns)

The system prompt is the primary mechanism for grounding the model in Foundry's data structure and D&D 5e rules.

**5. Validation & Feedback Layer**
Runs after every generation response. Responsible for:
- Checking that returned JSON is parseable
- Checking that field names exist in Foundry's item schema (no invented fields)
- On failure: feeding the error message back to the model as a follow-up message and retrying once
- On second failure: surfacing the raw response text in the chat window with a warning, so the GM can see what was generated and manually decide how to proceed
- On partial success: using the valid fields and ignoring invalid ones, noting the issue in the chat

The validation loop is intentionally simple for the POC. The model is expected to handle most cases correctly given schema-constrained output. The feedback loop exists as a safety net, not a primary flow.

---

## User Flow

1. GM creates or opens an existing item
2. GM clicks the three-dot context menu on the item sheet header
3. Clicks **"Generate with AI"**
4. A floating chat window opens titled with the item name
5. GM types a description: *"a shortsword that lets the wielder see in complete darkness, but causes vivid nightmares on a long rest"*
6. The module sends the message to Ollama with the system prompt and returns the generated item fields into the chat as a readable preview
7. GM iterates: *"make it require attunement, and add a minor curse mechanic"*
8. Model updates the result using full conversation context
9. When satisfied, GM clicks **Apply**
10. Item fields are overwritten with the generated data
11. Window remains open for further iteration if desired

---

## Performance Design

The core constraint is that Foundry must be unaffected during play. This is achieved through:

- **`keep_alive: 0`** on every Ollama request — model is loaded only during generation and unloaded immediately after. No residual memory usage.
- **Async/non-blocking API calls** — the Ollama request runs asynchronously and never blocks Foundry's main thread or UI
- **On-demand only** — the module has no background processes, no polling, no persistent connections. It is fully inert when the chat window is not actively generating.
- **Status indicator** — the chat window shows a clear visual state (idle / loading / generating) so the GM knows exactly when the model is consuming resources

---

## Configuration

Module settings (accessible via Foundry's module settings panel):
- **Ollama base URL** — default `http://localhost:11434` (allows pointing to a remote Ollama instance)
- **Model name** — default `llama3.2`, free text field
- **System prompt override** — optional, allows power users to replace the default prompt

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Ollama not running | Clear error message in chat window: "Could not connect to Ollama at localhost:11434" |
| Model not found | Error surfaced in chat with the model name and a hint to run `ollama pull <model>` |
| Invalid JSON returned | Automatic retry with error fed back to model. On second failure, raw output shown with warning |
| Partial JSON (missing fields) | Valid fields accepted, missing fields left at Foundry defaults, issue noted in chat |
| Network timeout | Error message in chat, generation state reset to idle |

---

## Open Questions / Future Iterations

- **Non-destructive apply** — diff view showing what will change before committing
- **NPC/Actor support** — more complex schema, likely staged generation (stat block → abilities → flavor)
- **RAG / SRD grounding** — embedding SRD content for more rules-accurate output
- **Conversation persistence** — saving chat history as a note on the item for future reference
- **Field locking** — preventing the model from changing fields the GM has marked as final
- **Compendium integration** — pulling existing items as a starting point or style reference

---

## Pre-Implementation Tasks

Before writing module code, the following should be prepared:

1. **Extract the full Foundry v13 item data schema** — needed for the system prompt and validation layer. Pull from Foundry's source or the dnd5e system's item data models.
2. **Validate Ollama JSON schema mode** — test that `format: { type: "object", properties: {...} }` correctly constrains output for the item schema with the chosen model
3. **Prototype the system prompt** — iterate on the prompt manually in an Ollama chat before wiring it into the module, to validate output quality and JSON reliability
