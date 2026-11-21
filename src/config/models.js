// ============================================================================
// THE swap point for models. When the course announces the allowed models and
// budget, edit DEFAULT_TASKS (or pick models on the Setup screen; choices there
// override these defaults and are stored in the browser).
// ============================================================================

export const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyHelp: 'Create a key at openrouter.ai/keys. Free models need a key too.',
    // OpenRouter returns the real cost of each call when asked.
    extraBody: { usage: { include: true } },
    listModels: true,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyHelp: 'Create a key at platform.openai.com/api-keys.',
    extraBody: {},
    listModels: false,
  },
  custom: {
    label: 'Other OpenAI-compatible API',
    baseUrl: '', // set on the Setup screen
    keyHelp: 'Any endpoint that speaks the OpenAI chat-completions format and allows browser (CORS) requests.',
    extraBody: {},
    listModels: false,
  },
  simulated: {
    label: 'Simulated (no model is called)',
    baseUrl: '',
    keyHelp: 'For trying the app without a key. Results are canned and clearly labeled as simulated.',
    extraBody: {},
    listModels: false,
  },
}

/**
 * Per-task model settings.
 *  needsVision: the model must accept images.
 *  timeoutMs: after this the call is abandoned and the app falls back to manual mode.
 *  The model ids below are starting points for development. If OpenRouter no longer
 *  lists one, the Setup screen auto-picks a free model with the right input types.
 */
export const DEFAULT_TASKS = {
  buildPlan: {
    label: 'Build plan',
    modality: 'language',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    needsVision: false,
    timeoutMs: 45000,
    maxTokens: 1500,
    temperature: 0.2,
  },
  visionCheck: {
    label: 'Solder check',
    modality: 'image understanding',
    model: 'google/gemma-3-27b-it:free',
    needsVision: true,
    timeoutMs: 40000,
    maxTokens: 600,
    temperature: 0,
  },
  fixHelp: {
    label: 'Fix help',
    modality: 'language',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    needsVision: false,
    timeoutMs: 30000,
    maxTokens: 700,
    temperature: 0.2,
  },
}

/**
 * Fallback prices in USD per 1M tokens, used when the provider does not report cost.
 * Models not listed here and not priced by the provider show cost "unknown", never $0.
 * Fill in when the course announces its models.
 */
export const PRICE_TABLE = {
  // 'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
}

export const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
