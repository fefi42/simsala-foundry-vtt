import { OllamaService } from "./OllamaService.js";
import { CatalogRegistry } from "./catalog.js";

const MODULE_ID = "simsala";
const CREATURE_INDEX_PATH = `modules/${MODULE_ID}/data/creature-index.json`;

let creatureIndex = null;

/**
 * Load the static creature index from JSON.
 * Called once on module ready.
 */
export async function loadCreatureIndex() {
  try {
    const resp = await fetch(CREATURE_INDEX_PATH);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    creatureIndex = await resp.json();
    console.log(`[simsala] Loaded creature index: ${creatureIndex.length} creatures`);
  } catch (err) {
    console.warn(`[simsala] Failed to load creature index:`, err.message);
    creatureIndex = [];
  }
}

/**
 * Format the creature index as a text list for the LLM prompt.
 * Format: "- Name — CR X, type: Y, size: Z\n  Description"
 */
function formatCreatureList(creatures) {
  return creatures
    .map(c => `- ${c.name} — CR ${c.cr}, type: ${c.type}, size: ${c.size}\n  ${c.summary}`)
    .join("\n");
}

// --- Step 1a: Classify creature type ---

const CREATURE_TYPES = [
  "aberration", "beast", "celestial", "construct", "dragon",
  "elemental", "fey", "fiend", "giant", "humanoid",
  "monstrosity", "ooze", "plant", "undead",
];

const TYPE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: CREATURE_TYPES },
    reason: { type: "string" },
  },
  required: ["type"],
};

async function classifyCreatureType(description) {
  const typeList = CREATURE_TYPES.map(t => `- ${t}`).join("\n");

  const prompt = `You are a D&D 5e assistant. What creature type best fits this description?

GM description: "${description}"

Available creature types:
${typeList}

Rules:
- Any person, soldier, guard, bandit, mage, priest, or named human/elf/dwarf/etc. is "humanoid"
- Only pick "dragon" if the description explicitly mentions a dragon or drake
- Only pick "undead" if the description mentions undead, skeleton, zombie, vampire, ghost, etc.
- Only pick "beast" for natural animals (wolf, bear, horse, etc.)
- When in doubt, pick "humanoid" — most NPCs are humanoids

Return JSON: { "type": "humanoid", "reason": "it is a human soldier" }`;

  const { parsed } = await OllamaService.generate(
    [{ role: "user", content: prompt }],
    TYPE_SCHEMA,
    -1,
  );

  if (!parsed?.type || !CREATURE_TYPES.includes(parsed.type)) {
    console.warn(`[simsala] Type classification failed, defaulting to humanoid`);
    return "humanoid";
  }

  console.log(`[simsala] Classified as: ${parsed.type} (${parsed.reason})`);
  return parsed.type;
}

// --- Step 1b: Pick base creature from filtered list ---

const PICK_SCHEMA = {
  type: "object",
  properties: {
    creature: { type: "string" },
    reason: { type: "string" },
  },
  required: ["creature"],
};

async function pickBaseCreature(description, creatureType) {
  if (!creatureIndex?.length) {
    throw new Error("Creature index not loaded.");
  }

  const filtered = creatureIndex.filter(c => c.type === creatureType);
  if (!filtered.length) {
    throw new Error(`No creatures of type "${creatureType}" in index.`);
  }

  const creatureList = formatCreatureList(filtered);

  const prompt = `You are a D&D 5e assistant. Pick the creature that best serves as a base for the GM's description.

GM description: "${description}"

Available ${creatureType} creatures (CR = challenge rating / power level):
${creatureList}

The chosen creature's stats will be kept as-is — only the name, biography, and 0-2 items will change.
Pick the creature whose combat role and CR best match the description.

Return JSON: { "creature": "Exact Name", "reason": "why this is the best match" }`;

  const { parsed } = await OllamaService.generate(
    [{ role: "user", content: prompt }],
    PICK_SCHEMA,
    -1,
  );

  if (!parsed?.creature) {
    throw new Error("LLM did not return a creature pick.");
  }

  // Find in filtered list (case-insensitive)
  const match = filtered.find(
    c => c.name.toLowerCase() === parsed.creature.toLowerCase().trim(),
  );

  if (!match) {
    // Fall back to full index in case of minor type mismatch
    const fallback = creatureIndex.find(
      c => c.name.toLowerCase() === parsed.creature.toLowerCase().trim(),
    );
    if (fallback) {
      console.warn(`[simsala] LLM picked "${fallback.name}" (${fallback.type}) outside filtered type "${creatureType}"`);
      return fallback;
    }
    throw new Error(`LLM picked "${parsed.creature}" which is not in the creature index.`);
  }

  console.log(`[simsala] Picked base creature: ${match.name} (${parsed.reason})`);
  return match;
}

// --- Step 2: Load creature from compendium ---

