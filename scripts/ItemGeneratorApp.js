import { OllamaService } from "./OllamaService.js";
import { DND5E_ITEM_SCHEMA } from "../data/dnd5e-item-schema.js";
import { ITEM_TYPE_GROUPS, GROUPS } from "./field-groups.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Deep merge — arrays are always replaced, not merged by index. */
function mergeDeep(target, source) {
  const result = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (Array.isArray(v)) {
      result[k] = v;
    } else if (v !== null && typeof v === "object" && result[k] !== null && typeof result[k] === "object") {
      result[k] = mergeDeep(result[k] ?? {}, v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export class ItemGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(doc, options = {}) {
    super(options);
    this.document = doc;
    this.chatLog    = [];   // display entries — survives re-renders
    this.lastResult = null;
    this.isGenerating = false;
  }

  static DEFAULT_OPTIONS = {
    id: "simsala-item-generator",
    window: { resizable: true },
    position: { width: 500, height: 600 },
  };

  static PARTS = {
    main: { template: "modules/simsala/templates/item-generator.hbs" },
  };

  get title() {
    return `Simsala — ${this.document.name}`;
  }

  async _prepareContext() { return {}; }

  _onRender() {
    const el = this.element;

    // Restore chat history after re-render
    const history = el.querySelector(".simsala-history");
    for (const entry of this.chatLog) {
      this._appendToHistory(history, entry.role, entry.content, entry.note);
    }
    history.scrollTop = history.scrollHeight;

    // Restore button states
    if (this.lastResult)   el.querySelector(".simsala-apply").disabled = false;
    if (this.isGenerating) this._setStatus("Generating…");

    // Event listeners
    el.querySelector(".simsala-send").addEventListener("click", () => this._onSend());
    el.querySelector(".simsala-apply").addEventListener("click", () => this._onApply());
    el.querySelector(".simsala-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this._onSend(); }
    });
  }

  async _onSend() {
    if (this.isGenerating) return;

    const input = this.element.querySelector(".simsala-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    this.isGenerating = true;
    this._setSendDisabled(true);
    this._appendMessage("user", text);

    // For follow-up turns, include the previous result as context
    const context = this.lastResult
      ? `${text}\n\nRefine the previous result:\n${JSON.stringify(this.lastResult, null, 2)}`
      : text;

    try {
      await this._generate(context);
    } catch (err) {
      this._appendMessage("error", err.message);
    }

    this.isGenerating = false;
    this._setStatus("Idle", "idle");
    this._setSendDisabled(false);
  }

  async _generate(context) {
    const itemType = this.document.type;
    const groupNames = ITEM_TYPE_GROUPS[itemType];

    if (!groupNames) {
      this._appendMessage("error", `Item type "${itemType}" is not supported. Supported types: ${Object.keys(ITEM_TYPE_GROUPS).join(", ")}.`);
      return;
    }

    let merged = {};
    let anySucceeded = false;
    let firstError = null;

    // Wave 1: identity alone — name/rarity feed into later prompts
    if (groupNames.includes("identity")) {
      this._setStatus(GROUPS.identity.label);
      const prompt = GROUPS.identity.buildPrompt(context, itemType, {});
      const schema = GROUPS.identity.schema(itemType);
      try {
        const { parsed } = await OllamaService.generate(
          [{ role: "user", content: prompt }],
          schema,
          -1,
        );
        if (parsed) {
          merged = mergeDeep(merged, GROUPS.identity.mapResult(parsed, itemType));
          anySucceeded = true;
        }
      } catch (err) {
        console.warn(`[simsala] group "identity" failed:`, err.message);
        firstError = err;
      }
    }

    // Wave 2: remaining groups with identity output as prior context
    const remainingNames = groupNames.filter(n => n !== "identity");
    if (remainingNames.length > 0) {
      this._setStatus("Generating details…");
      const prior = merged;

      const outcomes = await Promise.allSettled(
        remainingNames.map(async name => {
          const group = GROUPS[name];
          const prompt = group.buildPrompt(context, itemType, prior);
          const schema = group.schema(itemType);
          const { parsed } = await OllamaService.generate(
            [{ role: "user", content: prompt }],
            schema,
            -1,
          );
          return parsed ? group.mapResult(parsed, itemType, prior) : null;
        })
      );

      for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i];
        if (outcome.status === "fulfilled" && outcome.value) {
          merged = mergeDeep(merged, outcome.value);
          anySucceeded = true;
        } else if (outcome.status === "rejected") {
          console.warn(`[simsala] group "${remainingNames[i]}" failed:`, outcome.reason?.message);
          if (!firstError) firstError = outcome.reason;
        }
      }
    }

    // Unload model after all waves complete
    try { await OllamaService.generate([], {}, 0); } catch { /* ignore */ }

    if (!anySucceeded) {
      throw firstError ?? new Error("All generation groups failed.");
    }

    const { validated, removed } = this._validateProperties(merged);
    this.lastResult = validated;

    const note = removed.length
      ? `⚠ Removed invalid properties for ${itemType}: ${removed.join(", ")}`
      : "";
    this._appendMessage("assistant", JSON.stringify(validated, null, 2), note);
    this.element.querySelector(".simsala-apply").disabled = false;
  }

  _validateProperties(parsed) {
    if (!parsed.system?.properties) return { validated: parsed, removed: [] };

    const itemType = this.document.type;
    const removed  = [];
    const propsRaw = parsed.system.properties;
    const propsArray = Array.isArray(propsRaw) ? propsRaw : Object.keys(propsRaw);

    const validProps = propsArray.filter(key => {
      const def = DND5E_ITEM_SCHEMA.properties[key];
      if (!def || !def.validFor.includes(itemType)) { removed.push(key); return false; }
      return true;
    });

    const validated = foundry.utils.deepClone(parsed);
    validated.system.properties = validProps;
    return { validated, removed };
  }

  _onApply() {
    if (!this.lastResult) return;
    this.document.update(this.lastResult);
    this._appendMessage("note", "✓ Applied to item.");
  }

  _setStatus(label, semanticState = "generating") {
    const el = this.element?.querySelector(".simsala-status");
    if (!el) return;
    el.textContent = label;
    el.dataset.status = semanticState;
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
