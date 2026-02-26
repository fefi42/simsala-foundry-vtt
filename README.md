# Simsala — AI Item Generator for Foundry VTT

Simsala generates D&D 5e item data from a plain-text description. Open any item sheet, click the Simsala button, describe what you want, and get a fully populated item — name, rarity, damage, armor, flavor text, price, and more. All processing runs locally via [Ollama](https://ollama.com); no internet connection or subscription is required.

**Requires:** Foundry VTT v13 · D&D 5e system · Ollama

---

## Hardware Requirements

| Setup | Verdict |
|---|---|
| NVIDIA GPU, 8GB+ VRAM | Recommended. Fast generation (~40–50 tokens/sec with 8B model). |
| NVIDIA GPU, 4GB VRAM | Works with smaller models (llama3.2 3B). Slower but usable. |
| AMD GPU (Linux) | Works via ROCm. See [AMD install](#amd-gpu-linux) below. |
| Apple Silicon (M1/M2/M3/M4) | Excellent. Uses Metal — fast and efficient. |
| CPU only, 16GB+ RAM | Usable but slow (~3–6 tokens/sec). Generation takes 30–60+ seconds. |
| CPU only, 8GB RAM | Minimum viable. Only with 3B models. Not recommended for regular use. |
| CPU only, under 8GB RAM | Not supported. |

**Disk:** ~2GB for the default model. Larger models (8B+) require 5–8GB.

The module has zero performance impact during play. Ollama only uses resources while actively generating.

---

## Installing Ollama

### Windows
1. Go to [ollama.com](https://ollama.com) and click **Download for Windows**
2. Run the `.exe` installer — no configuration needed
3. Ollama starts automatically as a background service

### macOS
1. Go to [ollama.com](https://ollama.com) and click **Download for Mac**
2. Open the `.dmg` and drag Ollama to Applications
3. Launch Ollama — it runs as a menu bar app

> Requires macOS 14 Sonoma or later.

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve
```

### NVIDIA GPU drivers (Windows/Linux)
Ollama uses CUDA. Make sure your NVIDIA drivers are up to date (Game Ready or Studio drivers both work). No separate CUDA installation needed.

### AMD GPU (Linux)
Download the ROCm build from the [Ollama releases page](https://github.com/ollama/ollama/releases). ROCm on Windows is limited — AMD users on Windows may need to run CPU-only.

---

## Pulling a Model

Once Ollama is installed, open a terminal and run:

```
ollama pull llama3.2
```

This downloads the default model (~2GB). It only needs to be done once.

| Model | Size | Notes |
|---|---|---|
| `llama3.2` | ~2GB | Default. Fast on most hardware. |
| `llama3.1:8b` | ~5GB | Better output quality. Needs 8GB+ VRAM or 16GB+ RAM. |
| `deepseek-r1` | varies | Best quality. Slower — reasoning model. |

The model can be changed at any time in Foundry's module settings.

---

## Installing the Module

Place the `simsala` folder inside your Foundry `Data/modules/` directory, then enable it under **Settings → Manage Modules**.

---

## Usage

1. Open any item sheet (weapon, armor, consumable, tool, or loot)
2. Click the **✦** button in the sheet header
3. Type a description of the item — e.g. *"a cursed dagger that deals cold damage"*
4. Click **Send** (or press Enter) and wait for generation to complete
5. Review the generated JSON in the chat window
6. Optionally send follow-up messages to refine the result — e.g. *"make it legendary"*
7. Click **Apply** to write the data to the item

---

## Module Settings

Found under **Settings → Module Settings → Simsala**:

| Setting | Default | Description |
|---|---|---|
| Ollama URL | `http://localhost:11434` | Address of your Ollama instance |
| Model | `llama3.2` | Any model you have pulled locally |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Could not connect to Ollama" | Make sure Ollama is running. On Linux, run `ollama serve` in a terminal. |
| No response / timeout | The model may be loading for the first time. Wait 30 seconds and retry. |
| Slow generation | Normal on CPU-only hardware. Try a smaller model such as `llama3.2`. |
| "Model not found" | Run `ollama pull llama3.2` in a terminal. |
| Wrong URL | Check module settings — default is `http://localhost:11434`. |
