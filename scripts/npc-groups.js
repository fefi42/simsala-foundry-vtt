const CREATURE_TYPES = [
  "aberration", "beast", "celestial", "construct", "dragon", "elemental",
  "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead",
];

const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];

const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

const CONDITIONS = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
  "incapacitated", "invisible", "paralyzed", "petrified", "poisoned",
  "prone", "restrained", "stunned", "unconscious",
];

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

const SKILL_KEYS = [
  "acr", "ani", "arc", "ath", "dec", "his", "ins", "itm",
  "inv", "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur",
];

const STANDARD_LANGUAGES = [
  "common", "draconic", "dwarvish", "elvish", "giant",
  "gnomish", "goblin", "halfling", "orc",
];

const EXOTIC_LANGUAGES = [
  "abyssal", "celestial", "deep", "infernal", "primordial",
  "sylvan", "undercommon", "gith", "gnoll", "aarakocra",
];

const ALL_LANGUAGES = [...STANDARD_LANGUAGES, ...EXOTIC_LANGUAGES];

/** Deterministic HP calculation — avoids asking the LLM for both formula
 *  and max HP, which often produces inconsistent pairs. */
function computeHpAverage(formula) {
  const m = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!m) return 1;
  const count = parseInt(m[1], 10);
  const die   = parseInt(m[2], 10);
  const mod   = parseInt(m[3] ?? "0", 10);
  return Math.floor(count * (die + 1) / 2 + mod);
}

// ---------------------------------------------------------------------------
// Wave pipeline — each inner array is one wave. Single-element = sequential,
// multi-element = parallel within the wave.
// ---------------------------------------------------------------------------

export const NPC_WAVES = [
  ["concept"],
  ["mechanical"],
  ["coreStats"],
  ["savesSkills", "sensesLanguages"],
  ["description"],
];

// ---------------------------------------------------------------------------
// Group definitions
// ---------------------------------------------------------------------------

