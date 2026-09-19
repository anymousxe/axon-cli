import { MODELS, EFFORTS } from './models.js';
export const COMMANDS = [
  ['/btw', 'Ask Lightning without adding context'], ['/fast', 'Toggle Lightning with thinking off'],
  ['/compact', 'Summarize context with Lightning'], ['/retry', 'Resend the last user turn'],
  ['/copy', 'Copy the last assistant answer'], ['/usage', 'Detailed per-model token and cost ledger'],
  ['/status', 'Model, key, context and session details'], ['/theme', 'Choose dark, light or auto palette'],
  ['/model', 'List or switch models'], ['/think', 'Set effort or show/hide reasoning'],
  ['/hide-thinking', 'Toggle reasoning visibility'], ['/img', 'Attach image from file or clipboard'],
  ['/images', 'Clear queued images'], ['/tools', 'Toggle permission-gated tools'],
  ['/cost', 'Session and all-time costs'], ['/memory', 'List persistent memories'],
  ['/remember', 'Save a persistent memory'], ['/forget', 'Remove a numbered memory'],
  ['/chats', 'List recent chats'], ['/resume', 'Resume a recent chat'], ['/title', 'Rename this chat'],
  ['/clear', 'Clear context; keep transcript'], ['/new', 'Start a new chat'],
  ['/help', 'Show all commands'], ['/exit', 'Save and exit'],
];
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
    else if (command === '/tools') rows = ['on', 'off'].map(value => ({ value, description: 'Tools ' + value }));
    else if (command === '/images') rows = [{ value: 'clear', description: 'Remove all queued images' }];
    else return [];
    rows = rows.map(row => ({ ...row, label: row.value, value: command + ' ' + row.value }));
  }
  return rows.map(row => ({ ...row, score: fuzzyScore(query, row.label) })).filter(row => row.score >= 0).sort((a, b) => b.score - a.score);
}
export const SLASH_HELP = COMMANDS.map(([name, description]) => `${name.padEnd(17)}${description}`).join('\n') + '\n\n/think off|low|medium|high|max or show|hide\n/theme dark|light|auto\n↑/↓ choose · Tab/Enter complete · Esc dismiss · Enter again to run\n/img [path] reads clipboard without a path. Ctrl-V pastes text.\nCtrl-C cancels; Ctrl-D leaves. // sends a literal leading slash.';
