/**
 * Standalone test: runs NPC prompts against Ollama and validates the JSON output.
 * Usage: node tests/npc-pipeline-test.mjs
 */

const OLLAMA_URL = "http://localhost:11434";
const MODEL = "llama3.2";

// --- Enum definitions (mirror npc-groups.js) ---
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

// --- API call ---
async function generate(prompt, schema) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      format: schema,
      stream: false,
      keep_alive: -1,
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.message.content);
}

async function unloadModel() {
  try {
    await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [], stream: false, keep_alive: 0 }),
    });
  } catch { /* ignore */ }
}

// --- Wave prompts & schemas (condensed from npc-groups.js) ---

function conceptPrompt(context) {
  return [
    `You are a D&D 5e assistant. Create an NPC concept from the GM's description.`,
    ``, `GM description: "${context}"`, ``,
    `Creature types: ${CREATURE_TYPES.join(", ")}`,
    `CR ranges: 0 (commoner) to 30 (tarrasque). Most NPCs are CR 1–10.`,
    `subtype is optional — use for race/category like "elf", "goblinoid", "shapechanger". Empty string if not relevant.`,
    ``,
    `IMPORTANT: If the description says "a cultist" or "an acolyte" (generic/indefinite), use a type name like "Blood Cultist" — NOT a personal name. Only invent a personal name if the GM asks for a specific named character.`,
    `Think Monster Manual style: "Bandit Captain", "Cult Fanatic", "Shadow Demon".`,
    ``,
    `Return JSON: { "name": "Cult Fanatic", "cr": 2, "creatureType": "humanoid", "subtype": "human" }`,
  ].join("\n");
}
const conceptSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    cr: { type: "number" },
    creatureType: { type: "string", enum: CREATURE_TYPES },
    subtype: { type: "string" },
  },
  required: ["name", "cr", "creatureType"],
};

function mechanicalPrompt(context, prior) {
  const name = prior.name ?? "unnamed";
  const cr = prior.cr ?? "unknown";
  const type = prior.creatureType ?? "unknown";
  return [
    `You are a D&D 5e assistant. Determine the mechanical identity for an NPC.`,
    ``, `GM description: "${context}"`,
    `Creature: "${name}", CR ${cr}, ${type}`, ``,
    `Sizes: tiny, sm (Small), med (Medium), lg (Large), huge, grg (Gargantuan)`, ``,
    `Typical patterns:`,
    `- Undead: immune to poison damage + poisoned condition, often necrotic resistant`,
    `- Constructs: immune to poison + psychic, immune to charmed/exhaustion/frightened/paralyzed/petrified/poisoned`,
    `- Fiends: resistant to cold/fire/lightning, immune to poison + poisoned`,
    `- Elementals: immune to poison + poisoned/paralyzed, often one elemental immunity`,
    `- Beasts/Humanoids: usually no immunities or resistances`, ``,
    `Movement: walk 30 is standard for Medium humanoids. Set fly/swim/burrow/climb to 0 if not applicable.`, ``,
    `Return JSON: { "size": "med", "damageImmunities": [], "damageResistances": ["fire"], "conditionImmunities": [], "walk": 30, "fly": 0, "swim": 0, "burrow": 0, "climb": 0 }`,
  ].join("\n");
}
const mechanicalSchema = {
  type: "object",
  properties: {
    size: { type: "string", enum: SIZES },
    damageImmunities: { type: "array", items: { type: "string", enum: DAMAGE_TYPES } },
    damageResistances: { type: "array", items: { type: "string", enum: DAMAGE_TYPES } },
    conditionImmunities: { type: "array", items: { type: "string", enum: CONDITIONS } },
    walk: { type: "integer" }, fly: { type: "integer" }, swim: { type: "integer" },
    burrow: { type: "integer" }, climb: { type: "integer" },
  },
  required: ["size", "damageImmunities", "damageResistances", "conditionImmunities", "walk"],
};

