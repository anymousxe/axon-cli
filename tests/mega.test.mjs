import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Palette, inlineMarkdown, renderMarkdown, markdownTable, safeText, displayWidth, gradient, AnswerRenderer } from '../src/render.js';
import { compactThreshold, projectedTokens, shouldCompact, splitHistory, LockIn } from '../src/agent.js';
import { Session } from '../src/storage.js';
import { Engine } from '../src/engine.js';
import { Permissions } from '../src/tools.js';
import { toolsDefault, parseArgs } from '../src/cli.js';
import { Input } from '../src/input.js';
import { completions, pathCompletions } from '../src/commands.js';
import { startFixture } from './fixture.mjs';
const palette = new Palette({ color: true, truecolor: true });
const silent = { begin() {}, finish() {}, info() {}, event() {}, answer() {}, reasoning() {}, tool() {} };

test('inline markdown styles code, bold, italic, strike and links without terminal injection', () => {
  const text = inlineMarkdown('`x()` **bold** *italic* ~~gone~~ [site](https://example.com) \x1b[2J', palette);
  assert.equal(safeText(text), 'x() bold italic gone site (https://example.com) ');
  for (const code of ['48;5;', '[1;97m', '[3m', '[2;9m', '[4m']) assert.ok(text.includes(code));
  assert.ok(!text.includes('\x1b[2J'));
  assert.equal(safeText(inlineMarkdown('**bold and *italic***', palette)), 'bold and italic');
});
test('block markdown: headers, lists, quotes, rules, fences and aligned Unicode tables', () => {
  const out = renderMarkdown('# Header\n- **item**\n1. step\n> quote\n---\n```rust\nfn main() {}\n```', palette);
  assert.match(out, /\x1b\[1;4m/); assert.match(safeText(out), /• item\n1\. step\n│ quote\n─/);
  assert.match(safeText(out), /│ fn main\(\) \{\}/);
  const table = markdownTable(['| Name | Value |', '| :--- | ---: |', '| 界 | `1` |', '| long | **20** |'], palette);
  const widths = table.split('\n').map(displayWidth); assert.ok(widths.every(n => n === widths[0]));
  assert.match(safeText(table), /│ 界   │     1 │/);
});
test('gradient changes with phase; disabled and 256-color palettes are static', () => {
  assert.notEqual(gradient('AXON', palette, 0), gradient('AXON', palette, 1));
  const plain = new Palette({ color: false }), limited = new Palette({ color: true, truecolor: false });
  assert.equal(gradient('AXON', plain, 0), 'AXON');
  assert.equal(gradient('AXON', limited, 0), gradient('AXON', limited, 1));
});
// Tiny terminal emulator verifies incremental repaints, rather than stripping cursor controls.
function screen() {
  let rows = [''], x = 0, y = 0;
  return { write(text) {
    const parts = text.split(/(\x1b\[[0-9;]*[A-Za-z])/);
    for (const part of parts) {
      if (part.startsWith('\x1b')) {
        if (part.endsWith('A')) y = Math.max(0, y - Number(part.slice(2, -1)));
        if (part.endsWith('J')) { rows = rows.slice(0, y + 1); rows[y] = (rows[y] || '').slice(0, x); }
        continue;
      }
      for (const char of part) {
        if (char === '\r') x = 0;
        else if (char === '\n') { y++; x = 0; rows[y] ||= ''; }
        else { rows[y] = (rows[y] || '').slice(0, x) + char + (rows[y] || '').slice(x + 1); x++; }
      }
    }
  }, text: () => rows.join('\n') };
}
test('streamed markdown re-renders split delimiters and tables, preserving final screen', () => {
  const terminal = screen(); const renderer = new AnswerRenderer(s => terminal.write(s), palette, () => 200);
  const source = '# Hi\n**bold** and `code`\n| A | B |\n| --- | --- |\n| x | y |\n\n```js\nconst x = 1;\n```\nDone';
  for (const char of source) renderer.push(char);
  renderer.finish();
  assert.equal(terminal.text(), safeText(renderMarkdown(source, palette)));
  let raw = ''; const plain = new AnswerRenderer(s => raw += s, new Palette({ color: false }));
  for (const char of source) plain.push(char); plain.finish(); assert.equal(raw, source);
});
test('compaction math validates threshold, projects ledger + growth, preserves whole turns', () => {
  assert.equal(compactThreshold(), .8); assert.equal(compactThreshold('80'), .8); assert.equal(compactThreshold('.001'), .001);
  for (const value of ['bad', '0', '-1', '101']) assert.equal(compactThreshold(value), .8);
  assert.equal(shouldCompact(19200), true); assert.equal(shouldCompact(19199), false);
  const messages = Array.from({ length: 8 }, (_, i) => [{ role: 'user', content: `${i}` }, { role: 'assistant', tool_calls: [{ id: `${i}` }], content: null }, { role: 'tool', tool_call_id: `${i}`, content: 'result' }]).flat();
  const split = splitHistory(messages); assert.equal(split.older.length, 6); assert.equal(split.recent.length, 18); assert.equal(split.recent[0].role, 'user');
  assert.ok(projectedTokens(messages, '', { prompt_tokens: 2000, completion_tokens: 100, local_context_tokens: 1 }) > 2100);
});
test('lock-in state is idempotent, raises rounds, restores effort/tools and clears stale grants', () => {
  for (const tools of [true, false]) {
    const settings = { effort: 'low' }, permissions = { enabled: tools, session: false, allowed: new Set() };
    const lock = new LockIn(settings, permissions);
    assert.equal(lock.rounds, 8); lock.set(true); lock.set(true);
    assert.equal(lock.rounds, 24); assert.equal(settings.effort, 'max'); assert.equal(permissions.enabled, true);
    lock.set(false); lock.set(false); assert.equal(settings.effort, 'low'); assert.equal(permissions.enabled, tools); assert.equal(lock.rounds, 8);
  }
});
test('inspector keys preserve drafts, switch tabs and never intercept approval input', () => {
  const input = Object.create(Input.prototype);
  Object.assign(input, { menuEnabled: true, waiter() {}, render() {}, line: 'draft', cursor: 5, panel: false });
  input.key('', { ctrl: true, name: 't' }); assert.equal(input.panel, true);
  input.key('4', { name: '4' }); assert.equal(input.panelTab, 3);
  input.key('', { name: 'right' }); assert.equal(input.panelTab, 0);
  input.key('', { name: 'escape' }); assert.equal(input.panel, false); assert.equal(input.line, 'draft');
  input.menuEnabled = false; input.key('', { ctrl: true, name: 't' }); assert.equal(input.panel, false);
});
test('completion includes slash args, quoted image paths and freeform tool path arguments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-complete-'));
  try {
    fs.writeFileSync(path.join(dir, 'my image.png'), '');
    assert.equal(completions('/lockin o').length, 2); assert.equal(completions('/compact a')[0].value, '/compact auto');
    assert.ok(completions(`/img ${dir}/my`)[0].value.endsWith('my image.png"'));
    assert.ok(pathCompletions(`read_file {"path":"${dir}/my`)[0].value.includes('my image.png'));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('automatic compaction persists retained turns, savings, lock-in markers and ledger boundary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-compact-')), fixture = await startFixture();
  const old = process.env.AXON_BASE_URL, threshold = process.env.AXON_COMPACT_THRESHOLD;
  process.env.AXON_BASE_URL = fixture.url; process.env.AXON_COMPACT_THRESHOLD = '.001';
  try {
    const session = new Session(dir), engine = new Engine({ dir, key: 'fixture-key', session, settings: { model: 'axon-1.8-flash', effort: 'off' }, ui: silent, permissions: new Permissions(null, silent) });
    session.add({ role: 'user', content: 'Historical decisions. '.repeat(1000) });
    for (let i = 0; i < 6; i++) { session.add({ role: 'user', content: 'Keep ' + i }); session.add({ role: 'assistant', content: 'OK ' + i }); }
    const recent = session.messages.slice(-12); engine.setLockIn(true);
    assert.equal(await engine.maybeCompact(), true); assert.deepEqual(session.messages, recent);
    const resumed = new Session(dir, session.id); assert.deepEqual(resumed.messages, recent); assert.equal(resumed.compactions, 1); assert.ok(resumed.lastCompactionSavings > 0); assert.equal(resumed.lockin, true);
    assert.ok(engine.projectedContext < 2000);
    engine.setLockIn(false); assert.equal(new Session(dir, session.id).lockin, false);
    const noOlder = await engine.compact(); assert.equal(noOlder.changed, false);
    assert.ok(fixture.requests.every(r => !r.tools && r.model === 'axon-1.8-lightning'));
  } finally { if (old === undefined) delete process.env.AXON_BASE_URL; else process.env.AXON_BASE_URL = old; if (threshold === undefined) delete process.env.AXON_COMPACT_THRESHOLD; else process.env.AXON_COMPACT_THRESHOLD = threshold; await fixture.close(); fs.rmSync(dir, { recursive: true }); }
});

