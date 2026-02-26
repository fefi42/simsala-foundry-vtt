import { buildSystemPrompt } from "./prompt-template.js";
import { getSettings } from "./settings.js";
import { OllamaService } from "./OllamaService.js";
import { DND5E_ITEM_SCHEMA } from "../data/dnd5e-item-schema.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(item, options = {}) {
    super(options);
    this.item = item;
    this.messages = [];   // full conversation history sent to Ollama
    this.chatLog = [];    // display entries for re-render recovery
    this.lastResult = null;
    this.isGenerating = false;
  }

  static DEFAULT_OPTIONS = {
    id: "simsala-item-generator",
    window: {
      resizable: true,
    },
    position: {
      width: 500,
      height: 600,
    },
  };

  static PARTS = {
    main: {
      template: "modules/simsala/templates/item-generator.hbs",
    },
  };

  get title() {
    return `Simsala — ${this.item.name}`;
  }

  async _prepareContext() {
    return {};
  }

  _onRender() {
    const el = this.element;

    // Restore chat history after re-render
    const history = el.querySelector(".simsala-history");
    for (const entry of this.chatLog) {
      this._appendToHistory(history, entry.role, entry.content, entry.note);
    }
    history.scrollTop = history.scrollHeight;

    // Restore button states
    if (this.lastResult) el.querySelector(".simsala-apply").disabled = false;
    if (this.isGenerating) this._setStatus("generating");

    // Build system prompt on first open
    if (this.messages.length === 0) this._initSystemPrompt();

    // Event listeners
    el.querySelector(".simsala-send").addEventListener("click", () => this._onSend());
    el.querySelector(".simsala-apply").addEventListener("click", () => this._onApply());
    el.querySelector(".simsala-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._onSend();
      }
    });
  }

  _initSystemPrompt() {
    const { systemPromptOverride } = getSettings();
    const prompt = systemPromptOverride || buildSystemPrompt(this.item);
    this.messages.push({ role: "system", content: prompt });
  }

  async _onSend() {
    if (this.isGenerating) return;

    const input = this.element.querySelector(".simsala-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    this.isGenerating = true;
    this._setStatus("generating");
    this._setSendDisabled(true);

    this.messages.push({ role: "user", content: text });
    this._appendMessage("user", text);

    try {
      await this._generate();
    } catch (err) {
      this._appendMessage("error", err.message);
    }

    this.isGenerating = false;
    this._setStatus("idle");
    this._setSendDisabled(false);
  }

  async _generate(isRetry = false) {
    const { parsed, raw } = await OllamaService.generate(this.messages, { type: "object" });

    if (parsed) {
      const sanitized = this._sanitize(parsed, this.item.toObject());
      const { validated, removed } = this._validateProperties(sanitized);
      this.lastResult = validated;
      this.messages.push({ role: "assistant", content: raw });

      const note = removed.length
        ? `⚠ Removed properties not valid for ${this.item.type}: ${removed.join(", ")}`
        : "";
      this._appendMessage("assistant", JSON.stringify(validated, null, 2), note);
      this.element.querySelector(".simsala-apply").disabled = false;

    } else if (!isRetry) {
      this.messages.push({ role: "assistant", content: raw });
      this.messages.push({
        role: "user",
        content: "Your response was not valid JSON. Please respond with only a valid JSON object and nothing else.",
      });
      await this._generate(true);

    } else {
      this._appendMessage("error", `Could not parse response after retry. Raw output:\n\n${raw}`);
    }
  }

  /**
   * Recursively remove keys that don't exist in the reference (item.toObject()),
   * and strip any dot-notation keys the model may have produced.
   */
  _sanitize(obj, reference) {
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return obj;
    const result = {};
    for (const key of Object.keys(obj)) {
      if (key.includes(".")) continue;           // drop dot-notation keys
      if (!(key in reference)) continue;         // drop unknown keys
      const val = obj[key];
      if (typeof val === "object" && val !== null && !Array.isArray(val)
          && typeof reference[key] === "object" && reference[key] !== null) {
        result[key] = this._sanitize(val, reference[key]);
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  _validateProperties(parsed) {
    if (!parsed.system?.properties) return { validated: parsed, removed: [] };

    const itemType = this.item.type;
    const removed = [];

    // Normalize — model may return an object/Set instead of an array
    const propsRaw = parsed.system.properties;
    const propsArray = Array.isArray(propsRaw) ? propsRaw : Object.keys(propsRaw);

    const validProps = propsArray.filter(key => {
      const def = DND5E_ITEM_SCHEMA.properties[key];
      if (!def || !def.validFor.includes(itemType)) {
        removed.push(key);
        return false;
      }
      return true;
    });

    const validated = foundry.utils.deepClone(parsed);
    validated.system.properties = validProps;
    return { validated, removed };
  }

  _onApply() {
    if (!this.lastResult) return;
    this.item.update(this.lastResult);
    this._appendMessage("note", "✓ Applied to item.");
  }

  _setStatus(status) {
    const el = this.element?.querySelector(".simsala-status");
    if (!el) return;
    const labels = { idle: "Idle", generating: "Generating…", error: "Error" };
    el.textContent = labels[status] ?? status;
    el.dataset.status = status;
  }

  _setSendDisabled(disabled) {
    const btn = this.element?.querySelector(".simsala-send");
    if (btn) btn.disabled = disabled;
  }

  _appendMessage(role, content, note = "") {
    this.chatLog.push({ role, content, note });
    const history = this.element?.querySelector(".simsala-history");
    if (!history) return;
    this._appendToHistory(history, role, content, note);
    history.scrollTop = history.scrollHeight;
  }

  _appendToHistory(history, role, content, note = "") {
    const msg = document.createElement("div");
    msg.className = `simsala-message simsala-message--${role}`;

    if (role === "assistant") {
      const pre = document.createElement("pre");
      pre.textContent = content;
      msg.appendChild(pre);

      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "simsala-copy";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => {
        navigator.clipboard.writeText(content).then(() => {
          copy.textContent = "Copied!";
          setTimeout(() => { copy.textContent = "Copy"; }, 1500);
        });
      });
      msg.appendChild(copy);
    } else {
      const p = document.createElement("p");
      p.textContent = content;
      msg.appendChild(p);
    }

    if (note) {
      const noteEl = document.createElement("p");
      noteEl.className = "simsala-note";
      noteEl.textContent = note;
      msg.appendChild(noteEl);
    }

    history.appendChild(msg);
  }
}