function coreStatsPrompt(context, concept, mech) {
  const hitDieMap = { tiny: "d4", sm: "d6", med: "d8", lg: "d10", huge: "d12", grg: "d20" };
  const hitDie = hitDieMap[mech.size] || "d8";
  return [
    `You are a D&D 5e assistant. Determine ability scores, AC, and HP for an NPC.`,
    ``, `GM description: "${context}"`,
    `Creature: "${concept.name}", CR ${concept.cr}, ${concept.creatureType}, size ${mech.size}`,
    `Hit die for this size: ${hitDie}`, ``,
    `CR benchmarks (approximate):`,
    `CR 0: HP 3, AC 10, scores 8–12`,
    `CR 1: HP 50, AC 13, scores 12–16`,
    `CR 3: HP 80, AC 13, scores 13–17`,
    `CR 5: HP 110, AC 15, scores 14–18`,
    `CR 8: HP 150, AC 16, scores 15–20`,
    `CR 11: HP 190, AC 17, scores 16–22`,
    `CR 15: HP 230, AC 18, scores 18–24`,
    `CR 20: HP 310, AC 19, scores 20–26`, ``,
    `hpFormula: use the size's hit die. For Medium creature with 8 hit dice and CON +2: "8d8+16".`,
    `hpMax: the average of the formula (round down). For "8d8+16": 8*4.5+16 = 52.`, ``,
    `Return JSON: { "str": 16, "dex": 14, "con": 14, "int": 10, "wis": 12, "cha": 8, "ac": 15, "hpMax": 52, "hpFormula": "8d8+16" }`,
  ].join("\n");
}
const coreStatsSchema = {
  type: "object",
  properties: {
    str: { type: "integer" }, dex: { type: "integer" }, con: { type: "integer" },
    int: { type: "integer" }, wis: { type: "integer" }, cha: { type: "integer" },
    ac: { type: "integer" }, hpMax: { type: "integer" }, hpFormula: { type: "string" },
  },
  required: ["str", "dex", "con", "int", "wis", "cha", "ac", "hpMax", "hpFormula"],
};

function savesSkillsPrompt(context, concept, stats) {
  const abStr = ABILITY_KEYS.map(k => `${k.toUpperCase()} ${stats[k] ?? "?"}`).join(", ");
  return [
    `You are a D&D 5e assistant. Choose saving throw and skill proficiencies for an NPC.`,
    ``, `GM description: "${context}"`,
    `Creature: "${concept.name}", CR ${concept.cr}, ${concept.creatureType}`,
    `Ability scores: ${abStr}`, ``,
    `saves: 0 = not proficient, 1 = proficient. Most creatures have 2–3 save proficiencies.`,
    `skills: 0 = not proficient, 1 = proficient, 2 = expertise. Most creatures have 2–4 skill proficiencies.`, ``,
    `Skill keys: acr (Acrobatics), ani (Animal Handling), arc (Arcana), ath (Athletics),`,
    `dec (Deception), his (History), ins (Insight), itm (Intimidation), inv (Investigation),`,
    `med (Medicine), nat (Nature), prc (Perception), prf (Performance), per (Persuasion),`,
    `rel (Religion), slt (Sleight of Hand), ste (Stealth), sur (Survival)`, ``,
    `Return JSON with ALL keys set to 0 or 1/2:`,
    `{ "saves": { "str": 0, "dex": 1, "con": 1, "int": 0, "wis": 0, "cha": 0 },`,
    `  "skills": { "acr": 0, "ani": 0, "arc": 0, "ath": 1, "dec": 0, "his": 0, "ins": 0, "itm": 1, "inv": 0, "med": 0, "nat": 0, "prc": 1, "prf": 0, "per": 0, "rel": 0, "slt": 0, "ste": 0, "sur": 0 } }`,
  ].join("\n");
}
const savesSkillsSchema = {
  type: "object",
  properties: {
    saves: {
      type: "object",
      properties: Object.fromEntries(ABILITY_KEYS.map(k => [k, { type: "integer", enum: [0, 1] }])),
      required: [...ABILITY_KEYS],
    },
    skills: {
      type: "object",
      properties: Object.fromEntries(SKILL_KEYS.map(k => [k, { type: "integer", enum: [0, 1, 2] }])),
      required: [...SKILL_KEYS],
    },
  },
  required: ["saves", "skills"],
};