export const NPC_GROUPS = {

  // ---- Wave 1 — Concept & Flavor ------------------------------------------

  concept: {
    label: "Generating concept…",

    schema() {
      return {
        type: "object",
        properties: {
          name: { type: "string" },
          cr: { type: "number" },
          creatureType: { type: "string", enum: CREATURE_TYPES },
          subtype: { type: "string" },
        },
        required: ["name", "cr", "creatureType"],
      };
    },

    buildPrompt(context) {
      return [
        `You are a D&D 5e assistant. Create an NPC concept from the GM's description.`,
        ``,
        `GM description: "${context}"`,
        ``,
        `Creature type guide — pick the type that best fits:`,
        `- aberration: mind flayers, beholders, aboleths — alien/psionic creatures from the Far Realm`,
        `- beast: wolves, spiders, bears, hawks, giant animals — natural creatures, no magic`,
        `- celestial: angels, unicorns, couatls — creatures from the Upper Planes`,
        `- construct: golems, animated armor, shield guardians — magically created objects`,
        `- dragon: dragons, drakes, wyverns, dragon turtles — draconic creatures`,
        `- elemental: fire/water/earth/air elementals, genies, gargoyles, mephits`,
        `- fey: pixies, sprites, satyrs, dryads, hags — creatures from the Feywild`,
        `- fiend: demons, devils, yugoloths — creatures from the Lower Planes`,
        `- giant: hill giants, frost giants, ogres, trolls, ettins`,
        `- humanoid: humans, elves, dwarves, goblins, orcs, cultists, bandits, knights`,
        `- monstrosity: owlbears, basilisks, manticores, minotaurs — unnatural but not magical creatures`,
        `- ooze: gelatinous cubes, black puddings, gray oozes — amorphous creatures`,
        `- plant: treants, blights, shambling mounds, myconids`,
        `- undead: zombies, skeletons, vampires, liches, wraiths, ghosts, wights`,
        ``,
        `CR ranges: 0 (commoner) to 30 (tarrasque). Typical: goblin CR 1/4, ogre CR 2, young dragon CR 6–10, adult dragon CR 13–17, ancient dragon CR 20+, lich CR 21.`,
        `subtype is optional — use for race/category like "elf", "goblinoid", "shapechanger". Empty string if not relevant.`,
        ``,
        `IMPORTANT: If the description says "a cultist" or "an acolyte" (generic/indefinite), use a type name like "Blood Cultist" — NOT a personal name. Only invent a personal name if the GM asks for a specific named character.`,
        `Think Monster Manual style: "Bandit Captain", "Cult Fanatic", "Shadow Demon".`,
        ``,
        `Return JSON: { "name": "Cult Fanatic", "cr": 2, "creatureType": "humanoid", "subtype": "human" }`,
      ].join("\n");
    },

    mapResult(result) {
      const update = {
        system: {
          details: {
            cr: result.cr ?? 1,
            type: { value: result.creatureType ?? "humanoid" },
          },
        },
      };
      if (result.name) update.name = result.name;
      if (result.subtype) update.system.details.type.subtype = result.subtype;
      return update;
    },
  },

  // ---- Wave 2 — Mechanical Identity ---------------------------------------

  mechanical: {
    label: "Generating mechanical identity…",

    schema() {
      return {
        type: "object",
        properties: {
          size: { type: "string", enum: SIZES },
          damageImmunities: { type: "array", items: { type: "string", enum: DAMAGE_TYPES } },
          damageResistances: { type: "array", items: { type: "string", enum: DAMAGE_TYPES } },
          conditionImmunities: { type: "array", items: { type: "string", enum: CONDITIONS } },
          walk: { type: "integer" },
          fly: { type: "integer" },
          swim: { type: "integer" },
          burrow: { type: "integer" },
          climb: { type: "integer" },
        },
        required: ["size", "damageImmunities", "damageResistances", "conditionImmunities", "walk"],
      };
    },

    buildPrompt(context, _docType, prior = {}) {
      const name = prior.name ?? "unnamed";
      const cr = prior.system?.details?.cr ?? "unknown";
      const type = prior.system?.details?.type?.value ?? "unknown";

      return [
        `You are a D&D 5e assistant. Determine the mechanical identity for an NPC.`,
        ``,
        `GM description: "${context}"`,
        `Creature: "${name}", CR ${cr}, ${type}`,
        ``,
        `Sizes: tiny, sm (Small), med (Medium), lg (Large), huge, grg (Gargantuan)`,
        ``,
        `Typical patterns:`,
        `- Undead: immune to poison damage + poisoned condition, often necrotic resistant`,
        `- Constructs: immune to poison + psychic, immune to charmed/exhaustion/frightened/paralyzed/petrified/poisoned`,
        `- Fiends: resistant to cold/fire/lightning, immune to poison + poisoned`,
        `- Elementals: immune to poison + poisoned/paralyzed, often one elemental immunity`,
        `- Beasts/Humanoids: usually no immunities or resistances`,
        ``,
        `Movement: walk 30 is standard for Medium humanoids. Set fly/swim/burrow/climb to 0 if not applicable.`,
        ``,
        `Return JSON: { "size": "med", "damageImmunities": [], "damageResistances": ["fire"], "conditionImmunities": [], "walk": 30, "fly": 0, "swim": 0, "burrow": 0, "climb": 0 }`,
      ].join("\n");
    },

    mapResult(result) {
      return {
        system: {
          traits: {
            size: result.size ?? "med",
            di: { value: result.damageImmunities ?? [] },
            dr: { value: result.damageResistances ?? [] },
            ci: { value: result.conditionImmunities ?? [] },
          },
          attributes: {
            movement: {
              walk: result.walk ?? 30,
              fly: result.fly ?? 0,
              swim: result.swim ?? 0,
              burrow: result.burrow ?? 0,
              climb: result.climb ?? 0,
            },
          },
        },
      };
    },
  },

  // ---- Wave 3 — Core Stats ------------------------------------------------

  coreStats: {
    label: "Generating core stats…",

    schema() {
      return {
        type: "object",
        properties: {
          str: { type: "integer" },
          dex: { type: "integer" },
          con: { type: "integer" },
          int: { type: "integer" },
          wis: { type: "integer" },
          cha: { type: "integer" },
          ac: { type: "integer" },
          hpFormula: { type: "string" },
        },
        required: ["str", "dex", "con", "int", "wis", "cha", "ac", "hpFormula"],
      };
    },

    buildPrompt(context, _docType, prior = {}) {
      const name = prior.name ?? "unnamed";
      const cr = prior.system?.details?.cr ?? "unknown";
      const type = prior.system?.details?.type?.value ?? "unknown";
      const size = prior.system?.traits?.size ?? "med";

      const hitDieMap = { tiny: "d4", sm: "d6", med: "d8", lg: "d10", huge: "d12", grg: "d20" };
      const hitDie = hitDieMap[size] || "d8";

      return [
        `You are a D&D 5e assistant. Determine ability scores, AC, and HP formula for an NPC.`,
        ``,
        `GM description: "${context}"`,
        `Creature: "${name}", CR ${cr}, ${type}, size ${size}`,
        `Hit die for this size: ${hitDie}`,
        ``,
        `CR benchmarks (approximate HP, AC, ability score range):`,
        `CR 0: HP 3, AC 10, scores 8–12`,
        `CR 1: HP 50, AC 13, scores 12–16`,
        `CR 3: HP 80, AC 13, scores 13–17`,
        `CR 5: HP 110, AC 15, scores 14–18`,
        `CR 8: HP 150, AC 16, scores 15–20`,
        `CR 11: HP 190, AC 17, scores 16–22`,
        `CR 15: HP 230, AC 18, scores 18–24`,
        `CR 20: HP 310, AC 19, scores 20–26`,
        ``,
        `hpFormula: use the size's hit die + CON modifier per die.`,
        `Example: Medium creature, 8 hit dice, CON 14 (+2): "8d8+16" (8 dice × +2 CON = +16).`,
        `Example: Large creature, 12 hit dice, CON 18 (+4): "12d10+48" (12 dice × +4 CON = +48).`,
        `HP will be calculated automatically from the formula — only provide the formula.`,
        ``,
        `Return JSON: { "str": 16, "dex": 14, "con": 14, "int": 10, "wis": 12, "cha": 8, "ac": 15, "hpFormula": "8d8+16" }`,
      ].join("\n");
    },

    mapResult(result) {
      // Fix formula missing leading dice count (e.g. "d8+8" → "1d8+8")
      let formula = result.hpFormula ?? "1d8";
      if (/^d\d/.test(formula)) formula = "1" + formula;

      // Compute HP average from formula deterministically
      const hpMax = computeHpAverage(formula);
      return {
        system: {
          abilities: {
            str: { value: result.str ?? 10 },
            dex: { value: result.dex ?? 10 },
            con: { value: result.con ?? 10 },
            int: { value: result.int ?? 10 },
            wis: { value: result.wis ?? 10 },
            cha: { value: result.cha ?? 10 },
          },
          attributes: {
            ac: { flat: result.ac ?? 10, calc: "natural" },
            hp: { value: hpMax, max: hpMax, formula },
          },
        },
      };
    },
  },

  // ---- Wave 4a — Saves & Skills -------------------------------------------

  savesSkills: {
    label: "Generating saves & skills…",

    schema() {
      const profSchema = { type: "integer", enum: [0, 1] };
      const skillSchema = { type: "integer", enum: [0, 1, 2] };
      return {
        type: "object",
        properties: {
          saves: {
            type: "object",
            properties: Object.fromEntries(ABILITY_KEYS.map(k => [k, profSchema])),
            required: [...ABILITY_KEYS],
          },
          skills: {
            type: "object",
            properties: Object.fromEntries(SKILL_KEYS.map(k => [k, skillSchema])),
            required: [...SKILL_KEYS],
          },
        },
        required: ["saves", "skills"],
      };
    },

    buildPrompt(context, _docType, prior = {}) {
      const name = prior.name ?? "unnamed";
      const cr = prior.system?.details?.cr ?? "unknown";
      const type = prior.system?.details?.type?.value ?? "unknown";

      const abs = prior.system?.abilities ?? {};
      const abStr = ABILITY_KEYS.map(k => `${k.toUpperCase()} ${abs[k]?.value ?? "?"}`).join(", ");

      return [
        `You are a D&D 5e assistant. Choose saving throw and skill proficiencies for an NPC.`,
        ``,
        `GM description: "${context}"`,
        `Creature: "${name}", CR ${cr}, ${type}`,
        `Ability scores: ${abStr}`,
        ``,
        `saves: 0 = not proficient, 1 = proficient. Most creatures have 2–3 save proficiencies.`,
        `skills: 0 = not proficient, 1 = proficient, 2 = expertise. Most creatures have 2–4 skill proficiencies.`,
        ``,
        `Skill keys: acr (Acrobatics), ani (Animal Handling), arc (Arcana), ath (Athletics),`,
        `dec (Deception), his (History), ins (Insight), itm (Intimidation), inv (Investigation),`,
        `med (Medicine), nat (Nature), prc (Perception), prf (Performance), per (Persuasion),`,
        `rel (Religion), slt (Sleight of Hand), ste (Stealth), sur (Survival)`,
        ``,
        `Return JSON with ALL keys set to 0 or 1/2:`,
        `{ "saves": { "str": 0, "dex": 1, "con": 1, "int": 0, "wis": 0, "cha": 0 },`,
        `  "skills": { "acr": 0, "ani": 0, "arc": 0, "ath": 1, "dec": 0, "his": 0, "ins": 0, "itm": 1, "inv": 0, "med": 0, "nat": 0, "prc": 1, "prf": 0, "per": 0, "rel": 0, "slt": 0, "ste": 0, "sur": 0 } }`,
      ].join("\n");
    },

    mapResult(result) {
      const update = { system: { abilities: {}, skills: {} } };
      const saves = result.saves ?? {};
      for (const k of ABILITY_KEYS) {
        update.system.abilities[k] = { proficient: saves[k] ?? 0 };
      }
      const skills = result.skills ?? {};
      for (const k of SKILL_KEYS) {
        update.system.skills[k] = { value: skills[k] ?? 0 };
      }
      return update;
    },
  },

  // ---- Wave 4b — Senses & Languages ---------------------------------------

  sensesLanguages: {
    label: "Generating senses & languages…",

    schema() {
      return {
        type: "object",
        properties: {
          darkvision: { type: "integer" },
          blindsight: { type: "integer" },
          tremorsense: { type: "integer" },
          truesight: { type: "integer" },
          languages: { type: "array", items: { type: "string", enum: ALL_LANGUAGES } },
          customLanguages: { type: "string" },
        },
        required: ["darkvision", "blindsight", "tremorsense", "truesight", "languages"],
      };
    },

    buildPrompt(context, _docType, prior = {}) {
      const name = prior.name ?? "unnamed";
      const type = prior.system?.details?.type?.value ?? "unknown";

      return [
        `You are a D&D 5e assistant. Determine senses and languages for an NPC.`,
        ``,
        `GM description: "${context}"`,
        `Creature: "${name}", ${type}`,
        ``,
        `Senses: range in feet, 0 if none.`,
        `- Most undead/fiends: darkvision 60 or 120`,
        `- Beasts: may have blindsight or tremorsense`,
        `- Humanoids: usually no special senses (all 0)`,
        ``,
        `Languages: pick ONLY the 1–3 languages that make sense for this creature.`,
        `- Almost all intelligent creatures speak "common" — always include it unless the creature cannot speak or has no reason to know it.`,
        `- Humanoids: "common" plus maybe one racial language (e.g. "elvish", "dwarvish")`,
        `- Fiends: "common" + "abyssal" or "infernal"`,
        `- Undead: whatever languages they knew in life — usually "common"`,
        `- Beasts/oozes/plants: empty array [] — they do not speak`,
        `Do NOT select all languages. Be selective and realistic.`,
        ``,
        `Standard: ${STANDARD_LANGUAGES.join(", ")}`,
        `Exotic: ${EXOTIC_LANGUAGES.join(", ")}`,
        `customLanguages: semicolon-separated for non-standard (e.g. "Telepathy 60 ft."). Empty string if none.`,
        ``,
        `Return JSON: { "darkvision": 0, "blindsight": 0, "tremorsense": 0, "truesight": 0, "languages": ["common"], "customLanguages": "" }`,
      ].join("\n");
    },

    mapResult(result, _docType, prior = {}) {
      // Beasts, oozes, and plants cannot speak
      const noSpeech = ["beast", "ooze", "plant"];
      const creatureType = prior.system?.details?.type?.value;
      const languages = noSpeech.includes(creatureType) ? [] : (result.languages ?? ["common"]);
      const custom = noSpeech.includes(creatureType) ? "" : (result.customLanguages ?? "");

      return {
        system: {
          attributes: {
            senses: {
              ranges: {
                darkvision: result.darkvision ?? 0,
                blindsight: result.blindsight ?? 0,
                tremorsense: result.tremorsense ?? 0,
                truesight: result.truesight ?? 0,
              },
            },
          },
          traits: {
            languages: {
              value: languages,
              custom,
            },
          },
        },
      };
    },
  },

  // ---- Wave 5 — Description -----------------------------------------------

  description: {
    label: "Generating description…",

    schema() {
      return {
        type: "object",
        properties: {
          biography: { type: "string" },
        },
        required: ["biography"],
      };
    },

    buildPrompt(context, _docType, prior = {}) {
      const name = prior.name ?? "unnamed creature";
      const type = prior.system?.details?.type?.value ?? "unknown";
      const cr = prior.system?.details?.cr ?? "unknown";
      const size = prior.system?.traits?.size ?? "unknown";

      return [
        `You are a D&D 5e assistant writing NPC flavor text.`,
        ``,
        `GM description: "${context}"`,
        `Creature: "${name}", CR ${cr}, ${size} ${type}`,
        ``,
        `Write 3–5 sentences covering appearance, personality, and a hint of backstory.`,
        `Use the style of a D&D Monster Manual entry.`,
        `Wrap in <p> tags — one per paragraph, 2 paragraphs max.`,
        ``,
        `Return JSON: { "biography": "<p>First paragraph about appearance.</p><p>Second paragraph about personality and lore.</p>" }`,
      ].join("\n");
    },

    mapResult(result) {
      return {
        system: {
          details: {
            biography: { value: result.biography ?? "" },
          },
        },
      };
    },
  },
};
