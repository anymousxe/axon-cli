import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completion } from '../src/api.js';
import { Engine } from '../src/engine.js';
import { Session } from '../src/storage.js';
import { Permissions } from '../src/tools.js';

const silent = { info() {}, event() {}, begin() {}, finish() {}, answer() {}, reasoning() {}, tool() {} };
async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.AXON_BASE_URL;
  process.env.AXON_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try { await callback(); }
  finally {
    if (previous === undefined) delete process.env.AXON_BASE_URL; else process.env.AXON_BASE_URL = previous;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
const base = { key: 'fixture-key', model: 'axon-1.8-flash', messages: [{ role: 'user', content: 'hello' }] };
const sse = (res, object) => res.write(`data: ${JSON.stringify(object)}\n\n`);

test('aborting a partial stream saves the partial assistant response and keeps chat usable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-cancel-'));
  const controller = new AbortController();
  try {
    await withServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, { choices: [{ delta: { content: 'A partial answer' } }] });
    }, async () => {
      const session = new Session(dir);
      const ui = { ...silent, answer: () => controller.abort() };
      const engine = new Engine({ dir, key: 'fixture-key', session, settings: { model: 'axon-1.8-flash', variant: 'crescent', effort: 'off' }, ui, permissions: new Permissions(null, ui) });
      await assert.rejects(engine.turn('hello', [], controller.signal));
      const restored = new Session(dir, session.id);
      assert.equal(restored.messages.length, 2);
      assert.match(restored.messages[1].content, /partial answer[\s\S]*interrupted/);
      assert.equal(restored.records.at(-1).type, 'interrupted');
    });
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('premature stream EOF is not mistaken for success', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { content: 'partial' } }] }); res.end();
  }, async () => { await assert.rejects(completion(base), /ended early/); });
});

test('empty completed response and malformed stream are friendly failures', async () => {
  let count = 0;
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (count++ === 0) sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }] });
    else res.write('data: invalid json\n\n');
    res.end();
  }, async () => {
    await assert.rejects(completion(base), /empty/);
    await assert.rejects(completion(base), /Malformed JSON/);
  });
});

test('500 errors retry before output; final usage-only chunk is retained', async () => {
  let requests = 0, retries = 0;
  await withServer((req, res) => {
    if (++requests === 1) { res.writeHead(503, { 'retry-after': '0' }); res.end('busy'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] });
    sse(res, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    res.end('data: [DONE]\n\n');
  }, async () => {
    const result = await completion({ ...base, onRetry: () => retries++ });
    assert.equal(retries, 1); assert.equal(result.usage.completion_tokens, 3);
  });
});

test('HTTP 200 temporary-unavailable sentinel retries without printing false answers', async () => {
  let requests = 0; const text = [];
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    sse(res, { choices: [{ delta: { content: ++requests === 1 ? 'Axon inference is temporarily unavailable. Please try again in a moment.' : 'Recovered' }, finish_reason: 'stop' }] });
    res.end('data: [DONE]\n\n');
  }, async () => {
    const result = await completion({ ...base, onDelta: (type, value) => text.push(value) });
    assert.equal(result.content, 'Recovered'); assert.deepEqual(text, ['Recovered']);
  });
});

test('JSON tool responses accumulate multiple function calls without index collisions', async () => {
  await withServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    assert.equal(JSON.parse(raw).stream, false);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: ['one', 'two'].map(id => ({ id, type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } })) }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  }, async () => {
    const result = await completion({ ...base, tools: [{ type: 'function' }] });
    assert.equal(result.toolCalls.length, 2); assert.equal(result.toolCalls[1].id, 'two');
  });
});
