export function safeText(text) {
  // Never allow model/tool text to inject terminal control sequences.
  return String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export class UI {
  constructor({ json = false, color = process.stderr.isTTY && process.env.TERM !== 'dumb' && !('NO_COLOR' in process.env) } = {}) {
    this.json = json;
    this.color = color;
    this.section = null;
    this.answerStarted = false;
    this.activityTimer = null;
  }
  style(code, text) { return this.color ? `\x1b[${code}m${text}\x1b[0m` : text; }
  startActivity(text) {
    if (!this.color || this.json) return;
    this.stopActivity();
    let frame = 0;
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.activityTimer = setInterval(() => {
      process.stderr.write('\r\x1b[2K' + this.style('2', `${frames[frame++ % frames.length]} ${safeText(text)}`));
    }, 100);
    this.activityTimer.unref();
  }
  stopActivity() {
    if (this.activityTimer) { clearInterval(this.activityTimer); this.activityTimer = null; process.stderr.write('\r\x1b[2K'); }
  }
  info(text = '') { this.stopActivity(); if (!this.json) process.stderr.write(safeText(text) + '\n'); }
  error(text) { this.stopActivity(); process.stderr.write(this.style('31', `Error: ${safeText(text)}`) + '\n'); }
  event(type, data = {}) { if (this.json) process.stdout.write(JSON.stringify({ type, ...data }) + '\n'); }
  begin() { this.section = null; this.answerStarted = false; }
  reasoning(text) {
    this.stopActivity();
    if (this.json) return this.event('reasoning', { text });
    if (this.section !== 'reasoning') {
      process.stderr.write(this.style('2;3', '\n∴ thinking\n'));
      this.section = 'reasoning';
    }
    process.stderr.write(this.style('2;3', safeText(text)));
  }
  answer(text) {
    this.stopActivity();
    if (this.json) return this.event('delta', { text });
    if (this.section === 'reasoning') process.stderr.write('\n\n');
    this.section = 'answer';
    this.answerStarted = true;
    process.stdout.write(safeText(text));
  }
  finish() {
    this.stopActivity();
    if (!this.json && this.section === 'reasoning') process.stderr.write('\n');
    if (!this.json && this.answerStarted) process.stdout.write('\n');
    this.section = null;
  }
  tool(name, args, result) {
    if (this.json) return this.event('tool', { name, arguments: args, result });
    const text = result.length > 1800 ? result.slice(0, 1800) + '\n… output truncated for display' : result;
    this.info(`\n┌ ${name} ${JSON.stringify(args).slice(0, 300)}\n${text.split('\n').map(x => '│ ' + x).join('\n')}\n└`);
  }
  status(state, cost, context) {
    const text = `${state.model} · ${state.variant} · think ${state.effort} · ${cost} session · ctx ${context}%`;
    this.info();
    if (!this.json) process.stderr.write(this.style('2', text) + '\n');
  }
}
