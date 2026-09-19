import readline from 'node:readline';
import { Writable } from 'node:stream';

export class Input {
  constructor(onInterrupt) {
    this.queue = []; this.waiter = null; this.closed = false; this.muted = false;
    this.terminal = Boolean(process.stdin.isTTY && process.stderr.isTTY && process.env.TERM !== 'dumb');
    const output = new Writable({ write: (chunk, encoding, callback) => { if (!this.muted) process.stderr.write(chunk); callback(); } });
    output.isTTY = this.terminal;
    output.columns = process.stderr.columns || 80;
    this.rl = readline.createInterface({ input: process.stdin, output, terminal: this.terminal, historySize: 200, removeHistoryDuplicates: true });
    this.rl.on('line', line => { if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve(line); } else this.queue.push(line); });
    this.rl.on('close', () => { this.closed = true; if (this.waiter) { this.waiter(null); this.waiter = null; } });
    this.rl.on('SIGINT', () => { this.cancel(); onInterrupt(); });
  }
  next(prompt = '') {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.resolve(null);
    if (prompt) { if (this.terminal) { this.rl.setPrompt(prompt); this.rl.prompt(); } else if (process.stdin.isTTY) process.stderr.write(prompt); }
    return new Promise(resolve => { this.waiter = resolve; });
  }
  async ask(prompt, secret = false) {
    if (!secret) return (await this.next(prompt)) ?? '';
    process.stderr.write(prompt);
    this.muted = this.terminal;
    const answer = await this.next();
    this.muted = false;
    if (this.terminal) { this.rl.history = []; process.stderr.write('\n'); }
    return answer ?? '';
  }
  cancel() { if (this.waiter) { this.waiter(''); this.waiter = null; } }
  close() { this.rl.close(); }
}
