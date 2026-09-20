import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { APIError, completion } from '../src/api.js';
import { startDeviceFlow, pollDevice, fetchUsage, renderUsage, keyMask, whoamiLine } from '../src/auth.js';

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.AXON_BASE_URL;
  process.env.AXON_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try { await callback(); }
  finally {
    process.env.AXON_BASE_URL = previous;
    await new Promise(resolve => server.close(resolve));
  }
}

const json = (res, status, object) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(object)); };
const readBody = (req, fn) => { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => fn(body ? JSON.parse(body) : {})); };

test('device flow: pending polls then approved returns the issued API key', async () => {
  const seen = [];
  await withServer((req, res) => {
    if (req.url.split('?')[0] !== '/cli/device') { json(res, 404, { error: 'not found' }); return; }
    readBody(req, body => {
      seen.push(body);
      if (seen.length === 1) { json(res, 200, { device_code: 'dev-1', user_code: 'ABCD-1234', verification_url: '/cli-auth', expires_in: 30, interval: 0.01 }); return; }
      json(res, 200, seen.length < 4 ? { status: 'pending' } : { status: 'approved', api_key: 'axk-test1234567890ok' });
    });
  }, async () => {
    const flow = await startDeviceFlow();
    assert.equal(flow.user_code, 'ABCD-1234');
    assert.equal(flow.verification_url, `${process.env.AXON_BASE_URL}/cli-auth`);
    assert.equal(flow.interval, 0.01);
    const polls = [];
    const key = await pollDevice({ device_code: flow.device_code, interval: flow.interval, expires_in: flow.expires_in, onPoll: state => polls.push(state.status) });
    assert.equal(key, 'axk-test1234567890ok');
    assert.deepEqual(polls, ['pending', 'pending']);
    assert.deepEqual(seen[0], {});
    assert.deepEqual(seen[1], { device_code: 'dev-1' });
  });
});

test('device flow: server-side expiry and local deadline both fail cleanly', async () => {
  await withServer((req, res) => {
    readBody(req, body => {
      if (!body.device_code) { json(res, 200, { device_code: 'dev-2', user_code: 'WXYZ-9999', expires_in: 30, interval: 0.01 }); return; }
      json(res, 200, body.device_code === 'dev-3' ? { status: 'pending' } : { status: 'expired' });
    });
  }, async () => {
    const flow = await startDeviceFlow();
    await assert.rejects(pollDevice({ device_code: flow.device_code, interval: flow.interval, expires_in: flow.expires_in }), /Login window expired/);
    await assert.rejects(pollDevice({ device_code: 'dev-3', interval: 0.01, expires_in: 0.04 }), /Login window expired/);
  });
});

test('device flow: malformed states are rejected instead of looping forever', async () => {
  let count = 0;
  await withServer((req, res) => {
    readBody(req, () => { count++; json(res, 200, count === 1 ? { device_code: 'dev-4', user_code: 'NOPE-0000', expires_in: 30, interval: 0.01 } : { status: 'confused' }); });
  }, async () => {
    const flow = await startDeviceFlow();
    await assert.rejects(pollDevice({ device_code: flow.device_code, interval: flow.interval, expires_in: flow.expires_in }), /unexpected response/);
  });
});

test('usage endpoint: returns payload, null on 404, and a 401 status error', async () => {
  const payload = { plan: 'free', tokens_used: 142316, tokens_limit: 300000, images_used: 12, images_limit: 50, period_ends_at: '2026-10-15T00:00:00.000Z' };
  await withServer((req, res) => {
    if (req.url.split('?')[0] !== '/usage') { json(res, 404, {}); return; }
    if (req.headers.authorization === 'Bearer axon-gone') { json(res, 404, {}); return; }
    if (req.headers.authorization !== 'Bearer axk-live12345678') { json(res, 401, { error: 'invalid key' }); return; }
    json(res, 200, payload);
  }, async () => {
    assert.deepEqual(await fetchUsage('axk-live12345678'), payload);
    await assert.rejects(fetchUsage('axk-wrong'), error => error instanceof APIError && error.status === 401);
    assert.equal(await fetchUsage('axon-gone'), null);
  });
});

test('usage rendering: bars, counts, percentages, renewal days and unlimited plans', () => {
  const payload = { plan: 'free', tokens_used: 142316, tokens_limit: 300000, images_used: 12, images_limit: 50, period_ends_at: new Date(Date.now() + 12 * 86400000).toISOString() };
  const text = renderUsage(payload);
  assert.match(text, /free plan · resets \d{4}-\d{2}-\d{2} \(in 12 days\)/);
  assert.match(text, /Tokens  █+░+  142,316 \/ 300,000 \(47%\)/);
  assert.match(text, /Images  █+░+  12 \/ 50 \(24%\)/);
  const enterprise = renderUsage({ plan: 'enterprise', tokens_used: 9000000, tokens_limit: 0, images_used: 3, images_limit: -1, period_ends_at: new Date(Date.now() + 86400000).toISOString() });
  assert.match(enterprise, /enterprise plan/);
  assert.match(enterprise, /Tokens  █+  9,000,000 \/ unlimited/);
  assert.match(enterprise, /Images  █+  3 \/ unlimited/);
  assert.match(enterprise, /\(in 1 day\)/);
});

test('whoami line masks the key and summarizes the plan', () => {
  const usage = { plan: 'free', tokens_used: 142316, tokens_limit: 300000, images_used: 12, images_limit: 50, period_ends_at: '2026-10-15T00:00:00.000Z' };
  assert.equal(keyMask('axk-abcdEFGH12345678'), 'axk-abcd…5678');
  assert.match(whoamiLine('axk-abcdEFGH12345678', usage), /Logged in as key axk-abcd…5678 · free · tokens 142,316\/300,000 · images 12\/50 · renews 2026-10-15/);
  assert.match(whoamiLine('axk-x', { plan: 'enterprise', tokens_used: 5, tokens_limit: 0, images_used: 1, images_limit: 0, period_ends_at: '2026-10-15T00:00:00.000Z' }), /tokens 5\/unlimited · images 1\/unlimited/);
});

test('quota 402s map to a clean upgrade message; other 402s keep the wallet text', async () => {
  assert.match(new APIError(402, '{"error":{"message":"usage limit reached"}}').message, /Free plan limit reached — upgrade at https:\/\/axon-chat-nu\.vercel\.app\/usage/);
  assert.match(new APIError(402, JSON.stringify({ error: 'monthly usage limit exceeded' })).message, /Free plan limit reached/);
  assert.doesNotMatch(new APIError(402, '{"error":"insufficient wallet balance"}').message, /Free plan/);
  assert.match(new APIError(402).message, /wallet/);
  assert.match(new APIError(401).message, /login/);
  let calls = 0;
  await withServer((req, res) => { calls++; json(res, 402, { error: 'free plan usage limit reached for this month' }); }, async () => {
    await assert.rejects(completion({ key: 'k', model: 'axon-1.8-flash', messages: [{ role: 'user', content: 'hi' }], retries: 0 }), error => {
      assert.match(error.message, /Free plan limit reached/);
      assert.match(error.message, /upgrade at https:\/\/axon-chat-nu\.vercel\.app\/usage/);
      assert.doesNotMatch(error.message, /\{"/);
      return true;
    });
  });
  assert.equal(calls, 1);
});
