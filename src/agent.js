import { messageTokens } from './storage.js';
import { tokensFor, CONTEXT_TOKENS } from './models.js';

// Unknown server windows deliberately use the conservative local input budget.
export function compactThreshold(value = process.env.AXON_COMPACT_THRESHOLD) {
  if (value === undefined || value === '') return 0.8;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 100 ? (n > 1 ? n / 100 : n) : 0.8;
}
export function projectedTokens(messages, summary = '', ledger = null) {
  const local = messages.reduce((n, m) => n + messageTokens(m), tokensFor(summary)) + 128;
  // Usage is a floor only for the same active context, never a lifetime sum.
  return Math.max(local, ledger ? ledger.prompt_tokens + ledger.completion_tokens + Math.max(0, local - (ledger.local_context_tokens || local)) : 0);
}
export function shouldCompact(tokens, threshold = compactThreshold(), window = CONTEXT_TOKENS) {
  return tokens >= window * threshold;
}
export function splitHistory(messages, keepTurns = 6) {
  const starts = messages.flatMap((m, i) => m.role === 'user' ? [i] : []);
  const at = starts.length > keepTurns ? starts[starts.length - keepTurns] : 0;
  return { older: messages.slice(0, at), recent: messages.slice(at) };
}
export class LockIn {
  constructor(settings, permissions) { this.settings = settings; this.permissions = permissions; this.previous = null; }
  get active() { return Boolean(this.previous); }
  get rounds() { return this.active ? 24 : 8; }
  set(enabled) {
    if (enabled && !this.active) {
      this.previous = { effort: this.settings.effort, tools: this.permissions.enabled };
      this.settings.effort = 'max'; this.settings.lockin = true; this.permissions.enabled = true;
    } else if (!enabled && this.active) {
      this.settings.effort = this.previous.effort; this.permissions.enabled = this.previous.tools;
      this.settings.lockin = false; this.previous = null;
      if (!this.permissions.enabled) { this.permissions.session = false; this.permissions.allowed?.clear(); }
    }
    return this.active;
  }
}
