import { setTimeout as sleep } from 'node:timers/promises';
import { APIError } from './api.js';

const DEFAULT_SITE = 'https://axon-chat-nu.vercel.app';

// The chat endpoint lives at {site}/api/v1/chat/completions; account routes at {site}/api/*.
export function siteBase(url = process.env.AXON_BASE_URL || DEFAULT_SITE + '/api') {
  return String(url).replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/v1$/, '');
}

function absolute(url, base) { return /^https?:\/\//i.test(url) ? url : new URL(url, new URL(base).origin).toString(); }

export async function startDeviceFlow(signal) {
  const response = await fetch(`${siteBase()}/cli/device`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal });
  if (!response.ok) throw new APIError(response.status, await response.text());
  const flow = await response.json().catch(() => null);
  if (!flow?.device_code || !flow?.user_code) throw new Error('The login service returned an unexpected response.');
  return {
    device_code: flow.device_code,
    user_code: flow.user_code,
    verification_url: absolute(flow.verification_url || '/cli-auth', siteBase()),
    expires_in: Number(flow.expires_in) > 0 ? Number(flow.expires_in) : 900,
    interval: Number(flow.interval) > 0 ? Number(flow.interval) : 5,
  };
}

export async function pollDevice({ device_code, interval = 5, expires_in = 900, onPoll = () => {}, signal }) {
  const deadline = Date.now() + expires_in * 1000;
  for (;;) {
    signal?.throwIfAborted();
    const response = await fetch(`${siteBase()}/cli/device`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_code }), signal });
    if (!response.ok) throw new APIError(response.status, await response.text());
    const state = await response.json().catch(() => null);
    if (state?.status === 'approved') return state.api_key;
    if (state?.status === 'expired' || Date.now() + interval * 1000 >= deadline) throw new Error('Login window expired. Run `axon login` again.');
    if (state?.status !== 'pending') throw new Error('The login service returned an unexpected response.');
    onPoll(state);
    await sleep(interval * 1000, undefined, { signal });
  }
}

export async function fetchUsage(key, signal) {
  const response = await fetch(`${siteBase()}/usage`, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new APIError(response.status, await response.text());
  return response.json();
}

export function formatCount(n) { return Number(n || 0).toLocaleString('en-US'); }
function limitText(limit) { return Number(limit) > 0 ? formatCount(limit) : 'unlimited'; }
function bar(used, limit, width = 20) {
  if (!(Number(limit) > 0)) return `${'█'.repeat(width)}  ${formatCount(used)} / unlimited`;
  const ratio = Math.min(1, Math.max(0, used / limit));
  return `${'█'.repeat(Math.round(ratio * width))}${'░'.repeat(width - Math.round(ratio * width))}  ${formatCount(used)} / ${formatCount(limit)} (${Math.round(ratio * 100)}%)`;
}

export function renderUsage(u, now = Date.now()) {
  const ends = u?.period_ends_at ? new Date(u.period_ends_at) : null;
  const valid = ends && !Number.isNaN(ends.getTime());
  const days = valid ? Math.max(0, Math.ceil((ends.getTime() - now) / 86400000)) : null;
  const head = `${u?.plan ?? 'free'} plan · resets ${valid ? ends.toISOString().slice(0, 10) : 'unknown'}${days !== null ? ` (in ${days} day${days === 1 ? '' : 's'})` : ''}`;
  return [head, `Tokens  ${bar(u?.tokens_used, u?.tokens_limit)}`, `Images  ${bar(u?.images_used, u?.images_limit)}`].join('\n');
}

export function keyMask(key) {
  if (!key) return 'none';
  return key.length >= 14 ? `${key.slice(0, 8)}…${key.slice(-4)}` : `${key.slice(0, 4)}…`;
}

export function whoamiLine(key, u) {
  return `Logged in as key ${keyMask(key)} · ${u?.plan ?? 'free'} · tokens ${formatCount(u?.tokens_used)}/${limitText(u?.tokens_limit)} · images ${formatCount(u?.images_used)}/${limitText(u?.images_limit)} · renews ${u?.period_ends_at ? new Date(u.period_ends_at).toISOString().slice(0, 10) : 'unknown'}`;
}
