// Gemini prebuilt voices (30 voices, multi-language auto-detect)
const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((id) => ({ id, name: id, type: "tts" }));

// ── TTS Config (config-driven, single source of truth) ─────────────────────
export const TTS_MODELS_CONFIG = {
  gemini: {
    models: [
      { id: "gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS", type: "tts" },
      { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS", type: "tts" },
      { id: "gemini-2.5-pro-preview-tts",   name: "Gemini 2.5 Pro TTS",   type: "tts" },
    ],
    voices: {
      "gemini-3.1-flash-tts-preview": GEMINI_VOICES,
      "gemini-2.5-flash-preview-tts": GEMINI_VOICES,
      "gemini-2.5-pro-preview-tts":   GEMINI_VOICES,
    },
    allVoices: GEMINI_VOICES,
  },
};

// ── Build flat entries for PROVIDER_MODELS backward compat ─────────────────
export function buildTtsProviderModels() {
  const entries = {};
  for (const [provider, cfg] of Object.entries(TTS_MODELS_CONFIG)) {
    if (cfg.models) entries[`${provider}-tts-models`] = cfg.models;
    if (cfg.allVoices) entries[`${provider}-tts-voices`] = cfg.allVoices;
    if (cfg.defaults) entries[provider] = cfg.defaults;
  }
  return entries;
}
