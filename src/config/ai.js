// ============================================================================
// AI configuration. Defined in code only: nothing here is shown or editable in the app.
//
// Keys come from build-time environment variables (Vite inlines VITE_* at build):
//   local dev:  put them in .env.local (gitignored)
//   GitHub Pages: add them as repository secrets; .github/workflows/deploy.yml passes them in.
//
// WARNING: anything inlined into a static site can be read by anyone who opens it.
// Put a spending limit on these keys, or set VITE_AI_PROXY_URL to a server (e.g. the
// EC2 backend) that adds the key itself, so no key ships to the browser at all.
// With no key and no proxy, every AI call runs in simulated mode.
// ============================================================================

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

export const KEYS = {
  openrouter: env.VITE_OPENROUTER_API_KEY || '',
  openai: env.VITE_OPENAI_API_KEY || '',
}

/** Optional proxy: requests go to `${PROXY_URL}/${provider}/...` without an Authorization header. */
export const PROXY_URL = (env.VITE_AI_PROXY_URL || '').replace(/\/$/, '')

export const PROVIDERS = {
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', extraBody: { usage: { include: true } } },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', extraBody: {} },
}

export const hasProvider = (p) => Boolean(PROXY_URL || KEYS[p])

/** Model per call. Swap these when the course announces its models. */
export const TASKS = {
  verify: {
    label: 'Placement check',
    modality: 'image',
    provider: 'openrouter',
    model: 'google/gemma-3-27b-it:free',
    needs: 'image',
    timeoutMs: 40000,
    maxTokens: 500,
    temperature: 0,
  },
  assistant: {
    label: 'Voice assistant',
    modality: 'language',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    needs: 'text',
    timeoutMs: 20000,
    maxTokens: 500,
    temperature: 0.1,
  },
  orderPlan: {
    label: 'Order suggestion',
    modality: 'language',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    needs: 'text',
    timeoutMs: 45000,
    maxTokens: 1500,
    temperature: 0.2,
  },
}

/**
 * Speech to text. The first entry whose provider has a key is used; with none, the
 * browser's built-in recognizer is the fallback.
 *  - 'transcriptions': OpenAI-compatible /audio/transcriptions (OpenAI, Groq, ...)
 *  - 'chat-audio': a chat model that accepts audio input, via OpenRouter
 */
export const STT = {
  label: 'Speech to text',
  modality: 'speech',
  timeoutMs: 15000,
  engines: [
    { provider: 'openai', kind: 'transcriptions', model: 'gpt-4o-mini-transcribe', pricePerMinute: 0.003 },
    { provider: 'openrouter', kind: 'chat-audio', model: 'google/gemini-2.5-flash' },
  ],
}

/** Fallback prices (USD per 1M tokens) when the provider reports no cost. Unknown stays "unknown". */
export const PRICE_TABLE = {
  // 'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
}

/** Phone pairing. Leave empty for the public PeerJS server; set a TURN relay (e.g. coturn on EC2) if campus Wi-Fi blocks WebRTC. */
function iceServers() {
  try {
    if (env.VITE_ICE_SERVERS) return JSON.parse(env.VITE_ICE_SERVERS)
  } catch {
    console.warn('VITE_ICE_SERVERS is not valid JSON; using the default STUN server.')
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }]
}

export const PAIRING = {
  peerHost: env.VITE_PEER_HOST || '',
  peerPort: Number(env.VITE_PEER_PORT || 443),
  peerPath: env.VITE_PEER_PATH || '/',
  iceServers: iceServers(),
}
