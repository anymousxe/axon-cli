// Explicitly billable live gate. Credentials stay in the child environment,
// and temporary chat/config data is removed even on failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { apiKey, configDir } from '../src/paths.js';
import { Session } from '../src/storage.js';
const key = apiKey(configDir());
if (!key) throw new Error('Configure a key with axon login first.');
if (process.platform === 'win32') throw new Error('This PTY driver requires Linux; Windows approval is covered by unit tests.');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-live-tty-'));
const script = String.raw`
import os, pty, subprocess, select, time, fcntl, termios, struct, re
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 120, 0, 0))
env = dict(os.environ, TERM='xterm-256color', NO_COLOR='1')
args = [os.environ['AXON_TEST_NODE'], 'bin/axon.mjs']
if os.environ.get('AXON_LIVE_COMPACT'): args += ['--continue']
p = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave, env=env)
out = b''
def wait(pattern, timeout=150):
    global out
    end = time.time()+timeout
    while time.time()<end:
        if re.search(pattern, out): return
        ready,_,_=select.select([master],[],[],.2)
        if ready:
            try: out += os.read(master,65536)
            except OSError: break
        if p.poll() is not None: break
    # This buffer cannot contain credentials; CLI was launched with a configured key.
    raise Exception('PTY timeout waiting for '+repr(pattern)+'; tail: '+repr(out[-1800:]))
def send(text): os.write(master, text.encode())
try:
    wait(rb'axon .')
    if os.environ.get('AXON_LIVE_COMPACT'):
        send('What project codename did we agree on? Reply in one sentence.\r')
        wait(rb'Compaction: ~[1-9][0-9]* tokens freed')
        wait(rb'tokens .* [+]')
        assert b'ORCHID' in out, 'compacted context lost codename'
        print('PASS: LIVE forced auto-compaction, tokens freed, final answer recalls ORCHID')
    else:
        send('Use run_command to run exactly uname -a, then report its actual output. Do not just describe it.\r')
        wait(rb'Allow\?')
        assert b'run_command' in out and b'uname -a' in out
        send('y\r')
        wait(rb'\[exit 0\]')
        wait(rb'tokens .* [+]')
        assert b'Linux' in out
        print('PASS: LIVE plain axon (no --tools), uname -a, approval y, Linux output, exit 0, model follow-up')
    # Bracketed paste prevents completion from consuming the Enter key.
    send('\x1b[200~/exit\x1b[201~\r')
    # First Enter may complete /exit; second submits the completed command.
    time.sleep(.1)
    if p.poll() is None: send('\r')
    p.wait(timeout=10)
    assert p.returncode == 0
    assert termios.tcgetattr(slave)[3] & termios.ICANON, 'raw mode leaked'
finally:
    if p.poll() is None: p.kill(); p.wait()
    os.close(master); os.close(slave)
`;
try {
  const env = { ...process.env, AXON_CONFIG_DIR: dir, AXON_API_KEY: key, AXON_TEST_NODE: process.execPath };
  const first = spawnSync('python3', ['-c', script], { env, encoding: 'utf8', timeout: 200000 });
  assert.equal(first.status, 0, first.stderr); process.stdout.write(first.stdout);
  const session = new Session(dir);
  session.add({ role: 'user', content: 'The agreed project codename is ORCHID. Preserve that decision. ' + 'We are building a terminal assistant; permissions are required for every shell action. '.repeat(120) });
  session.add({ role: 'assistant', content: 'The project codename is ORCHID.' });
  for (let i = 0; i < 6; i++) { session.add({ role: 'user', content: `Recent requirement ${i}: preserve saved chats.` }); session.add({ role: 'assistant', content: 'Noted.' }); }
  const recent = session.messages.slice(-10);
  const second = spawnSync('python3', ['-c', script], { env: { ...env, AXON_COMPACT_THRESHOLD: '.001', AXON_LIVE_COMPACT: '1' }, encoding: 'utf8', timeout: 200000 });
  assert.equal(second.status, 0, second.stderr); process.stdout.write(second.stdout);
  const resumed = new Session(dir, session.id);
  assert.equal(resumed.compactions, 1); assert.ok(resumed.lastCompactionSavings > 0);
  assert.deepEqual(resumed.messages.slice(0, 10), recent); assert.match(resumed.summary, /ORCHID/);
  console.log('PASS: compaction marker, savings, summary and retained turns survive JSONL resume');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
