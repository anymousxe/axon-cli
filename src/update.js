import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { ensureDir, privateWrite } from './paths.js';

export const RELEASE_MANIFEST = 'https://axon-chat-nu.vercel.app/cli/manifest.json';
const MAX_BYTES = 4 * 1024 * 1024;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export function newerVersion(candidate, current) {
  const parse = value => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split('.').map(BigInt) : null;
  const next = parse(candidate), previous = parse(current);
  if (!next || !previous) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i];
  }
  return false;
}

function launcherVersion(source) {
  return source.match(/^const VERSION = '(\d+\.\d+\.\d+)';/m)?.[1];
}

function acquireUpdateLock(directory) {
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = JSON.parse(fs.readFileSync(path.join(directory, 'owner.json'), 'utf8')); } catch {}
    if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); return false; } catch (error) {
        if (error.code !== 'ESRCH') return false;
      }
    } else if (Date.now() - fs.statSync(directory).mtimeMs < 30000) {
      return false;
    }
    fs.rmSync(directory, { recursive: true });
    try { fs.mkdirSync(directory, { mode: 0o700 }); } catch { return false; }
  }
  fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
  return true;
}

async function releaseBytes(url, limit, signal) {
  const response = await fetch(url, { signal, redirect: 'error', credentials: 'omit', headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok || !response.body) throw new Error('Release unavailable');
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('Release too large');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Release too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function syntaxCheck(file, signal) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--check', file], {
      signal, timeout: 3000, maxBuffer: 64 * 1024,
      env: { ...process.env, NODE_OPTIONS: '' }, windowsHide: true,
    }, error => error ? reject(error) : resolve());
  });
}

export async function updateLauncher({ version, dir, explicit = false, signal, launcher = process.argv[1] }) {
  let lock, candidate, backup, replaced = false;
  const deadline = new AbortController();
  const abort = () => deadline.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 8000);
  try {
    const target = fs.realpathSync(launcher);
    const original = fs.readFileSync(target, 'utf8');
    if (!original.startsWith('#!/usr/bin/env node\n// Generated from src/ by scripts/build.mjs.')) throw new Error('Not a standalone installation');
    ensureDir(dir);
    const metadata = path.join(dir, 'update.json');
    if (!explicit) {
      try {
        const last = JSON.parse(fs.readFileSync(metadata, 'utf8')).checkedAt;
        if (Number.isFinite(last) && Date.now() - last >= 0 && Date.now() - last < CHECK_INTERVAL) return { status: 'skipped' };
      } catch {}
    }
    // The lock lives beside the real launcher, so symlinks and separate profiles coordinate.
    lock = `${target}.update-lock`;
    if (!acquireUpdateLock(lock)) { lock = null; return { status: 'busy' }; }
    privateWrite(metadata, JSON.stringify({ checkedAt: Date.now() }) + '\n');
    const manifest = JSON.parse((await releaseBytes(RELEASE_MANIFEST, 16384, deadline.signal)).toString('utf8'));
    if (typeof manifest.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) throw new Error('Invalid release');
    if (!newerVersion(manifest.version, version)) return { status: 'current' };
    if (manifest.path !== `/cli/axon-${manifest.version}.mjs` || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > MAX_BYTES) throw new Error('Invalid release');
    const bytes = await releaseBytes(new URL(manifest.path, RELEASE_MANIFEST), manifest.bytes, deadline.signal);
    const digest = data => createHash('sha256').update(data).digest('hex');
    if (bytes.length !== manifest.bytes || digest(bytes) !== manifest.sha256) throw new Error('Invalid release');
    if (launcherVersion(bytes.toString('utf8')) !== manifest.version) throw new Error('Invalid release');
    candidate = path.join(path.dirname(target), `.axon-update-${process.pid}-${Date.now()}.mjs`);
    fs.writeFileSync(candidate, bytes, { mode: fs.statSync(target).mode & 0o777, flag: 'wx' });
    fs.chmodSync(candidate, fs.statSync(target).mode & 0o777);
    await syntaxCheck(candidate, deadline.signal);
    if (deadline.signal.aborted) throw new Error('Update cancelled');
    const installed = fs.readFileSync(target, 'utf8');
    // Never overwrite a concurrently rebuilt or already updated local installation.
    if (installed !== original) return { status: 'busy' };
    const installedVersion = launcherVersion(installed);
    if (!installedVersion || !newerVersion(manifest.version, installedVersion)) return { status: 'current' };
    backup = `${candidate}.backup`;
    fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
    fs.renameSync(candidate, target);
    replaced = true;
    if (digest(fs.readFileSync(target)) !== manifest.sha256) throw new Error('Replacement failed');
    replaced = false;
    return { status: 'updated', version: manifest.version };
  } catch {
    if (replaced && backup) {
      try { fs.renameSync(backup, fs.realpathSync(launcher)); backup = null; } catch { /* Retain the backup if the filesystem cannot restore it. */ }
    }
    return { status: 'failed' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (candidate) try { fs.unlinkSync(candidate); } catch {}
    if (backup && !replaced) try { fs.unlinkSync(backup); } catch {}
    if (lock) {
      try { fs.unlinkSync(path.join(lock, 'owner.json')); } catch {}
      try { fs.rmdirSync(lock); } catch {}
    }
  }
}
