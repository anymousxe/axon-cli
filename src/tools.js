import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const schema = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const TOOL_DEFINITIONS = [
  schema('run_command', 'Run a shell command in the current project. Requires user permission. Bash on Linux, PowerShell or cmd on Windows.', { command: { type: 'string' }, shell: { type: 'string', enum: ['bash', 'powershell', 'cmd'] } }, ['command']),
  schema('read_file', 'Read a UTF-8 text file (up to 64 KiB). Requires user permission.', { path: { type: 'string' } }, ['path']),
  schema('write_file', 'Write or overwrite a UTF-8 file. Requires user permission.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  schema('list_dir', 'List a directory. Requires user permission.', { path: { type: 'string' } }, ['path']),
];
function signature(name, args) { return JSON.stringify([name, ...Object.keys(args).sort().map(key => [key, args[key]])]); }
export class Permissions {
  constructor(ask, ui, enabled = false) { this.ask = ask; this.ui = ui; this.enabled = enabled; this.session = false; this.allowed = new Set(); }
  async allow(name, args) {
    if (!this.enabled) return false;
    if (this.session || this.allowed.has(signature(name, args))) return true;
    if (JSON.stringify(args).length > 20000 && name !== 'write_file') {
      this.ui.info('Denied: tool arguments are too long to review safely.'); return false;
    }
    const preview = name === 'write_file' ? { ...args, content: typeof args.content === 'string' && args.content.length > 3000 ? args.content.slice(0, 1500) + `\n… [${args.content.length - 3000} characters omitted; this file will be overwritten] …\n` + args.content.slice(-1500) : args.content } : args;
    this.ui.info(`\nPermission requested: ${name}\n${JSON.stringify(preview, null, 2)}`);
    if (!this.ask) { this.ui.info('Denied: tool permissions require an interactive terminal.'); return false; }
    const answer = (await this.ask('Allow? [y/N/a=always-for-session/c=always-for-cmd] ')).trim().toLowerCase();
    if (['a', 'always-for-session'].includes(answer)) { this.session = true; return true; }
    if (['c', 'always-for-cmd'].includes(answer)) { this.allowed.add(signature(name, args)); return true; }
    return ['y', 'yes'].includes(answer);
  }
}
function runCommand(args, signal) {
  if (typeof args.command !== 'string' || !args.command.trim()) throw new Error('command must be a nonempty string');
  let executable, options;
  if (process.platform === 'win32') {
    if (args.shell === 'cmd') { executable = process.env.ComSpec || 'cmd.exe'; options = ['/d', '/s', '/c', args.command]; }
    else { executable = 'powershell.exe'; options = ['-NoProfile', '-NonInteractive', '-Command', args.command]; }
  } else { executable = 'bash'; options = ['-lc', args.command]; }
  return new Promise(resolve => {
    const child = spawn(executable, options, { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let output = '', truncated = false, timedOut = false, settled = false;
    const stop = () => {
      if (process.platform === 'win32') {
        if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const timeout = setTimeout(() => { timedOut = true; stop(); }, 30000);
    const finish = value => { if (settled) return; settled = true; clearTimeout(timeout); signal?.removeEventListener('abort', stop); resolve(value); };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    const capture = chunk => { if (output.length < 64000) output += chunk.toString().slice(0, 64000 - output.length); else truncated = true; };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.on('error', error => finish(`Could not run command: ${error.message}`));
    child.on('close', code => finish(`${output}${truncated ? '\n[output truncated]' : ''}\n[exit ${code}${timedOut ? ', 30s timeout' : ''}${signal?.aborted ? ', cancelled' : ''}]`));
  });
}
export async function executeTool(name, args, signal) {
  signal?.throwIfAborted();
  if (name === 'run_command') return runCommand(args, signal);
  if (typeof args.path !== 'string') throw new Error('path must be a string');
  const file = path.resolve(args.path);
  if (name === 'read_file') {
    if (!fs.statSync(file).isFile()) throw new Error('Not a regular file');
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(64000); const bytes = fs.readSync(fd, buf, 0, buf.length, 0); return buf.subarray(0, bytes).toString() + (fs.statSync(file).size > bytes ? '\n[file truncated]' : ''); }
    finally { fs.closeSync(fd); }
  }
  if (name === 'write_file') {
    if (typeof args.content !== 'string' || args.content.length > 1e6) throw new Error('content must be a string under 1 MB');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, args.content); return `Wrote ${Buffer.byteLength(args.content)} bytes to ${file}`;
  }
  if (name === 'list_dir') return fs.readdirSync(file, { withFileTypes: true }).slice(0, 500).map(entry => entry.name + (entry.isDirectory() ? '/' : '')).join('\n');
  throw new Error(`Unknown tool: ${name}`);
}
export async function handleTool(call, permissions, ui, signal) {
  let args = {}, result;
  try {
    args = JSON.parse(call.function.arguments || '{}');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
    if (!TOOL_DEFINITIONS.some(tool => tool.function.name === call.function.name)) throw new Error('Unknown tool');
    result = await permissions.allow(call.function.name, args) ? await executeTool(call.function.name, args, signal) : 'Permission denied by user. Do not retry this action without asking.';
  } catch (error) { result = `Tool error: ${error.message}`; }
  // Cap what goes back into context independently from the larger file/process capture cap.
  if (result.length > 16000) result = result.slice(0, 16000) + '\n[tool result truncated to 16000 characters]';
  ui.tool(call.function.name, args, result);
  return { role: 'tool', tool_call_id: call.id, content: result };
}
