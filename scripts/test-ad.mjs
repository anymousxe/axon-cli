import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openAd } from './ad-browser.mjs';
const output = path.resolve(process.argv[2] || '/tmp/axon-ad-verification'); fs.mkdirSync(output, { recursive: true });
const app = await openAd(); const { page, url } = app;
const errors = [], failed = []; let passed = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
const ok = name => { passed++; console.log('✓ ' + name); };
try {
  await page.goto(url + '?paused=1'); await page.waitForFunction(() => window.axonFilm);
  assert.equal(await page.evaluate(() => axonFilm.state.webgl), true); ok('real shader compiles and WebGL renders');
  for (const [time, text] of [[0, 'Meet Flash.'], [7, 'See more.'], [13, 'By choice.'], [19, 'More creation.']]) {
    await page.evaluate(t => axonFilm.seek(t), time);
    assert.ok((await page.locator('#headline').innerText()).includes(text));
    assert.equal(await page.locator('[aria-current="step"]').count(), 1);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, `chapter-${Math.floor(time / 6)}.png`) });
  }
  ok('all four chapters render at deterministic times');
  const before = await page.locator('#scene').evaluate(canvas => canvas.toDataURL());
  await page.mouse.move(1100, 380); await page.mouse.down(); await page.mouse.move(1200, 430, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(100);
  const after = await page.locator('#scene').evaluate(canvas => canvas.toDataURL()); assert.notEqual(before, after);
  ok('pointer drag changes the rendered core');

  await page.locator('#play').click(); await page.waitForTimeout(250); assert.equal(await page.evaluate(() => axonFilm.state.playing), true);
  await page.locator('#play').click(); const paused = await page.evaluate(() => axonFilm.state.time); await page.waitForTimeout(150); assert.equal(await page.evaluate(() => axonFilm.state.time), paused);
  await page.locator('#replay').click(); assert.ok(await page.evaluate(() => axonFilm.state.time < 1));
  await page.evaluate(() => axonFilm.seek(24)); assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Replay film');
  await page.locator('#play').click(); assert.ok(await page.evaluate(() => axonFilm.state.time < 1));
  ok('play, pause, replay and end-of-film behavior');
  await page.locator('#timeline').evaluate(el => { el.value = '9'; el.dispatchEvent(new Event('input')); });
  assert.equal(await page.evaluate(() => axonFilm.state.time), 9); assert.equal(await page.evaluate(() => axonFilm.state.playing), false);
  await page.locator('button[data-chapter="3"]').click(); assert.equal(await page.evaluate(() => axonFilm.state.chapter), 3);
  await page.locator('#sound').click(); assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
  await page.locator('#sound').click(); assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false'); ok('seek, chapter navigation and opt-in audio');
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(80);
    for (const time of [0, 7, 13, 19]) {
      await page.evaluate(t => axonFilm.seek(t), time);
      const fit = await page.evaluate(() => {
        const h = document.querySelector('#headline'); const r = document.createRange(); r.selectNodeContents(h); const bounds = r.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth && bounds.right <= innerWidth && bounds.left >= 0;
      }); assert.ok(fit, `text overflow at ${width}px chapter ${time}`);
    }
    if (width === 390) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true }); }
  }
  ok('all chapters fit 320–1920px widths without horizontal overflow');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload(); assert.equal(await page.evaluate(() => axonFilm.state.playing), false); ok('reduced motion starts paused');
  await page.evaluate(() => document.querySelector('#scene').getContext('webgl').getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(() => document.querySelector('.film').classList.contains('no-webgl'));
  assert.equal(await page.locator('#render-label').textContent(), 'CSS 3D EDITION');
  await page.screenshot({ path: path.join(output, 'fallback.png') }); ok('context loss reveals the CSS fallback without crashing');
  const plain = await app.browser.newPage({ javaScriptEnabled: false }); await plain.goto(url); assert.ok(await plain.locator('noscript').isVisible()); await plain.close(); ok('no-JavaScript message and CTA');
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto(url + '?capture=1&t=3');
  assert.equal(await page.locator('.transport').isVisible(), false); assert.equal(await page.evaluate(() => axonFilm.state.playing), false);
  await page.screenshot({ path: path.join(output, 'poster.png') }); ok('clean deterministic 16:9 video export mode');
  assert.deepEqual(errors, []); assert.deepEqual(failed, []); ok('no browser exceptions or failed asset requests');
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed, browser: await app.browser.version(), errors, failed }, null, 2));
  console.log(`${passed} ad checks passed; screenshots: ${output}`);
} finally { await app.close(); }
