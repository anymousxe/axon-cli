import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LIMIT = 10 * 1024 * 1024;
export function imagePart(buffer, name = 'clipboard') {
  if (!buffer.length || buffer.length > LIMIT) throw new Error('Images must be nonempty and no larger than 10 MiB.');
  let mime;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
  else if (buffer.subarray(0, 6).toString().match(/^GIF8[79]a$/)) mime = 'image/gif';
  else if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
  else throw new Error('Unsupported image. Use PNG, JPEG, GIF, or WebP.');
  return { name, ...imageDimensions(buffer, mime), part: { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } } };
}
export function loadImage(file) {
  const full = path.resolve(file.replace(/^~(?=[/\\])/, os.homedir()));
  const stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > LIMIT) throw new Error('Image must be a file no larger than 10 MiB.');
  return imagePart(fs.readFileSync(full), path.basename(full));
}
// Header-only dimensions: never decode image pixels or invoke a shell.
export function imageDimensions(b, mime) {
  try {
    let width, height;
    if (mime === 'image/png' && b.length >= 24) { width = b.readUInt32BE(16); height = b.readUInt32BE(20); }
    else if (mime === 'image/gif' && b.length >= 10) { width = b.readUInt16LE(6); height = b.readUInt16LE(8); }
    else if (mime === 'image/jpeg') {
      let at = 2;
      while (at + 4 < b.length) {
        if (b[at++] !== 255) continue;
        const marker = b[at++];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const size = b.readUInt16BE(at);
        if (size < 2 || at + size > b.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7) {
          height = b.readUInt16BE(at + 3); width = b.readUInt16BE(at + 5); break;
        }
        at += size;
      }
    } else if (mime === 'image/webp') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8X' && b.length >= 30) { width = b.readUIntLE(24, 3) + 1; height = b.readUIntLE(27, 3) + 1; }
      else if (kind === 'VP8 ' && b.length >= 30) { width = b.readUInt16LE(26) & 0x3fff; height = b.readUInt16LE(28) & 0x3fff; }
      else if (kind === 'VP8L' && b.length >= 25) { const bits = b.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
    }
    return width && height ? { width, height } : {};
  } catch { return {}; }
}
export function imageChip(image, index) {
  return `[img ${index + 1} · ${image.name} · ${image.width ? image.width + 'x' + image.height : 'size unknown'}]`;
}

// Only existing local image files qualify. Quoted and shell-escaped paths work;
// nonexistent paths, URLs and ordinary prose stay untouched.
export function extractImages(text) {
  const images = [];
  const decode = token => token.replace(/^(["'])(.*)\1$/s, '$2').replace(/\\([ \t()'"\\])/g, '$1');
  const take = token => {
    let file = decode(token);
    if (!/\.(png|jpe?g|gif|webp)$/i.test(file)) return false;
    if (file.startsWith('file://')) { try { file = fileURLToPath(file); } catch { return false; } }
    try {
      if (!fs.existsSync(file.replace(/^~(?=[/\\])/, os.homedir()))) return false;
      images.push(loadImage(file)); return true;
    } catch { return false; }
  };
  // Whole-line paths may contain unquoted spaces (file managers often paste these).
  const remaining = String(text).split('\n').map(line => {
    if (take(line.trim())) return '';
    return line.replace(/"[^"\n]+"|'[^'\n]+'|(?:\\[^\n]|[^\s"'])+/g, token => take(token) ? '' : token);
  }).join('\n');
  return { text: remaining, images };
}

function clipboardCommand(command, args) {
  return new Promise(resolve => {
    let child, timer, size = 0, chunks = [], settled = false;
    const done = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      timer = setTimeout(() => { child.kill(); done(null); }, 2000);
      child.on('error', () => done(null));
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > LIMIT * 2) { child.kill(); done(null); } else chunks.push(chunk);
      });
      child.on('close', code => done(code === 0 ? Buffer.concat(chunks) : null));
    } catch { done(null); }
  });
}
export async function readClipboard({ platform = process.platform, run = clipboardCommand } = {}) {
  const asImage = data => { try { return data?.length ? { image: imagePart(data) } : null; } catch { return null; } };
  if (platform === 'win32') {
    const script = "Add-Type -AssemblyName System.Windows.Forms; $i=Get-Clipboard -Format Image; if ($null -ne $i) { $m=New-Object System.IO.MemoryStream; $i.Save($m,[System.Drawing.Imaging.ImageFormat]::Png); [Console]::Write('IMAGE:'+ [Convert]::ToBase64String($m.ToArray())); $i.Dispose(); $m.Dispose() } else { $t=Get-Clipboard -Raw; [Console]::Write('TEXT:'+ [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$t))) }";
    const data = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
    const value = data?.toString() || '';
    if (value.startsWith('IMAGE:')) { const image = asImage(Buffer.from(value.slice(6), 'base64')); if (image) return image; }
    if (value.startsWith('TEXT:')) return { text: Buffer.from(value.slice(5), 'base64').toString('utf8') };
  } else if (platform === 'darwin') {
    const image = asImage(await run('pngpaste', ['-'])); if (image) return image;
    const text = await run('osascript', ['-e', 'the clipboard as text']);
    if (text !== null) return { text: text.toString('utf8').replace(/\r?\n$/, '') };
  } else {
    for (const provider of ['wl-paste', 'xclip']) {
      const query = provider === 'wl-paste' ? ['--list-types'] : ['-selection', 'clipboard', '-t', 'TARGETS', '-o'];
      const types = (await run(provider, query))?.toString().split(/\s+/) || ['image/png'];
      const args = type => provider === 'wl-paste' ? ['--no-newline', '--type', type] : ['-selection', 'clipboard', '-t', type, '-o'];
      for (const type of types.filter(type => /^image\/(png|jpeg|gif|webp)$/.test(type))) {
        const image = asImage(await run(provider, args(type))); if (image) return image;
      }
      const textType = types.find(type => /^(text\/plain;charset=utf-8|UTF8_STRING)$/i.test(type)) || types.find(type => type === 'text/plain') || 'UTF8_STRING';
      const text = await run(provider, args(textType));
      if (text !== null && !text.includes(0)) return { text: text.toString('utf8') };
    }
  }
  throw new Error('Clipboard unavailable. Use /img <path> or paste an image file path. Clipboard tools: wl-clipboard/xclip (Linux), pngpaste (macOS), PowerShell (Windows).');
}
export async function clipboardImage() {
  const value = await readClipboard();
  if (!value.image) throw new Error('Clipboard contains no image. Copy an image, or use /img <path>.');
  return value.image;
}
