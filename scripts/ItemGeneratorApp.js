import { OllamaService } from "./OllamaService.js";
import { DND5E_ITEM_SCHEMA } from "../data/dnd5e-item-schema.js";
import { ITEM_TYPE_GROUPS, GROUPS } from "./field-groups.js";
import { generateNpc } from "./npc-generation.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Human-readable labels for known JSON paths in generation results.
 * Paths not listed here fall back to showing the dotted path itself.
 */
const PATH_LABELS = {
  "name":                             "Name",
  "system.rarity":                    "Rarity",
  "system.type.value":                "Type",
  "system.attunement":                "Attunement",
  "system.mastery":                   "Weapon Mastery",
  "system.description.value":         "Description",
  "system.details.biography.value":   "Biography",
  "system.details.type.value":        "Creature Type",
  "system.details.type.subtype":      "Subtype",
  "system.details.cr":                "CR",
  "system.details.xp.value":          "XP",
  "system.details.alignment":         "Alignment",
  "system.details.environment":       "Environment",
  "system.damage.base.formula":       "Damage",
  "system.damage.base.types":         "Damage Types",
  "system.damage.versatile.formula":  "Versatile Damage",
  "system.damage.versatile.types":    "Versatile Types",
  "system.armor.value":               "AC",
  "system.strength":                  "Strength Req.",
  "system.properties":                "Properties",
  "system.uses.max":                  "Max Uses",
  "system.uses.per":                  "Uses Per",
  "system.price.value":               "Price",
  "system.price.denomination":        "Currency",
  "system.weight.value":              "Weight",
  // Abilities
  "system.abilities.str.value":       "STR",
  "system.abilities.dex.value":       "DEX",
  "system.abilities.con.value":       "CON",
  "system.abilities.int.value":       "INT",
  "system.abilities.wis.value":       "WIS",
  "system.abilities.cha.value":       "CHA",
  // Common nested fields
  "system.attributes.hp.value":       "HP",
  "system.attributes.hp.max":         "HP Max",
  "system.attributes.hp.formula":     "HP Formula",
  "system.attributes.ac.value":       "AC",
  "system.attributes.ac.flat":        "AC (flat)",
  "system.attributes.movement.walk":  "Speed (walk)",
  "system.attributes.movement.fly":   "Speed (fly)",
  "system.attributes.movement.swim":  "Speed (swim)",
  "system.attributes.movement.burrow":"Speed (burrow)",
  "system.attributes.movement.climb": "Speed (climb)",
  "system.attributes.senses.darkvision":    "Darkvision",
  "system.attributes.senses.blindsight":    "Blindsight",
  "system.attributes.senses.tremorsense":   "Tremorsense",
  "system.attributes.senses.truesight":     "Truesight",
  "system.attributes.senses.special":       "Special Senses",
};

/**
 * Derive a short human-readable label from a dotted path.
 * Uses PATH_LABELS for known paths, otherwise extracts the last
 * meaningful segment(s) and title-cases them.
 */
