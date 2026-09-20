import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Palette, terminalCaps, safeText, highlight, AnswerRenderer, unifiedDiff, colorDiff } from '../src/render.js';
import { completions, COMMANDS } from '../src/commands.js';
import { Input } from '../src/input.js';
import { Engine } from '../src/engine.js';
import { Session, usageSummary } from '../src/storage.js';
import { Permissions, handleTool } from '../src/tools.js';
import { copyText } from '../src/clipboard.js';
import { startFixture } from './fixture.mjs';
const silent = { info() {}, event() {}, begin() {}, finish() {}, answer() {}, reasoning() {}, tool() {} };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'axon-polish-'));

test('capabilities: NO_COLOR, dumb, non-TTY and legacy Windows are safe', () => {
  assert.equal(terminalCaps({ isTTY: true }, { NO_COLOR: '' }, 'linux').color, false);
  assert.equal(terminalCaps({ isTTY: true }, { TERM: 'dumb' }, 'linux').ansi, false);
  assert.equal(terminalCaps({ isTTY: false }, { COLORTERM: 'truecolor' }, 'linux').color, false);
  assert.equal(terminalCaps({ isTTY: true }, {}, 'win32').ansi, false);
  assert.equal(terminalCaps({ isTTY: true }, { WT_SESSION: 'test' }, 'win32').truecolor, true);
  const plain = new Palette({ color: false }); assert.equal(plain.paint('ok', 'ok'), 'ok');
  const p = new Palette({ color: true, truecolor: true, theme: 'dark' });
  const dark = p.paint('primary', 'x'); p.setTheme('light'); assert.notEqual(dark, p.paint('primary', 'x'));
  assert.match(dark, /38;2;/);
  const auto = new Palette({ color: true, theme: 'auto', env: { COLORFGBG: '0;15' } }); assert.equal(auto.light, true);
});

