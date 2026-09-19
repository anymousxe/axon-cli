import readline from 'node:readline';
import { Writable } from 'node:stream';
import { safeText, terminalCaps, Palette } from './render.js';
import { completions } from './commands.js';
export class Input {
  constructor(onInterrupt) {
    this.queue = []; this.waiter = null; this.closed = false; this.muted = false;
    this.terminal = Boolean(process.stdin.isTTY && terminalCaps().ansi);
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
  configure({ chats, status, palette } = {}) { this.chats = chats; this.status = status; if (palette) this.palette = palette; }
  items() { return this.menuEnabled && !this.muted && !this.dismissed ? completions(this.line, this.line.startsWith('/resume ') ? this.chats?.() || [] : []) : []; }
  erase() {
    if (!this.terminal || !this.rows) return;
    process.stderr.write('\r' + (this.rows > 1 ? `\x1b[${this.rows - 1}A` : '') + '\x1b[J'); this.rows = 0;
  }
  render() {
    this.erase();
    const width = Math.max(8, (process.stderr.columns || 80) - 1);
    const clip = value => [...safeText(value).replace(/\n/g, '↵').replace(/\t/g, '  ')].slice(0, width).join('');
    const lines = [];
    if (this.menuEnabled && this.status) lines.push(this.palette.paint('primary', clip(this.status())));
    const items = this.items(); this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
    const count = Math.max(1, Math.min(6, (process.stderr.rows || 24) - 5));
    const start = Math.max(0, this.selected - count + 1);
    for (let i = start; i < Math.min(items.length, start + count); i++) {
      const row = items[i];
      lines.push(this.palette.paint(i === this.selected ? 'primary' : 'meta', clip(`${i === this.selected ? '›' : ' '} ${row.label}  ${row.description}`)));
    }
    const prompt = clip(this.prompt || '').slice(0, Math.max(1, width - 4));
    const shown = this.muted ? '' : this.line.replace(/\n/g, '↵').replace(/\t/g, ' ');
    const available = Math.max(1, width - [...prompt].length);
    const charCursor = [...shown.slice(0, this.cursor)].length;
    const offset = Math.max(0, charCursor - available + 1);
    const visible = [...shown].slice(offset, offset + available).join('');
    lines.push(this.palette.paint('primary', prompt) + visible);
    process.stderr.write(lines.join('\n'));
    this.rows = lines.length;
    const col = [...prompt].length + (this.muted ? 0 : charCursor - offset);
    process.stderr.write('\r' + (col ? `\x1b[${col}C` : ''));
  }
  edit() { this.dismissed = false; this.selected = 0; this.render(); }
  insert(text) { this.line = this.line.slice(0, this.cursor) + text + this.line.slice(this.cursor); this.cursor += text.length; }
  key(text, key) {
    if (key.ctrl && key.name === 'c') { this.cancel(); this.onInterrupt(); return; }
    if (!this.waiter) return;
    if (key.name === 'paste-start') { this.pasting = true; this.paste = ''; return; }
    if (key.name === 'paste-end') {
      this.pasting = false; this.insert(safeText(this.paste.replace(/\r\n?/g, '\n'))); this.paste = ''; this.edit(); return;
    }
    if (this.pasting) { this.paste += text || key.sequence || ''; return; }
    if (key.ctrl && key.name === 'd') { if (!this.line) this.close(); else { this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + 1); this.edit(); } return; }
    if (key.name === 'escape') { this.dismissed = true; this.render(); return; }
    const items = this.items();
    if (items.length && ['up', 'down'].includes(key.name)) { this.selected = (this.selected + (key.name === 'down' ? 1 : -1) + items.length) % items.length; this.render(); return; }
    if (key.name === 'tab' || (items.length && key.name === 'return')) {
      if (!items.length && key.name === 'tab') { this.dismissed = false; this.render(); return; }
      const item = items[this.selected] || items[0];
      if (item) { this.line = item.value; this.cursor = this.line.length; this.dismissed = true; this.selected = 0; this.render(); }
      return;
    }
    if (key.name === 'return' || key.name === 'enter') { this.submit(this.line); return; }
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
    } else if (text && !key.ctrl && !key.meta && !text.startsWith('\x1b')) { this.insert(safeText(text)); this.edit(); return; }
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
    this.prompt = prompt; this.menuEnabled = menu; this.line = ''; this.cursor = 0; this.dismissed = false; this.selected = 0; this.historyAt = this.history.length;
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
  cancel() { if (this.waiter) this.submit(''); }
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
