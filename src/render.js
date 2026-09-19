export function safeText(text) {
  return String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export function terminalCaps(stream = process.stderr, env = process.env, platform = process.platform) {
  const ansi = Boolean(stream.isTTY && env.TERM !== 'dumb' && (platform !== 'win32' || env.WT_SESSION || env.ANSICON || env.TERM || env.ConEmuANSI === 'ON'));
  return { ansi, color: ansi && !('NO_COLOR' in env), truecolor: /truecolor|24bit/i.test(env.COLORTERM || '') || Boolean(env.WT_SESSION), unicode: platform !== 'win32' || Boolean(env.WT_SESSION) };
}
export class Palette {
  constructor({ color = terminalCaps().color, theme = 'auto', env = process.env, truecolor = terminalCaps().truecolor } = {}) {
    this.enabled = color; this.truecolor = truecolor; this.env = env; this.setTheme(theme);
  }
  setTheme(theme) {
    this.theme = theme;
    this.light = theme === 'light' || (theme === 'auto' && Number(this.env.COLORFGBG?.split(';').at(-1)) >= 10);
  }
  paint(name, value) {
    const text = String(value);
    if (!this.enabled) return text;
    const dark = { primary: [117, '139;213;255'], thinking: [221, '255;204;102'], ok: [114, '151;218;141'], error: [203, '255;110;120'], meta: [245, '139;148;165'], string: [150, '178;220;155'], keyword: [111, '135;174;255'], number: [215, '255;190;130'], func: [159, '164;236;239'] };
    const light = { primary: [25, '0;91;150'], thinking: [130, '145;82;0'], ok: [28, '32;113;43'], error: [160, '184;34;52'], meta: [240, '88;97;112'], string: [28, '41;110;36'], keyword: [61, '78;73;172'], number: [130, '145;82;0'], func: [30, '0;107;122'] };
    const [index, rgb] = (this.light ? light : dark)[name] || dark.meta;
    return `\x1b[${this.truecolor ? '38;2;' + rgb : '38;5;' + index}m${text}\x1b[0m`;
  }
}
const WORDS = {
  js: 'async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
  json: 'true false null',
  sql: 'select from where insert into values update set delete create alter drop table join inner left right outer on as and or not null is group by order having limit offset union all distinct asc desc case when then else end exists primary key references',
  bash: 'if then else elif fi for while do done case esac in function select until echo export local readonly return exit source sudo cd',
};
export function highlight(code, language, palette) {
  const lang = ({ javascript: 'js', typescript: 'js', ts: 'js', jsx: 'js', tsx: 'js', python: 'py', sh: 'bash', shell: 'bash' })[language] || language;
  if (!WORDS[lang]) return safeText(code);
  const keywords = new Set((WORDS[lang] + (lang === 'js' ? ' interface type implements public private protected readonly enum namespace declare abstract string number boolean unknown never any' : '')).split(' '));
  // Single lexical pass: generated ANSI is never fed back into the tokenizer.
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*|\/\*[\s\S]*?(?:\*\/|$)|--.*|#.*|\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|\b[A-Za-z_$][\w$]*\b)/gi;
  return safeText(code).replace(pattern, (token, _capture, offset, source) => {
    let color;
    if (/^["'`]/.test(token)) color = 'string';
    else if ((lang === 'js' && /^\//.test(token)) || (lang === 'sql' && token.startsWith('--')) || (['py', 'bash'].includes(lang) && token.startsWith('#'))) color = 'meta';
    else if (/^\d/.test(token)) color = 'number';
    else if (keywords.has(lang === 'sql' ? token.toLowerCase() : token)) color = 'keyword';
    else if (/^\s*\(/.test(source.slice(offset + token.length))) color = 'func';
    return color ? palette.paint(color, token) : token;
  });
}
export function colorDiff(diff, palette) {
  return safeText(diff).split('\n').map(line => palette.paint(line.startsWith('+') && !line.startsWith('+++') ? 'ok' : line.startsWith('-') && !line.startsWith('---') ? 'error' : 'meta', line)).join('\n');
}
export function unifiedDiff(before, after, file = 'file') {
  if (before === after) return '';
  const a = before ? before.replace(/\n$/, '').split('\n') : [], b = after ? after.replace(/\n$/, '').split('\n') : [];
  let start = 0, end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  const lo = Math.max(0, start - 3), hiA = Math.min(a.length, a.length - end + 3), hiB = Math.min(b.length, b.length - end + 3);
  return [`--- a/${safeText(file)}`, `+++ b/${safeText(file)}`, `@@ -${a.length ? lo + 1 : 0},${hiA - lo} +${b.length ? lo + 1 : 0},${hiB - lo} @@`, ...a.slice(lo, start).map(x => ' ' + x), ...a.slice(start, a.length - end).map(x => '-' + x), ...b.slice(start, b.length - end).map(x => '+' + x), ...a.slice(a.length - end, hiA).map(x => ' ' + x), ...(before.endsWith('\n') === after.endsWith('\n') ? [] : ['\\ No newline at end of file (changed)'])].join('\n');
}
// Prose streams immediately; only fences and code lines wait for a newline.
export class AnswerRenderer {
  constructor(write, palette) { this.write = write; this.palette = palette; this.line = ''; this.fence = null; this.prose = false; }
  push(text) {
    if (!this.palette.enabled) { this.write(safeText(text)); return; }
    for (const char of safeText(text)) {
      if (char === '\n') { this.flushLine(true); continue; }
      if (this.prose) this.write(char);
      else {
        this.line += char;
        if (!this.fence && !/^\s{0,3}`{0,3}[^`]*$/.test(this.line)) this.prose = true;
        if (!this.fence && !/^ {0,3}`/.test(this.line) && !/^ {0,3}$/.test(this.line)) this.prose = true;
        if (this.prose) { this.write(this.line); this.line = ''; }
      }
    }
  }
  flushLine(newline) {
    const match = this.line.match(/^ {0,3}(`{3,})([\w+-]*)\s*$/);
    if (!this.prose && match && (!this.fence || (match[1].length >= this.fence.length && !match[2]))) {
      if (this.fence) { this.write(this.palette.paint('meta', '└────────────────────')); this.fence = null; }
      else { this.fence = { length: match[1].length, lang: match[2].toLowerCase() }; this.write(this.palette.paint('meta', `┌─ ${match[2] || 'code'} ──────────────`)); }
    } else if (this.fence) this.write(this.palette.paint('meta', '│ ') + highlight(this.line, this.fence.lang, this.palette));
    else if (this.line) this.write(this.line);
    if (newline) this.write('\n');
    this.line = ''; this.prose = false;
  }
  finish() { if (this.line) this.flushLine(false); if (this.fence) { this.write('\n' + this.palette.paint('meta', '└────────────────────')); this.fence = null; } }
}