test('syntax lexer colors supported languages without changing source', () => {
  const palette = new Palette({ color: true });
  for (const [lang, code] of Object.entries({ js: 'const x = f("hi", 42); // comment', ts: 'interface Foo { x: number }', py: 'def f(x): # comment\n  return "ok"', json: '{"ok": true, "n": 42}', sql: 'SELECT count(*) FROM users -- note', bash: 'if true; then echo "ok"; fi # note', sh: 'echo 42' })) {
    const result = highlight(code, lang, palette); assert.match(result, /\x1b\[/); assert.equal(safeText(result), code);
  }
  assert.equal(highlight('hello', 'unknown', palette), 'hello');
});

test('streaming markdown handles fragmented fences, live prose and plain fallback', () => {
  let out = ''; const p = new Palette({ color: true });
  const r = new AnswerRenderer(text => out += text, p);
  r.push('Hi'); assert.equal(out, 'Hi');
  for (const char of '\n```js\nconst x = 1;\n```\nDone') r.push(char);
  r.finish(); assert.match(safeText(out), /┌─ js/); assert.match(safeText(out), /│ const x = 1;/); assert.match(safeText(out), /└.*\nD/); assert.ok(safeText(out).endsWith('Done'));
  let plain = ''; const uncolored = new AnswerRenderer(text => plain += text, new Palette({ color: false }));
  uncolored.push('```py\nprint(1)\n```'); uncolored.finish(); assert.equal(plain, '```py\nprint(1)\n```');
});

test('unified diff has bounded context, addition/deletion colors and safe paths', () => {
  const diff = unifiedDiff('one\nold\nthree\n', 'one\nnew\nthree\n', 'test');
  assert.match(diff, /@@ -1,3 \+1,3 @@/); assert.match(diff, /-old\n\+new/);
  const colored = colorDiff(diff, new Palette({ color: true })); assert.equal(safeText(colored), diff);
  assert.match(unifiedDiff('', 'new\n', 'test'), /-0,0 \+1,1/);
  assert.equal(unifiedDiff('same', 'same'), '');
});

test('command menu fuzzy filtering and argument menus carry descriptions/prices', () => {
  assert.equal(completions('/').length, COMMANDS.length);
  assert.equal(completions('/mdl')[0].label, '/model');
  assert.equal(completions('//model').length, 0);
  assert.equal(completions('ordinary text').length, 0);
  const models = completions('/model '); assert.equal(models.length, 4); assert.match(models[0].description, /per 1M/);
  assert.equal(completions('/think h')[0].value, '/think high');
  assert.equal(completions('/theme l')[0].value, '/theme light');
  assert.equal(completions('/resume abc', [{ id: 'abc123', title: 'Chat' }])[0].description, 'Chat');
});

// Drive the actual raw-key state machine without owning the test runner's stdin.
function editor() {
  const input = Object.create(Input.prototype);
  Object.assign(input, { line: '', cursor: 0, selected: 0, menuEnabled: true, muted: false, dismissed: false, history: [], historyAt: 0, waiter() {}, render() {}, onInterrupt() {}, close() { this.closed = true; } });
  return input;
}
test('raw key navigation, completion, Escape, editing and multiline bracketed paste', () => {
  const input = editor(); input.key('/', {}); assert.equal(input.items().length, COMMANDS.length);
  input.key('', { name: 'down' }); assert.equal(input.selected, 1);
  input.key('', { name: 'tab' }); assert.equal(input.line, input.line.trimEnd() + ' '); assert.equal(input.dismissed, true);
  input.key('', { name: 'escape' }); assert.equal(input.items().length, 0);
  input.line = '/theme '; input.cursor = 7; input.dismissed = false; input.selected = 0;
  input.key('l', {}); assert.equal(input.items()[0].value, '/theme light');
  input.key('', { name: 'return' }); assert.equal(input.line, '/theme light'); assert.ok(input.waiter);
  input.line = ''; input.cursor = 0;
  input.key('', { name: 'paste-start' }); input.key('/clear', {}); input.key('\r', { name: 'return' }); input.key('some text', {}); input.key('', { name: 'paste-end' });
  assert.equal(input.line, '/clear\nsome text'); assert.ok(input.waiter); assert.equal(input.items().length, 0);
  input.key('', { ctrl: true, name: 'u' }); assert.equal(input.line, '');
  input.key('😀', {}); input.key('', { name: 'backspace' }); assert.equal(input.line, '');
  input.muted = true; input.key('/secret', {}); assert.equal(input.items().length, 0);
});

test('side questions stay out of context, compact survives resume, retry replaces a turn', async () => {
  const dir = temp(), fixture = await startFixture(), previous = process.env.AXON_BASE_URL;
  process.env.AXON_BASE_URL = fixture.url;
  try {
    const session = new Session(dir);
    const engine = new Engine({ dir, key: 'fixture-key', session, settings: { model: 'axon-1.8-flash', effort: 'high', showThinking: false }, ui: silent, permissions: new Permissions(null, silent) });
    await engine.turn('Hello'); const messages = JSON.stringify(session.messages), title = session.title;
    await engine.sideQuestion('side only');
    assert.equal(JSON.stringify(session.messages), messages); assert.equal(session.title, title);
    const side = fixture.requests.at(-1); assert.equal(side.model, 'axon-1.8-lightning'); assert.equal(side.reasoning_effort, undefined); assert.equal(side.messages.length, 1); assert.equal(side.tools, undefined);
    assert.equal(usageSummary(dir).models['axon-1.8-lightning'].requests, 1);
    await engine.retry(); assert.equal(session.messages.length, 2); assert.equal(new Session(dir, session.id).messages.length, 2);
    session.add({ role: 'user', content: 'Long context. '.repeat(1000) });
    for (let i = 0; i < 6; i++) { session.add({ role: 'user', content: 'Recent ' + i }); session.add({ role: 'assistant', content: 'Noted' }); }
    const recent = session.messages.slice(-12);
    const result = await engine.compact(); assert.ok(result.saved > 0); assert.deepEqual(session.messages, recent);
    const resumed = new Session(dir, session.id); assert.ok(resumed.summary); assert.ok(resumed.records.some(r => r.type === 'message'));
    await engine.turn('continue'); assert.match(fixture.requests.at(-1).messages[0].content, /Conversation summary/);
    assert.ok(!JSON.stringify(fixture.requests.at(-1).messages).includes('side only'));
    session.clear(); assert.equal(new Session(dir, session.id).summary, '');
    await assert.rejects(engine.retry(), /No user/);
    // Assert the full request schema instead of allowing obsolete options to leak.
    for (const req of fixture.requests) assert.ok(Object.keys(req).every(key => ['model', 'messages', 'stream', 'stream_options', 'include_reasoning', 'reasoning_effort', 'tools', 'tool_choice', 'max_tokens', 'authorization'].includes(key)));
  } finally { if (previous === undefined) delete process.env.AXON_BASE_URL; else process.env.AXON_BASE_URL = previous; await fixture.close(); fs.rmSync(dir, { recursive: true }); }
});

test('approved write/edit emits diffs; denied edit never changes files', async () => {
  const dir = temp(), file = path.join(dir, 'text'); const diffs = [];
  const ui = { ...silent, diff: text => diffs.push(text) };
  const permissions = new Permissions(async () => 'y', ui, true);
  const call = (name, args) => ({ id: 'id', function: { name, arguments: JSON.stringify(args) } });
  try {
    await handleTool(call('write_file', { path: file, content: 'hello\n' }), permissions, ui);
    await handleTool(call('edit_file', { path: file, old_text: 'hello', new_text: 'world' }), permissions, ui);
    assert.equal(diffs.length, 2); assert.match(diffs[1], /-hello\n\+world/);
    permissions.enabled = false;
    const denied = await handleTool(call('edit_file', { path: file, old_text: 'world', new_text: 'bad' }), permissions, ui);
    assert.match(denied.content, /Permission denied/); assert.equal(fs.readFileSync(file, 'utf8'), 'world\n');
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('clipboard tries providers without a shell and transmits exact text', async () => {
  const calls = [], text = '$(not a shell)\nhello';
  const fake = (cmd, args, opts) => {
    calls.push(cmd); assert.equal(opts.shell, undefined);
    const child = new EventEmitter(); child.kill = () => {};
    child.stdin = new EventEmitter(); child.stdin.end = value => { assert.equal(value, text); queueMicrotask(() => child.emit('close', cmd === 'clip.exe' ? 0 : 1)); };
    return child;
  };
  assert.equal(await copyText(text, fake), 'clip.exe'); assert.deepEqual(calls, ['wl-copy', 'xclip', 'clip.exe']);
  await assert.rejects(copyText(''), /No assistant/);
});

test('bundled REPL: fast toggle, theme persistence, status masking and JSON commands', async () => {
  const fixture = await startFixture(), dir = temp();
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['bin/axon.mjs', '--repl', '--json'], { env: { ...process.env, AXON_CONFIG_DIR: dir, AXON_BASE_URL: fixture.url, AXON_API_KEY: 'fixture-key', NO_COLOR: '1' } });
      let out = '', err = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b); child.on('error', reject); child.on('close', code => resolve({ code, out, err }));
      child.stdin.end('/theme light\n/fast\nhello\n/fast\n/status\n/btw side\n/usage\n/exit\n');
    });
    assert.equal(result.code, 0, result.err); const events = result.out.trim().split('\n').map(x => JSON.parse(x));
    assert.ok(events.some(e => e.type === 'btw')); assert.ok(events.some(e => e.type === 'usage'));
    assert.match(events.find(e => e.command === '/status').text, /axon-1.8-flash/);
    assert.doesNotMatch(result.out, /fixture-key|\x1b/);
    assert.equal(fixture.requests[0].model, 'axon-1.8-lightning'); assert.equal(fixture.requests[0].reasoning_effort, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'))).theme, 'light');
  } finally { await fixture.close(); fs.rmSync(dir, { recursive: true }); }
});
