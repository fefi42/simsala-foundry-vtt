import { ItemGeneratorApp } from "./ItemGeneratorApp.js";
import { registerSettings } from "./settings.js";

console.log("[simsala] main.js loaded");

Hooks.once("init", () => {
  registerSettings();
});

// Inject a button directly into the item sheet header
Hooks.on("renderItemSheet5e", (app, html) => {
  const header = app.element.querySelector(".window-header");
  if (!header || header.querySelector(".simsala-btn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "header-control simsala-btn";
  btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i>';
  btn.dataset.tooltip = "Simsala";
  btn.addEventListener("click", () => {
    console.log("[simsala] opening window for", app.document.name);
    new ItemGeneratorApp(app.document).render({ force: true });
  });

  const toggleBtn = header.querySelector('[data-action="toggleControls"]');
  toggleBtn ? header.insertBefore(btn, toggleBtn) : header.appendChild(btn);
});
