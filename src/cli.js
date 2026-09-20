import fs from 'node:fs';
import path from 'node:path';
import { configDir, readConfig, saveConfig, apiKey } from './paths.js';
import { MODELS, EFFORTS, money, validateSettings } from './models.js';
import { Session, lastSession, listSessions, memoryText, remember, forget, recordUsage, usageSummary } from './storage.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { completion, endpoint } from './api.js';
import { startDeviceFlow, pollDevice, fetchUsage, renderUsage, whoamiLine, keyMask } from './auth.js';
import { loadImage, clipboardImage, extractImages, imageChip } from './images.js';
import { Permissions } from './tools.js';
import { Engine } from './engine.js';
import { SLASH_HELP, isCommandLine } from './commands.js';
import { copyText } from './clipboard.js';

export const VERSION = '1.4.0';
const HELP = `axon — a fast terminal companion for Axon\n\nUsage: axon [options] [login|logout|whoami|usage]\n\n  -p, --prompt <text>    One-shot prompt (piped stdin is additional context)\n  -i, --image <path>     Attach an image; repeat for multiple images\n  -c, --continue         Continue the last chat\n  -r, --resume <id>      Resume a saved chat\n      --model <name>    Default: axon-1.8-flash\n      --think <effort>  off (default), low, medium, high, max\n      --hide-thinking   Hide reasoning; does not change its cost\n      --tools           Enable tools for one-shot (interactive chat defaults on)\n      --no-tools        Disable tools
      --new             Start a fresh chat instead of continuing the last one
      --save            Persist a one-shot run as a saved chat\n      --json            Newline-delimited JSON events on stdout\n      --repl            Treat piped lines as REPL turns and slash commands\n      --version         Print version\n  -h, --help            Show this help\n\nWithout a prompt: interactive chat on a TTY; one-shot from piped stdin.\nConfig: AXON_API_KEY, AXON_BASE_URL, AXON_CONFIG_DIR, NO_COLOR.\n`;


export function toolsDefault(opts, interactive) { return opts.tools ?? interactive; }
export function parseArgs(argv) {
  const options = { images: [] };
  const values = { '-p': 'prompt', '--prompt': 'prompt', '-i': 'image', '--image': 'image', '-r': 'resume', '--resume': 'resume', '--model': 'model', '--think': 'effort' };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i], inline;
    if (flag.startsWith('--') && flag.includes('=')) { const index = flag.indexOf('='); inline = flag.slice(index + 1); flag = flag.slice(0, index); }
    if (values[flag]) {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === undefined && /^--?\w/.test(value))) throw new Error(`${flag} requires a value.`);
      if (values[flag] === 'image') options.images.push(value); else options[values[flag]] = value;
    } else if (inline !== undefined) throw new Error(`${flag} does not take a value.`);
    else if (['-c', '--continue'].includes(flag)) options.continue = true;
    else if (['-h', '--help'].includes(flag)) options.help = true;
    else if (flag === '--version' || flag === '-v') options.version = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--repl') options.repl = true;
    else if (flag === '--tools') options.tools = true;
    else if (flag === '--no-tools') options.tools = false;
    else if (flag === '--new') options.new = true;
    else if (flag === '--save') options.save = true;
    else if (flag === '--hide-thinking') options.hideThinking = true;
    else if (['login', 'logout', 'whoami', 'usage'].includes(flag) && !options.command) options.command = flag;
    else throw new Error(`Unknown argument: ${flag}. Run axon --help.`);
  }
  if (options.continue && options.resume) throw new Error('Choose either --continue or --resume.');
  if (options.repl && options.prompt !== undefined) throw new Error('Choose --repl or --prompt, not both.');
  return options;
}
function settingsFrom(config, opts) {
  return { model: opts.model ?? config.model ?? 'axon-1.8-flash', effort: opts.effort ?? config.effort ?? 'off', showThinking: !opts.hideThinking && config.showThinking !== false, theme: ['dark', 'light', 'auto'].includes(config.theme) ? config.theme : 'auto' };
}
function saveSettings(dir, settings) {
  const previous = readConfig(dir);
  const { showThinking, theme } = settings;
  const model = settings.fast ? previous.model : settings.model;
  const effort = settings.fast || settings.lockin ? previous.effort : settings.effort;
  saveConfig(dir, { apiKey: previous.apiKey, model, effort, showThinking, theme });
}

