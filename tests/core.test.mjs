import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir, privateWrite, readConfig, saveConfig } from '../src/paths.js';
import { costFor, money, validateSettings } from '../src/models.js';
import { sseEvents, completion, endpoint, APIError } from '../src/api.js';
import { Session, contextFor, remember, forget, memoryText, usageSummary, recordUsage, listSessions } from '../src/storage.js';
import { imagePart } from '../src/images.js';
import { Permissions, executeTool, handleTool } from '../src/tools.js';
import { safeText, UI } from '../src/ui.js';
import { parseArgs } from '../src/cli.js';
import { startFixture } from './fixture.mjs';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'axon-unit-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5E0AAAAASUVORK5CYII=', 'base64');

test('model pricing, exact usage arithmetic, formatting and settings', () => {
  assert.equal(costFor('axon-1.8-flash', { prompt_tokens: 1e6, completion_tokens: 1e6 }), 0.4);
  assert.equal(costFor('axon-1.8-lightning', { prompt_tokens: 1000, completion_tokens: 500 }), 0.00007);
  assert.equal(costFor('axon-1.6-pro', { prompt_tokens: 1e6, completion_tokens: 2e6 }), 0.95);
  assert.equal(money(0.0042), '$0.0042'); assert.equal(money(1.235), '$1.24');
  assert.throws(() => validateSettings({ model: 'unknown', variant: 'crescent', effort: 'off' }), /Model/);
});

test('portable paths, private config, no environment mutation', () => {
  assert.equal(configDir({}, 'linux', '/home/test'), path.join('/home/test', '.config', 'axon'));
  assert.equal(configDir({ XDG_CONFIG_HOME: '/tmp/config' }, 'linux', '/home/test'), path.join('/tmp/config', 'axon'));
  assert.equal(configDir({ APPDATA: 'C:/Users/Test/AppData/Roaming' }, 'win32', 'C:/Users/Test'), path.join('C:/Users/Test/AppData/Roaming', 'axon'));
  assert.equal(configDir({}, 'win32', 'C:/Users/Test'), path.join('C:/Users/Test', '.axon'));
  const dir = temp(); saveConfig(dir, { apiKey: 'fixture-key' });
  assert.equal(readConfig(dir).apiKey, 'fixture-key');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'config.json')).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true });
});

test('SSE handles CRLF, multiline data, comments, fragmented Unicode, EOF', async () => {
  const data = Buffer.from(':keepalive\r\ndata: {"text":\r\ndata: "héllo 🌙"}\r\n\r\ndata: [DONE]');
  async function* bytes() { for (let i = 0; i < data.length; i++) yield data.subarray(i, i + 1); }
  const events = []; for await (const event of sseEvents(bytes())) events.push(event);
  assert.equal(JSON.parse(events[0]).text, 'héllo 🌙'); assert.equal(events[1], '[DONE]');
});

test('endpoint normalization and friendly errors', () => {
  assert.equal(endpoint('https://example.org/api/v1/'), 'https://example.org/api/v1/chat/completions');
  assert.equal(endpoint('https://example.org/api/v1/chat/completions'), 'https://example.org/api/v1/chat/completions');
  assert.throws(() => endpoint('file:///tmp/api'), /http/);
  assert.throws(() => endpoint('https://secret@example.com'), /credentials/);
  assert.match(new APIError(401).message, /login/); assert.match(new APIError(402).message, /wallet/);
});

test('sessions persist, resume, clear context, retain usage and validate IDs', () => {
  const dir = temp(), session = new Session(dir);
  session.setTitle('A useful chat'); session.add({ role: 'user', content: 'Hello' });
  recordUsage(dir, session, 'axon-1.8-flash', { prompt_tokens: 100, completion_tokens: 20 }, [], '');
  assert.equal(new Session(dir, session.id).messages[0].content, 'Hello');
  assert.equal(listSessions(dir)[0].title, 'A useful chat');
  assert.equal(usageSummary(dir).models['axon-1.8-flash'].requests, 1);
  assert.equal(usageSummary(dir).total, 0.000016);
  session.clear(); assert.equal(new Session(dir, session.id).messages.length, 0);
  assert.throws(() => new Session(dir, '../bad'), /Invalid/);
  assert.throws(() => new Session(dir, 'missing'), /not found/);
  fs.rmSync(dir, { recursive: true });
});

test('memory persists, has timestamps, trims oldest, and supports forget', () => {
  const dir = temp(); remember(dir, 'My favorite color is teal'); remember(dir, 'Use concise answers');
  assert.match(memoryText(dir), /\[\d{4}-\d{2}-\d{2}\]/);
  forget(dir, 1); assert.doesNotMatch(memoryText(dir), /teal/);
  assert.throws(() => forget(dir, 0), /forget/);
  for (let i = 0; i < 20; i++) remember(dir, `${i}: ${'x'.repeat(900)}`);
  assert.ok(memoryText(dir).length <= 8000); assert.match(memoryText(dir), /19:/); assert.doesNotMatch(memoryText(dir), /\] 0:/);
  fs.rmSync(dir, { recursive: true });
});

