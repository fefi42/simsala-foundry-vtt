# Plan 04 — User Documentation

**Goal:** Write a clear README targeting non-technical GM users on Windows and Mac. Covers prerequisites, installation, hardware requirements, and first use. To be written after the module is feature-complete.

---

## Deliverables

- `README.md` in the project root

---

## Sections

### 1. What is Simsala?
One paragraph. What it does, what it requires (Foundry VTT + dnd5e + Ollama), that it runs fully locally with no internet or subscription needed.

### 2. Hardware Requirements

| Situation | Verdict |
|---|---|
| NVIDIA GPU, 8GB+ VRAM | Recommended. Fast generation (~40–50 tokens/sec with 8B model). |
| NVIDIA GPU, 4GB VRAM | Works with smaller models (llama3.2 3B). Slower but usable. |
| AMD GPU | Works via ROCm. See AMD install path below. |
| Apple Silicon (M1/M2/M3/M4) | Excellent. macOS uses Metal — fast and efficient. |
| CPU only, 16GB+ RAM | Usable but slow (~3–6 tokens/sec). Generation takes 30–60+ seconds. |
| CPU only, 8GB RAM | Minimum. Only viable with 3B models. Not recommended for regular use. |
| CPU only, under 8GB RAM | Not supported. |

**Disk space:** The recommended model (llama3.2) requires ~2GB. Larger models (8B+) require 5–8GB.

**Note:** The module has zero performance impact during play. Ollama only uses resources while actively generating.

### 3. Prerequisites

- Foundry VTT v13
- D&D 5e system
- Ollama (installation instructions below)

### 4. Installing Ollama

#### Windows
1. Go to [ollama.com](https://ollama.com) and click Download for Windows
2. Run the `.exe` installer — no configuration needed
3. Ollama starts automatically as a background service

#### macOS
1. Go to [ollama.com](https://ollama.com) and click Download for Mac
2. Open the `.dmg` and drag Ollama to Applications
3. Launch Ollama — it runs as a menu bar app
4. **Requires macOS 14 Sonoma or later**

#### Linux
See Linux install section — requires manual steps (documented separately or linked to Ollama docs).

#### GPU drivers (NVIDIA, Windows/Linux)
Ollama uses CUDA. If you have an NVIDIA GPU, make sure your drivers are up to date (Game Ready or Studio drivers both work). No separate CUDA installation needed — Ollama bundles what it requires.

#### AMD GPU (Linux)
Download the ROCm variant:
```
https://ollama.com/download/ollama-linux-amd64-rocm.tar.zst
```
ROCm support on Windows is limited — AMD users on Windows may need to run CPU-only.

### 5. Pulling a Model

Once Ollama is installed, open a terminal and run:

```
ollama pull llama3.2
```

This downloads the default recommended model (~2GB). Run this once — the model is stored locally and reused.

**Model recommendations:**

| Model | Size | Quality | Notes |
|---|---|---|---|
| `llama3.2` | ~2GB | Good | Default recommendation. Fast on most hardware. |
| `llama3.1:8b` | ~5GB | Better | Needs 8GB+ VRAM or 16GB+ RAM. Noticeably better output quality. |
| `deepseek-r1` | varies | Best | Reasoning model. Slower but highest quality for complex items. |

The model can be changed at any time in Foundry's module settings.

### 6. Installing the Module

Standard Foundry module installation. Either:
- Install via the module manifest URL, or
- Place the module folder in `Data/modules/simsala/` manually

Enable the module in your world settings under **Manage Modules**.

### 7. First Use

1. Open any item sheet
2. Click the **✦ Simsala** button in the sheet header
3. Type a description of the item you want to generate
4. Click **Send** and wait for the model to respond
5. Review the generated fields in the chat window
6. Iterate with follow-up messages if needed
7. Click **Apply** to write the generated data to the item

### 8. Troubleshooting

| Problem | Solution |
|---|---|
| "Could not connect to Ollama" | Make sure Ollama is running. On Windows/Mac it should start automatically. On Linux, run `ollama serve` in a terminal. |
| No response / timeout | The model may be loading for the first time. Wait 30 seconds and try again. |
| Slow generation | Normal on CPU-only. Consider a smaller model (`llama3.2` instead of larger variants). |
| Model not found | Run `ollama pull llama3.2` in a terminal to download it. |
| Wrong Ollama URL | Check module settings — default is `http://localhost:11434`. |

---

## Notes for Writing

- Avoid technical jargon. Target audience is a GM who has never used a terminal.
- Windows and Mac users should be able to follow without ever opening a terminal (except for `ollama pull`).
- Screenshots would help — add placeholders where they should go.
- Link to Ollama's own docs for advanced cases rather than duplicating them.
