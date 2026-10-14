export const DEFAULT_MODEL = 'axon-2-cobalt';
// category: flagship | 2. Users may hide any model except the flagship via /models.
export const MODELS = {
  'axon-2-cobalt': { name: 'Axon 2 Cobalt', input: 0.40, output: 1.20, vision: true, context: 2_000_000, category: 'flagship' },
  'axon-2-regent': { name: 'Axon 2 Regent', input: 0.80, output: 2.40, vision: true, context: 2_000_000, category: '2' },
  'axon-2-monarch': { name: 'Axon 2 Monarch', input: 2.00, output: 4.00, vision: true, context: 2_000_000, category: '2' },
};
export const CATEGORIES = [['flagship', 'Flagship'], ['2', 'Axon 2']];
// 'off' sends no reasoning_effort at all; the rest are sent to the API as-is.
export const EFFORTS = ['off', 'xlite', 'low', 'medium', 'high', 'xhigh', 'max'];
// The free plan's "Extended thinking" control: Standard (xlite) plus a small monthly budget of the rest.
export const FREE_EFFORTS = ['xlite', 'low', 'medium', 'high'];
export const FREE_CONTEXT = 512_000;
// A conservative local input budget, not a claim about the server's context limit.
export const CONTEXT_TOKENS = 24000;
export const isFree = plan => plan === 'free';
// Per-model local input budget: the large-window models keep far more history
// locally before compacting; the free plan is capped at 512K.
export function contextWindowFor(model, plan) {
  const window = MODELS[model]?.context ?? CONTEXT_TOKENS;
  return isFree(plan) ? Math.min(window, FREE_CONTEXT) : window;
}
// xlite is 0.4x of the listed rate; Fast mode is 3x.
export function costFor(model, usage, { effort, fast } = {}) {
  const price = MODELS[model];
  if (!price) throw new Error(`Unknown model: ${model}`);
  const factor = (effort === 'xlite' ? 0.4 : 1) * (fast ? 3 : 1);
  return ((usage.prompt_tokens || 0) * price.input + (usage.completion_tokens || 0) * price.output) * factor / 1e6;
}
export function money(value) { return `$${value.toFixed(value < 0.01 ? 4 : 2)}`; }
export function tokensFor(value) { return Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / 4); }
// Saved selections that no longer name a public model (including withdrawn ones) fall back to the flagship.
export function migrateModel(model) { return MODELS[model] ? model : DEFAULT_MODEL; }
export function effortLabel(effort) { return effort === 'xlite' ? 'standard' : effort; }
export function parseEffort(value, plan) {
  const effort = value === 'standard' ? 'xlite' : value;
  if (!EFFORTS.includes(effort)) throw new Error(`Thinking effort must be one of: ${(isFree(plan) ? ['standard', ...FREE_EFFORTS.slice(1)] : EFFORTS).join(', ')}`);
  if (isFree(plan) && effort !== 'off' && !FREE_EFFORTS.includes(effort)) throw new Error('Free plan thinking options: standard, low, medium, high.');
  return effort;
}
// Visibility overrides: { hidden: [ids], shown: [ids] }. Unlisted models are visible.
export function visibilityOf(overrides) {
  return { hidden: Array.isArray(overrides?.hidden) ? overrides.hidden : [], shown: Array.isArray(overrides?.shown) ? overrides.shown : [] };
}
export function isVisible(id, overrides) {
  const { hidden } = visibilityOf(overrides);
  if (id === DEFAULT_MODEL) return true;
  if (hidden.includes(id)) return false;
  return true;
}
export function setVisible(overrides, id, visible) {
  if (!MODELS[id]) throw new Error(`Unknown model: ${id}. Models: ${Object.keys(MODELS).join(', ')}`);
  if (!visible && id === DEFAULT_MODEL) throw new Error(`${MODELS[id].name} is the flagship and cannot be hidden.`);
  const { hidden, shown } = visibilityOf(overrides);
  const rest = list => list.filter(x => x !== id);
  return visible ? { hidden: rest(hidden), shown: [...rest(shown), id] } : { hidden: [...rest(hidden), id], shown: rest(shown) };
}
// Models offered in pickers for a plan: free is fixed to the flagship.
export function visibleModels(overrides, plan) {
  return Object.keys(MODELS).filter(id => isFree(plan) ? id === DEFAULT_MODEL : isVisible(id, overrides));
}
export function priceText(id) { return `$${MODELS[id].input.toFixed(2)} in / $${MODELS[id].output.toFixed(2)} out per 1M`; }
export function validateSettings(settings) {
  if (!MODELS[settings.model]) throw new Error(`Model must be one of: ${Object.keys(MODELS).join(', ')}`);
  if (!EFFORTS.includes(settings.effort)) throw new Error(`Thinking effort must be one of: ${EFFORTS.join(', ')}`);
}
