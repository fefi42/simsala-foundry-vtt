import { OllamaService } from "./OllamaService.js";
import { DND5E_ITEM_SCHEMA } from "../data/dnd5e-item-schema.js";
import { ITEM_TYPE_GROUPS, GROUPS } from "./field-groups.js";
import { NPC_WAVES, NPC_GROUPS } from "./npc-groups.js";
import { runCatalogSelection } from "./catalog-selection.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Deep merge — arrays are always replaced, not merged by index.
 * Array replacement is intentional: merging by index produces nonsensical
 * results for fields like damage types or language lists where the full
 * array is the intended value, not a partial update.
 */
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

/**
 * Separate embedded item data from actor update data.
 * Groups can return { system: {...}, _embedded: { Item: [...] } } —
 * the _embedded items are accumulated separately and created via
 * createEmbeddedDocuments on apply, not merged into the actor update.
 */
function extractEmbedded(mapped) {
  const embedded = mapped._embedded?.Item ?? [];
  if (!embedded.length) return { actorUpdate: mapped, embedded: [] };
  const actorUpdate = { ...mapped };
  delete actorUpdate._embedded;
  return { actorUpdate, embedded };
}

export class ItemGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(doc, options = {}) {
    super(options);
    this.document = doc;
    this.chatLog    = [];   // display entries — survives re-renders
    this.lastResult = null;
    this.lastEmbeddedItems = [];
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
    if (this.lastResult || this.lastEmbeddedItems.length) {
      el.querySelector(".simsala-apply").disabled = false;
    }
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

    // Follow-up turns include the previous result so the LLM can refine
    // rather than regenerate from scratch. Embedded item names are included
    // so the LLM knows what abilities the NPC already has.
    let context = text;
    if (this.lastResult || this.lastEmbeddedItems.length) {
      const prior = {};
      if (this.lastResult) prior.actorData = this.lastResult;
      if (this.lastEmbeddedItems.length) {
        prior.abilities = this.lastEmbeddedItems.map(i => ({ type: i.type, name: i.name }));
      }
      context = `${text}\n\nRefine the previous result:\n${JSON.stringify(prior, null, 2)}`;
    }

    try {
      await this._generate(context);
    } catch (err) {
      this._appendMessage("error", err.message);
    }

