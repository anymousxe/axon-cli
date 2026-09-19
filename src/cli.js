import fs from 'node:fs';
import path from 'node:path';
import { configDir, readConfig, saveConfig, apiKey } from './paths.js';
import { MODELS, VARIANTS, EFFORTS, money, validateSettings } from './models.js';
import { Session, lastSession, listSessions, memoryText, remember, forget, recordUsage, usageSummary } from './storage.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { completion, endpoint } from './api.js';
import { loadImage, clipboardImage } from './images.js';
import { Permissions } from './tools.js';
import { Engine } from './engine.js';

export const VERSION = '1.0.0';
const HELP = `axon — a fast terminal companion for Axon\n\nUsage: axon [options] [login|logout|whoami]\n\n  -p, --prompt <text>    One-shot prompt (piped stdin is additional context)\n  -i, --image <path>     Attach an image; repeat for multiple images\n  -c, --continue         Continue the last chat\n  -r, --resume <id>      Resume a saved chat\n      --model <name>    Default: axon-1.8-flash\n      --variant <name>  crescent (default), stellar, zetta, nano\n      --think <effort>  off (default), low, medium, high, max\n      --hide-thinking   Hide reasoning; does not change its cost\n      --tools           Enable permission-gated tools (TTY required to approve)\n      --no-tools        Disable tools\n      --json            Newline-delimited JSON events on stdout\n      --repl            Treat piped lines as REPL turns and slash commands\n      --version         Print version\n  -h, --help            Show this help\n\nWithout a prompt: interactive chat on a TTY; one-shot from piped stdin.\nConfig: AXON_API_KEY, AXON_BASE_URL, AXON_CONFIG_DIR, NO_COLOR.\n`;
const SLASH_HELP = `/model [name]        List or switch models\n/variant [name]      List or switch variants\n/think <effort>      off | low | medium | high | max\n/think show|hide     Show or hide the reasoning block\n/img [path]         Queue an image; no path reads clipboard\n/images clear       Remove queued images\n/tools on|off       Toggle permission-gated tools\n/cost               Session and all-time usage, by model\n/memory             Print numbered persistent memories\n/remember <text>    Save a timestamped memory\n/forget <n>         Remove memory number n\n/chats              List recent chats\n/resume <id>        Resume a saved chat\n/title <text>       Rename this chat\n/clear              Clear context; retain transcript and memory\n/new                Start a new chat\n/help               Show this help\n/exit               Save and leave\n\nTip: /img uses your clipboard; Ctrl-V pastes text normally.\nCtrl-C cancels the active request; Ctrl-D leaves. Tools may modify files.\nUse // at the start of a prompt to send a literal leading slash.`;

