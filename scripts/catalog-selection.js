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

/**
 * Step 1 — Map: select which catalog groups to explore.
 */
async function selectGroups(context, prior) {
  const groupIndex = CatalogRegistry.getGroupIndex();
  if (!groupIndex.length) return [];

  const groupList = groupIndex
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

  if (!parsed?.selectedGroups) return [];

  // Filter to only valid group IDs
  const validIds = new Set(groupIndex.map(g => g.id));
  return parsed.selectedGroups.filter(g => validIds.has(g.groupId));
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

  if (!selectedGroups.length) {
    return { actorUpdate: {}, embeddedItems: [] };
  }

  // Resolve group data (items with names/summaries)
  const groupIds = selectedGroups.map(g => g.groupId);
  const groups = CatalogRegistry.getGroups(groupIds);

  // Step 2 — Explore: parallel candidate selection per group
  setStatus("Exploring abilities…");
  const exploreResults = await Promise.allSettled(
    selectedGroups.map(sel => {
      const group = groups.find(g => g.id === sel.groupId);
      if (!group) return Promise.resolve([]);
      return exploreCandidates(group, sel.refinement, context, prior);
    })
  );

  const allCandidates = [];
  for (const result of exploreResults) {
    if (result.status === "fulfilled" && result.value) {
      allCandidates.push(...result.value);
    }
  }

  if (!allCandidates.length) {
    return { actorUpdate: {}, embeddedItems: [] };
  }

  // Step 3 — Reduce: final assembly
  setStatus("Assembling abilities…");
  const selection = await assembleSelection(allCandidates, context, prior);

  if (!selection?.selected?.length) {
    return { actorUpdate: {}, embeddedItems: [] };
  }

  // Resolve selected items from compendium
  setStatus("Loading from compendium…");

  // Group selected items by their compendium source for batch resolution
  const bySource = new Map();
  for (const sel of selection.selected) {
    // Find which candidate (and thus which source) this name came from
    const candidate = allCandidates.find(c => c.name.toLowerCase() === sel.name.toLowerCase());
    if (!candidate) continue;
    const source = candidate.source;
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push({ name: sel.name, mode: sel.mode });
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
