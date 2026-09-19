import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const python = spawnSync('python3', ['--version']);
test('real PTY: dropdown above prompt, completion, resize, paste, hidden input and cleanup', { skip: process.platform === 'win32' || python.status !== 0 }, () => {
  const script = String.raw`
import os, pty, subprocess, select, time, json, fcntl, termios, struct, signal

def run(source, actions):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
    env = dict(os.environ, TERM='xterm-256color', NO_COLOR='1')
    p = subprocess.Popen([os.environ['AXON_TEST_NODE'], '--input-type=module', '-e', source], stdin=slave, stdout=slave, stderr=slave, env=env)
    out = b''
    def drain(seconds=0.15):
        nonlocal out
        end=time.time()+seconds
        while time.time()<end:
            ready,_,_=select.select([master],[],[],max(0,end-time.time()))
            if ready:
                try: out += os.read(master,65536)
                except OSError: break
    drain(.25)
    for action in actions:
        if action == 'RESIZE':
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 18, 60, 0, 0)); p.send_signal(signal.SIGWINCH)
        else: os.write(master, action)
        drain()
    drain(.2)
    try: p.wait(timeout=3)
    except: p.kill(); raise
    drain(.1)
    attrs=termios.tcgetattr(slave)
    assert attrs[3] & termios.ICANON, 'terminal raw mode not restored'
    os.close(master); os.close(slave)
    assert p.returncode == 0, out
    assert b'\x1b[?2004l' in out, 'bracketed paste not restored'
    return out.decode(errors='replace')

base="import { Input } from './src/input.js'; const i = new Input(()=>{}); "
out=run(base+"i.configure({status:()=> 'test status'}); const x=await i.next('axon > '); i.close(); console.log('RESULT:'+JSON.stringify(x));", [b'/thi',b'\t',b'\t',b'l', 'RESIZE', b'\r',b'\r'])
assert '/think' in out and 'Thinking low' in out, out
assert 'RESULT:"/think low"' in out, out
assert out.find('/think') < out.rfind('axon > '), out

out=run(base+"const x=await i.next('axon > '); i.close(); console.log('RESULT:'+JSON.stringify(x));", [b'\x1b[200~/clear\nsecond line\x1b[201~', b'\r'])
assert 'RESULT:"/clear\\nsecond line"' in out, out

out=run(base+"const x=await i.ask('Key: ',true); i.close(); console.log('LENGTH:'+x.length);", [b'ultra-secret-123',b'\r'])
assert 'ultra-secret-123' not in out, out
assert 'LENGTH:16' in out, out

out=run(base+"const x=await i.next('axon > '); i.close(); console.log('EOF:'+String(x));", [b'\x04'])
assert 'EOF:null' in out, out
print('PTY menu, resize, paste, hidden input, EOF and terminal restoration passed')
`;
  const result = spawnSync('python3', ['-c', script], { env: { ...process.env, AXON_TEST_NODE: process.execPath }, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
