const MODULE_ID = "simsala";
const CATALOG_DIR = `modules/${MODULE_ID}/data/catalogs`;

/**
 * Registry of ability/spell catalogs loaded from JSON config files.
 * Each catalog references a Foundry compendium pack and organizes its
 * items into thematic groups for LLM-driven selection.
 *
 * Config files are the only thing that needs to change to support new
 * compendiums or 3rd-party content — no code changes required.
 */
export class CatalogRegistry {
  static _catalogs = [];
  static _indexCache = new Map();

  /**
   * Load all catalog JSON files from data/catalogs/.
   * Called once on module init.
   */
  static async loadAll() {
    this._catalogs = [];
    this._indexCache.clear();

    const catalogFiles = ["srd-spells.json", "srd-abilities.json"];

    for (const file of catalogFiles) {
      try {
        const resp = await fetch(`${CATALOG_DIR}/${file}`);
        if (!resp.ok) {
          console.warn(`[simsala] Failed to load catalog ${file}: ${resp.status}`);
          continue;
        }
        const catalog = await resp.json();
        this._catalogs.push(catalog);
      } catch (err) {
        console.warn(`[simsala] Error loading catalog ${file}:`, err.message);
      }
    }

    console.log(`[simsala] Loaded ${this._catalogs.length} catalog(s) with ${this.getGroupIndex().length} groups`);
  }

  /**
   * Return all groups across all catalogs with their descriptions.
   * Used by the map step — the LLM sees only group IDs and descriptions,
   * not individual items (keeps the prompt small regardless of catalog size).
   */
  static getGroupIndex() {
    const index = [];
    for (const catalog of this._catalogs) {
      for (const group of catalog.groups) {
        index.push({
          id: group.id,
          description: group.description,
          source: catalog.source,
          itemCount: group.items.length,
        });
      }
    }
    return index;
  }

  /**
   * Return the raw group data (items with names/summaries) for specific group IDs.
   * Used by the explore step — the LLM sees item names and summaries
   * to pick candidates.
   */
  static getGroups(groupIds) {
    const result = [];
    for (const catalog of this._catalogs) {
      for (const group of catalog.groups) {
        if (groupIds.includes(group.id)) {
          result.push({ ...group, source: catalog.source });
        }
      }
    }
    return result;
  }

  /**
   * Resolve item names to full Foundry item documents from their compendium pack.
   * Returns plain objects ready for createEmbeddedDocuments.
   * Items not found are silently skipped with a console warning.
   */
  static async resolveItems(names, source) {
    const pack = game.packs.get(source);
    if (!pack) {
      console.warn(`[simsala] Compendium pack "${source}" not found`);
      return [];
    }

    // Cache the compendium index to avoid reloading for each resolution call
    if (!this._indexCache.has(source)) {
      this._indexCache.set(source, await pack.getIndex());
    }
    const index = this._indexCache.get(source);

    const results = [];
    const missing = [];

    for (const name of names) {
      const entry = index.find(e => e.name.toLowerCase() === name.toLowerCase().trim());
      if (entry) {
        const doc = await pack.getDocument(entry._id);
        results.push(doc.toObject());
      } else {
        missing.push(name);
      }
    }

    if (missing.length) {
      console.warn(`[simsala] Items not found in ${source}: ${missing.join(", ")}`);
    }

    return results;
  }
}
