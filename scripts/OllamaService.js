import { getSettings } from "./settings.js";

/**
 * Stateless HTTP wrapper — no conversation memory. The caller (ItemGeneratorApp)
 * owns state and passes the full message context each time.
 */
export class OllamaService {
  /**
   * @param {Array} messages - Chat messages to send
   * @param {Object} format - JSON Schema that constrains the model's output structure
   * @param {number} keepAlive - -1 keeps model loaded, 0 unloads immediately
   */
  static async generate(messages, format, keepAlive = 0) {
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
          keep_alive: keepAlive,
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

    // parsed is null on JSON failure — the caller decides whether to
    // retry, skip, or surface the raw text to the user.
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch { /* intentional — null signals parse failure */ }

    return { parsed, raw };
  }
}
