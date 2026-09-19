import { safeText, terminalCaps, Palette, AnswerRenderer, colorDiff, fitCells } from './render.js';
export class UI {
  constructor({ json = false, color = terminalCaps().color, theme = 'auto' } = {}) {
    this.json = json; this.color = color && !json;
    this.palette = new Palette({ color: this.color, theme });
    this.answerPalette = new Palette({ color: this.color && Boolean(process.stdout.isTTY), theme });
    this.section = null; this.answerStarted = false; this.activityTimer = null;
  }
  style(code, text) { return this.color ? `\x1b[${code}m${text}\x1b[0m` : text; }
  setTheme(theme) { this.palette.setTheme(theme); this.answerPalette.setTheme(theme); }
  async banner(version, id) {
    const mark = terminalCaps().unicode ? 'ϟ' : '*';
    if (this.color) {
      for (const intensity of ['2', '22', '1']) {
        process.stderr.write('\r\x1b[2K' + this.style(intensity, this.palette.paint('primary', `  ${mark} AXON ${version}`)));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      process.stderr.write('\n');
    } else this.info(`  ${mark} AXON ${version}`);
    this.info(`  ${id}\n  /help for commands · / for menu · Ctrl-C cancels\n`);
  }
  startActivity(text, thinking = false) {
    if (!this.color || this.json) return;
    this.stopActivity();
    let frame = 0; const start = Date.now();
    const frames = terminalCaps().unicode ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] : ['|', '/', '-', '\\'];
    const draw = () => {
      const label = thinking ? this.style(frame % 8 < 4 ? '2' : '1', '∴ thinking') : frames[frame % frames.length];
      frame++;
      if ((process.stderr.columns || 80) < 25) { process.stderr.write('\r\x1b[2K' + this.palette.paint('primary', fitCells(`${frames[frame % frames.length]} ${((Date.now() - start) / 1000).toFixed(1)}s`, Math.max(0, process.stderr.columns - 1)))); return; }
      process.stderr.write('\r\x1b[2K' + this.palette.paint(thinking ? 'thinking' : 'primary', `${label} ${((Date.now() - start) / 1000).toFixed(1)}s`) + ' ' + this.palette.paint('meta', fitCells(safeText(text).replace(/\n/g, ' '), Math.max(0, (process.stderr.columns || 80) - 25))));
    };
    draw(); this.activityTimer = setInterval(draw, 100); this.activityTimer.unref();
  }
  stopActivity() {
    if (this.activityTimer) { clearInterval(this.activityTimer); this.activityTimer = null; process.stderr.write('\r\x1b[2K'); }
  }
  info(text = '') { this.stopActivity(); if (!this.json) process.stderr.write(this.palette.paint('meta', safeText(text)) + '\n'); }
  error(text) { this.stopActivity(); process.stderr.write(this.palette.paint('error', `Error: ${safeText(text)}`) + '\n'); }
  event(type, data = {}) { if (this.json) process.stdout.write(JSON.stringify({ type, ...data }) + '\n'); }
  begin() {
    this.section = null; this.answerStarted = false; this.reasonBuffer = '';
    this.renderer = new AnswerRenderer(text => process.stdout.write(text), this.answerPalette);
  }
  flushReasoning() {
    this.stopActivity();
    if (this.reasonBuffer) { process.stderr.write(this.palette.paint('thinking', safeText(this.reasonBuffer)) + '\n'); this.reasonBuffer = ''; }
  }
  reasoning(text) {
    this.stopActivity();
    if (this.json) return this.event('reasoning', { text });
    if (this.section !== 'reasoning') {
      process.stderr.write(this.palette.paint('thinking', '\n∴ thinking\n')); this.section = 'reasoning';
    }
    if (!this.color) { process.stderr.write(safeText(text)); return; }
    this.reasonBuffer += safeText(text);
    // Keep the pulse on a dedicated line so it never overwrites streamed text.
    const width = Math.max(20, (process.stderr.columns || 80) - 4);
    while (this.reasonBuffer.includes('\n') || this.reasonBuffer.length >= width) {
      const at = this.reasonBuffer.indexOf('\n'); const count = at >= 0 && at < width ? at : width;
      process.stderr.write(this.palette.paint('thinking', this.reasonBuffer.slice(0, count)) + '\n');
      this.reasonBuffer = this.reasonBuffer.slice(count + (this.reasonBuffer[count] === '\n' ? 1 : 0));
    }
    this.startActivity(this.reasonBuffer, true);
  }
  answer(text) {
    this.stopActivity();
    if (this.json) return this.event('delta', { text });
    if (this.section === 'reasoning') { this.flushReasoning(); process.stderr.write('\n'); }
    this.section = 'answer'; this.answerStarted = true;
    this.renderer ||= new AnswerRenderer(text => process.stdout.write(text), this.answerPalette);
    this.renderer.push(text);
  }
  finish() {
    this.stopActivity();
    if (!this.json && this.section === 'reasoning') { this.flushReasoning(); process.stderr.write('\n'); }
    if (!this.json && this.answerStarted) { this.renderer?.finish(); process.stdout.write('\n'); }
    if (this.color && this.answerStarted) process.stderr.write(this.style('1', this.palette.paint('ok', '✓')) + '\n');
    this.section = null; this.answerStarted = false;
  }
  async pulse() {
    if (!this.color) return;
    process.stderr.write(this.style('1', this.palette.paint('ok', '✓ complete')));
    await new Promise(resolve => setTimeout(resolve, 100));
    process.stderr.write('\r\x1b[2K' + this.palette.paint('meta', '✓ complete') + '\n');
  }
  diff(text) { this.stopActivity(); if (this.json) this.event('diff', { text }); else process.stderr.write(colorDiff(text, this.palette) + '\n'); }
  tool(name, args, result) {
    if (this.json) return this.event('tool', { name, arguments: args, result });
    const text = result.length > 1800 ? result.slice(0, 1800) + '\n… output truncated for display' : result;
    this.info(`\n┌ ${name} ${JSON.stringify(args).slice(0, 300)}\n${text.split('\n').map(x => '│ ' + x).join('\n')}\n└`);
  }
  statusText(state, cost, context) {
    return `${state.fast ? '⚡ ' : ''}${state.model} · ${state.effort} · ctx ${context}% · ${cost} session`;
  }
  status(state, cost, context) {
    this.stopActivity(); if (this.json) return;
    const text = this.statusText(state, cost, context);
    process.stderr.write('\n' + this.palette.paint('primary', process.stderr.isTTY ? fitCells(text, Math.max(1, (process.stderr.columns || 80) - 1)) : text) + '\n');
  }
}
