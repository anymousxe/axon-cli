import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const LIMIT = 10 * 1024 * 1024;
export function imagePart(buffer, name = 'clipboard') {
  if (!buffer.length || buffer.length > LIMIT) throw new Error('Images must be nonempty and no larger than 10 MiB.');
  let mime;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
  else if (buffer.subarray(0, 6).toString().match(/^GIF8[79]a$/)) mime = 'image/gif';
  else if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
  else throw new Error('Unsupported image. Use PNG, JPEG, GIF, or WebP.');
  return { name, part: { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } } };
}
export function loadImage(file) {
  const full = path.resolve(file.replace(/^~(?=[/\\])/, os.homedir()));
  const stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > LIMIT) throw new Error('Image must be a file no larger than 10 MiB.');
  return imagePart(fs.readFileSync(full), path.basename(full));
}
export function clipboardImage() {
  if (process.platform === 'win32') {
    const script = 'Add-Type -AssemblyName System.Windows.Forms; $i=[System.Windows.Forms.Clipboard]::GetImage(); if ($null -eq $i) { exit 2 }; $m=New-Object System.IO.MemoryStream; $i.Save($m,[System.Drawing.Imaging.ImageFormat]::Png); [Console]::Write([Convert]::ToBase64String($m.ToArray())); $i.Dispose(); $m.Dispose()';
    const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { maxBuffer: LIMIT * 2, timeout: 10000, windowsHide: true });
    if (result.status === 0 && result.stdout.length) return imagePart(Buffer.from(result.stdout.toString().trim(), 'base64'));
    throw new Error('No clipboard image found. Copy an image, or use /img <path>.');
  }
  const commands = [['wl-paste', ['--no-newline', '--type', 'image/png']], ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']]];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { maxBuffer: LIMIT + 1, timeout: 5000 });
    if (!result.error && result.status === 0 && result.stdout.length) return imagePart(result.stdout);
  }
  throw new Error('No clipboard image found. Install wl-clipboard (Wayland) or xclip (X11), or use /img <path>.');
}
