const MODULE_ID = "simsala";

export function registerSettings() {
  game.settings.register(MODULE_ID, "ollamaUrl", {
    name: "Ollama URL",
    hint: "Base URL for the Ollama API.",
    scope: "world",
    config: true,
    type: String,
    default: "http://localhost:11434",
  });

  game.settings.register(MODULE_ID, "modelName", {
    name: "Model Name",
    hint: "The Ollama model to use. Run 'ollama pull <model>' to download it first.",
    scope: "world",
    config: true,
    type: String,
    default: "llama3.2",
  });

  game.settings.register(MODULE_ID, "systemPromptOverride", {
    name: "System Prompt Override",
    hint: "Optional. If set, replaces the default system prompt entirely.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
}

export function getSettings() {
  return {
    ollamaUrl: game.settings.get(MODULE_ID, "ollamaUrl"),
    modelName: game.settings.get(MODULE_ID, "modelName"),
    systemPromptOverride: game.settings.get(MODULE_ID, "systemPromptOverride"),
  };
}
