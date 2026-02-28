import { ItemGeneratorApp } from "./ItemGeneratorApp.js";
import { registerSettings } from "./settings.js";
import { CatalogRegistry } from "./catalog.js";

console.log("[simsala] main.js loaded");

Hooks.once("init", () => {
  registerSettings();
});

// Load catalog configs after the game is fully ready (compendiums available)
Hooks.once("ready", async () => {
  await CatalogRegistry.loadAll();
});

// Direct DOM injection instead of getHeaderControlsApplicationV2 hook
// because the controls panel renders differently and loses data-action
// on click events. See docs/foundry-integration.md.
function injectButton(header, onClick) {
  if (!header || header.querySelector(".simsala-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "header-control simsala-btn";
  btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i>';
  btn.dataset.tooltip = "Simsala";
  btn.addEventListener("click", onClick);
  // Place before the toggle button so it's visible without expanding controls
  const toggleBtn = header.querySelector('[data-action="toggleControls"]');
  toggleBtn ? header.insertBefore(btn, toggleBtn) : header.appendChild(btn);
}

Hooks.on("renderItemSheet5e", (app) => {
  injectButton(app.element.querySelector(".window-header"), () => {
    new ItemGeneratorApp(app.document).render({ force: true });
  });
});

Hooks.on("renderNPCActorSheet", (app) => {
  injectButton(app.element.querySelector(".window-header"), () => {
    new ItemGeneratorApp(app.document).render({ force: true });
  });
});