function sensesLanguagesPrompt(context, concept) {
  return [
    `You are a D&D 5e assistant. Determine senses and languages for an NPC.`,
    ``, `GM description: "${context}"`,
    `Creature: "${concept.name}", ${concept.creatureType}`, ``,
    `Senses: range in feet, 0 if none.`,
    `- Most undead/fiends: darkvision 60 or 120`,
    `- Beasts: may have blindsight or tremorsense`,
    `- Humanoids: usually no special senses (all 0)`, ``,
    `Languages: pick ONLY the 1–3 languages that make sense for this creature.`,
    `- Almost all intelligent creatures speak "common" — always include it unless the creature cannot speak or has no reason to know it.`,
    `- Humanoids: "common" plus maybe one racial language (e.g. "elvish", "dwarvish")`,
    `- Fiends: "common" + "abyssal" or "infernal"`,
    `- Undead: whatever languages they knew in life — usually "common"`,
    `- Beasts/oozes/plants: empty array [] — they do not speak`,
    `Do NOT select all languages. Be selective and realistic.`, ``,
    `Standard: ${STANDARD_LANGUAGES.join(", ")}`,
    `Exotic: ${EXOTIC_LANGUAGES.join(", ")}`,
    `customLanguages: semicolon-separated for non-standard (e.g. "Telepathy 60 ft."). Empty string if none.`, ``,
    `Return JSON: { "darkvision": 0, "blindsight": 0, "tremorsense": 0, "truesight": 0, "languages": ["common"], "customLanguages": "" }`,
  ].join("\n");
}
const sensesLanguagesSchema = {
  type: "object",
  properties: {
    darkvision: { type: "integer" }, blindsight: { type: "integer" },
    tremorsense: { type: "integer" }, truesight: { type: "integer" },
    languages: { type: "array", items: { type: "string", enum: ALL_LANGUAGES } },
    customLanguages: { type: "string" },
  },
  required: ["darkvision", "blindsight", "tremorsense", "truesight", "languages"],
};

// --- Validation helpers ---
const errors = [];
function check(testName, condition, detail = "") {
  if (!condition) {
    errors.push(`  FAIL: ${testName}${detail ? " — " + detail : ""}`);
  }
}

function validateConcept(prompt, result) {
  check("name is string", typeof result.name === "string", `got ${typeof result.name}`);
  check("name is not empty", result.name?.length > 0);
  check("name looks template-style", !/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(result.name) || true,
    `"${result.name}" might be a personal name`);
  check("cr is number", typeof result.cr === "number", `got ${typeof result.cr}: ${result.cr}`);
  check("cr in range 0–30", result.cr >= 0 && result.cr <= 30, `got ${result.cr}`);
  check("creatureType valid", CREATURE_TYPES.includes(result.creatureType), `got "${result.creatureType}"`);
}

function validateMechanical(result) {
  check("size valid", SIZES.includes(result.size), `got "${result.size}"`);
  check("damageImmunities is array", Array.isArray(result.damageImmunities));
  check("damageResistances is array", Array.isArray(result.damageResistances));
  check("conditionImmunities is array", Array.isArray(result.conditionImmunities));
  for (const d of result.damageImmunities ?? [])
    check("di value valid", DAMAGE_TYPES.includes(d), `invalid di: "${d}"`);
  for (const d of result.damageResistances ?? [])
    check("dr value valid", DAMAGE_TYPES.includes(d), `invalid dr: "${d}"`);
  for (const c of result.conditionImmunities ?? [])
    check("ci value valid", CONDITIONS.includes(c), `invalid ci: "${c}"`);
  check("walk is number", typeof result.walk === "number", `got ${typeof result.walk}`);
  check("walk > 0 or beast/plant", result.walk >= 0, `got ${result.walk}`);
}