    this.isGenerating = false;
    this._setStatus("Idle", "idle");
    this._setSendDisabled(false);
  }

  /**
   * Route to the correct pipeline by document type.
   * Both items and NPCs use the same generate/merge/apply loop;
   * only the wave definitions and group registries differ.
   */
  _getPipeline() {
    const docType = this.document.type;

    // NPC actor
    if (docType === "npc") {
      return { waves: NPC_WAVES, groups: NPC_GROUPS };
    }

    // Item types
    const groupNames = ITEM_TYPE_GROUPS[docType];
    if (groupNames) {
      return {
        waves: [
          ["identity"],
          groupNames.filter(n => n !== "identity"),
        ],
        groups: GROUPS,
      };
    }

    return null;
  }

  async _generate(context) {
    const docType = this.document.type;
    const pipeline = this._getPipeline();

    if (!pipeline) {
      this._appendMessage("error", `Type "${docType}" is not supported.`);
      return;
    }

    const { waves, groups } = pipeline;
    let merged = {};
    let embeddedItems = [];
    let anySucceeded = false;
    let firstError = null;

    for (const wave of waves) {
      if (wave.length === 0) continue;

      // Pass accumulated embedded item names so later wave prompts
      // can reference what abilities the NPC already has.
      const prior = { ...merged };
      if (embeddedItems.length) {
        prior._embeddedSummary = embeddedItems.map(i => `${i.name} (${i.type})`).join(", ");
      }

      if (wave.length === 1) {
        const name = wave[0];
        const group = groups[name];
        this._setStatus(group.label);

        // The catalogSelection group runs its own multi-step LLM pipeline
        // instead of the normal schema→prompt→generate→mapResult flow.
        if (name === "catalogSelection") {
          try {
            const { actorUpdate, embeddedItems: catalogItems } = await runCatalogSelection(
              context, prior, (label) => this._setStatus(label),
            );
            if (Object.keys(actorUpdate).length) {
              merged = mergeDeep(merged, actorUpdate);
            }
            embeddedItems.push(...catalogItems);
            if (catalogItems.length || Object.keys(actorUpdate).length) {
              anySucceeded = true;
            }
          } catch (err) {
            console.warn(`[simsala] catalog selection failed:`, err.message);
            if (!firstError) firstError = err;
          }
        } else {
          // Standard group — single LLM call with keep_alive: -1 to keep the
          // model loaded in memory across waves (avoids ~5s reload per wave).
          try {
            const prompt = group.buildPrompt(context, docType, prior);
            const schema = group.schema(docType);
            const { parsed } = await OllamaService.generate(
              [{ role: "user", content: prompt }], schema, -1,
            );
            if (parsed) {
              const mapped = await group.mapResult(parsed, docType, prior);
              const { actorUpdate, embedded } = extractEmbedded(mapped);
              merged = mergeDeep(merged, actorUpdate);
              embeddedItems.push(...embedded);
              anySucceeded = true;
            }
          } catch (err) {
            console.warn(`[simsala] group "${name}" failed:`, err.message);
            if (!firstError) firstError = err;
          }
        }
      } else {
        // Parallel — multiple groups
        this._setStatus("Generating details…");
        const outcomes = await Promise.allSettled(
          wave.map(async name => {
            const group = groups[name];
            const prompt = group.buildPrompt(context, docType, prior);
            const schema = group.schema(docType);
            const { parsed } = await OllamaService.generate(
              [{ role: "user", content: prompt }], schema, -1,
            );
            return parsed ? await group.mapResult(parsed, docType, prior) : null;
          })
        );
        for (let i = 0; i < outcomes.length; i++) {
          const outcome = outcomes[i];
          if (outcome.status === "fulfilled" && outcome.value) {
            const { actorUpdate, embedded } = extractEmbedded(outcome.value);
            merged = mergeDeep(merged, actorUpdate);
            embeddedItems.push(...embedded);
            anySucceeded = true;
          } else if (outcome.status === "rejected") {
            console.warn(`[simsala] group "${wave[i]}" failed:`, outcome.reason?.message);
            if (!firstError) firstError = outcome.reason;
          }
        }
      }
    }

    // Unload model from GPU memory after generation completes.
    // keep_alive: 0 ensures zero memory impact during play.
    try { await OllamaService.generate([], {}, 0); } catch { /* ignore */ }

    if (!anySucceeded) {
      throw firstError ?? new Error("All generation groups failed.");
    }

    // Item-specific validation
    if (ITEM_TYPE_GROUPS[docType]) {
      const { validated, removed } = this._validateProperties(merged);
      merged = validated;
      if (removed.length) {
        this._appendMessage("note", `⚠ Removed invalid properties for ${docType}: ${removed.join(", ")}`);
      }
    }

    this.lastResult = merged;
    this.lastEmbeddedItems = embeddedItems;

    // Display actor data as JSON, embedded items as a readable list
    this._appendMessage("assistant", JSON.stringify(merged, null, 2));
    if (embeddedItems.length) {
      const listing = embeddedItems.map(i => `  ${i.name} (${i.type})`).join("\n");
      this._appendMessage("note", `Abilities:\n${listing}`);
    }
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

  async _onApply() {
    if (!this.lastResult && !this.lastEmbeddedItems.length) return;

    // Apply actor-level field updates
    if (this.lastResult && Object.keys(this.lastResult).length) {
      await this.document.update(this.lastResult);
    }

    // Replace previously generated embedded items with the new set.
    // The simsala.generated flag distinguishes our items from manually added ones.
    if (this.lastEmbeddedItems.length) {
      const oldIds = this.document.items
        ?.filter(i => i.getFlag("simsala", "generated"))
        .map(i => i.id) ?? [];
      if (oldIds.length) {
        await this.document.deleteEmbeddedDocuments("Item", oldIds);
      }

      const flagged = this.lastEmbeddedItems.map(item => ({
        ...item,
        flags: { ...item.flags, simsala: { generated: true } },
      }));
      await this.document.createEmbeddedDocuments("Item", flagged);
    }

    const label = this.document.type === "npc" ? "NPC" : "item";
    this._appendMessage("note", `✓ Applied to ${label}.`);
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
