# Plan 03 — Ollama Integration & Chat UI

**Goal:** Wire the LLM into the module. The GM can type a description in the chat window, receive generated item fields, iterate over multiple turns, and apply the result to the item. Depends on plan 02 (schema file + prompt template must exist).

---

## Deliverables

- `scripts/settings.js` — registers module settings
- `scripts/OllamaService.js` — stateless service for Ollama API calls
- `scripts/ItemGeneratorApp.js` — updated with full chat UI and generation logic
- `templates/item-generator.hbs` — full chat window template
- `styles/simsala.css` — basic chat window styles

---

## Part 1 — `scripts/settings.js`

Register three module settings via `game.settings.register`:

| Key | Type | Default | Description |
|---|---|---|---|
| `ollamaUrl` | String | `http://localhost:11434` | Ollama base URL |
| `modelName` | String | `llama3.2` | Model to use |
| `systemPromptOverride` | String | `""` | Optional full prompt override |

Export a helper `getSettings()` that returns all three values.

Register settings in a `Hooks.once("init", ...)` call in `main.js`.

---

## Part 2 — `scripts/OllamaService.js`

Stateless class. One public method: `generate(messages, schema)`.

```
OllamaService.generate(messages, jsonSchema) → Promise<{ parsed, raw }>
```

**Request shape** sent to `POST {ollamaUrl}/api/chat`:
```json
{
  "model": "<modelName>",
  "messages": [ ...conversation history ],
  "format": { ...jsonSchema },
  "stream": false,
  "keep_alive": 0
}
```

- `messages` is the full conversation history (system prompt + all turns)
- `format` constrains output to our item JSON schema subset
- `keep_alive: 0` unloads the model immediately after response
- `stream: false` for simplicity in POC

**Returns:**
- `parsed` — `JSON.parse(response.message.content)` on success
- `raw` — the raw string, always included

**Error handling:**
- Network failure → throw with message `"Could not connect to Ollama at {url}"`
- Non-200 response → throw with status + body
- JSON parse failure → return `{ parsed: null, raw }`

---

## Part 3 — Chat Window UI (`ItemGeneratorApp.js` + template)

### Template structure (`item-generator.hbs`)

```
┌─────────────────────────────────────┐
│ [status indicator]                  │
├─────────────────────────────────────┤
│                                     │
│  conversation history (scrollable)  │
│                                     │
├─────────────────────────────────────┤
│ [text input field]        [Send]    │
├─────────────────────────────────────┤
│                          [Apply]    │
└─────────────────────────────────────┘
```

- Status indicator: text label showing `Idle` / `Generating...` / `Error`
- Conversation history: alternating user/assistant message bubbles
  - Assistant messages show the generated fields as formatted JSON preview
- Apply button: disabled until at least one successful generation
- Send button: disabled while generating

### State in `ItemGeneratorApp`

```js
this.messages = [];        // full conversation history including system prompt
this.lastResult = null;    // last parsed JSON from the model
this.isGenerating = false;
```

### Flow on Send

1. Disable send button, set status to `Generating...`
2. Append user message to `this.messages` and render it in the history
3. Call `OllamaService.generate(this.messages, itemJsonSchema)`
4. On success:
   - Append assistant message to `this.messages`
   - If `parsed` is valid: run property validation (see below), store as `this.lastResult`, render formatted preview, enable Apply
   - If `parsed` is null (JSON parse failed): retry once by appending an error correction message and calling generate again
   - If second failure: render raw response with a warning, leave Apply disabled

### Property Validation

Validated in testing: the model correctly follows the JSON structure and uses valid enum values for rarity, attunement, etc. — but it does **not** self-enforce the `validFor` constraints on `system.properties`. For example, when generating a loot item described as a dagger, it returned `["mgc", "fin", "thr", "spc"]` — the last three are weapon-only properties not valid for loot.

After parsing, strip any property values that are not in `DND5E_ITEM_SCHEMA.properties[key].validFor` for the item's type before storing as `lastResult`. Note the removed properties in the chat message so the GM is aware. Do not retry — this is an expected model limitation, not a failure.
5. Re-enable send button, set status to `Idle`
6. On error: display error message in chat, reset to `Idle`

### On Open (first render)

Build the initial system prompt via `buildSystemPrompt(item)` from plan 02 and push it as the first message with role `"system"`.

### Apply button

Calls `item.update(this.lastResult)` — Foundry's standard document update method. Only the fields present in `lastResult` are changed; all other fields keep their current values.

Window remains open after apply for further iteration.

---

## Part 4 — `styles/simsala.css`

Minimal styles to make the chat window usable:
- Message history area: scrollable, flex column
- User messages: right-aligned
- Assistant messages: left-aligned, monospace font for JSON preview
- Status indicator: small text, color-coded (grey/orange/green/red)

---

## Verification

1. Open an item sheet, click Simsala
2. Type `"a shortsword that glows faintly in the dark"` → send
3. Confirm the status cycles through Generating → Idle
4. Confirm a JSON preview appears in the chat
5. Type `"make it require attunement"` → send → confirm the model updates attunement in the result
6. Click Apply → confirm the item document is updated in Foundry
7. Close Ollama and try to send — confirm the error message appears

---

## Out of Scope

- Non-destructive apply / diff view
- Conversation persistence
- Field locking