export async function main(argv = process.argv.slice(2)) {
  let opts, ui, input, controller;
  let interruptAt = 0;
  let interrupted = false;
  const interrupt = () => {
    if (controller) { controller.abort(); input?.cancel(); return; }
    if (Date.now() - interruptAt < 1200) { input?.close(); interrupted = true; }
    else { interruptAt = Date.now(); ui?.info('\nPress Ctrl-C again to exit, or Ctrl-D.'); }
  };
  process.on('SIGINT', interrupt);
  // Closed downstream pipes are normal (e.g. `axon ... | head`).
  const pipeError = error => { if (error.code === 'EPIPE') { controller?.abort(); input?.close(); process.exitCode = 0; } else throw error; };
  process.stdout.on('error', pipeError);
  try {
    opts = parseArgs(argv); ui = new UI(opts);
    if (opts.help) { process.stdout.write(HELP); return; }
    if (opts.version) { process.stdout.write(VERSION + '\n'); return; }
    const dir = configDir();
    let config = readConfig(dir);
    if (opts.command === 'logout') {
      delete config.apiKey; saveConfig(dir, config);
      const message = 'Stored key removed.' + (process.env.AXON_API_KEY ? ' AXON_API_KEY is still set; unset it separately.' : '');
      ui.info(message); ui.event('logout', { message }); return;
    }
    let key = apiKey(dir);
    const login = async () => {
      const flow = await startDeviceFlow();
      ui.info(`Visit ${flow.verification_url} and enter code: ${flow.user_code}`);
      ui.event('login', { status: 'pending', user_code: flow.user_code, verification_url: flow.verification_url });
      controller = new AbortController();
      let granted = null;
      try {
        granted = await pollDevice({ device_code: flow.device_code, interval: flow.interval, expires_in: flow.expires_in, signal: controller.signal, onPoll: () => { if (!opts.json) process.stderr.write('.'); } });
      } catch (error) {
        if (controller.signal.aborted) { process.stderr.write('\n'); ui.info('Login cancelled.'); return false; }
        throw error;
      } finally { controller = null; }
      if (!granted) throw new Error('The login service returned an unexpected response.');
      if (!opts.json) process.stderr.write('\n');
      saveConfig(dir, { ...readConfig(dir), apiKey: granted }); key = granted;
      if (process.env.AXON_API_KEY) ui.info('Note: AXON_API_KEY overrides the saved key in subsequent runs.');
      ui.info('Logged in.'); ui.event('login', { status: 'approved' });
      return true;
    };
    if (opts.command === 'login') { await login(); return; }
    const remoteUsage = async () => {
      try { return await fetchUsage(key); }
      catch (error) { if (error.status === 401) return 401; throw error; }
    };
    if (opts.command === 'whoami') {
      if (!key) { ui.info('Not logged in. Run: axon login'); ui.event('whoami', { authenticated: false }); return; }
      const usage = await remoteUsage();
      if (usage === 401) { ui.info('Not logged in. Run: axon login'); ui.event('whoami', { authenticated: false }); return; }
      if (usage) {
        if (opts.json) ui.event('whoami', { authenticated: true, key: keyMask(key), ...usage });
        else ui.info(whoamiLine(key, usage));
        return;
      }
      const source = process.env.AXON_API_KEY ? 'AXON_API_KEY' : config.apiKey ? 'config' : 'none';
      const info = { authenticated: true, source, config_dir: dir, endpoint: endpoint(), note: 'Usage API not available; showing local credential presence only.' };
      if (opts.json) ui.event('whoami', info); else ui.info(`Key configured (${source})\nConfig: ${dir}\nEndpoint: ${info.endpoint}\n${info.note}`);
      return;
    }
    if (opts.command === 'usage') {
      if (!key) throw new Error('Not logged in. Run: axon login');
      const usage = await remoteUsage();
      if (usage === 401) throw new Error('Not logged in. Run: axon login');
      if (!usage) ui.info('Usage API not available yet.');
      else { ui.info(renderUsage(usage)); ui.event('usage', usage); }
      return;
    }
    if (!key) {
      if (!process.stdin.isTTY) throw new Error('No interactive terminal for login. Set AXON_API_KEY, or run `axon login` in a terminal.');
      if (opts.json) throw new Error('Run `axon login` without --json to enter a key securely.');
      input = new Input(interrupt);
      ui.info('Welcome to Axon. Bring your own API key; it stays on this device.');
      ui.info(`Validation endpoint: ${endpoint()}\nYour key will be stored privately in ${dir}`);
      if (process.env.AXON_API_KEY) ui.info('Note: AXON_API_KEY overrides the saved key in subsequent runs.');
      if (!input.terminal) throw new Error('Secure key entry needs a TTY with TERM other than dumb. Set AXON_API_KEY instead.');
      const entered = (await input.ask('API key (hidden): ', true)).trim();
      if (!entered) throw new Error('No key entered. Nothing was saved.');
      ui.info('Validating with a tiny, billable request…'); controller = new AbortController();
      const messages = [{ role: 'user', content: 'Reply OK.' }];
      const result = await completion({ key: entered, model: 'axon-1.8-lightning', messages, maxTokens: 4, signal: controller.signal });
      recordUsage(dir, null, 'axon-1.8-lightning', result.usage, messages, result.content);
      controller = null;
      saveConfig(dir, { ...config, apiKey: entered }); key = process.env.AXON_API_KEY || entered;
      ui.info('✓ Key validated and saved.');
      config = readConfig(dir);
    }
    const settings = settingsFrom(config, opts); validateSettings(settings); ui.setTheme(settings.theme);
    const interactive = Boolean(process.stdin.isTTY) && opts.prompt === undefined;
    const repl = interactive || opts.repl;
    const safeLast = () => { try { return lastSession(dir); } catch { return undefined; } };
    const autoId = opts.resume || (opts.continue ? lastSession(dir) : undefined) || (repl && !opts.new ? safeLast() : undefined);
    const session = new Session(dir, autoId, { ephemeral: !repl && !opts.save });
    if (repl && !opts.resume && !opts.continue && !opts.new && autoId) ui.info(`continuing ${session.id} · /new for a fresh chat`);
    if (repl && !input) input = new Input(interrupt);
    if (!input && process.stdin.isTTY) input = new Input(interrupt);
    const permissions = new Permissions(process.stdin.isTTY && input ? prompt => input.ask(prompt) : null, ui, toolsDefault(opts, interactive));
    const engine = new Engine({ dir, key, session, settings, ui, permissions });
    engine.contextPercent = engine.contextStats.percent;
    if (session.lockin && opts.tools !== false && interactive) engine.setLockIn(true);
    const inspector = tab => {
      const context = engine.contextStats;
      if (tab === 'session') return [engine.session.title, `Session: ${engine.session.id}`, `Model: ${settings.model}`, `Effort: ${settings.effort}`, `Context: ~${context.tokens} / 24000 (${context.percent}%)`, `Lock-in: ${engine.lockin.active ? 'ON · 24 rounds' : 'off'}`];
      if (tab === 'usage') return [`Session: ${money(engine.session.cost)}`, `All-time: ${money(usageSummary(dir).total)}`, `Context: ${context.percent}% · projected ~${engine.projectedContext}`, `Compactions: ${engine.session.compactions}`, `Last savings: ~${engine.session.lastCompactionSavings} tokens`, `Automatic compaction: ${engine.autoCompact ? 'on' : 'off'}`];
      if (tab === 'memory') return memoryText(dir).split('\n').filter(Boolean).length ? memoryText(dir).split('\n') : ['No memories. /remember <text>'];
      return [`Tools: ${permissions.enabled ? 'on (permission-gated)' : 'off'}`, `Session-wide grant: ${permissions.session ? 'yes' : 'no'}`, `Exact-command grants: ${permissions.allowed.size}`, `Lock-in: ${engine.lockin.active ? 'ON' : 'off'} · cap ${engine.lockin.rounds}`, 'run_command · read_file · write_file · edit_file · list_dir', 'Tools can access your local files. Review every approval.'];
    };
    let pending = opts.images.map(loadImage);
    input?.configure({ inspector, attachments: () => pending, attach: images => pending.push(...images), chats: () => listSessions(dir), status: () => ui.statusText(settings, money(engine.session.cost), engine.contextPercent), palette: ui.palette });
    let savedFast = null;
    const operation = async action => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 300000);
      try { return await action(controller.signal); }
      finally { clearTimeout(timeout); controller = null; ui.stopActivity(); }
    };
    const turn = async (text, images) => {
      controller = new AbortController();
      const timeout = setTimeout(() => { ui.info('Request reached the 5-minute safety timeout.'); controller?.abort(); }, 300000);
      try { await engine.turn(text, images, controller.signal); }
      catch (error) {
        if (!controller.signal.aborted) { ui.error(error.message); ui.event('error', { message: error.message, status: error.status }); }
        if (!repl) process.exitCode = controller.signal.aborted ? 130 : 1;
      } finally { clearTimeout(timeout); controller = null; ui.stopActivity(); }
    };
    if (!repl) {
      let piped = '';
      if (!process.stdin.isTTY) {
        let size = 0;
        for await (const chunk of process.stdin) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Piped input exceeds 1 MiB.'); piped += chunk; }
      }
      const fromPrompt = extractImages(opts.prompt || ''), fromPipe = extractImages(piped);
      pending.push(...fromPrompt.images, ...fromPipe.images);
      piped = fromPipe.text;
      const prompt = opts.prompt === undefined ? piped.trim() : fromPrompt.text + (piped.trim() ? `\n\n<stdin>\n${piped.trim()}\n</stdin>` : '');
      if (!prompt && !pending.length) throw new Error('No prompt supplied. Use axon -p "Hello", pipe text, or run axon in a terminal.');
      await turn(prompt, pending); return;
    }
    await ui.banner(VERSION, session.id);
    if (interactive && !input.terminal) ui.info('Clipboard shortcuts need raw terminal mode. Use /img <path> or paste a file path instead.');
    ui.event('session', { session_id: session.id, ...settings });
    while (!interrupted) {
      if (!input.terminal) ui.status(settings, money(engine.session.cost), engine.contextPercent);
      const line = await input.next('axon › ');
      if (line === null) break;
      if (input.cancelled) continue;
      let text = line.trim();
      // Resolve local absolute paths before interpreting slash commands.
      if (!isCommandLine(line)) {
        const found = extractImages(text); pending.push(...found.images); text = found.text.trim();
        if (found.images.length && !text) {
          ui.info(pending.map(imageChip).join('\n') + '\nAdd a prompt, or press Enter to describe.');
          ui.event('attachments', { images: pending.map(({ name, width, height }) => ({ name, width, height })) });
          continue;
        }
      }
      if (!text && !pending.length) continue;
      if (text.startsWith('/') && !text.startsWith('//') && !line.includes('\n')) {
        const space = text.search(/\s/), command = space < 0 ? text : text.slice(0, space), arg = space < 0 ? '' : text.slice(space).trim();
        try {
          if (command === '/exit' || command === '/quit') break;
          const say = value => { ui.info(value); ui.event('notice', { command, text: value }); };
          switch (command) {
            case '/help': say(SLASH_HELP); break;
            case '/btw': await operation(signal => engine.sideQuestion(arg, signal)); break;
            case '/panel':
              if (arg && !['session', 'usage', 'memory', 'tools'].includes(arg)) throw new Error('Usage: /panel [session|usage|memory|tools]');
              if (input.terminal) input.openPanel(arg || 'session'); else say(inspector(arg || 'session').join('\n'));
              break;
            case '/lockin':
              if (arg && !['on', 'off'].includes(arg)) throw new Error('Usage: /lockin [on|off]');
              if (savedFast) { Object.assign(settings, savedFast); savedFast = null; settings.fast = false; }
              say(`Lock-in ${engine.setLockIn(arg ? arg === 'on' : !engine.lockin.active) ? 'ON · max effort · tools on · 24 rounds · approvals still required' : 'off · previous effort/tools restored'}`); break;
            case '/fast':
              if (engine.lockin.active) throw new Error('Turn /lockin off before changing fast mode.');
              if (savedFast) { Object.assign(settings, savedFast); savedFast = null; settings.fast = false; }
              else { savedFast = { model: settings.model, effort: settings.effort }; settings.model = 'axon-1.8-lightning'; settings.effort = 'off'; settings.fast = true; }
              say(`Fast mode ${settings.fast ? 'on ⚡' : 'off'}: ${settings.model} · ${settings.effort}`); break;
            case '/compact': {
              if (['auto', 'off'].includes(arg)) { engine.autoCompact = arg === 'auto'; say(`Automatic compaction ${engine.autoCompact ? 'on' : 'off'}.`); break; }
              if (arg) throw new Error('Usage: /compact [auto|off]');
              const result = await operation(signal => engine.compact(signal));
              say(`Context: ~${result.before} → ~${result.after} tokens; ~${result.saved} saved.${result.changed ? '' : ' ' + (result.reason || 'Original context retained (summary not smaller).')}`);
              ui.event('compact', result); break;
            }
            case '/retry': await operation(signal => engine.retry(signal)); break;
            case '/copy': say(`Copied last assistant answer via ${await copyText(engine.lastAnswer)}.`); break;
            case '/status': {
              const context = engine.contextStats; engine.contextPercent = context.percent;
              const masked = key.length > 8 ? `${key.slice(0, 3)}…${key.slice(-4)}` : '********';
              say(`Axon ${VERSION}\nModel: ${settings.model}${settings.fast ? ' ⚡' : ''}\nEffort: ${settings.effort}\nKey: ${masked}\nContext: ~${context.tokens} tokens / ${context.percent}% (local 24k budget)\nSession: ${engine.session.id}\nCost: ${money(engine.session.cost)}\nTheme: ${settings.theme}`); break;
            }
            case '/theme':
              if (!['dark', 'light', 'auto'].includes(arg)) { say(`Theme: ${settings.theme}. Usage: /theme dark|light|auto`); break; }
              settings.theme = arg; ui.setTheme(arg); saveSettings(dir, settings); say(`Theme: ${arg}`); break;
            case '/hide-thinking': settings.showThinking = !settings.showThinking; saveSettings(dir, settings); say(`Thinking ${settings.showThinking ? 'visible' : 'hidden'}.`); break;
            case '/model':
              if (!arg) say(Object.keys(MODELS).map(name => `${name === settings.model ? '●' : '○'} ${name}`).join('\n'));
              else { validateSettings({ ...settings, model: arg }); settings.model = arg; savedFast = null; settings.fast = false; saveSettings(dir, settings); say(`Model: ${arg}`); } break;
            case '/think':
              if (engine.lockin.active && arg && !['show', 'hide'].includes(arg)) throw new Error('Turn /lockin off before changing effort.');
              if (['show', 'hide'].includes(arg)) settings.showThinking = arg === 'show';
              else if (!arg) { say(`Effort: ${settings.effort}; display: ${settings.showThinking ? 'show' : 'hide'}. Options: ${EFFORTS.join(', ')}`); break; }
              else { validateSettings({ ...settings, effort: arg }); settings.effort = arg; savedFast = null; settings.fast = false; }
              saveSettings(dir, settings); say(`Thinking: ${settings.effort}, ${settings.showThinking ? 'visible' : 'hidden'}`); break;
            case '/tools':
              if (engine.lockin.active && arg === 'off') throw new Error('Turn /lockin off before disabling tools.');
              if (!['on', 'off'].includes(arg)) { say(`Tools: ${permissions.enabled ? 'on' : 'off'}. Usage: /tools on|off`); break; }
              permissions.enabled = arg === 'on'; if (!permissions.enabled) { permissions.session = false; permissions.allowed.clear(); }
              say(`Tools ${arg}. ${arg === 'on' ? 'Each action needs approval; grants expire when you exit.' : 'Session approvals cleared.'}`); break;
            case '/img': pending.push(arg ? loadImage(arg.replace(/^(["'])(.*)\1$/, '$2')) : await clipboardImage()); say(`Queued ${pending.length} image(s). Add your prompt next.`); break;
            case '/imgs': say(pending.length ? pending.map(imageChip).join('\n') : 'No pending images.'); break;
            case '/images': if (arg !== 'clear') throw new Error('Usage: /images clear'); pending = []; say('Image queue cleared.'); break;
            case '/remember': remember(dir, arg); say('Memory saved for future turns and sessions.'); break;
            case '/memory': say(memoryText(dir).split('\n').filter(Boolean).map((value, i) => `${i + 1}. ${value}`).join('\n') || 'No memories yet. /remember <text>'); break;
            case '/forget': forget(dir, Number(arg)); say('Memory removed.'); break;
            case '/chats': say(listSessions(dir).map(chat => `${chat.id}  ${chat.title}`).join('\n') || 'No saved chats.'); break;
            case '/resume': { const next = new Session(dir, arg || lastSession(dir)); if (engine.lockin.active) engine.setLockIn(false); engine.session = next; if (next.lockin && opts.tools !== false && interactive) engine.setLockIn(true); pending = []; engine.contextPercent = engine.contextStats.percent; say(`Resumed ${engine.session.id}: ${engine.session.title}`); break; }
            case '/new': if (engine.lockin.active) engine.setLockIn(false); engine.session = new Session(dir); pending = []; engine.contextPercent = 0; say(`New chat: ${engine.session.id}`); break;
            case '/title': if (!arg) { say(engine.session.title); break; } engine.session.setTitle(arg); say('Title saved.'); break;
            case '/clear': engine.session.clear(); pending = []; engine.contextPercent = 0; say('Context cleared. Transcript and persistent memory retained.'); break;
            case '/usage': {
              if (!key) throw new Error('Not logged in. Run /login.');
              let usage = null;
              try { usage = await fetchUsage(key); }
              catch (error) { if (error.status === 401) throw new Error('Not logged in. Run /login.'); usage = null; }
              if (usage) { say(renderUsage(usage)); ui.event('usage', usage); break; }
              say('Usage API not available yet. Local session ledger:');
            }
            case '/cost': {
              const all = usageSummary(dir), current = usageSummary(dir, engine.session.id);
              say(`Session: ${money(current.total)} · All-time: ${money(all.total)}${all.estimated ? ' (includes estimates)' : ''}\n` + Object.entries(all.models).map(([model, row]) => `${model}: session ${money(current.models[model]?.cost || 0)} / all-time ${money(row.cost)} · ${row.prompt_tokens} in / ${row.completion_tokens} out · ${row.requests} requests`).join('\n'));
              ui.event('usage', { session: current, all_time: all }); break;
            }
            case '/login': await login(); break;
            case '/logout': {
              const current = readConfig(dir);
              delete current.apiKey; saveConfig(dir, current);
              say('Stored key removed.' + (process.env.AXON_API_KEY ? ' AXON_API_KEY is still set; unset it separately.' : '') + ' This session keeps using the old key until you exit.');
              break;
            }
            default: throw new Error(`Unknown command: ${command}. Try /help.`);
          }
        } catch (error) { ui.error(error.message); ui.event('error', { message: error.message }); }
      } else { const images = pending; pending = []; await turn(text.startsWith('//') ? text.slice(1) : text, images); }
    }
    ui.info(`Chat saved: ${engine.session.id}`);
  } catch (error) {
    ui ||= new UI({ json: argv.includes('--json') });
    ui.error(error.message); ui.event('error', { message: error.message, status: error.status }); process.exitCode = 1;
  } finally {
    ui?.stopActivity(); ui?.stopCaret(); input?.close(); process.removeListener('SIGINT', interrupt);
    // Keep the EPIPE handler installed until buffered stdout has drained.
  }
}
