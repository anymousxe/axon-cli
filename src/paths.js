import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function configDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.AXON_CONFIG_DIR) return path.resolve(env.AXON_CONFIG_DIR);
  if (platform === 'win32') return env.APPDATA ? path.join(env.APPDATA, 'axon') : path.join(home, '.axon');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'axon');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function privateWrite(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, value, { mode: 0o600 });
    fs.renameSync(tmp, file);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${file}: ${error.message}. Back it up before resetting it.`);
  }
}

export function readConfig(dir) { return readJSON(path.join(dir, 'config.json'), {}); }
export function saveConfig(dir, config) { privateWrite(path.join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n'); }
export function apiKey(dir) { return process.env.AXON_API_KEY || readConfig(dir).apiKey; }