test('context drops entire oldest turns, preserves memory and tool relationships', () => {
  const messages = [{ role: 'user', content: 'x'.repeat(2000) }, { role: 'assistant', content: 'old reply' }, { role: 'user', content: 'new' }, { role: 'assistant', content: null, tool_calls: [{ id: 'id', type: 'function', function: { name: 'list_dir', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'id', content: 'file.txt' }];
  const result = contextFor(messages, 'teal', 300);
  assert.equal(result.trimmed, 2); assert.match(result.messages[0].content, /teal/);
  assert.equal(result.messages[1].role, 'user'); assert.equal(result.messages.at(-1).role, 'tool');
  assert.throws(() => contextFor([{ role: 'user', content: 'x'.repeat(100000) }]), /too large/);
});

test('images detect magic bytes rather than trusting extensions', () => {
  assert.match(imagePart(png, 'x.txt').part.image_url.url, /^data:image\/png;base64,/);
  assert.throws(() => imagePart(Buffer.from('not an image')), /Unsupported/);
  assert.throws(() => imagePart(Buffer.alloc(11 * 1024 * 1024)), /10 MiB/);
});

test('argument parsing, repeated images, equals syntax, fast default', () => {
  assert.deepEqual(parseArgs(['-i', 'one.png', '--image=two.png', '-p', 'hello']).images, ['one.png', 'two.png']);
  assert.equal(parseArgs([]).effort, undefined);
  assert.throws(() => parseArgs(['-p']), /requires/);
  assert.throws(() => parseArgs(['--model', '--json']), /requires/);
  assert.throws(() => parseArgs(['-c', '-r', 'id']), /either/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown/);
});

test('untrusted output strips terminal escapes and control characters', () => {
  assert.equal(safeText('\x1b[2Jhello\x1b]52;c;stolen\x07\r\x00\x1b[31m!\x1b[0m'), 'hello!');
});

test('tool permissions: default deny, exact-command grants, session grants', async () => {
  const ui = { info() {}, tool() {} };
  const denied = new Permissions(null, ui, true);
  assert.equal(await denied.allow('run_command', { command: 'echo test' }), false);
  let count = 0;
  const permissions = new Permissions(async () => { count++; return count === 1 ? 'c' : 'n'; }, ui, true);
  assert.equal(await permissions.allow('run_command', { command: 'echo test' }), true);
  assert.equal(await permissions.allow('run_command', { command: 'echo test' }), true);
  assert.equal(await permissions.allow('run_command', { command: 'rm important' }), false); assert.equal(count, 2);
  permissions.session = true; assert.equal(await permissions.allow('read_file', { path: '/etc/hosts' }), true);
  permissions.enabled = false; assert.equal(await permissions.allow('read_file', { path: '/etc/hosts' }), false);
});

test('tools really run echo and operate on a temporary directory', async () => {
  const dir = temp(), file = path.join(dir, 'hello.txt');
  assert.match(await executeTool('run_command', { command: 'echo AXON_TOOL_OK' }), /AXON_TOOL_OK[\s\S]*exit 0/);
  assert.match(await executeTool('write_file', { path: file, content: 'teal' }), /Wrote 4 bytes/);
  assert.equal(await executeTool('read_file', { path: file }), 'teal');
  assert.match(await executeTool('list_dir', { path: dir }), /hello.txt/);
  const result = await handleTool({ id: 'test', function: { name: 'run_command', arguments: 'bad-json' } }, {}, { tool() {} });
  assert.match(result.content, /Tool error/);
  fs.rmSync(dir, { recursive: true });
});

test('API streams answers/reasoning/tools, usage, retries and error handling', async () => {
  const fixture = await startFixture(), previous = process.env.AXON_BASE_URL;
  process.env.AXON_BASE_URL = fixture.url;
  try {
    const deltas = [], base = { key: 'fixture-key', model: 'axon-1.8-flash', messages: [{ role: 'user', content: 'hello' }] };
    const result = await completion({ ...base, onDelta: (type, text) => deltas.push({ type, text }) });
    assert.match(result.content, /Axon ready/); assert.equal(result.usage.prompt_tokens, 100); assert.ok(deltas.length > 1);
    assert.equal(fixture.requests[0].reasoning_effort, undefined);
    assert.match((await completion({ ...base, effort: 'high' })).reasoning, /carefully/);
    const tool = await completion({ ...base, messages: [{ role: 'user', content: 'FIXTURE_TOOL' }], tools: [{ type: 'function' }] });
    assert.equal(JSON.parse(tool.toolCalls[0].function.arguments).command, 'echo AXON_TOOL_OK');
    let retries = 0;
    await completion({ ...base, messages: [{ role: 'user', content: 'FIXTURE_429' }], onRetry: () => retries++ }); assert.equal(retries, 2);
    await assert.rejects(completion({ ...base, key: 'wrong' }), /key rejected/);
    await assert.rejects(completion({ ...base, messages: [{ role: 'user', content: 'FIXTURE_402' }] }), /wallet/);
  } finally { if (previous === undefined) delete process.env.AXON_BASE_URL; else process.env.AXON_BASE_URL = previous; await fixture.close(); }
});