function pathLabel(path) {
  if (PATH_LABELS[path]) return PATH_LABELS[path];
  // Take last 1-2 segments, skip generic ones like "value"
  const parts = path.split(".");
  const skip = new Set(["system", "value", "values", "max", "min"]);
  const meaningful = parts.filter(p => !skip.has(p));
  const tail = meaningful.slice(-2).join(" ");
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/**
 * Semantic groups for organising actor-change fields.
 * Each entry: { label, paths[] }.  Paths are matched as prefixes so
 * "system.attributes" catches "system.attributes.hp.max" etc.
 * Fields that don't match any group fall into "Other".
 */
const FIELD_GROUPS = [
  {
    key: "identity",
    label: "Identity",
    paths: [
      "name", "system.rarity", "system.type", "system.attunement",
      "system.mastery", "system.description", "system.details.biography",
      "system.details.type",
    ],
  },
  {
    key: "stats",
    label: "Base Stats",
    paths: [
      "system.abilities",
    ],
  },
  {
    key: "combat",
    label: "Combat",
    paths: [
      "system.attributes.hp", "system.attributes.ac",
      "system.attributes.movement", "system.attributes.init",
      "system.damage", "system.armor", "system.strength",
      "system.properties", "system.bonuses",
    ],
  },
  {
    key: "skills",
    label: "Skills & Senses",
    paths: [
      "system.skills", "system.attributes.senses",
      "system.tools", "system.traits",
    ],
  },
  {
    key: "details",
    label: "Details",
    paths: [
      "system.details.cr", "system.details.xp",
      "system.details.environment", "system.details.alignment",
      "system.details.source",
    ],
  },
  {
    key: "physical",
    label: "Physical",
    paths: [
      "system.price", "system.weight", "system.uses",
    ],
  },
];

/**
 * Assign a flat field entry to a semantic group.
 * Returns the group key, or "other" if no group matches.
 */
function fieldGroup(path) {
  for (const g of FIELD_GROUPS) {
    if (g.paths.some(p => path === p || path.startsWith(p + "."))) return g.key;
  }
  return "other";
}

/**
 * Resolve a dotted path against an object, returning undefined if missing.
 */
function resolvePath(obj, path) {
  let cur = obj;
  for (const p of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Check whether two values are deeply equal (good enough for JSON-safe data).
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Flatten a nested object into an array of { path, value } entries.
 * Stops recursing at leaf values, arrays, and HTML strings.
 */
function flattenObject(obj, prefix = "") {
  const entries = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      entries.push({ path, value: v });
    } else if (v !== null && typeof v === "object") {
      entries.push(...flattenObject(v, path));
    } else {
      entries.push({ path, value: v });
    }
  }
  return entries;
}

/**
 * Format a value for display in the friendly result view.
 * Long HTML strings are stripped and truncated.
 */
function formatValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string" && value.includes("<")) {
    const stripped = value.replace(/<[^>]*>/g, "").trim();
    return stripped.length > 80 ? stripped.slice(0, 80) + "…" : stripped;
  }
  return String(value);
}

/**
 * Get the full unformatted text of a value (for tooltips).
 */
function fullText(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string" && value.includes("<")) {
    return value.replace(/<[^>]*>/g, "").trim();
  }
  return String(value);
}

/**
 * Build a nested update object from a dotted path and value.
 * e.g. ("system.damage.base.formula", "2d6") → { system: { damage: { base: { formula: "2d6" } } } }
 */
