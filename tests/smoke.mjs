import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.mjs';
import { Engine } from '../src/engine.js';
import { Session } from '../src/storage.js';
import { Permissions } from '../src/tools.js';
import { costFor } from '../src/models.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
if (live && !process.env.AXON_API_KEY) { console.error('Set AXON_API_KEY to a working test key. No keys are bundled.'); process.exit(2); }
const fixture = live ? null : await startFixture();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-smoke-'));
const env = { ...process.env, AXON_CONFIG_DIR: dir, AXON_API_KEY: live ? process.env.AXON_API_KEY : 'fixture-key', NO_COLOR: '1' };
if (fixture) env.AXON_BASE_URL = fixture.url;
const run = (args, input = '', timeout = 90000) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['bin/axon.js', ...args], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out: ${args.join(' ')}`)); }, timeout);
  child.stdout.on('data', chunk => out += chunk); child.stderr.on('data', chunk => err += chunk);
  child.on('error', reject);
  child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  child.stdin.end(input);
});
const events = result => result.out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
let passed = 0;
const ok = name => { console.log(`✓ ${name}`); passed++; };
try {
  const one = await run(['-p', 'Reply with a short greeting.', '--json']);
  assert.equal(one.code, 0, one.err);
  const result = events(one).find(e => e.type === 'result');
  assert.ok(result?.text); assert.ok(result.usage.prompt_tokens >= 0); assert.ok(result.session_id);
  ok('one-shot streaming + structured result + usage');
  const pipe = await run([], 'Give me a short greeting.');
  assert.equal(pipe.code, 0, pipe.err); assert.ok(pipe.out.trim()); ok('pipe stdin');
  const repl = await run(['--repl'], '/think medium\nReply with a short greeting.\n/think off\n/cost\n/exit\n');
  assert.equal(repl.code, 0, repl.err); assert.ok(repl.out.trim()); assert.match(repl.err, /All-time/); assert.match(repl.err, /thinking/i);
  ok('streamed REPL over piped lines + thinking + cost');
  const memory1 = await run(['--repl'], '/remember My favorite color is teal\n/exit\n');
  assert.equal(memory1.code, 0, memory1.err);
  const memory2 = await run(['-p', 'What is my favorite color? Reply in one sentence.', '--json']);
  assert.equal(memory2.code, 0, memory2.err); assert.match(events(memory2).find(e => e.type === 'result').text, /teal/i);
  ok('memory persistence across two processes');
  const image = path.join(dir, 'pixel.png');
  fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5E0AAAAASUVORK5CYII=', 'base64'));
  for (const [model, route] of [['axon-1.8-flash', 'native'], ['axon-1.8-lightning', 'describe']]) {
    const vision = await run(['--model', model, '-i', image, '-p', 'Describe what you see briefly.', '--json']);
    assert.equal(vision.code, 0, vision.err);
    assert.ok(events(vision).some(e => e.type === 'image_route' && e.route === route));
    assert.ok(events(vision).find(e => e.type === 'result')?.text); ok(`image routing: ${model} → ${route}`);
  }
  const first = await run(['-p', 'Remember the word ORCHID for this conversation.', '--json']);
  assert.equal(first.code, 0, first.err);
  const id = events(first).find(e => e.type === 'result').session_id;
  for (const flags of [['-c'], ['-r', id]]) {
    const resumed = await run([...flags, '-p', 'What was the previous word? Reply with just that word.', '--json']);
    assert.equal(resumed.code, 0, resumed.err); assert.match(events(resumed).find(e => e.type === 'result').text, /ORCHID/i);
  }
  ok('continue and resume replay context');
  // Exercise a real process execution behind an explicitly granted permission.
  // Production never exposes an auto-approve flag to piped/model-controlled input.
  const oldBase = process.env.AXON_BASE_URL;
  if (fixture) process.env.AXON_BASE_URL = fixture.url;
  let toolSeen = false;
  const ui = { begin() {}, finish() {}, info() {}, event() {}, answer() {}, reasoning() {}, tool(name, args, output) { if (name === 'run_command' && output.includes('AXON_TOOL_OK') && output.includes('exit 0')) toolSeen = true; } };
  const engine = new Engine({ dir, key: env.AXON_API_KEY, session: new Session(dir), settings: { model: 'axon-1.8-flash', variant: 'stellar', effort: 'off', showThinking: false }, ui, permissions: new Permissions(async () => 'y', ui, true) });
  await engine.turn(live ? 'Use the run_command tool to execute exactly: echo AXON_TOOL_OK. Then report the output. Do not just describe running it.' : 'FIXTURE_TOOL');
  assert.ok(toolSeen, 'Model did not execute the echo tool');
  if (oldBase === undefined) delete process.env.AXON_BASE_URL; else process.env.AXON_BASE_URL = oldBase;
  ok('function-calling loop → approved real echo command → model follow-up');
  assert.equal(costFor('axon-1.8-flash', { prompt_tokens: 1e6, completion_tokens: 1e6 }), 0.4);
  const usage = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
  assert.ok(usage.total > 0); assert.ok(usage.models['axon-1.8-flash']); ok('cost arithmetic + persisted model breakdown');
  if (fixture) {
    const denied = await run(['--tools', '-p', 'FIXTURE_TOOL', '--json']);
    assert.equal(denied.code, 0, denied.err); assert.ok(events(denied).some(e => e.type === 'tool' && e.result.includes('Permission denied')));
    ok('non-TTY tool approval fails closed');
    assert.ok(fixture.requests.some(r => r.model === 'axon-1.8-lightning' && JSON.stringify(r.messages).includes('image_description')));
    assert.ok(fixture.requests.every(r => r.model === 'axon-1.8-flash' || !r.messages.some(m => Array.isArray(m.content))));
    ok('wire payloads confirm native and describe routing');
  }
  console.log(`\n${passed} smoke checks passed (${live ? 'LIVE API' : 'local HTTP/SSE fixture; not live API verification'}).`);
} catch (error) {
  console.error(`\nSMOKE FAILED (${live ? 'live' : 'fixture'}): ${error.stack}`); process.exitCode = 1;
} finally { await fixture?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
