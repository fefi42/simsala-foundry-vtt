import { DND5E_ITEM_SCHEMA } from "../data/dnd5e-item-schema.js";

/** Which groups run for each item type, in order. */
export const ITEM_TYPE_GROUPS = {
  weapon:     ["identity", "description", "damage", "properties", "physical"],
  equipment:  ["identity", "description", "defense", "properties", "physical"],
  consumable: ["identity", "description", "damage", "uses", "properties", "physical"],
  tool:       ["identity", "description", "properties", "physical"],
  loot:       ["identity", "description", "properties", "physical"],
};

export const GROUPS = {

  identity: {
    label: "Generating identity…",

    schema(itemType) {
      const typeValues = DND5E_ITEM_SCHEMA.itemTypes[itemType]?.typeValues ?? [];
      const props = {
        name:      { type: "string" },
        rarity:    { type: "string", enum: DND5E_ITEM_SCHEMA.rarity },
        typeValue: { type: "string", enum: typeValues },
      };
      const required = ["name", "rarity", "typeValue"];
      if (itemType !== "loot") {
        props.attunement = { type: "string", enum: DND5E_ITEM_SCHEMA.attunement };
        required.push("attunement");
      }
      if (itemType === "weapon") {
        props.mastery = { type: "string", enum: DND5E_ITEM_SCHEMA.weaponMasteries };
        required.push("mastery");
      }
      return { type: "object", properties: props, required };
    },

    buildPrompt(context, itemType) {
      const typeValues = DND5E_ITEM_SCHEMA.itemTypes[itemType]?.typeValues ?? [];
      const lines = [
        `You are a D&D 5e assistant. Determine the identity fields for a ${itemType} item.`,
        ``,
        `GM description: "${context}"`,
        ``,
        `Rarity options: ${DND5E_ITEM_SCHEMA.rarity.join(", ")}`,
        `typeValue options: ${typeValues.join(", ")}`,
      ];
      if (itemType !== "loot") {
        lines.push(`attunement options: "" (none), "required", "optional"`);
      }
      if (itemType === "weapon") {
        lines.push(`mastery options: ${DND5E_ITEM_SCHEMA.weaponMasteries.join(", ")} — pick the most fitting for this weapon's combat style`);
      }
      lines.push(``, `Return JSON with: name, rarity, typeValue${itemType !== "loot" ? ", attunement" : ""}${itemType === "weapon" ? ", mastery" : ""}.`);
      return lines.join("\n");
    },

    mapResult(result, itemType) {
      const update = {
        name: result.name,
        system: {
          rarity: result.rarity,
          type: { value: result.typeValue ?? "" },
        },
      };
      if (itemType !== "loot" && result.attunement !== undefined) {
        update.system.attunement = result.attunement;
      }
      if (itemType === "weapon" && result.mastery) {
        update.system.mastery = result.mastery;
      }
      return update;
    },
  },

  // ---------------------------------------------------------------------------

  description: {
    label: "Generating description…",

    schema() {
      return {
        type: "object",
        properties: { description: { type: "string" } },
        required: ["description"],
      };
    },

    buildPrompt(context, itemType) {
      return [
        `You are a D&D 5e assistant writing item flavor text.`,
        ``,
        `GM description: "${context}"`,
        `Item type: ${itemType}`,
        ``,
        `Write 2–4 sentences in the style of a D&D sourcebook. Be evocative and specific. Wrap in a single <p> tag.`,
        `Return JSON: { "description": "<p>...</p>" }`,
      ].join("\n");
    },

    mapResult(result) {
      return { system: { description: { value: result.description ?? "" } } };
    },
  },

  // ---------------------------------------------------------------------------

  damage: {
    label: "Generating damage…",

    schema() {
      return {
        type: "object",
        properties: {
          formula:          { type: "string" },
          types:            { type: "array", items: { type: "string" } },
          versatileFormula: { type: "string" },
        },
        required: ["formula", "types"],
      };
    },

    buildPrompt(context, itemType) {
      const isConsumable = itemType === "consumable";
      return [
        `You are a D&D 5e assistant. Determine the damage for a ${itemType}.`,
        ``,
        `GM description: "${context}"`,
        ``,
        isConsumable
          ? `If this item does NOT deal direct damage (e.g. a healing potion, food), return formula: "" and types: [].`
          : ``,
        `5e damage benchmarks: dagger 1d4 piercing, shortsword 1d6 piercing, longsword 1d8 slashing (versatile 1d10), greatsword 2d6 slashing, handaxe 1d6 slashing.`,
        `Damage types: ${DND5E_ITEM_SCHEMA.damageTypes.join(", ")}.`,
        `For versatile weapons, also return versatileFormula (e.g. "1d10"). Omit it if the weapon is not versatile.`,
        ``,
        `Return JSON: { "formula": "1d6", "types": ["slashing"] }`,
      ].filter(Boolean).join("\n");
    },

    mapResult(result) {
      // Skip if no damage (e.g. non-damaging consumable)
      if (!result.formula) return {};
      const update = {
        system: {
          damage: {
            base: { formula: result.formula, types: result.types ?? [] },
          },
        },
      };
      if (result.versatileFormula) {
        update.system.damage.versatile = {
          formula: result.versatileFormula,
          types: result.types ?? [],
        };
      }
      return update;
    },
  },

  // ---------------------------------------------------------------------------

  properties: {
    label: "Generating properties…",

    schema() {
      return {
        type: "object",
        properties: { properties: { type: "array", items: { type: "string" } } },
        required: ["properties"],
      };
    },

    buildPrompt(context, itemType) {
      const validKeys = Object.entries(DND5E_ITEM_SCHEMA.properties)
        .filter(([, def]) => def.validFor.includes(itemType))
        .map(([key, def]) => `${key} (${def.label})`)
        .join(", ");
      return [
        `You are a D&D 5e assistant. Choose which properties apply to this ${itemType}.`,
        ``,
        `GM description: "${context}"`,
        ``,
        `Valid property keys for ${itemType}: ${validKeys}`,
        `Return only properties that genuinely apply. Return empty array if none fit.`,
        `Return JSON: { "properties": ["mgc", "fin"] }`,
      ].join("\n");
    },

    mapResult(result) {
      return { system: { properties: result.properties ?? [] } };
    },
  },

  // ---------------------------------------------------------------------------

  defense: {
    label: "Generating defense…",

    schema() {
      return {
        type: "object",
        properties: {
          armorValue: { type: "number" },
          strength:   { type: "number" },
        },
        required: ["armorValue", "strength"],
      };
    },

    buildPrompt(context) {
      return [
        `You are a D&D 5e assistant. Determine the AC and strength requirement for armor or a shield.`,
        ``,
        `GM description: "${context}"`,
        ``,
        `5e AC benchmarks: padded/leather 11–12, chain shirt 13, scale mail 14, breastplate 14, half plate 15, chain mail 16, splint 17, plate 18, shield adds +2.`,
        `Minimum strength: only for heavy armor (chain mail 13, splint 15, plate 15). Use 0 if not applicable.`,
        ``,
        `Return JSON: { "armorValue": 16, "strength": 15 }`,
      ].join("\n");
    },

    mapResult(result) {
      const update = { system: { armor: { value: result.armorValue ?? 0 } } };
      if (result.strength) update.system.strength = result.strength;
      return update;
    },
  },

  // ---------------------------------------------------------------------------

  uses: {
    label: "Generating uses…",

    schema() {
      return {
        type: "object",
        properties: {
          max: { type: "integer" },
          per: { type: "string", enum: ["sr", "lr", "day", "charges"] },
        },
        required: ["max", "per"],
      };
    },

    buildPrompt(context) {
      return [
        `You are a D&D 5e assistant. Determine the uses/charges for a consumable item.`,
        ``,
        `GM description: "${context}"`,
        ``,
        `max: an INTEGER — the number of uses. Never use words. Examples: 1, 3, 10.`,
        `per: one of "sr" (short rest), "lr" (long rest), "day" (dawn), "charges" (item consumed permanently).`,
        `Single-use items (potions, scrolls, food, poisons): max 1, per "charges".`,
        `Multi-charge items (wands, rods): max 3–10, per "lr" or "day".`,
        ``,
        `Return JSON: { "max": 3, "per": "lr" }`,
      ].join("\n");
    },

    mapResult(result) {
      const validPer = ["sr", "lr", "day", "charges"];
      const maxNum = parseInt(result.max, 10);
      const max = String(isFinite(maxNum) && maxNum > 0 ? maxNum : 1);
      const per = validPer.includes(result.per) ? result.per : "charges";
      return { system: { uses: { max, per } } };
    },
  },

  // ---------------------------------------------------------------------------

  physical: {
    label: "Generating physical properties…",

    schema() {
      return {
        type: "object",
        properties: {
          price:        { type: "number" },
          denomination: { type: "string", enum: DND5E_ITEM_SCHEMA.priceDenomination },
          weight:       { type: "number" },
        },
        required: ["price", "denomination", "weight"],
      };
    },

    buildPrompt(context, itemType) {
      return [
        `You are a D&D 5e assistant. Determine the price and weight for a ${itemType}.`,
        ``,
        `GM description: "${context}"`,
        ``,
        `Rarity pricing: common ~50gp, uncommon ~500gp, rare ~5000gp, very rare ~50000gp, legendary ~500000gp.`,
        `Denominations: ${DND5E_ITEM_SCHEMA.priceDenomination.join(", ")}. Use gp for most items.`,
        `Typical weights: dagger 1lb, sword 2–4lb, armor 10–65lb, potion 0.5lb, wand 1lb, gem 0lb.`,
        ``,
        `Return JSON: { "price": 5000, "denomination": "gp", "weight": 1 }`,
      ].join("\n");
    },

    mapResult(result) {
      return {
        system: {
          price:  { value: result.price ?? 0, denomination: result.denomination ?? "gp" },
          weight: { value: result.weight ?? 0 },
        },
      };
    },
  },
};