export function parseArgs(argv) {
  const options = { images: [] };
  const values = { '-p': 'prompt', '--prompt': 'prompt', '-i': 'image', '--image': 'image', '-r': 'resume', '--resume': 'resume', '--model': 'model', '--variant': 'variant', '--think': 'effort' };
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
    else if (flag === '--hide-thinking') options.hideThinking = true;
    else if (['login', 'logout', 'whoami'].includes(flag) && !options.command) options.command = flag;
    else throw new Error(`Unknown argument: ${flag}. Run axon --help.`);
  }
  if (options.continue && options.resume) throw new Error('Choose either --continue or --resume.');
  if (options.repl && options.prompt !== undefined) throw new Error('Choose --repl or --prompt, not both.');
  return options;
}
function settingsFrom(config, opts) {
  return { model: opts.model ?? config.model ?? 'axon-1.8-flash', variant: opts.variant ?? config.variant ?? 'crescent', effort: opts.effort ?? config.effort ?? 'off', showThinking: !opts.hideThinking && config.showThinking !== false };
}
function saveSettings(dir, settings) { saveConfig(dir, { ...readConfig(dir), ...settings }); }

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
    if (opts.command === 'whoami') {
      const source = process.env.AXON_API_KEY ? 'AXON_API_KEY' : config.apiKey ? 'config' : 'none';
      const info = { authenticated: source !== 'none', source, config_dir: dir, endpoint: endpoint(), note: 'Local credential presence only; not an account identity or live validation.' };
      if (opts.json) ui.event('whoami', info); else ui.info(`${info.authenticated ? 'Key configured' : 'Not logged in'} (${source})\nConfig: ${dir}\nEndpoint: ${info.endpoint}\n${info.note}`);
      return;
    }
    let key = apiKey(dir);
    if (!key || opts.command === 'login') {
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
      if (opts.command === 'login') return;
      config = readConfig(dir);
    }
    const settings = settingsFrom(config, opts); validateSettings(settings);
    const session = new Session(dir, opts.resume || (opts.continue ? lastSession(dir) : undefined));
    const interactive = Boolean(process.stdin.isTTY) && opts.prompt === undefined;
    const repl = interactive || opts.repl;
    if (repl && !input) input = new Input(interrupt);
    if (!input && process.stdin.isTTY) input = new Input(interrupt);
    const permissions = new Permissions(process.stdin.isTTY && input ? prompt => input.ask(prompt) : null, ui, opts.tools ?? false);
    const engine = new Engine({ dir, key, session, settings, ui, permissions });
    let pending = opts.images.map(loadImage);
    const turn = async (text, images) => {
      controller = new AbortController();
      const timeout = setTimeout(() => { ui.info('Request reached the 5-minute safety timeout.'); controller?.abort(); }, 300000);
      try { await engine.turn(text, images, controller.signal); }
      catch (error) {
        if (!controller.signal.aborted) { ui.error(error.message); ui.event('error', { message: error.message, status: error.status }); }
        if (!repl) process.exitCode = controller.signal.aborted ? 130 : 1;
      } finally { clearTimeout(timeout); controller = null; }
    };
    if (!repl) {
      let piped = '';
      if (!process.stdin.isTTY) {
        let size = 0;
        for await (const chunk of process.stdin) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Piped input exceeds 1 MiB.'); piped += chunk; }
      }
      const prompt = opts.prompt === undefined ? piped.trim() : opts.prompt + (piped.trim() ? `\n\n<stdin>\n${piped.trim()}\n</stdin>` : '');
      if (!prompt && !pending.length) throw new Error('No prompt supplied. Use axon -p "Hello", pipe text, or run axon in a terminal.');
      await turn(prompt, pending); return;
    }
    ui.info(`\n  AXON ${VERSION}  ·  ${session.id}\n  /help for commands · /img for clipboard · Ctrl-C cancels\n`);
    ui.event('session', { session_id: session.id, ...settings });
    while (!interrupted) {
      ui.status(settings, money(engine.session.cost), engine.contextPercent);
      const line = await input.next(pending.length ? `axon [${pending.length} img] › ` : 'axon › ');
      if (line === null) break;
      const text = line.trim(); if (!text) continue;
      if (text.startsWith('/') && !text.startsWith('//')) {
        const space = text.search(/\s/), command = space < 0 ? text : text.slice(0, space), arg = space < 0 ? '' : text.slice(space).trim();
        try {
          if (command === '/exit' || command === '/quit') break;
          const say = value => { ui.info(value); ui.event('notice', { command, text: value }); };
          switch (command) {
            case '/help': say(SLASH_HELP); break;
            case '/model':
              if (!arg) say(Object.keys(MODELS).map(name => `${name === settings.model ? '●' : '○'} ${name}`).join('\n'));
              else { validateSettings({ ...settings, model: arg }); settings.model = arg; saveSettings(dir, settings); say(`Model: ${arg}`); } break;
            case '/variant':
              if (!arg) say(VARIANTS.join(' · '));
              else { validateSettings({ ...settings, variant: arg }); settings.variant = arg; saveSettings(dir, settings); say(`Variant: ${arg}`); } break;
            case '/think':
              if (['show', 'hide'].includes(arg)) settings.showThinking = arg === 'show';
              else if (!arg) { say(`Effort: ${settings.effort}; display: ${settings.showThinking ? 'show' : 'hide'}. Options: ${EFFORTS.join(', ')}`); break; }
              else { validateSettings({ ...settings, effort: arg }); settings.effort = arg; }
              saveSettings(dir, settings); say(`Thinking: ${settings.effort}, ${settings.showThinking ? 'visible' : 'hidden'}`); break;
            case '/tools':
              if (!['on', 'off'].includes(arg)) { say(`Tools: ${permissions.enabled ? 'on' : 'off'}. Usage: /tools on|off`); break; }
              permissions.enabled = arg === 'on'; if (!permissions.enabled) { permissions.session = false; permissions.allowed.clear(); }
              say(`Tools ${arg}. ${arg === 'on' ? 'Each action needs approval; grants expire when you exit.' : 'Session approvals cleared.'}`); break;
            case '/img': pending.push(arg ? loadImage(arg.replace(/^(["'])(.*)\1$/, '$2')) : clipboardImage()); say(`Queued ${pending.length} image(s). Add your prompt next.`); break;
            case '/images': if (arg !== 'clear') throw new Error('Usage: /images clear'); pending = []; say('Image queue cleared.'); break;
            case '/remember': remember(dir, arg); say('Memory saved for future turns and sessions.'); break;
            case '/memory': say(memoryText(dir).split('\n').filter(Boolean).map((value, i) => `${i + 1}. ${value}`).join('\n') || 'No memories yet. /remember <text>'); break;
            case '/forget': forget(dir, Number(arg)); say('Memory removed.'); break;
            case '/chats': say(listSessions(dir).map(chat => `${chat.id}  ${chat.title}`).join('\n') || 'No saved chats.'); break;
            case '/resume': engine.session = new Session(dir, arg || lastSession(dir)); pending = []; engine.contextPercent = 0; say(`Resumed ${engine.session.id}: ${engine.session.title}`); break;
            case '/new': engine.session = new Session(dir); pending = []; engine.contextPercent = 0; say(`New chat: ${engine.session.id}`); break;
            case '/title': if (!arg) { say(engine.session.title); break; } engine.session.setTitle(arg); say('Title saved.'); break;
            case '/clear': engine.session.clear(); pending = []; engine.contextPercent = 0; say('Context cleared. Transcript and persistent memory retained.'); break;
            case '/cost': {
              const all = usageSummary(dir), current = usageSummary(dir, engine.session.id);
              say(`Session: ${money(current.total)} · All-time: ${money(all.total)}${all.estimated ? ' (includes estimates)' : ''}\n` + Object.entries(all.models).map(([model, row]) => `${model}: session ${money(current.models[model]?.cost || 0)} / all-time ${money(row.cost)} · ${row.prompt_tokens} in / ${row.completion_tokens} out · ${row.requests} requests`).join('\n'));
              ui.event('usage', { session: current, all_time: all }); break;
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
    input?.close(); process.removeListener('SIGINT', interrupt);
    // Keep the EPIPE handler installed until buffered stdout has drained.
  }
}
