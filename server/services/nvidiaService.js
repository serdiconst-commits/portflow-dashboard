const defaultBaseUrl = 'https://integrate.api.nvidia.com/v1';

const getConfig = () => ({
  enabled: String(process.env.NVIDIA_AI_ENABLED || 'false').toLowerCase() === 'true',
  apiKey: process.env.NVIDIA_API_KEY || '',
  baseUrl: (process.env.NVIDIA_BASE_URL || defaultBaseUrl).replace(/\/$/, ''),
  model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-nano-30b-a3b',
  maxInputTokens: Number(process.env.NVIDIA_MAX_INPUT_TOKENS || 12000),
  maxOutputTokens: Number(process.env.NVIDIA_MAX_OUTPUT_TOKENS || 1200),
  timeoutMs: Number(process.env.NVIDIA_TIMEOUT_MS || 45000),
});

export async function getNvidiaStatus() {
  const config = getConfig();
  return {
    enabled: config.enabled,
    configured: Boolean(config.apiKey),
    model: config.model,
    baseUrl: config.baseUrl,
  };
}

export async function callNvidiaChat({ messages, language = 'en' }) {
  const config = getConfig();
  if (!config.enabled) {
    const error = new Error('NVIDIA AI analytics is disabled. Enable NVIDIA_AI_ENABLED and company AI analytics settings before asking PortFlow.');
    error.status = 503;
    throw error;
  }
  if (!config.apiKey) {
    const error = new Error('NVIDIA_API_KEY is not configured.');
    error.status = 503;
    throw error;
  }
  const serialized = JSON.stringify(messages || []);
  if (!messages?.length || serialized.length > config.maxInputTokens * 4) {
    const error = new Error('AI analytics prompt is empty or too large.');
    error.status = 400;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const modelsResponse = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    if (!modelsResponse.ok) {
      const error = new Error(`Unable to verify NVIDIA model availability (${modelsResponse.status}).`);
      error.status = modelsResponse.status;
      throw error;
    }
    const models = await modelsResponse.json();
    const modelAvailable = Array.isArray(models?.data) && models.data.some((model) => model.id === config.model);
    if (!modelAvailable) {
      const error = new Error(`Configured NVIDIA model is not available: ${config.model}`);
      error.status = 404;
      throw error;
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.1,
        max_tokens: config.maxOutputTokens,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`NVIDIA chat request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || (language === 'es' ? 'No hay respuesta disponible.' : 'No answer was returned.');
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('NVIDIA AI request timed out.');
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
