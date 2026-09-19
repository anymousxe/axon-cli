import readline from 'node:readline';
import { Writable } from 'node:stream';
import { safeText, terminalCaps, Palette, fitCells, displayWidth, inputViewport } from './render.js';
import { completions, isCommandLine } from './commands.js';
import { readClipboard, extractImages, imageChip } from './images.js';
export class Input {
  constructor(onInterrupt) {
    this.queue = []; this.waiter = null; this.closed = false; this.muted = false;
    this.terminal = Boolean(process.stdin.isTTY && typeof process.stdin.setRawMode === 'function' && terminalCaps().ansi);
    this.onInterrupt = onInterrupt; this.rows = 0; this.line = ''; this.cursor = 0;
    this.history = []; this.historyAt = 0; this.selected = 0; this.dismissed = false;
    this.menuEnabled = false; this.palette = new Palette();
    if (this.terminal) {
      this.wasRaw = process.stdin.isRaw;
      readline.emitKeypressEvents(process.stdin);
      this.keyHandler = (text, key) => this.key(text, key || {});
      this.resizeHandler = () => { if (this.waiter) this.render(); };
      process.stdin.on('keypress', this.keyHandler); process.stderr.on('resize', this.resizeHandler);
      process.stdin.setRawMode(true); process.stdin.resume();
      process.stderr.write('\x1b[?2004h');
    } else {
      const output = new Writable({ write: (chunk, encoding, callback) => { if (!this.muted) process.stderr.write(chunk); callback(); } });
      this.rl = readline.createInterface({ input: process.stdin, output, terminal: false });
      this.rl.on('line', line => { if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve(line); } else this.queue.push(line); });
      this.rl.on('close', () => { this.closed = true; if (this.waiter) { this.waiter(null); this.waiter = null; } });
    }
  }
  configure({ chats, status, palette, attachments, attach } = {}) { this.chats = chats; this.status = status; this.attachments = attachments; this.attach = attach; if (palette) this.palette = palette; }
  items() { return this.menuEnabled && !this.muted && !this.dismissed ? completions(this.line, this.line.startsWith('/resume ') ? this.chats?.() || [] : []) : []; }
  erase() {
    if (!this.terminal || !this.rows) return;
    process.stderr.write('\r' + (this.rows > 1 ? `\x1b[${this.rows - 1}A` : '') + '\x1b[J'); this.rows = 0;
  }
  render() {
    this.erase();
    const width = Math.max(1, (process.stderr.columns || 80) - 1);
    const clip = value => fitCells(safeText(value).replace(/\n/g, '↵').replace(/\t/g, '  '), width);
    const lines = [];
    if (this.menuEnabled && this.status) lines.push(this.palette.paint('primary', clip(this.status())));
    const chips = this.menuEnabled ? this.attachments?.() || [] : [];
    const chipLimit = Math.max(1, Math.floor((process.stderr.rows || 24) / 4));
    for (let i = 0; i < Math.min(chips.length, chipLimit); i++) lines.push(this.palette.paint('meta', clip(imageChip(chips[i], i))));
    if (chips.length > chipLimit) lines.push(this.palette.paint('meta', clip(`+${chips.length - chipLimit} images · /imgs to list`)));
    if (this.notice) lines.push(this.palette.paint('meta', clip(this.notice)));
    const items = this.items(); this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
    const count = Math.max(1, Math.min(6, (process.stderr.rows || 24) - lines.length - 3));
    const start = Math.max(0, this.selected - count + 1);
    for (let i = start; i < Math.min(items.length, start + count); i++) {
      const row = items[i];
      lines.push(this.palette.paint(i === this.selected ? 'primary' : 'meta', clip(`${i === this.selected ? '›' : ' '} ${row.label}  ${row.description}`)));
    }
    const prompt = fitCells(clip(this.prompt || ''), Math.max(0, width - 2));
    const shown = this.muted ? '' : this.line.replace(/\n/g, '↵').replace(/\t/g, ' ');
    const available = Math.max(1, width - displayWidth(prompt));
    const view = inputViewport(shown, this.cursor, available);
    lines.push(this.palette.paint('primary', prompt) + view.text);
    process.stderr.write(lines.join('\n'));
    this.rows = lines.length;
    const col = displayWidth(prompt) + (this.muted ? 0 : view.column);
    process.stderr.write('\r' + (col ? `\x1b[${col}C` : ''));
  }
  edit() { this.dismissed = false; this.selected = 0; this.render(); }
  insert(text) { this.line = this.line.slice(0, this.cursor) + text + this.line.slice(this.cursor); this.cursor += text.length; }
  detectImages() {
    if (!this.menuEnabled || this.muted || !this.attach || isCommandLine(this.line)) return false;
    const found = extractImages(this.line);
    if (!found.images.length) return false;
    const left = extractImages(this.line.slice(0, this.cursor)).text;
    this.line = found.text; this.cursor = Math.min(left.length, this.line.length);
    this.attach(found.images); return true;
  }
  async pasteClipboard() {
    if (this.clipboardBusy) return;
    const waiter = this.waiter;
    this.clipboardBusy = true; this.clipboardKeys = []; this.notice = 'Reading clipboard…'; this.render();
    try {
      const value = await (this.readClipboard || readClipboard)();
      if (this.closed || this.waiter !== waiter) return;
      this.notice = '';
      if (value.image) {
        if (this.menuEnabled && !this.muted && this.attach) this.attach([value.image]);
        else this.notice = 'Image paste is only available at the chat prompt; use /img <path>.';
      } else { this.insert(safeText(value.text.replace(/\r\n?/g, '\n'))); this.detectImages(); }
    } catch (error) { if (this.waiter === waiter) this.notice = error.message; }
    finally {
      this.clipboardBusy = false;
      const keys = this.clipboardKeys; this.clipboardKeys = [];
      if (!this.closed && this.waiter === waiter) { this.edit(); for (const [text, key] of keys) this.key(text, key); }
    }
  }
  key(text, key) {
    if (key.ctrl && key.name === 'c' && !this.pasting) { this.cancel(); this.onInterrupt(); return; }
    if (key.name === 'escape' && !this.pasting) {
      const now = Date.now();
      if (key.sequence === '\x1b\x1b' || (this.escapeAt && now - this.escapeAt < 500)) { this.escapeAt = 0; this.onInterrupt(); }
      else this.escapeAt = now;
      if (this.waiter) { this.dismissed = true; this.render(); }
      return;
    }
    this.escapeAt = 0;
    if (!this.waiter) return;
    if (this.clipboardBusy) { this.clipboardKeys.push([text, key]); return; }
    if (key.name === 'paste-start') { this.pasting = true; this.paste = ''; return; }
    if (key.name === 'paste-end') {
      this.pasting = false; this.insert(safeText(this.paste.replace(/\r\n?/g, '\n'))); this.paste = ''; this.detectImages(); this.edit(); return;
    }
    if (this.pasting) { this.paste += text || key.sequence || ''; return; }
    if (key.ctrl && key.name === 'v') { void this.pasteClipboard(); return; }
    if (key.ctrl && key.name === 'l') { if (this.terminal) { process.stderr.write('\x1b[2J\x1b[H'); this.rows = 0; } this.render(); return; }
    if (key.ctrl && key.name === 'd') { if (!this.line) this.close(); else { this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + ([...this.line.slice(this.cursor)][0]?.length || 0)); this.edit(); } return; }
    const items = this.items();
    if (items.length && ['up', 'down'].includes(key.name)) { this.selected = (this.selected + (key.name === 'down' ? 1 : -1) + items.length) % items.length; this.render(); return; }
    if (key.name === 'tab' || (items.length && key.name === 'return')) {
      if (!items.length && key.name === 'tab') { this.dismissed = false; this.render(); return; }
      const item = items[this.selected] || items[0];
      if (item) { this.line = item.value; this.cursor = this.line.length; this.dismissed = true; this.selected = 0; this.render(); }
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      if (this.detectImages() && !this.line.trim()) { this.line = ''; this.cursor = 0; this.edit(); return; }
      this.submit(this.line); return;
    }
    if (key.name === 'backspace') {
      if (this.cursor) { const n = [...this.line.slice(0, this.cursor)].at(-1).length; this.line = this.line.slice(0, this.cursor - n) + this.line.slice(this.cursor); this.cursor -= n; } this.edit(); return;
    }
    if (key.name === 'delete') { const n = [...this.line.slice(this.cursor)][0]?.length || 0; this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + n); this.edit(); return; }
    if (key.name === 'left') this.cursor = Math.max(0, this.cursor - ([...this.line.slice(0, this.cursor)].at(-1)?.length || 0));
    else if (key.name === 'right') this.cursor = Math.min(this.line.length, this.cursor + ([...this.line.slice(this.cursor)][0]?.length || 0));
    else if (key.name === 'home' || (key.ctrl && key.name === 'a')) this.cursor = 0;
    else if (key.name === 'end' || (key.ctrl && key.name === 'e')) this.cursor = this.line.length;
    else if (key.ctrl && key.name === 'u') { this.line = this.line.slice(this.cursor); this.cursor = 0; this.edit(); return; }
    else if (key.ctrl && key.name === 'k') { this.line = this.line.slice(0, this.cursor); this.edit(); return; }
    else if (key.ctrl && key.name === 'w') { const left = this.line.slice(0, this.cursor).replace(/\s*\S+\s*$/, ''); this.line = left + this.line.slice(this.cursor); this.cursor = left.length; this.edit(); return; }
    else if (['up', 'down'].includes(key.name) && !this.muted) {
      if (this.historyAt === this.history.length) this.draft = this.line;
      this.historyAt = Math.max(0, Math.min(this.history.length, this.historyAt + (key.name === 'up' ? -1 : 1)));
      this.line = this.history[this.historyAt] ?? this.draft ?? ''; this.cursor = this.line.length; this.dismissed = true;
    } else if (text && !key.ctrl && !key.meta && !text.startsWith('\x1b')) { this.insert(safeText(text)); if (/\s/.test(text)) this.detectImages(); this.edit(); return; }
    this.render();
  }
  submit(line) {
    this.erase();
    if (this.terminal) process.stderr.write(safeText(this.prompt || '') + (this.muted ? '' : safeText(line)) + '\n');
    if (!this.muted && line && this.menuEnabled) { this.history.push(line); if (this.history.length > 200) this.history.shift(); }
    this.line = ''; this.cursor = 0;
    const resolve = this.waiter; this.waiter = null; resolve?.(line);
  }
  next(prompt = '', menu = true) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.resolve(null);
    this.cancelled = false; this.notice = ''; this.pasting = false; this.paste = ''; this.prompt = prompt; this.menuEnabled = menu; this.line = ''; this.cursor = 0; this.dismissed = false; this.selected = 0; this.historyAt = this.history.length;
    return new Promise(resolve => {
      this.waiter = resolve;
      if (this.terminal) this.render(); else if (process.stdin.isTTY && prompt) process.stderr.write(prompt);
    });
  }
  async ask(prompt, secret = false) {
    this.muted = secret;
    try { return (await this.next(prompt, false)) ?? ''; }
    finally { this.muted = false; }
  }
  cancel() { if (this.waiter) { this.erase(); const resolve = this.waiter; this.waiter = null; this.line = ''; this.cursor = 0; resolve(''); this.cancelled = true; } }
  close() {
    if (this.terminal && !this.closed) {
      this.erase(); process.stderr.write('\x1b[?2004l');
      process.stdin.removeListener('keypress', this.keyHandler); process.stderr.removeListener('resize', this.resizeHandler);
      process.stdin.setRawMode(Boolean(this.wasRaw)); process.stdin.pause();
      this.waiter?.(null); this.waiter = null;
    }
    this.closed = true; this.rl?.close();
  }
}
