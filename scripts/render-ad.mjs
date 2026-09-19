import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { openAd } from './ad-browser.mjs';
const output = path.resolve(process.argv[2] || '/tmp/axon-ad-export');
const width = Number(process.env.AD_WIDTH || 1920), height = Number(process.env.AD_HEIGHT || 1080), fps = 24, duration = 24;
fs.mkdirSync(output, { recursive: true });
const audioFile = path.join(output, 'soundtrack.wav');
// Original procedural stereo score. No samples, music libraries or licensed assets.
const rate = 48000, samples = rate * duration, data = Buffer.alloc(samples * 4), tau = Math.PI * 2;
for (let n = 0; n < samples; n++) {
  const t = n / rate, fade = Math.min(1, t / 1.5, (duration - t) / 2), beat = t % .75;
  const section = Math.min(3, Math.floor(t / 6));
  const chords = [[110,164.81,220,329.63],[130.81,196,261.63,392],[146.83,220,293.66,440],[110,164.81,220,440]][section];
  for (let channel = 0; channel < 2; channel++) {
    let signal = 0;
    chords.forEach((freq, i) => { signal += Math.sin(tau * (freq + channel * .15) * t) * (.047 / (1 + i * .4)) * (.85 + .15 * Math.sin(t * .8 + i)); });
    const note = chords[Math.floor(t / .75) % 4] * 2;
    signal += Math.sin(tau * note * t) * Math.exp(-beat * 8) * .075;
    signal += Math.sin(tau * 55 * t) * Math.exp(-beat * 16) * .07;
    const boundary = t % 6; signal += Math.sin(tau * (880 * t + 45 * boundary * boundary)) * Math.exp(-boundary * 3) * .025;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, signal * fade)) * 32767), (n * 2 + channel) * 2);
  }
}
const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40); fs.writeFileSync(audioFile, Buffer.concat([header, data]));
const app = await openAd({ width, height });
const file = path.join(output, 'axon-1.8-flash-ad.mp4');
const encoder = spawn('ffmpeg', ['-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-i',audioFile,'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-t',String(duration),file], { stdio: ['pipe','ignore','pipe'] });
let encoderError = ''; encoder.stderr.on('data', chunk => encoderError += chunk); encoder.stdin.on('error', () => {});
const encoded = once(encoder, 'close');
try {
  const errors = []; app.page.on('pageerror', error => errors.push(error.message));
  await app.page.goto(app.url + '?capture=1');
  if (!await app.page.evaluate(() => axonFilm.state.webgl)) throw new Error('Video export requires WebGL');
  for (let frame = 0; frame < fps * duration; frame++) {
    await app.page.evaluate(time => axonFilm.seek(time), frame / fps);
    const image = await app.page.screenshot({ type: 'jpeg', quality: 94 });
    if (!encoder.stdin.write(image)) await once(encoder.stdin, 'drain');
    if (frame % (fps * 6) === 0) console.log(`Rendered ${frame}/${fps * duration} frames`);
    if (frame === fps * 3) await app.page.screenshot({ path: path.join(output, 'poster.png') });
  }
  encoder.stdin.end(); const [code] = await encoded;
  if (code !== 0) throw new Error(encoderError);
  if (errors.length) throw new Error(errors.join('\n'));
  const probe = spawnSync('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',file], { encoding:'utf8' });
  if (probe.status !== 0) throw new Error(probe.stderr);
  const info = JSON.parse(probe.stdout), video = info.streams.find(s => s.codec_type === 'video'), audio = info.streams.find(s => s.codec_type === 'audio');
  if (video.width !== width || video.height !== height || Number(video.nb_frames) !== fps * duration || !audio || Math.abs(Number(info.format.duration) - duration) > .1) throw new Error('Export validation failed');
  const decode = spawnSync('ffmpeg', ['-v','error','-i',file,'-f','null','-'], { encoding:'utf8' });
  if (decode.status !== 0 || decode.stderr.trim()) throw new Error('Decode validation failed: ' + decode.stderr);
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ width, height, fps, duration, frames: Number(video.nb_frames), video: video.codec_name, audio: audio.codec_name, fullDecode: 'passed', browserErrors: errors }, null, 2));
  const names = ['axon-1.8-flash-ad.mp4','soundtrack.wav','poster.png','verification.json'];
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), names.map(name => `${createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex')}  ${name}`).join('\n') + '\n');
  console.log('Export and full decode verified:', file);
} finally { encoder.stdin.destroy(); encoder.kill(); await app.close(); }
