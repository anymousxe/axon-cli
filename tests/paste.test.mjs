import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readClipboard, extractImages, imagePart, imageDimensions, imageChip } from '../src/images.js';
import { Input } from '../src/input.js';
import { fitCells, displayWidth, inputViewport, Palette } from '../src/render.js';
import { COMMANDS, SLASH_HELP } from '../src/commands.js';
import { startFixture } from './fixture.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5E0AAAAASUVORK5CYII=', 'base64');

function editor() {
  const input = Object.create(Input.prototype), attachments = [];
  Object.assign(input, { line: '', cursor: 0, selected: 0, menuEnabled: true, muted: false, dismissed: false, history: [], historyAt: 0, waiter() {}, render() {}, onInterrupt() {}, attachments: () => attachments, attach: images => attachments.push(...images) });
  return input;
}

test('clipboard: Wayland image, X11 fallback, exact multiline text, bounded provider errors', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    if (args.includes('--list-types')) return Buffer.from('text/plain\nimage/png\n');
    if (args.includes('image/png')) return png;
    assert.fail('image must be preferred over text');
  };
  assert.equal((await readClipboard({ platform: 'linux', run })).image.width, 1);
  assert.equal(calls.length, 2);
  const fallback = async (command, args) => {
    if (command === 'wl-paste') return null;
    if (args.includes('TARGETS')) return Buffer.from('UTF8_STRING\nimage/png');
    if (args.includes('image/png')) return png;
    assert.fail('unexpected read');
  };
  assert.equal((await readClipboard({ platform: 'linux', run: fallback })).image.name, 'clipboard');
  const text = 'hello\nworld\n';
  assert.deepEqual(await readClipboard({ platform: 'linux', run: async (_, args) => Buffer.from(args.includes('--list-types') ? 'text/plain' : text) }), { text });
  await assert.rejects(readClipboard({ platform: 'linux', run: async () => null }), /\/img <path>/);
});

test('clipboard: macOS pngpaste and osascript; Windows image and UTF-8 text envelopes', async () => {
  assert.ok((await readClipboard({ platform: 'darwin', run: async command => command === 'pngpaste' ? png : null })).image);
  assert.deepEqual(await readClipboard({ platform: 'darwin', run: async command => command === 'osascript' ? Buffer.from('text\n\n') : null }), { text: 'text\n' });
  for (const [prefix, bytes, property] of [['IMAGE:', png, 'image'], ['TEXT:', Buffer.from('héllo\n世界'), 'text']]) {
    const result = await readClipboard({ platform: 'win32', run: async (command, args) => {
      assert.equal(command, 'powershell.exe'); assert.ok(args.includes('-STA')); assert.match(args.at(-1), /Get-Clipboard/);
      return Buffer.from(prefix + bytes.toString('base64'));
    } });
    assert.ok(result[property]); if (property === 'text') assert.equal(result.text, 'héllo\n世界');
  }
});

test('dimensions and attachment chips support PNG, GIF, JPEG, WebP and truncated headers', () => {
  assert.equal(imageChip(imagePart(png), 0), '[img 1 · clipboard · 1x1]');
  const gif = Buffer.alloc(10); gif.write('GIF89a'); gif.writeUInt16LE(1170, 6); gif.writeUInt16LE(1969, 8);
  assert.equal(imagePart(gif).height, 1969);
  const jpeg = Buffer.from([255,216,255,192,0,11,8,0,10,0,20,1,1,0,0]);
  assert.deepEqual(imageDimensions(jpeg, 'image/jpeg'), { width: 20, height: 10 });
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(1169, 24, 3); webp.writeUIntLE(1968, 27, 3);
  assert.equal(imagePart(webp).width, 1170);
  for (let n = 0; n < 30; n++) assert.doesNotThrow(() => imageDimensions(webp.subarray(0, n), 'image/webp'));
});

