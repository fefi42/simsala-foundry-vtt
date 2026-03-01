import { OllamaService } from "./OllamaService.js";
import { CatalogRegistry } from "./catalog.js";

/**
 * LLM-driven map-reduce pipeline for selecting abilities from the catalog.
 *
 * Three steps:
 * 1. Map — LLM picks which thematic groups to explore (sees only group descriptions)
 * 2. Explore — parallel LLM calls per group, each returns 3 candidates (sees item names/summaries)
 * 3. Reduce — LLM makes final selection from all candidates, respects CR limits
 *
 * This pattern keeps prompt size bounded regardless of catalog size — the LLM
 * never sees the full item list, only the slice it asked for.
 */

/**
 * Build a short NPC context string for inclusion in all prompts.
 */
function buildNpcContext(context, prior) {
  const name = prior.name ?? "unnamed";
  const cr = prior.system?.details?.cr ?? "?";
  const type = prior.system?.details?.type?.value ?? "unknown";
  const size = prior.system?.traits?.size ?? "med";
  const abilities = prior.system?.abilities ?? {};

  const abStr = ["str", "dex", "con", "int", "wis", "cha"]
    .map(k => `${k.toUpperCase()} ${abilities[k]?.value ?? "?"}`)
    .join(", ");

  const attacks = prior._embeddedSummary ?? "none yet";

  return [
    `NPC: "${name}", CR ${cr}, ${size} ${type}`,
    `Abilities: ${abStr}`,
    `Attacks: ${attacks}`,
    `GM description: "${context}"`,
  ].join("\n");
}

// Equipment group IDs — injected programmatically for humanoids so the LLM
// only needs to decide on abilities/spells (it's unreliable at picking equipment).
const EQUIPMENT_GROUP_IDS = new Set([
  "weapon-simple-melee", "weapon-simple-ranged",
  "weapon-martial-melee", "weapon-martial-ranged",
  "armor-light", "armor-medium", "armor-heavy", "shield",
]);

/**
 * Step 1 — Map: select which catalog groups to explore.
 *
 * For humanoids, equipment groups are always injected (the LLM only picks
 * abilities/spells). For other creature types, equipment is excluded entirely.
 */
async function selectGroups(context, prior) {
  const groupIndex = CatalogRegistry.getGroupIndex();
  if (!groupIndex.length) return [];

  const creatureType = prior?.system?.details?.type?.value;
  const isHumanoid = creatureType === "humanoid";

  // Split groups: equipment handled programmatically, rest by LLM
  const llmGroups = groupIndex.filter(g => !EQUIPMENT_GROUP_IDS.has(g.id));
  const equipGroups = groupIndex.filter(g => EQUIPMENT_GROUP_IDS.has(g.id));

  const groupList = llmGroups
    .map(g => `- ${g.id}: ${g.description} (${g.itemCount} items)`)
    .join("\n");

  const prompt = [
    `You are a D&D 5e assistant. Choose which ability groups to explore for this NPC.`,
    ``,
    buildNpcContext(context, prior),
    ``,
    `Available groups:`,
    groupList,
    ``,
    `Select 2–6 groups that fit this creature thematically and mechanically.`,
    `For each group, optionally provide a refinement prompt to narrow the search`,
    `(e.g. "fire-themed only" or "levels 1-3 only"). Empty string if no refinement needed.`,
    ``,
    `Consider:`,
    `- Beasts typically need only passive-combat and passive-sensory, no spells`,
    `- Spellcasters need damage spells + defense spells + possibly buff/debuff`,
    `- Dragons need breath weapons + legendary actions + passive-defense`,
    `- Undead often need passive-defense + damage-necrotic-poison`,
    `- Low CR creatures (0-2) need fewer groups, high CR (15+) need more`,
    ``,
    `Return JSON: { "selectedGroups": [{ "groupId": "...", "refinement": "..." }] }`,
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      selectedGroups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            groupId: { type: "string" },
            refinement: { type: "string" },
          },
          required: ["groupId", "refinement"],
        },
      },
    },
    required: ["selectedGroups"],
  };

  const { parsed } = await OllamaService.generate(
    [{ role: "user", content: prompt }], schema, -1,
  );

  // Filter LLM picks to valid non-equipment group IDs
  const validIds = new Set(llmGroups.map(g => g.id));
  const llmPicks = (parsed?.selectedGroups ?? []).filter(g => validIds.has(g.groupId));

  // For humanoids: always inject all equipment groups so the explore step
  // can pick the right weapons and armor for their role.
  if (isHumanoid && equipGroups.length) {
    const equipPicks = equipGroups.map(g => ({ groupId: g.id, refinement: "" }));
    return [...equipPicks, ...llmPicks];
  }

  return llmPicks;
}

/**
 * Step 2 — Explore: for one group, select 3 candidates.
 */