async function loadFromCompendium(creatureName) {
  const pack = game.packs.get("dnd5e.monsters");
  if (!pack) throw new Error('Compendium "dnd5e.monsters" not found.');

  const index = await pack.getIndex();
  const entry = index.find(
    e => e.name.toLowerCase() === creatureName.toLowerCase(),
  );

  if (!entry) {
    throw new Error(`"${creatureName}" not found in dnd5e.monsters compendium.`);
  }

  const doc = await pack.getDocument(entry._id);
  return doc.toObject();
}

// --- Step 3: LLM re-flavor ---

const REFLAVOR_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    biography: { type: "string" },
    removeItems: {
      type: "array",
      items: { type: "string" },
    },
    addItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          source: {
            type: "string",
            enum: ["dnd5e.items", "dnd5e.spells", "dnd5e.monsterfeatures"],
          },
        },
        required: ["name", "source"],
      },
    },
  },
  required: ["name", "biography"],
};

async function reflavorCreature(description, baseData) {
  const itemNames = (baseData.items ?? []).map(i => i.name).join(", ");

  const prompt = `You are a D&D 5e assistant. Re-flavor this base creature to match the GM's description.

GM description: "${description}"
Base creature: "${baseData.name}" (CR ${baseData.system.details.cr}, ${baseData.system.details.type.value})
Current items: ${itemNames}

Make light adjustments:
- New name fitting the description
- Short biography paragraph (2-3 sentences, appearance and personality)
- Optionally swap 0-2 items to better fit the theme
  - removeItems: names of items to remove (must match current items exactly)
  - addItems: items to add from compendium (name + source pack)
    Sources: "dnd5e.items" (weapons/armor), "dnd5e.spells", "dnd5e.monsterfeatures"

Keep the creature mechanically similar. Do NOT change stats, HP, AC, or CR.
Only swap items if thematically important (e.g. scimitar → rapier for a pirate).

Return JSON: { "name": "...", "biography": "...", "removeItems": [...], "addItems": [...] }`;

  const { parsed } = await OllamaService.generate(
    [{ role: "user", content: prompt }],
    REFLAVOR_SCHEMA,
    -1,
  );

  if (!parsed?.name) {
    throw new Error("LLM did not return a valid re-flavor result.");
  }

  return parsed;
}

// --- Step 4: Apply modifications ---

async function applyModifications(baseData, reflavor) {
  // Build actor update from base data
  const actorUpdate = {
    name: reflavor.name,
    system: foundry.utils.deepClone(baseData.system),
  };
  actorUpdate.system.details.biography = {
    value: `<p>${reflavor.biography}</p>`,
  };

  // Start with all base items
  let items = [...(baseData.items ?? [])];

  // Remove items by name
  if (reflavor.removeItems?.length) {
    const removeNames = new Set(reflavor.removeItems.map(n => n.toLowerCase()));
    const before = items.length;
    items = items.filter(i => !removeNames.has(i.name.toLowerCase()));
    const removed = before - items.length;
    if (removed > 0) {
      console.log(`[simsala] Removed ${removed} item(s): ${reflavor.removeItems.join(", ")}`);
    }
  }

  // Add items from compendium
  if (reflavor.addItems?.length) {
    for (const add of reflavor.addItems) {
      const resolved = await CatalogRegistry.resolveItems([add.name], add.source);
      items.push(...resolved);
    }
  }

  return { actorUpdate, embeddedItems: items };
}

// --- Main pipeline ---

/**
 * Run the full NPC generation pipeline:
 * 1. LLM picks a base creature
 * 2. Load it from compendium
 * 3. LLM re-flavors (name, bio, item swaps)
 * 4. Apply modifications
 *
 * @param {string} description - GM's description of the desired NPC
 * @param {Function} setStatus - Callback to update UI status label
 * @returns {{ actorUpdate: object, embeddedItems: object[] }}
 */
export async function generateNpc(description, setStatus) {
  // Step 1a: Classify creature type
  setStatus("Classifying creature type…");
  const creatureType = await classifyCreatureType(description);

  // Step 1b: Pick base creature from filtered list
  setStatus("Picking base creature…");
  const picked = await pickBaseCreature(description, creatureType);

  // Step 2: Load from compendium
  setStatus(`Loading ${picked.name}…`);
  const baseData = await loadFromCompendium(picked.name);

  // Step 3: Re-flavor
  setStatus("Re-flavoring…");
  const reflavor = await reflavorCreature(description, baseData);

  // Step 4: Apply modifications
  setStatus("Applying modifications…");
  const result = await applyModifications(baseData, reflavor);

  // Unload model from GPU
  try { await OllamaService.generate([], {}, 0); } catch { /* ignore */ }

  // Log summary
  console.log(`[simsala] Generated NPC: "${reflavor.name}" based on "${picked.name}"`);

  return {
    actorUpdate: result.actorUpdate,
    embeddedItems: result.embeddedItems,
    baseName: picked.name,
    reason: picked.reason,
  };
}