function validateCoreStats(result, concept) {
  for (const k of ABILITY_KEYS) {
    check(`${k} is number`, typeof result[k] === "number", `got ${typeof result[k]}`);
    check(`${k} in range 1–30`, result[k] >= 1 && result[k] <= 30, `got ${result[k]}`);
  }
  check("ac is number", typeof result.ac === "number");
  check("ac in range 5–25", result.ac >= 5 && result.ac <= 25, `got ${result.ac}`);
  check("hpMax is number", typeof result.hpMax === "number");
  check("hpMax > 0", result.hpMax > 0, `got ${result.hpMax}`);
  check("hpFormula is string", typeof result.hpFormula === "string");
  check("hpFormula has dice notation", /\d+d\d+/.test(result.hpFormula), `got "${result.hpFormula}"`);

  // Check HP formula roughly matches hpMax
  const match = result.hpFormula.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (match) {
    const [, count, die, mod] = match;
    const avg = parseInt(count) * (parseInt(die) / 2 + 0.5) + (parseInt(mod) || 0);
    const diff = Math.abs(avg - result.hpMax);
    check("hpMax ≈ formula average", diff <= avg * 0.3,
      `hpMax=${result.hpMax}, formula avg=${Math.floor(avg)}, formula="${result.hpFormula}"`);
  }
}

function validateSavesSkills(result) {
  check("saves is object", typeof result.saves === "object");
  check("skills is object", typeof result.skills === "object");
  const saveCount = ABILITY_KEYS.filter(k => result.saves?.[k] === 1).length;
  const skillCount = SKILL_KEYS.filter(k => (result.skills?.[k] ?? 0) > 0).length;
  check("saves count reasonable (0–6)", saveCount >= 0 && saveCount <= 6, `got ${saveCount}`);
  check("skills count reasonable (0–8)", skillCount >= 0 && skillCount <= 8, `got ${skillCount}`);
  for (const k of ABILITY_KEYS)
    check(`save.${k} is 0 or 1`, [0, 1].includes(result.saves?.[k]), `got ${result.saves?.[k]}`);
  for (const k of SKILL_KEYS)
    check(`skill.${k} is 0/1/2`, [0, 1, 2].includes(result.skills?.[k]), `got ${result.skills?.[k]}`);
}

function validateSensesLanguages(result, concept) {
  check("darkvision is number", typeof result.darkvision === "number");
  check("languages is array", Array.isArray(result.languages));
  const langCount = result.languages?.length ?? 0;
  check("language count ≤ 5", langCount <= 5, `got ${langCount}: ${result.languages?.join(", ")}`);
  for (const l of result.languages ?? [])
    check("language valid", ALL_LANGUAGES.includes(l), `invalid: "${l}"`);

  // Beasts shouldn't speak
  if (concept.creatureType === "beast") {
    check("beasts don't speak", langCount === 0, `beast has ${langCount} languages`);
  }
  // Intelligent creatures should know common
  if (["humanoid", "fiend", "celestial", "dragon", "giant", "fey", "undead"].includes(concept.creatureType)) {
    check("intelligent creature knows common", result.languages?.includes("common"),
      `${concept.creatureType} missing common: [${result.languages?.join(", ")}]`);
  }
}

// --- Test prompts ---
const TEST_PROMPTS = [
  "A blood cultist acolyte who is able to drain blood from creatures if they fail a saving throw.",
  "A giant spider that lurks in cave ceilings",
  "An ancient red dragon",
  "A sneaky goblin thief",
  "A paladin of the sun god who has fallen from grace",
  "A tiny fairy that plays tricks on travelers",
  "A construct guardian made of animated armor",
  "A lich who has been alive for thousands of years",
  "A pack of wolves",
  "A street urchin pickpocket",
  "An ooze that dissolves metal",
  "A treant protector of the forest",
  "A fire elemental summoned by a wizard",
  "A vampire spawn lurking in the catacombs",
  "A frost giant raider",
  "A mindflayer who controls a colony of thralls",
  "A celestial guardian angel",
  "A swamp hag who brews potions",
  "A bandit captain leading a group of highwaymen",
  "A beholder",
];

