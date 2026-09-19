import { spawn } from 'node:child_process';
export async function copyText(text, run = spawn) {
  if (!text) throw new Error('No assistant answer to copy.');
  const commands = [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['clip.exe', []], ['pbcopy', []]];
  for (const [command, args] of commands) {
    const ok = await new Promise(resolve => {
      let settled = false, timer;
      const done = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      try {
        const child = run(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
        timer = setTimeout(() => { child.kill(); done(false); }, 2000);
        child.on('error', () => done(false)); child.on('close', code => done(code === 0));
        child.stdin.on('error', () => done(false)); child.stdin.end(text);
      } catch { done(false); }
    });
    if (ok) return command;
  }
  throw new Error('Clipboard unavailable. Install wl-clipboard or xclip, or use clip.exe (Windows/WSL).');
}