test('existing local paths attach anywhere; quotes, escaped spaces, file URIs, missing files and prose', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-path-'));
  try {
    const file = path.join(dir, 'my image.PNG'); fs.writeFileSync(file, png);
    for (const text of [file, `"${file}"`, file.replace(/ /g, '\\ '), `file://${file.replace(/ /g, '%20')}`]) {
      const found = extractImages(text); assert.equal(found.images.length, 1, text); assert.equal(found.text, '');
    }
    const found = extractImages(`compare "${file}" and '${file}' please`);
    assert.equal(found.images.length, 2); assert.equal(found.text, 'compare  and  please');
    for (const text of ['see missing.png', 'https://example.com/image.png', '/help', 'ordinary prose']) assert.deepEqual(extractImages(text), { text, images: [] });
    const i = editor(); i.line = file; i.cursor = file.length; i.key('', { name: 'return' });
    assert.equal(i.attachments().length, 1); assert.equal(i.line, ''); assert.ok(i.waiter, 'path-only input must leave a chip, not submit');
    i.line = `/img "${file}"`; assert.equal(i.detectImages(), false);
    i.line = `/remember ${file}`; assert.equal(i.detectImages(), false);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('Ctrl-V attaches images, inserts text at cursor, queues keys and never submits a late paste', async () => {
  const i = editor(); i.readClipboard = async () => ({ image: imagePart(png) });
  await i.pasteClipboard(); assert.equal(i.attachments().length, 1); assert.equal(i.line, '');
  i.line = 'ab'; i.cursor = 1; i.readClipboard = async () => ({ text: 'x\r\ny' });
  await i.pasteClipboard(); assert.equal(i.line, 'ax\nyb'); assert.equal(i.cursor, 4);
  let resolve; i.readClipboard = () => new Promise(r => resolve = r);
  const paste = i.pasteClipboard(); i.key('z', {}); resolve({ text: '!' }); await paste;
  assert.equal(i.line, 'ax\ny!zb');
  const late = i.pasteClipboard(); i.waiter = () => {}; resolve({ image: imagePart(png) }); await late;
  assert.equal(i.attachments().length, 1);
  i.readClipboard = async () => { throw new Error('Clipboard unavailable: /img <path>'); };
  await i.pasteClipboard(); assert.match(i.notice, /\/img/);
  i.muted = true; i.readClipboard = async () => ({ image: imagePart(png) }); await i.pasteClipboard(); assert.equal(i.attachments().length, 1);
});

test('interrupts without an input waiter, empty Ctrl-D, history draft and Ctrl-U keep chips', () => {
  const i = editor(); let count = 0; i.onInterrupt = () => count++;
  i.waiter = null; i.key('', { name: 'escape' }); i.key('', { name: 'escape' }); assert.equal(count, 1);
  i.waiter = () => {}; i.history = ['first', 'second']; i.historyAt = 2;
  i.key('', { name: 'up' }); assert.equal(i.line, 'second'); i.key('', { name: 'up' }); assert.equal(i.line, 'first');
  i.key('', { name: 'down' }); i.key('', { name: 'down' }); assert.equal(i.line, '');
  i.attach([imagePart(png)]); i.key('draft', {}); i.key('', { ctrl: true, name: 'u' }); assert.equal(i.line, ''); assert.equal(i.attachments().length, 1);
  i.line = '😀x'; i.cursor = 0; i.key('', { ctrl: true, name: 'd' }); assert.equal(i.line, 'x');
  i.line = ''; i.erase = () => {}; let cancelled; i.waiter = value => cancelled = value; i.cancel(); assert.equal(cancelled, ''); assert.equal(i.cancelled, true); assert.equal(i.attachments().length, 1);
  i.waiter = () => {}; i.close = () => i.closed = true; i.key('', { ctrl: true, name: 'd' }); assert.ok(i.closed);
});

test('cell-aware clipping fits narrow terminals, CJK, combining marks and emoji', () => {
  assert.equal(displayWidth('A界😀é'), 6);
  assert.equal(fitCells('A界😀é', 4), 'A界');
  assert.equal(displayWidth('👨‍👩‍👧‍👦'), 2);
  for (let width = 1; width < 30; width++) {
    const view = inputViewport('hello 世界 😀 world', 11, width);
    assert.ok(displayWidth(view.text) <= width); assert.ok(view.column < width);
  }
  for (const [command, description] of COMMANDS) { assert.ok(SLASH_HELP.includes(command)); assert.ok(SLASH_HELP.includes(description)); }
});

test('render limits chips and fits every status/menu/input row at narrow widths', () => {
  const i = editor(), oldWrite = process.stderr.write, oldCols = process.stderr.columns, oldRows = process.stderr.rows;
  i.render = Input.prototype.render; i.palette = new Palette({ color: false }); i.rows = 0; i.prompt = 'axon › '; i.status = () => '界'.repeat(100);
  i.line = '/'; i.cursor = 1; i.attach(Array.from({ length: 12 }, () => imagePart(png)));
  try {
    process.stderr.rows = 15;
    for (const width of [4, 12, 30, 60]) {
      let out = ''; process.stderr.columns = width; process.stderr.write = value => { out += value; return true; };
      i.render();
      for (const line of out.split('\n')) assert.ok(displayWidth(line) <= width - 1, JSON.stringify(line));
    }
  } finally { process.stderr.write = oldWrite; process.stderr.columns = oldCols; process.stderr.rows = oldRows; }
});

test('bundle attaches -p paths, piped paths, REPL mixed text, lists and clears images', async () => {
  const fixture = await startFixture(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-paste-'));
  const file = path.join(dir, 'pixel.png'); fs.writeFileSync(file, png);
  const run = (args, text = '') => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/axon.mjs', ...args, '--json'], { env: { ...process.env, AXON_CONFIG_DIR: dir, AXON_API_KEY: 'fixture-key', AXON_BASE_URL: fixture.url, NO_COLOR: '1' } });
    let out = '', err = ''; child.stdout.on('data', data => out += data); child.stderr.on('data', data => err += data); child.on('error', reject);
    child.on('close', code => { try { assert.equal(code, 0, err); resolve(out.trim().split('\n').map(JSON.parse)); } catch (error) { reject(error); } }); child.stdin.end(text);
  });
  try {
    for (const [args, text] of [[['-p', file], ''], [[], file], [['-p', `describe "${file}"`], ''], [['--repl'], `${file}\n/imgs\nDescribe it\n/exit\n`], [['--repl'], `Describe ${file}\n/exit\n`]]) {
      const events = await run(args, text); assert.ok(events.some(e => e.type === 'image_route' && e.route === 'native')); assert.ok(events.some(e => e.type === 'result'));
    }
    const events = await run(['--repl'], `${file}\n/imgs\n/images clear\n/imgs\nhello\n/exit\n`);
    assert.match(events.find(e => e.command === '/imgs').text, /1x1/);
    assert.ok(events.some(e => e.command === '/imgs' && e.text === 'No pending images.'));
    assert.ok(!events.some(e => e.type === 'image_route'));
    const lightning = await run(['--model', 'axon-1.8-lightning', '-p', file]);
    assert.ok(lightning.some(e => e.type === 'image_route' && e.route === 'describe'));
  } finally { await fixture.close(); fs.rmSync(dir, { recursive: true }); }
});