async function exploreCandidates(group, refinement, context, prior) {
  const itemList = group.items
    .map(i => `- ${i.name}: ${i.summary}`)
    .join("\n");

  const prompt = [
    `You are a D&D 5e assistant. Pick the 3 best items from this group for the NPC.`,
    ``,
    buildNpcContext(context, prior),
    refinement ? `\nRefinement: ${refinement}` : ``,
    ``,
    `Group: ${group.description}`,
    ``,
    `Available items:`,
    itemList,
    ``,
    `Pick exactly 3 items (or fewer if the group has less than 3).`,
    `The name must match exactly as listed above.`,
    `Provide a short reason for each pick (one sentence).`,
    ``,
    `Return JSON: { "candidates": [{ "name": "...", "reason": "..." }] }`,
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            reason: { type: "string" },
          },
          required: ["name", "reason"],
        },
      },
    },
    required: ["candidates"],
  };

  const { parsed } = await OllamaService.generate(
    [{ role: "user", content: prompt }], schema, -1,
  );

  if (!parsed?.candidates) return [];

  // Only keep candidates whose names actually exist in the group
  const validNames = new Set(group.items.map(i => i.name.toLowerCase()));
  return parsed.candidates
    .filter(c => validNames.has(c.name.toLowerCase()))
    .map(c => ({
      ...c,
      groupId: group.id,
      source: group.source,
    }));
}

/**
 * Step 3 — Reduce: final selection from all candidates.
 */
async function assembleSelection(allCandidates, context, prior) {
  const cr = prior.system?.details?.cr ?? 1;

  const candidateList = allCandidates
    .map(c => `- ${c.name} (from ${c.groupId}): ${c.reason}`)
    .join("\n");

  // CR-based ability budget to keep stat blocks appropriately sized
  let abilityBudget;
  if (cr <= 2) abilityBudget = "2–4 abilities total";
  else if (cr <= 5) abilityBudget = "4–6 abilities total";
  else if (cr <= 10) abilityBudget = "5–8 abilities total";
  else if (cr <= 15) abilityBudget = "6–10 abilities total";
  else abilityBudget = "8–12 abilities total";

  const prompt = [
    `You are a D&D 5e assistant. Make the final ability selection for this NPC.`,
    ``,
    buildNpcContext(context, prior),
    ``,
    `Budget: ${abilityBudget} (CR ${cr})`,
    ``,
    `Candidates:`,
    candidateList,
    ``,
    `Select the best combination. You may discard candidates that don't fit.`,
    `Aim for a balanced loadout (mix of offense, defense, utility where appropriate).`,
    ``,
    `HARD RULES:`,
    `- legendaryActionCount and legendaryResistanceCount MUST be 0 for creatures below CR 15.`,
    `  Only CR 15+ creatures get legendary actions (typically 3) and legendary resistances (typically 3).`,
    `- Do NOT include Legendary Resistance or legendary action abilities for creatures below CR 15.`,
    ``,
    `For spells, assign a mode:`,
    `- "atwill" — cantrips or at-will spells (unlimited use)`,
    `- "innate" — innate spellcasting (limited uses per day)`,
    `- "prepared" — standard spell slot casting`,
    `For non-spell abilities, use mode "".`,
    ``,
    `If the NPC is a spellcaster, also set spellcastingAbility ("int", "wis", or "cha")`,
    `and spellcastingLevel (usually equal to CR for full casters, half for half-casters).`,
    `Set both to "" and 0 if the NPC has no spells.`,
    ``,
    `Return JSON:`,
    `{`,
    `  "spellcastingAbility": "int",`,
    `  "spellcastingLevel": 7,`,
    `  "legendaryActionCount": 0,`,
    `  "legendaryResistanceCount": 0,`,
    `  "selected": [{ "name": "Fireball", "mode": "prepared" }]`,
    `}`,
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      spellcastingAbility: { type: "string" },
      spellcastingLevel: { type: "integer" },
      legendaryActionCount: { type: "integer" },
      legendaryResistanceCount: { type: "integer" },
      selected: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            mode: { type: "string", enum: ["atwill", "innate", "prepared", ""] },
          },
          required: ["name", "mode"],
        },
      },
    },
    required: ["spellcastingAbility", "spellcastingLevel", "legendaryActionCount", "legendaryResistanceCount", "selected"],
  };

  const { parsed } = await OllamaService.generate(
    [{ role: "user", content: prompt }], schema, -1,
  );

  return parsed;
}

/**
 * Run the full map-reduce catalog selection pipeline.
 * Returns { actorUpdate, embeddedItems } ready for the wave pipeline.
 */