test('interactive tools default on; explicit --no-tools and one-shot/pipes stay off', () => {
  assert.equal(toolsDefault(parseArgs([]), true), true);
  assert.equal(toolsDefault(parseArgs(['--no-tools']), true), false);
  assert.equal(toolsDefault(parseArgs([]), false), false);
  assert.equal(toolsDefault(parseArgs(['--tools']), false), true);
});
test('agent loop actually continues beyond eight rounds when locked, but stops at 24', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-loop-'));
  try {
    for (const [locked, finalAt, expected] of [[false, 10, 8], [true, 10, 10], [true, 100, 24]]) {
      const session = new Session(dir), engine = new Engine({ dir, key: 'fixture-key', session, settings: { model: 'axon-1.8-flash', effort: 'low' }, ui: silent, permissions: new Permissions(null, silent) });
      engine.setLockIn(locked); let count = 0;
      engine.request = async () => { count++; return { content: count === finalAt ? 'Final answer' : '', reasoning: '', toolCalls: count === finalAt ? [] : [{ id: 'call_' + count, function: { name: 'list_dir', arguments: '{"path":"."}' } }] }; };
      await engine.turn('Work until done');
      assert.equal(count, expected);
      assert.equal(session.messages.filter(m => m.role === 'tool').length, expected - (finalAt === expected ? 1 : 0));
    }
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('empty or failed compaction cannot replace history; unpaired tool results stay in recent groups', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-atomic-'));
  try {
    const session = new Session(dir), engine = new Engine({ dir, key: 'fixture-key', session, settings: { model: 'axon-1.8-flash', effort: 'off' }, ui: silent, permissions: new Permissions(null, silent) });
    for (let i = 0; i < 8; i++) session.add({ role: 'user', content: 'History '.repeat(100) });
    const before = JSON.stringify(session.messages);
    engine.request = async () => ({ content: ' ' });
    await assert.rejects(engine.compact(), /Empty summary/);
    assert.equal(JSON.stringify(session.messages), before); assert.equal(session.compactions, 0); assert.equal(engine.compacting, false);
    engine.request = async () => { throw new Error('network down'); };
    await assert.rejects(engine.compact(), /network down/);
    assert.equal(JSON.stringify(new Session(dir, session.id).messages), before);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