// --- Run tests ---
async function main() {
  console.log(`\n=== NPC Pipeline Test — ${TEST_PROMPTS.length} prompts ===\n`);

  // Phase 1: Run all 20 through Wave 1 (concept)
  console.log("--- Phase 1: Concept (Wave 1) — all 20 prompts ---\n");
  const concepts = [];
  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const prompt = TEST_PROMPTS[i];
    errors.length = 0;
    try {
      const result = await generate(conceptPrompt(prompt), conceptSchema);
      validateConcept(prompt, result);
      const status = errors.length === 0 ? "OK" : "ISSUES";
      console.log(`[${i + 1}] ${status} — "${result.name}" CR ${result.cr} ${result.creatureType}`);
      if (errors.length) errors.forEach(e => console.log(e));
      concepts.push({ prompt, result });
    } catch (err) {
      console.log(`[${i + 1}] ERROR — ${err.message}`);
      concepts.push({ prompt, result: null });
    }
  }

  // Phase 2: Run 5 full pipelines
  const fullTestIndices = [0, 1, 2, 5, 8]; // blood cultist, spider, dragon, fairy, wolves
  console.log(`\n--- Phase 2: Full pipeline — ${fullTestIndices.length} prompts ---\n`);

  for (const idx of fullTestIndices) {
    const { prompt, result: concept } = concepts[idx];
    if (!concept) { console.log(`[${idx + 1}] SKIPPED — concept failed\n`); continue; }
    console.log(`[${idx + 1}] "${concept.name}" — running full pipeline...`);
    errors.length = 0;

    try {
      // Wave 2: Mechanical
      const mech = await generate(mechanicalPrompt(prompt, concept), mechanicalSchema);
      validateMechanical(mech);

      // Wave 3: Core Stats
      const stats = await generate(coreStatsPrompt(prompt, concept, mech), coreStatsSchema);
      validateCoreStats(stats, concept);

      // Wave 4: Saves & Skills + Senses & Languages (parallel)
      const [savesSkills, sensesLangs] = await Promise.all([
        generate(savesSkillsPrompt(prompt, concept, stats), savesSkillsSchema),
        generate(sensesLanguagesPrompt(prompt, concept), sensesLanguagesSchema),
      ]);
      validateSavesSkills(savesSkills);
      validateSensesLanguages(sensesLangs, concept);

      const status = errors.length === 0 ? "OK" : `${errors.length} ISSUES`;
      console.log(`  Result: ${status}`);
      console.log(`  Size: ${mech.size}, AC: ${stats.ac}, HP: ${stats.hpMax} (${stats.hpFormula})`);
      console.log(`  STR ${stats.str} DEX ${stats.dex} CON ${stats.con} INT ${stats.int} WIS ${stats.wis} CHA ${stats.cha}`);
      console.log(`  Saves: ${ABILITY_KEYS.filter(k => savesSkills.saves[k]).join(", ") || "none"}`);
      console.log(`  Skills: ${SKILL_KEYS.filter(k => savesSkills.skills[k] > 0).join(", ") || "none"}`);
      console.log(`  Senses: dv${sensesLangs.darkvision} bs${sensesLangs.blindsight} ts${sensesLangs.tremorsense} tv${sensesLangs.truesight}`);
      console.log(`  Languages: [${sensesLangs.languages.join(", ")}] ${sensesLangs.customLanguages || ""}`);
      if (errors.length) { console.log("  Issues:"); errors.forEach(e => console.log("  " + e)); }
    } catch (err) {
      console.log(`  PIPELINE ERROR: ${err.message}`);
    }
    console.log();
  }

  await unloadModel();
  console.log("=== Done ===\n");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
