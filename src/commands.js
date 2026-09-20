import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MODELS, EFFORTS } from './models.js';
export const COMMANDS = [
  ['/panel', 'Tabbed session / usage / memory / tools inspector'], ['/lockin', 'Lock in: max effort, tools, 24 rounds (on|off)'],
  ['/btw', 'Ask Lightning without adding context'], ['/fast', 'Toggle Lightning with thinking off'],
  ['/compact', 'Compact older turns; auto|off toggles automation'], ['/retry', 'Resend the last user turn'],
  ['/copy', 'Copy the last assistant answer'], ['/usage', 'Detailed per-model token and cost ledger'],
  ['/status', 'Model, key, context and session details'], ['/theme', 'Choose dark, light or auto palette'],
  ['/model', 'List or switch models'], ['/think', 'Set effort or show/hide reasoning'],
  ['/hide-thinking', 'Toggle reasoning visibility'], ['/img', 'Attach image from file or clipboard'],
  ['/imgs', 'List pending image attachments'], ['/images', 'Clear queued images (/images clear)'], ['/tools', 'Toggle permission-gated tools'],
  ['/cost', 'Session and all-time costs'], ['/memory', 'List persistent memories'],
  ['/remember', 'Save a persistent memory'], ['/forget', 'Remove a numbered memory'],
  ['/chats', 'List recent chats'], ['/resume', 'Resume a recent chat'], ['/title', 'Rename this chat'],
  ['/clear', 'Clear context; keep transcript'], ['/new', 'Start a new chat'],
  ['/help', 'Show all commands'], ['/exit', 'Save and exit'],
];
export function isCommandLine(line) {
  if (line.includes('\n')) return false;
  const name = line.trimStart().split(/\s/, 1)[0];
  return name === '/quit' || COMMANDS.some(([command]) => command === name);
}
export function fuzzyScore(query, text) {
  query = query.toLowerCase(); text = text.toLowerCase();
  if (text.startsWith(query)) return 1000 - text.length;
  let at = -1, score = 0;
  for (const char of query) { const next = text.indexOf(char, at + 1); if (next < 0) return -1; score += next === at + 1 ? 10 : 1; at = next; }
  return score;
}
export function completions(line, chats = []) {
  if (!line.startsWith('/') || line.startsWith('//') || line.includes('\n')) return [];
  const match = line.match(/^(\/\S+)\s+(.*)$/);
  let rows, query;
  if (!match) { query = line; rows = COMMANDS.map(([value, description]) => ({ value: value + ' ', label: value, description })); }
  else {
    const [, command, arg] = match; query = arg;
    if (command === '/model') rows = Object.entries(MODELS).map(([value, price]) => ({ value, description: `$${price.input.toFixed(2)} in / $${price.output.toFixed(2)} out per 1M` }));
    else if (command === '/think') rows = [...EFFORTS, 'show', 'hide'].map(value => ({ value, description: 'Thinking ' + value }));
    else if (command === '/theme') rows = ['dark', 'light', 'auto'].map(value => ({ value, description: value === 'auto' ? 'Detect terminal background' : value + ' background palette' }));
    else if (command === '/resume') rows = chats.map(chat => ({ value: chat.id, description: chat.title }));
    else if (command === '/compact') rows = ['auto', 'off'].map(value => ({ value, description: 'Auto compaction ' + value }));
    else if (command === '/panel') rows = ['session', 'usage', 'memory', 'tools'].map(value => ({ value, description: 'Inspector tab' }));
    else if (command === '/img') return pathCompletions(line);
    else if (command === '/tools' || command === '/lockin') rows = ['on', 'off'].map(value => ({ value, description: 'Tools ' + value }));
    else if (command === '/images') rows = [{ value: 'clear', description: 'Remove all queued images' }];
    else return [];
    rows = rows.map(row => ({ ...row, label: row.value, value: command + ' ' + row.value }));
  }
  return rows.map(row => ({ ...row, score: fuzzyScore(query, row.label) })).filter(row => row.score >= 0).sort((a, b) => b.score - a.score);
}
export const SLASH_HELP = COMMANDS.map(([name, description]) => `${name.padEnd(17)}${description}`).join('\n') + '\n\n/think off|low|medium|high|max or show|hide\n/theme dark|light|auto\n↑/↓ choose · Tab/Enter complete · Esc dismiss · Enter again to run\n/img [path] reads clipboard without a path. Ctrl-V pastes images or text.\nPaste a local image path to attach; /imgs lists chips; /images clear removes all.\nEnter sends pending images; Ctrl-U edits text only. Ctrl-L clears the screen.\nCtrl-T opens the inspector; ←/→ or 1–4 switch tabs, q/Esc close.\n/lockin on|off sets max effort + tools; /compact auto|off toggles automatic compaction.\nCtrl-C or double-Esc cancels; Ctrl-D exits on empty input. ↑/↓ recall history. // sends a literal leading slash.';

// Also used by Tab in free text: shell-like path tokens and JSON tool arguments.
export function pathCompletions(line) {
  const match = line.startsWith('/img ') ? line.slice(5).match(/^(["']?)([^"'\n]*)$/) : line.match(/(?:^|\s|[:=])(["'])([^"'\n]*)$|(?:^|\s|[:=])()([^\s"'\n]*)$/);
  if (!match) return [];
  const quote = match[1] ?? match[3], token = match[2] ?? match[4];
  const image = line.startsWith('/img ');
  if (!image && !/^(?:\.{1,2}[\\/]|~[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(token)) return [];
  const typed = token || './';
  const expanded = typed.replace(/^~(?=[\\/])/, os.homedir());
  const slash = Math.max(expanded.lastIndexOf('/'), expanded.lastIndexOf('\\'));
  const folder = slash < 0 ? '.' : expanded.slice(0, slash + 1), base = slash < 0 ? expanded : expanded.slice(slash + 1);
  const typedSlash = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\'));
  const prefix = typedSlash < 0 ? '' : typed.slice(0, typedSlash + 1);
  const start = line.length - token.length - quote.length;
  try {
    return fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.name.startsWith(base)).slice(0, 80).map(e => {
      const value = prefix + e.name + (e.isDirectory() ? path.sep : '');
      const q = quote || (/\s/.test(value) ? '"' : '');
      return { label: value, value: line.slice(0, start) + q + value + (q && !e.isDirectory() ? q : ''), description: e.isDirectory() ? 'directory' : 'file' };
    });
  } catch { return []; }
}
