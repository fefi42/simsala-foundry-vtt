export class NpcGeneratorApp extends foundry.applications.api.ApplicationV2 {
  constructor(actor) {
    super();
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    id: "simsala-npc-generator",
    window: { title: "Simsala — NPC Generator" },
    position: { width: 420, height: 300 },
  };

  async _renderHTML() {
    const div = document.createElement("div");
    div.style.padding = "1rem";
    div.textContent = "NPC generation coming soon.";
    return div;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }
}
