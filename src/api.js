import { setTimeout as sleep } from 'node:timers/promises';

export class APIError extends Error {
  constructor(status, detail) {
    const messages = {
      401: 'API key rejected. Run `axon login` or check AXON_API_KEY.',
      402: 'Your Axon wallet is empty. Add funds before trying again.',
      403: 'Access denied by the Axon API.',
      429: 'Rate limit reached. Please try again shortly.',
    };
    super(messages[status] || `Axon API returned HTTP ${status}${detail ? ': ' + detail.slice(0, 300) : ''}`);
    this.status = status;
  }
}
export function endpoint(base = process.env.AXON_BASE_URL || 'https://axon-chat-nu.vercel.app/api/v1') {
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('AXON_BASE_URL must use http or https.');
  if (url.username || url.password) throw new Error('Do not put credentials in AXON_BASE_URL.');
  url.pathname = url.pathname.replace(/\/$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.toString();
}

export async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buffer = '', data = [];
  function lineEvent(line) {
    if (line === '') {
      if (!data.length) return undefined;
      const event = data.join('\n'); data = []; return event;
    }
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
      const event = lineEvent(line);
      if (event !== undefined) yield event;
    }
  }
  buffer += decoder.decode();
  if (buffer) { const event = lineEvent(buffer.replace(/\r$/, '')); if (event !== undefined) yield event; }
  if (data.length) yield data.join('\n');
}

const UNAVAILABLE = 'Axon inference is temporarily unavailable. Please try again in a moment.';

export async function completion({ key, model, effort = 'off', messages, tools, signal, onDelta = () => {}, onRetry = () => {}, maxTokens, retries = 3 }) {
  // The live Axon endpoint currently drops tool_calls from SSE. Use its
  // OpenAI JSON response for tool-enabled rounds; regular chat stays streamed.
  const body = { model, messages, stream: !tools?.length };
  if (body.stream) body.stream_options = { include_usage: true };
  if (effort !== 'off') body.reasoning_effort = effort;
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (maxTokens) body.max_tokens = maxTokens;
  let response;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      response = await fetch(endpoint(), {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt >= retries) throw new Error(`Cannot reach Axon: ${error.message}. Check your connection and AXON_BASE_URL.`);
      onRetry(attempt + 1);
      await sleep(500 * 2 ** attempt, undefined, { signal });
      continue;
    }
    if (response.ok) break;
    const detail = await response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const retryHeader = response.headers.get('retry-after');
      const delay = retryHeader && /^\d+(\.\d+)?$/.test(retryHeader) ? Number(retryHeader) * 1000 : 500 * 2 ** attempt;
      onRetry(attempt + 1);
      await sleep(Math.min(delay, 15000), undefined, { signal });
      continue;
    }
    throw new APIError(response.status, detail);
  }
  let content = '', reasoning = '', usage = null, finishReason = null, done = false;
  const calls = new Map();
  const apply = chunk => {
    if (chunk.error) throw new Error(chunk.error.message || 'API stream error');
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || choice.message || {};
    if (typeof delta.content === 'string') { content += delta.content; if (delta.content !== UNAVAILABLE) onDelta('content', delta.content); }
    if (typeof delta.reasoning_content === 'string') { reasoning += delta.reasoning_content; onDelta('reasoning', delta.reasoning_content); }
    for (const part of delta.tool_calls || []) {
      const index = part.index ?? 0;
      const call = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      calls.set(index, call);
    }
  };
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    const obj = await response.json();
    // Nonstreaming responses have no delta indexes.
    obj.choices?.[0]?.message?.tool_calls?.forEach((call, index) => { call.index = index; });
    apply(obj);
  } else {
    for await (const event of sseEvents(response.body)) {
      if (event.trim() === '[DONE]') { done = true; break; }
      let obj;
      try { obj = JSON.parse(event); } catch { throw new Error('Malformed JSON in the Axon event stream. The partial answer was preserved.'); }
      apply(obj);
    }
  }
  if (!finishReason && !done) throw new Error('The response stream ended early. Partial output was preserved; retry your request.');
  if (content.trim() === UNAVAILABLE) {
    if (retries <= 0) throw new Error('Axon inference is temporarily unavailable. Please retry shortly.');
    onRetry(4 - retries);
    await sleep(1000, undefined, { signal });
    return completion({ key, model, effort, messages, tools, signal, onDelta, onRetry, maxTokens, retries: retries - 1 });
  }
  const toolCalls = [...calls.values()];
  if (!content && !toolCalls.length) throw new Error('Axon returned an empty or interrupted response.');
  return { content, reasoning, toolCalls, usage, finishReason };
}