function buildUpdate(path, value) {
  const parts = path.split(".");
  let obj = {};
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
  return obj;
}

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
   * Items use the wave pipeline; NPCs use the base-creature pipeline.
   */
  _getPipeline() {
    const docType = this.document.type;

    // NPC actor — handled by generateNpc(), no wave pipeline
    if (docType === "npc") return "npc";

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

    // NPC generation — base-creature pipeline
    if (pipeline === "npc") {
      await this._generateNpc(context);
      return;
    }

    // Item generation — wave pipeline
    const { waves, groups } = pipeline;
    let merged = {};
    let embeddedItems = [];
    let anySucceeded = false;
    let firstError = null;

    for (const wave of waves) {
      if (wave.length === 0) continue;

      const prior = { ...merged };
      if (embeddedItems.length) {
        prior._embeddedSummary = embeddedItems.map(i => `${i.name} (${i.type})`).join(", ");
      }

      if (wave.length === 1) {
        const name = wave[0];
        const group = groups[name];

        if (group.shouldRun && !group.shouldRun(prior)) continue;

        this._setStatus(group.label);

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

    this._displayResult({ actorUpdate: merged, embeddedItems });
    this.element.querySelector(".simsala-apply").disabled = false;
  }

  /**
   * NPC generation — base-creature pipeline.
   * Picks an SRD creature, loads it, re-flavors via LLM, applies item swaps.
   */
  async _generateNpc(context) {
    const result = await generateNpc(
      context,
      (label) => this._setStatus(label),
    );

    this.lastResult = result.actorUpdate;
    this.lastEmbeddedItems = result.embeddedItems;

    // Display summary
    const summary = `Based on: ${result.baseName}\n${result.reason ?? ""}`;
    this._appendMessage("note", summary);

    this._displayResult({
      actorUpdate: result.actorUpdate,
      embeddedItems: result.embeddedItems,
    });
    this.element.querySelector(".simsala-apply").disabled = false;
  }

  /**
   * Show generation results — either as raw JSON (developer mode) or
   * as a friendly card view with per-item apply buttons.
   */
  _displayResult(data) {
    const jsonMode = game.settings.get("simsala", "jsonOutputInChat");

    if (jsonMode) {
      this._appendMessage("assistant", JSON.stringify(data.actorUpdate, null, 2));
      if (data.embeddedItems.length) {
        const listing = data.embeddedItems.map(i => `  ${i.name} (${i.type})`).join("\n");
        this._appendMessage("note", `Items:\n${listing}`);
      }
    } else {
      this._appendMessage("result", data);
    }
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
    this._appendMessage("note", `✓ Applied all to ${label}.`);
  }

  /**
   * Apply a single field from lastResult to the document.
   */
  async _onApplyField(path) {
    if (!this.lastResult) return;

    // Resolve the value from lastResult using the dotted path
    const parts = path.split(".");
    let value = this.lastResult;
    for (const p of parts) {
      if (value == null) return;
      value = value[p];
    }
    if (value === undefined) return;

    const update = buildUpdate(path, value);
    await this.document.update(update);
  }

  /**
   * Apply a single embedded item to the document.
   */
  async _onApplyOneItem(index) {
    const item = this.lastEmbeddedItems[index];
    if (!item) return;

    const flagged = {
      ...item,
      flags: { ...item.flags, simsala: { generated: true } },
    };
    await this.document.createEmbeddedDocuments("Item", [flagged]);
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

  /**
   * Bind a rich dnd5e-style tooltip to an element using a compendium UUID.
   * Loads the document on hover and calls richTooltip() for the formatted view.
   */
  _bindRichTooltip(element, uuid) {
    element.addEventListener("pointerenter", async () => {
      const doc = await fromUuid(uuid);
      if (!doc) return;
      const tip = await (doc.richTooltip?.() ?? doc.system?.richTooltip?.());
      if (!tip?.content) return;
      // Activate with placeholder text, then replace with rich content
      game.tooltip.activate(element, { text: "Loading…", direction: "LEFT" });
      const tt = game.tooltip.tooltip;
      tt.innerHTML = tip.content;
      tt.classList.remove("theme-dark");
      if (tip.classes?.length) tt.classList.add(...tip.classes);
    });
    element.addEventListener("pointerleave", () => {
      game.tooltip.deactivate();
      game.tooltip.tooltip.classList.remove(
        "dnd5e2", "dnd5e-tooltip", "item-tooltip", "themed", "theme-light",
      );
    });
  }

  _appendMessage(role, content, note = "") {
    this.chatLog.push({ role, content, note });
    const history = this.element?.querySelector(".simsala-history");
    if (!history) return;
    const msg = this._appendToHistory(history, role, content, note);
    // For result cards, scroll so the first result is visible at the top.
    // For everything else, scroll to the bottom as usual.
    if (role === "result") {
      msg.scrollIntoView({ block: "start", behavior: "smooth" });
    } else {
      history.scrollTop = history.scrollHeight;
    }
  }

  _appendToHistory(history, role, content, note = "") {
    const msg = document.createElement("div");
    msg.className = `simsala-message simsala-message--${role}`;

    if (role === "result") {
      this._renderResult(msg, content);
    } else if (role === "assistant") {
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
    return msg;
  }

  /**
   * Build the friendly result card DOM inside a container element.
   * Shows a collapsible actor-changes block and per-item cards.
   */
  _renderResult(container, data) {
    const { actorUpdate, embeddedItems } = data;

    // --- Actor changes (grouped, filtered) ---
    if (actorUpdate && Object.keys(actorUpdate).length) {
      // Flatten and filter out fields unchanged from current document
      const currentData = this.document.toObject();
      const allFields = flattenObject(actorUpdate).filter(({ path, value }) => {
        const current = resolvePath(currentData, path);
        return !deepEqual(current, value);
      });

      // Bucket into semantic groups
      const buckets = new Map();
      for (const entry of allFields) {
        const key = fieldGroup(entry.path);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(entry);
      }

      // Render each non-empty group as a collapsible <details>
      const groupDefs = [...FIELD_GROUPS, { key: "other", label: "Other", paths: [] }];
      for (const gDef of groupDefs) {
        const entries = buckets.get(gDef.key);
        if (!entries?.length) continue;

        const details = document.createElement("details");
        details.className = "simsala-result-group";

        const summary = document.createElement("summary");
        const summaryLabel = document.createElement("span");
        summaryLabel.textContent = `${gDef.label} (${entries.length})`;
        summary.appendChild(summaryLabel);

        const applyGroupBtn = document.createElement("button");
        applyGroupBtn.type = "button";
        applyGroupBtn.className = "simsala-apply-group";
        applyGroupBtn.textContent = "Apply";
        const groupPaths = entries.map(e => e.path);
        applyGroupBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          for (const path of groupPaths) {
            await this._onApplyField(path);
          }
          details.classList.add("simsala-result-applied");
          applyGroupBtn.disabled = true;
          applyGroupBtn.textContent = "Applied";
          for (const btn of details.querySelectorAll(".simsala-apply-field")) {
            btn.disabled = true;
            btn.textContent = "Applied";
          }
        });
        summary.appendChild(applyGroupBtn);
        details.appendChild(summary);

        const fields = document.createElement("div");
        fields.className = "simsala-result-fields";

        for (const { path, value } of entries) {
          const row = document.createElement("div");
          row.className = "simsala-result-row";

          const label = document.createElement("span");
          label.className = "simsala-field-label";
          label.textContent = pathLabel(path);
          row.appendChild(label);

          const val = document.createElement("span");
          val.className = "simsala-field-value";
          val.textContent = formatValue(value);
          const full = fullText(value);
          if (full.length > 80) {
            val.dataset.tooltip = full;
            val.dataset.tooltipDirection = "DOWN";
          }
          row.appendChild(val);

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "simsala-apply-field";
          btn.textContent = "Apply";
          btn.addEventListener("click", async () => {
            await this._onApplyField(path);
            row.classList.add("simsala-result-applied");
            btn.disabled = true;
            btn.textContent = "Applied";
          });
          row.appendChild(btn);

          fields.appendChild(row);
        }

        details.appendChild(fields);
        container.appendChild(details);
      }
    }

    // --- Embedded items ---
    if (embeddedItems?.length) {
      for (let i = 0; i < embeddedItems.length; i++) {
        const item = embeddedItems[i];
        const row = document.createElement("div");
        row.className = "simsala-result-item";

        const typeBadge = document.createElement("span");
        typeBadge.className = "simsala-result-type";
        typeBadge.textContent = item.type;
        row.appendChild(typeBadge);

        const name = document.createElement("strong");
        name.textContent = item.name;
        row.appendChild(name);

        // Rich tooltip for compendium items, plain text fallback for others
        if (item._sourceUuid) {
          this._bindRichTooltip(row, item._sourceUuid);
        } else {
          const desc = item.system?.description?.value;
          if (desc) row.dataset.tooltip = desc.replace(/<[^>]*>/g, "").trim();
        }

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "simsala-apply-one";
        btn.textContent = "Apply";
        btn.addEventListener("click", async () => {
          await this._onApplyOneItem(i);
          row.classList.add("simsala-result-applied");
          btn.disabled = true;
          btn.textContent = "Applied";
        });
        row.appendChild(btn);

        container.appendChild(row);
      }
    }
  }
}
