export const serviceError = (message, status = 503) =>
  Object.assign(new Error(message), { status });

// Never return provider response bodies: they may contain internal URLs or credentials.
export async function providerJson(fetcher, url, options, name, maxBytes = 2000000) {
  let response;
  try {
    response = await fetcher(url, { ...options, redirect: 'error' });
  } catch {
    throw serviceError(`${name} could not be reached or timed out. Check connectivity and retry.`);
  }
  if (!response.ok) {
    const hints = {
      401: 'check the API key',
      403: 'check account permissions',
      402: 'add credits or claim the hackathon allowance',
      429: 'rate limited; wait before retrying',
      404: 'check endpoint/model availability',
    };
    throw serviceError(
      `${name} returned HTTP ${response.status}: ${hints[response.status] || 'provider request failed'}.`,
    );
  }
  // Test adapters can provide json(); real fetch responses are bounded while streaming.
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw serviceError(`${name} response exceeded the safety limit.`);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error.status) throw error;
    throw serviceError(`${name} returned unreadable JSON.`);
  }
}

export function createInferenceClient(env, fetcher = fetch) {
  const base = env.NOSANA_INFERENCE_URL || 'https://inference.nosana.com/v1';
  const key = env.NOSANA_INFERENCE_KEY || env.NOSANA_API_KEY;
  const configured = Boolean(env.NOSANA_API_KEY || (env.NOSANA_INFERENCE_URL && env.NOSANA_MODEL));
  let cachedModel;
  let modelCheckedAt = 0;
  const headers = {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  function endpoint(path) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw serviceError(
        'Nosana inference requires a valid HTTPS base URL without embedded credentials.',
      );
    return `${url.href.replace(/\/$/, '')}/${path}`;
  }
  async function model(signal) {
    if (!configured)
      throw serviceError('Add NOSANA_API_KEY, or configure NOSANA_INFERENCE_URL and NOSANA_MODEL.');
    if (env.NOSANA_MODEL) return env.NOSANA_MODEL;
    if (cachedModel && Date.now() - modelCheckedAt < 300000) return cachedModel;
    const result = await providerJson(
      fetcher,
      endpoint('models'),
      { headers, signal: signal || AbortSignal.timeout(15000) },
      'Nosana',
    );
    const available = result.data?.find(
      (m) =>
        typeof m.id === 'string' &&
        m.available !== false &&
        (!m.context_length || m.context_length >= 8192),
    );
    if (!available)
      throw serviceError(
        'No suitable Nosana model is currently serving. Retry later or set NOSANA_MODEL to an available model.',
      );
    cachedModel = available.id;
    modelCheckedAt = Date.now();
    return cachedModel;
  }
  return {
    configured,
    model,
    async complete(messages, { maxTokens = 1800, signal } = {}) {
      const selected = await model(signal);
      const result = await providerJson(
        fetcher,
        endpoint('chat/completions'),
        {
          method: 'POST',
          headers,
          signal: signal || AbortSignal.timeout(45000),
          body: JSON.stringify({
            model: selected,
            temperature: 0,
            max_tokens: maxTokens,
            messages,
          }),
        },
        'Nosana',
      );
      const text = result.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim() || text.length > 24000)
        throw serviceError(
          'Nosana returned an empty or invalid answer. No research data was substituted.',
        );
      return { text, model: selected };
    },
  };
}
