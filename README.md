<p align="center"><img src="docs/hero.svg" alt="AXON — intelligence at your prompt" width="100%"></p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-%E2%89%A518-5eead4?style=flat" alt="Node 18 or newer">
  <img src="https://img.shields.io/badge/dependencies-zero-60a5fa?style=flat" alt="Zero dependencies">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT license"></a>
</p>

**A small, capable terminal companion for the Axon API.** Stream a quick answer, keep a long-running
conversation, attach a screenshot, or let Axon work with your files—with your permission.
Linux and Windows. One portable file. No runtime dependencies. Bring your own API key.

## Install

Install [Node.js 18+](https://nodejs.org/) first (a current LTS release is recommended).
The following install the versioned npm package from GitHub Releases, **not the npm registry**.
No Git checkout, build tools, or `sudo`-executed installer scripts required.
`--allow-remote=root` explicitly permits this direct download on npm 12+; older npm versions may
warn about the extra option and can omit it.

**Linux — Bash**
```sh
npm install -g --allow-remote=root https://github.com/anymousxe/axon-cli/releases/download/v1.1.0/anymousxe-axon-cli-1.1.0.tgz
```

**Windows — PowerShell**
```powershell
npm install -g --allow-remote=root https://github.com/anymousxe/axon-cli/releases/download/v1.1.0/anymousxe-axon-cli-1.1.0.tgz
```

Then run `axon`. First run opens a hidden-key wizard, validates your key with a tiny **billable** request,
and saves it in your platform's private config directory. `axon login` replaces it later.
If your PowerShell policy blocks npm's `.ps1` shims, use `npm.cmd` and `axon.cmd`.
On Linux, use a user-owned Node installation if your global npm prefix is not writable.

<details>
<summary>Portable single-file installation / running from source</summary>

Download [`axon.mjs`](https://github.com/anymousxe/axon-cli/releases/download/v1.1.0/axon.mjs) and run:

```sh
node /path/to/axon.mjs --help
```

The `.mjs` extension makes it work outside any npm project, including Node 18. The release also includes
SHA-256 checksums. Source install (requires Git):

```sh
npm install -g git+https://github.com/anymousxe/axon-cli.git
```

Or clone and run `node bin/axon.mjs`. The committed bundle needs no build step.
</details>

## Quickstart

```sh
axon                                  # Interactive conversation
axon -p "Explain this project briefly" # One-shot, streamed to stdout
cat error.log | axon -p "Find the cause"
axon -c                               # Continue your last chat
axon -r 20260919T215942-39f63f          # Resume an ID from /chats
axon --model axon-1.8-lightning -p "Summarize this idea"
axon --think high -p "Check this proof carefully"
axon -i screenshot.png -p "What is wrong with this UI?"
axon --tools                          # Offer tools; ask before each action
axon -p "Say hello" --json            # Newline-delimited JSON events
```

PowerShell piping works too: `Get-Content error.log -Raw | axon -p "Find the cause"`.
With no TTY, stdin is one prompt. Use `--repl` to interpret piped lines as separate turns and slash commands.
When `-p` and stdin are both supplied, stdin is appended as clearly delimited context.

### A real conversation

Captured against the **live Axon API** on 2026-09-19. Prompts below are annotated for readability;
the [captured output with obsolete status fields removed](examples/live-transcript.txt) is included. Tiny amounts round to four decimals.

```text
axon › /remember My favorite color is teal
Memory saved for future turns and sessions.

axon › What is my favorite color? Answer in one sentence.
Your favorite color is teal.

2.1s · ~99 in / 7 out tokens · +$0.0000 (estimated)

axon › /cost
Session: $0.0000 · All-time: $0.0000 (includes estimates)
axon-1.8-flash: session $0.0000 / all-time $0.0000 · 99 in / 7 out · 1 requests

axon › /exit
Chat saved: 20260919T215942-39f63f
```

## What feels good

- **Fast by default.** Flash; no extra reasoning effort unless you ask for it.
- **Streamed answers and thinking.** Opt-in reasoning appears in a amber, pulsing `∴ thinking` block.
  Hide its display without changing the requested effort or billing.
- **Useful context.** Persistent memory and complete recent turns, not orphaned tool messages.
  Old chat remains on disk when it leaves the context window.
- **Clear status.** Model · thinking effort · estimated context usage · session cost; ⚡ in fast mode.
  A TTY activity indicator runs while waiting; elapsed time and tokens follow each answer.
- **Images that reach the right model.** Native Flash input or a Flash description passed to a text-only model.
- **Tools you control.** Read, write, edit, list, and run commands. Off by default; no silent approvals.
- **Script-friendly.** Answers on stdout, UI on stderr, NDJSON when requested, friendly error exit codes.
- **Resilient by design.** Ctrl-C cancels without losing the chat; retries for rate limits/server errors;
  raw-key editing with a plain-line fallback, terminal escapes stripped from untrusted output, `NO_COLOR` support.

## Chat commands

| Command | Action |
| --- | --- |
| `/btw <question>` | Lightning side answer, never added to chat messages or future context; usage is still billed and recorded |
| `/fast` | Toggle Lightning + thinking off; toggle again to restore previous settings |
| `/compact` | Summarize active history with Lightning; retain transcript and report estimated tokens saved |
| `/retry` | Replace the last user turn and its replies with a fresh response; old transcript stays on disk |
| `/copy` | Copy the last assistant answer via `wl-copy`, `xclip`, `clip.exe`, or `pbcopy` |
| `/usage` | Detailed per-model input/output tokens, request counts, session and all-time cost |
| `/status` | Version, model, effort, masked key, context estimate, session ID, theme and cost |
| `/theme dark\|light\|auto` | Persist the terminal palette; auto uses `COLORFGBG` when available, otherwise dark |
| `/hide-thinking` | Toggle reasoning display without changing effort or billing |
| `/model [name]` | List models or switch; save as the new default |
| `/think off\|low\|medium\|high\|max` | Select reasoning effort; `off` omits it from requests |
| `/think show\|hide` | Show/hide reasoning text |
| `/img [path]` | Queue an image from a file or the clipboard |
| `/images clear` | Clear queued images |
| `/tools on\|off` | Enable tools or disable and clear session approvals |
| `/cost` | Session and all-time totals with per-model breakdown |
| `/remember <text>` | Add a timestamped persistent memory |
| `/memory` · `/forget <n>` | List numbered memories / remove one |
| `/chats` · `/resume <id>` | List recent chats / resume one |
| `/title <text>` | Rename the current chat |
| `/clear` | Clear active context, retaining the transcript and memory |
| `/new` | Start a fresh session |
| `/help` · `/exit` | Help / save and leave |

CLI settings flags apply to that invocation. Model, effort, thinking visibility, and theme commands persist. `/fast` is temporary and restores the previous model/effort when toggled off.
Use `//` to send a prompt beginning with a literal slash. Ctrl-D exits; Ctrl-C cancels an active
request, or twice at an idle prompt exits. The editor uses raw keys on capable TTYs, with a plain-line fallback for dumb terminals, legacy Windows consoles, and piped input.

## Command menu and terminal styling

Type `/` or `/prefix` at the prompt to open a fuzzy-filtered menu **above** the input.
Use ↑/↓ to select, Tab or Enter to complete, then Enter again to execute. Esc dismisses.
After completing `/model `, press Tab again to open the model argument menu with input/output
prices. `/think `, `/resume `, `/theme `, `/tools ` and `/images ` also complete arguments.
Command matching starts at the beginning of the prompt; slashes inside ordinary prose do not
hijack typing. Bracketed paste is inserted as text, including multiline text, never executed
as a batch of commands. Home/End, arrows, Backspace/Delete, Ctrl-A/E/U/K/W and history work.
Permission prompts and hidden key entry never show command suggestions.

Illustrative terminal sample (the actual UI colors these lines):

```text
  ϟ AXON 1.1.0

axon-1.8-flash · off · ctx 2% · $0.0004 session
› /model   List or switch models
  /memory  List persistent memories
axon › /m

∴ thinking 1.2s                         [amber pulse]
┌─ js ──────────────
│ const answer = await axon.chat("Hello");
└────────────────────
--- a/hello.js
+++ b/hello.js
@@ -1,1 +1,1 @@
-oldValue                               [red]
+newValue                               [green]
✓ complete
```

Ice-blue accents work on deep-space backgrounds; light mode uses darker, higher-contrast
accents. JS/TS, Python, JSON, SQL, Bash and sh fenced code gets dependency-free lexical
highlighting. Write/edit tools show unified diffs after approved changes. Startup fades in
for 300 ms; waiting shows a spinner with elapsed seconds; reasoning pulses and answers
complete with a subtle confirmation pulse. The prompt status refreshes after each command
and turn, and request activity shows the current model/effort/context/cost.

`NO_COLOR` disables colors **and animation** (but retains keyboard menus on capable TTYs).
`TERM=dumb` and non-TTY output are plain; redirected answers keep their original Markdown.
Windows Terminal supports ANSI/truecolor, while legacy Windows consoles use plain-line input.
JSON mode has no styled answer output or animations. Unicode width can vary by terminal;
the prompt scrolls horizontally rather than wrapping long input.

Compaction is billable and lossy: full transcripts remain on disk, but summarized context
replaces active messages only after a successful, smaller summary. Large histories are
summarized in bounded chunks. Image bytes are excluded from summaries; discuss important
visual details before compacting. `/clear` removes the compact summary as well as active
messages, not persistent memory. Token savings and context percentages are local estimates.

## Vision

```text
axon › /img ./screenshot.png
Queued 1 image(s). Add your prompt next.
axon › Explain this layout.
◈ Image route: native → axon-1.8-flash (1 image)
```

- **Flash:** PNG/JPEG/GIF/WebP bytes are sent as base64 multimodal content.
- **Lightning, 1.6, 1.6 Pro:** Flash first describes the image precisely; that description is then
  injected as explicitly untrusted context for the chosen text-only model. Both requests count toward cost.
- Switching a native-image conversation to a text-only model also routes retained images through Flash.
- `/img` with no argument reads an image from the clipboard: `wl-paste` (Wayland), `xclip` (X11), or
  Windows PowerShell's clipboard image API. Install `wl-clipboard`/`xclip` on Linux as needed.
  Ctrl-V remains normal text paste; use `/img` for images. Quoted paths with spaces work.
- Files are validated by magic bytes and capped at **10 MiB each**. Attach multiple with repeated `-i`.

Native image payloads are stored in local chat JSONL; description-routed chats store the description.
There is no separate image upload service.

## Tools and permissions

`axon --tools` or `/tools on` exposes five OpenAI-compatible functions:

| Tool | Behavior |
| --- | --- |
| `run_command` | Bash on Linux; PowerShell by default or `cmd` on Windows; 30-second timeout |
| `read_file` | Read a UTF-8 file, bounded to 64 KiB |
| `write_file` | Write/overwrite a UTF-8 file, create parent directories |
| `edit_file` | Replace one exact occurrence in a UTF-8 file (fails on ambiguous matches) |
| `list_dir` | List up to 500 directory entries |

Each action asks: **y / n / always-for-session / always-for-cmd** (`a` and `c` are shortcuts).
“Always for cmd” matches the exact tool and arguments, not a dangerous prefix wildcard. Grants disappear
when you exit or turn tools off. Non-TTY requests cannot approve tools and are denied automatically.
There is deliberately no `--yes` switch. Outputs are truncated for display and bounded in model context;
the loop stops after eight rounds per user turn.

**Live API compatibility:** the current endpoint returns function calls in non-streaming JSON, but drops
them from SSE. Tool-enabled rounds therefore use JSON requests; ordinary chat and vision remain streamed.
The same OpenAI function-call loop handles both response formats. The UI still shows activity while waiting.

Tools run with **your user privileges**, not in a sandbox. Read the [security guide](SECURITY.md) before
allowing broad access. Never approve a command just because the model says it is safe.

## Models and cost

Prices in USD per **1 million** tokens:

| Model | Input | Output | Images |
| --- | ---: | ---: | --- |
| `axon-1.6` | $0.05 | $0.15 | Flash description |
| `axon-1.6-pro` | $0.15 | $0.40 | Flash description |
| **`axon-1.8-flash`** (default) | **$0.10** | **$0.30** | **Native** |
| `axon-1.8-lightning` | $0.03 | $0.08 | Flash description |

All models default to **fast pass**: `reasoning_effort` is omitted. Opt in with `--think` or `/think`.

When present, response usage is authoritative. The live SSE endpoint may omit usage; Axon then uses a
clearly marked character-based estimate (~4 characters/token, with an image allowance). Reasoning and
all model/tool rounds contribute. Actual wallet charges may differ, particularly for images, reasoning,
and interrupted requests. Prices are a local table, not a wallet balance query.

`/btw` and `/compact` charges are included in the session ledger.

`usage.jsonl` is an append-only ledger, with a `usage.json` summary. `/cost` rebuilds from the ledger so
parallel processes do not lose entries. There is no migration from an arbitrary third-party usage file.

## Config, authentication, and privacy

| Platform | Default directory |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/axon` or `~/.config/axon` |
| Windows | `%APPDATA%\axon`, falling back to `%USERPROFILE%\.axon` |

| Variable | Purpose |
| --- | --- |
| `AXON_API_KEY` | Overrides the stored key; never written to config automatically |
| `AXON_BASE_URL` | API prefix or full completions URL; receives your key, so only use trusted servers |
| `AXON_CONFIG_DIR` | Override the whole config directory (useful for isolated projects/tests) |
| `NO_COLOR` | Disable ANSI styling |

Default URL: `https://axon-chat-nu.vercel.app/api/v1/chat/completions`.
`axon whoami` reports credential source and local paths **without printing the key**; it is not an account
identity or a fresh validation request. `axon logout` removes the saved key, not your shell's environment.

Config contains `config.json`, `chats/*.jsonl`, chat title sidecars, `last-chat`, `memory.md`, `usage.jsonl`,
and `usage.json`. Files are plaintext; Unix config files are private (`0600`, directory `0700`). Windows
uses your profile ACLs. There is **no telemetry or background update check**.

Memory keeps the newest ~8,000 characters (~2k estimated tokens). The local context input budget is
24,000 estimated tokens, **not a claim about the server's maximum window**. Trimming removes oldest whole
turns and always retains the generated system prompt and memory. Oversized single turns are rejected.

## JSON and exits

```sh
axon -p "Say hello" --json
```

Stdout is NDJSON: `delta`, `reasoning` (when visible), `image_route`, `tool`, and a final `result`, or
`error` / `cancelled`. REPL mode also emits `session`, `notice`, `usage`, `btw`, and `compact` events; approved file changes can emit `diff`. `result` includes:
`session_id`, `text`, `elapsed_seconds`, `usage`, `cost`, `session_cost`, and `context_percent`.
No banner or ANSI escapes are written to JSON stdout. Extract only `type == "result"` for the whole answer.

Exit codes: **0** success, **1** configuration/API failure, **130** cancelled one-shot. An interactive
request failure leaves the REPL open. Tools may return a denied/failed result without failing the whole chat.

## Development and verification

```sh
npm run check          # Build + unit tests + offline end-to-end smoke checks
npm run smoke:live     # Opt-in, billable: requires AXON_API_KEY
npm pack               # Build the installable npm tarball
```

Verified during release preparation on Linux with Node **18.20.8** and **26.8.2**:
- **31 unit/protocol/PTY tests:** pricing, storage, paths, SSE fragmentation, permissions, cancellation,
  early EOF, retry behavior, JSON tool parsing, rendering, capabilities, autocomplete, compaction,
  side-question isolation, retry persistence, clipboard fallbacks, and actual PTY interaction.
- **11 offline end-to-end checks:** real subprocess CLI, local HTTP fixture, image routing, permission denial,
  echo execution, memory across processes, continue/resume, and persisted costs.
- **9 live API smoke checks:** chat, piped/streamed REPL, memory, both image routes, resume, actual echo tool,
  and usage accounting. No credentials are in this repository.
- **Additional live v1.1 command smoke:** fast mode, side questions, compaction, post-summary context
  recall, retry, status, and detailed usage.
- **Automated Linux PTY checks:** menu placement, completion, resize, multiline bracketed paste,
  hidden input, EOF, and terminal-mode restoration. Prior v1 live checks covered login and tool approvals.
- A [CI workflow template](.github/ci-template.yml) targets Node **18, 22, and 24** on **Linux and Windows**.
  It is **not active**: the publishing login lacks GitHub workflow scope. Move it to
  `.github/workflows/ci.yml` using a workflow-authorized account to enable it. Windows runtime and
  desktop clipboard integration have **not** been verified in this release environment.

See [CONTRIBUTING.md](CONTRIBUTING.md). The source is intentionally small: `api`, `storage`, `images`,
`tools`, `engine`, `input`, `ui`, `render`, `commands`, `clipboard`, `paths`, `models`, and `cli`. A deterministic, dependency-free build script
emits the standalone executable.

## Roadmap

- Cache historical image descriptions when switching models.
- Optional OS keychain storage and encrypted chat export.
- Richer multiline editing and search without compromising fallback terminals.
- Server-reported context limits and exact image/reasoning billing when the API exposes them.
- Streaming tool rounds once the live endpoint preserves function-call deltas.
- npm registry distribution when publishing credentials are configured.

MIT licensed. This is a community CLI, not an assertion of affiliation with the Axon API operator.
