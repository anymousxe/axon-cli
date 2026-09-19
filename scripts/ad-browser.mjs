import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function openAd(viewport = { width: 1440, height: 900 }, options = {}) {
  const { chromium } = await import(process.env.AXON_PLAYWRIGHT ? pathToFileURL(path.resolve(process.env.AXON_PLAYWRIGHT)).href : 'playwright');
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const relative = name === '/ad/' ? 'index.html' : name.replace(/^\/ad\//, '');
    const file = path.resolve(root, 'docs/ad', relative);
    if (!file.startsWith(path.join(root, 'docs/ad') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.AXON_CHROMIUM || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, ...options });
    const url = `http://127.0.0.1:${server.address().port}/ad/`;
    return { browser, page, url, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
  } catch (error) { server.close(); await browser?.close(); throw error; }
}
