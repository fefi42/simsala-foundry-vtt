/**
 * D&D 5e item enum reference for Simsala.
 * Sourced from dnd5e/module/config.mjs — update when the system updates.
 *
 * Used in two places:
 *  1. The LLM system prompt, so the model knows valid values for enum fields
 *  2. The validation layer, to reject invented values before applying to the item
 */
export const DND5E_ITEM_SCHEMA = {

  /**
   * system.rarity
   */
  rarity: ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"],

  /**
   * system.attunement
   * "" means no attunement required.
   */
  attunement: ["", "required", "optional"],

  /**
   * system.price.denomination
   */
  priceDenomination: ["cp", "sp", "ep", "gp", "pp"],

  /**
   * system.weight.units
   */
  weightUnits: ["lb", "tn", "kg", "Mg"],

  /**
   * Damage types — used in system.damage.base.types (a Set of strings)
   * and damage formula parts.
   */
  damageTypes: [
    "acid", "bludgeoning", "cold", "fire", "force",
    "lightning", "necrotic", "piercing", "poison",
    "psychic", "radiant", "slashing", "thunder"
  ],

  /**
   * system.type.value — valid values depend on the item's top-level type field.
   *
   * Top-level item types (the `type` field on the document root, not system.type):
   *   weapon, equipment, consumable, tool, loot, container, feat, spell, background, class, subclass, race
   *
   * This module targets: weapon, equipment, consumable, tool, loot.
   */
  itemTypes: {
    weapon: {
      typeValues: ["simpleM", "simpleR", "martialM", "martialR", "natural", "improv"],
      notes: "simpleM=simple melee, simpleR=simple ranged, martialM=martial melee, martialR=martial ranged"
    },
    equipment: {
      typeValues: [
        // armor
        "light", "medium", "heavy", "natural", "shield",
        // misc
        "clothing", "ring", "rod", "trinket", "vehicle", "wand", "wondrous"
      ]
    },
    consumable: {
      typeValues: ["ammo", "potion", "poison", "food", "scroll", "wand", "rod", "trinket", "wondrous"],
      subtypes: {
        ammo: ["arrow", "crossbowBolt", "energyCell", "firearmBullet", "slingBullet", "blowgunNeedle"],
        poison: ["contact", "ingested", "inhaled", "injury"]
      }
    },
    tool: {
      typeValues: ["art", "game", "music"],
      notes: "art=artisan tools, game=gaming set, music=musical instrument"
    },
    loot: {
      typeValues: ["art", "gear", "gem", "junk", "material", "resource", "trade", "treasure"]
    }
  },

  /**
   * system.properties — a Set of strings. Valid values differ per item type.
   * All property keys and their meanings:
   */
  properties: {
    ada:                { label: "Adamantine",          validFor: ["weapon", "equipment"] },
    amm:                { label: "Ammunition",          validFor: ["weapon"] },
    fin:                { label: "Finesse",             validFor: ["weapon"] },
    fir:                { label: "Firearm",             validFor: ["weapon"] },
    foc:                { label: "Spellcasting Focus",  validFor: ["weapon", "equipment", "tool"] },
    hvy:                { label: "Heavy",               validFor: ["weapon"] },
    lgt:                { label: "Light",               validFor: ["weapon"] },
    lod:                { label: "Loading",             validFor: ["weapon"] },
    mgc:                { label: "Magical",             validFor: ["weapon", "equipment", "consumable", "tool", "loot", "container"] },
    rch:                { label: "Reach",               validFor: ["weapon"] },
    ret:                { label: "Returning",           validFor: ["weapon"] },
    sil:                { label: "Silvered",            validFor: ["weapon"] },
    spc:                { label: "Special",             validFor: ["weapon"] },
    stealthDisadvantage:{ label: "Stealth Disadvantage",validFor: ["equipment"] },
    thr:                { label: "Thrown",              validFor: ["weapon"] },
    two:                { label: "Two-Handed",          validFor: ["weapon"] },
    ver:                { label: "Versatile",           validFor: ["weapon"] }
  },

  /**
   * Notes on non-obvious field formats.
   */
  fieldNotes: {
    "system.damage.base.formula": "Dice expression string, e.g. '1d8', '2d6 + 3'",
    "system.damage.base.types":   "Array of damage type strings from the damageTypes list above",
    "system.damage.versatile":    "Same structure as damage.base — for versatile weapons held two-handed",
    "system.range.value":         "Number — normal range in feet",
    "system.range.long":          "Number — long range in feet (disadvantage beyond normal)",
    "system.range.reach":         "Number — reach extension in feet (usually 5)",
    "system.range.units":         "'ft' for feet (most cases)",
    "system.uses.max":            "Formula string for max uses, e.g. '3' or '@abilities.wis.mod'",
    "system.uses.per":            "Recovery period: 'sr' (short rest), 'lr' (long rest), 'day', 'charges'",
    "system.armor.value":         "Number — base AC for armor, shield bonus for shields",
    "system.properties":          "Array of property key strings (converted to Set internally)",
    "system.description.value":   "HTML string — wrap plain text in <p> tags",
    "name":                       "The item's display name"
  }
};
