export const MODELS = {
  'axon-1.6': { input: 0.05, output: 0.15, vision: false },
  'axon-1.6-pro': { input: 0.15, output: 0.40, vision: false },
  'axon-1.8-flash': { input: 0.10, output: 0.30, vision: true },
  'axon-1.8-lightning': { input: 0.03, output: 0.08, vision: false },
};
export const VARIANTS = ['crescent', 'stellar', 'zetta', 'nano'];
export const EFFORTS = ['off', 'low', 'medium', 'high', 'max'];
// A conservative local input budget, not a claim about the server's context limit.
export const CONTEXT_TOKENS = 24000;
export function costFor(model, usage) {
  const price = MODELS[model];
  if (!price) throw new Error(`Unknown model: ${model}`);
  return ((usage.prompt_tokens || 0) * price.input + (usage.completion_tokens || 0) * price.output) / 1e6;
}
export function money(value) { return `$${value.toFixed(value < 0.01 ? 4 : 2)}`; }
export function tokensFor(value) { return Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / 4); }
export function validateSettings(settings) {
  if (!MODELS[settings.model]) throw new Error(`Model must be one of: ${Object.keys(MODELS).join(', ')}`);
  if (!VARIANTS.includes(settings.variant)) throw new Error(`Variant must be one of: ${VARIANTS.join(', ')}`);
  if (!EFFORTS.includes(settings.effort)) throw new Error(`Thinking effort must be one of: ${EFFORTS.join(', ')}`);
}