export async function runCatalogSelection(context, prior, setStatus) {
  // Step 1 — Map: select groups
  setStatus("Selecting ability groups…");
  const selectedGroups = await selectGroups(context, prior);

  console.log(`[simsala] Selected groups:`, selectedGroups.map(g => g.groupId));

  if (!selectedGroups.length) {
    return { actorUpdate: {}, embeddedItems: [] };
  }

  // Resolve group data (items with names/summaries)
  const groupIds = selectedGroups.map(g => g.groupId);
  const groups = CatalogRegistry.getGroups(groupIds);
  console.log(`[simsala] Resolved ${groups.length} of ${groupIds.length} group(s) from catalog`);

  // Step 2 — Explore: parallel candidate selection per group
  setStatus("Exploring abilities…");
  const exploreResults = await Promise.allSettled(
    selectedGroups.map(sel => {
      const group = groups.find(g => g.id === sel.groupId);
      if (!group) {
        console.warn(`[simsala] Group "${sel.groupId}" not found in loaded catalogs — skipped`);
        return Promise.resolve([]);
      }
      return exploreCandidates(group, sel.refinement, context, prior);
    })
  );

  // Split candidates: equipment (handled directly) vs abilities (go through reduce step)
  const equipCandidates = [];
  const abilityCandidates = [];
  for (const result of exploreResults) {
    if (result.status === "fulfilled" && result.value) {
      for (const c of result.value) {
        if (EQUIPMENT_GROUP_IDS.has(c.groupId)) {
          equipCandidates.push(c);
        } else {
          abilityCandidates.push(c);
        }
      }
    }
  }

  console.log(`[simsala] Equipment candidates:`, equipCandidates.map(c => `${c.name} (${c.groupId})`));
  console.log(`[simsala] Ability candidates:`, abilityCandidates.map(c => `${c.name} (${c.groupId})`));

  if (!equipCandidates.length && !abilityCandidates.length) {
    return { actorUpdate: {}, embeddedItems: [] };
  }

  // Equipment: take the #1 pick from each equipment group.
  // The explore step already ranks items for this NPC, so first = best.
  const equipPicks = [];
  const seenEquipGroups = new Set();
  for (const c of equipCandidates) {
    if (!seenEquipGroups.has(c.groupId)) {
      seenEquipGroups.add(c.groupId);
      equipPicks.push(c);
    }
  }

  console.log(`[simsala] Equipment picks (top-1 per group):`, equipPicks.map(c => `${c.name} (${c.groupId})`));

  // Abilities: run through the LLM reduce step
  let selection = { selected: [], spellcastingAbility: "", spellcastingLevel: 0,
    legendaryActionCount: 0, legendaryResistanceCount: 0 };
  if (abilityCandidates.length) {
    setStatus("Assembling abilities…");
    selection = await assembleSelection(abilityCandidates, context, prior) ?? selection;
    console.log(`[simsala] Ability selection:`, selection?.selected?.map(s => `${s.name} [${s.mode}]`));
  }

  // Combine: equipment picks + ability selection
  const allSelected = [
    ...equipPicks.map(c => ({ name: c.name, mode: "", source: c.source })),
    ...(selection.selected ?? []).map(s => {
      const candidate = abilityCandidates.find(c => c.name.toLowerCase() === s.name.toLowerCase());
      return candidate ? { name: s.name, mode: s.mode, source: candidate.source } : null;
    }).filter(Boolean),
  ];

  console.log(`[simsala] Combined selection:`, allSelected.map(s => `${s.name} [${s.mode || "equip"}]`));

  if (!allSelected.length) {
    return { actorUpdate: {}, embeddedItems: [] };
  }

  // Resolve selected items from compendium
  setStatus("Loading from compendium…");

  // Group selected items by their compendium source for batch resolution
  const bySource = new Map();
  for (const sel of allSelected) {
    if (!bySource.has(sel.source)) bySource.set(sel.source, []);
    bySource.get(sel.source).push({ name: sel.name, mode: sel.mode });
  }

  const embeddedItems = [];
  for (const [source, items] of bySource) {
    const names = items.map(i => i.name);
    const resolved = await CatalogRegistry.resolveItems(names, source);

    for (const itemData of resolved) {
      // Find the mode assigned by the LLM
      const sel = items.find(i => i.name.toLowerCase() === itemData.name.toLowerCase());
      if (sel?.mode && itemData.type === "spell") {
        // Set spellcasting mode on spell items
        itemData.system = itemData.system ?? {};
        itemData.system.preparation = { mode: sel.mode === "atwill" ? "atwill" : sel.mode === "innate" ? "innate" : "prepared" };
      }
      embeddedItems.push(itemData);
    }
  }

  console.log(`[simsala] Resolved ${embeddedItems.length} item(s) from compendium:`,
    embeddedItems.map(i => `${i.name} (${i.type})`));

  // Build actor update for spellcasting and legendary resources
  const actorUpdate = {};
  if (selection.spellcastingAbility) {
    actorUpdate.system = {
      ...actorUpdate.system,
      attributes: {
        spellcasting: selection.spellcastingAbility,
        spell: { level: selection.spellcastingLevel || 1 },
      },
    };
  }
  if (selection.legendaryActionCount > 0 || selection.legendaryResistanceCount > 0) {
    actorUpdate.system = {
      ...actorUpdate.system,
      resources: {
        legact: { max: selection.legendaryActionCount || 0 },
        legres: { max: selection.legendaryResistanceCount || 0 },
      },
    };
  }

  return { actorUpdate, embeddedItems };
}
