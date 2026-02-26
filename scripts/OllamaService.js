import { getSettings } from "./settings.js";

export class OllamaService {
  static async generate(messages, format) {
    const { ollamaUrl, modelName } = getSettings();

    let response;
    try {
      response = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages,
          format,
          stream: false,
          keep_alive: 0,
        }),
      });
    } catch {
      throw new Error(`Could not connect to Ollama at ${ollamaUrl}. Is it running?`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama error ${response.status}: ${body}`);
    }

    const data = await response.json();
    const raw = data.message?.content ?? "";

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Caller handles retry on null
    }

    return { parsed, raw };
  }
}
