# Changelog

## 1.3.0 — 2026-09-20

- Fix the interactive tools-off default: plain TTY `axon` offers shell/file tools, always
  permission-gated. One-shot/pipes remain off unless `--tools`; `--no-tools` wins.
- Rich incremental Markdown: accent-backed inline code, bold/italic/strike, gradient
  underlined headings, lists, quotes, links, aligned tables, rules and fenced syntax.
  Add Go, Rust, C/C++ and Java lexical highlighting. Pipes keep raw Markdown.
- Truecolor hue-drift on startup, active status/spinner, streaming caret, lock-in badge
  and compaction; ~12 fps only while active, static 256-color/plain fallbacks.
- Ctrl+T and `/panel` inspector: session/usage/memory/tools tabs, arrows or 1–4 navigation,
  q/Esc dismissal, preserved drafts and narrow-terminal clipping.
- Complete slash args, model names, efforts, `/img` file paths and freeform/tool JSON paths.
- `/lockin [on|off]`: max effort, tools, 24 model/tool rounds, prior-state restoration,
  resumable JSONL markers, no bypass of permission checks. Subtle completion sparkles.
- Automatic compaction at 80% of the conservative 24k local budget; ledger-informed
  projections, `AXON_COMPACT_THRESHOLD` override, `/compact auto|off`, manual `/compact`.
  Lightning summarizes older turns while six recent turns remain verbatim. Nonempty/smaller
  summary check, failure-safe retention, JSONL resume, inspector counts and token savings.
- Preserve thinking, both reasoning protocols and include_reasoning, images/clipboard,
  memory, cost ledger, themes, dropdown, chats/resume and dependency-free Node 18 bundle.
- Release gates: 52 tests on Node 18/26, 11 fixture checks, 9 live API smoke checks,
  live PTY plain-axon uname approval, forced compaction + recall + resume validation.
  Windows terminal capabilities/providers are simulated; native Windows was not run.

## 1.2.1
- Reasoning hotfix: parse legacy top-level Axon SSE (reasoning/delta/level) and send include_reasoning opt-in with effort
- Docs: server-side reasoning opt-in patch for site operators (docs/reasoning-optin.patch)

## 1.2.0 — 2026-09-19

- Paste-anywhere images: Ctrl+V reads images or text directly from the clipboard in raw-key mode;
  no `/img` command required. Linux Wayland/X11, Windows PowerShell, and macOS providers.
- Existing PNG/JPEG/GIF/WebP paths auto-attach from pasted/typed prompts, `-p`, and piped input;
  support quoted paths, shell-escaped spaces, home paths, and local file URIs.
- Pending image chips above the prompt show source/name and dimensions. `/imgs` lists attachments;
  `/images clear` removes them. `/img` and repeated `-i` remain supported.
- Async, bounded, shell-free clipboard reads keep the editor responsive; missing tools and
  non-raw terminals explain the file-path fallback. Multiline paste remains one chat turn.
- Ctrl-L clear/redraw, Ctrl-D exit-on-empty with Unicode-safe forward delete, double-Esc streaming
  interrupt, history draft restoration, and cancellation that does not accidentally send attachments.
- Cell-aware narrow-terminal clipping for status, menus, chips and input, including CJK/emoji;
  bounded attachment rows and tiny-terminal spinner output. Retained high-contrast light palette.
- Shared help/dropdown command registry documents all new shortcuts and image queue behavior.
- Preserve streaming, thinking, permissions/tools, memory, ledger, chats, themes and both image routes.
- 40 tests pass on Node 18 and 26, including actual PTY image/text paste via a controlled provider;
  11 fixture smoke checks and 9 live API smoke checks pass. Live smoke reads saved login credentials.
- Rebuilt standalone bundle; release includes npm tarball, bundle and SHA-256 checksums.

## 1.1.0 — 2026-09-19

- Simplified model selection and request schema; removed obsolete server-specific selectors.
- Ice-blue brand palette, persisted dark/light/auto themes, 256-color and truecolor output.
- Streaming fenced-code renderer with JS/TS/Python/JSON/SQL/Bash/sh lexical highlighting.
- Permission-gated exact-match `edit_file` tool and colored write/edit unified diffs.
- Elapsed spinner, amber thinking pulse, 300 ms startup fade, completion pulse, colored status.
- Raw-key slash menu above input: fuzzy filtering, arrows, Tab/Enter completion, Esc dismissal,
  priced model menus, effort/theme/recent-chat argument menus, and bracketed-paste safety.
- Added `/btw`, `/fast`, `/compact`, `/retry`, `/copy`, `/usage`, `/status`, `/theme`,
  and `/hide-thinking`; retained all v1 commands, image routing and JSON/pipe modes.
- Transactional compaction and retry records preserve original transcripts on disk.
- Terminal capability fallbacks, hidden-key input isolation, and clipboard provider fallbacks.
- Expanded regression coverage and live API smoke verification; rebuilt single-file bundle.

## 1.0.0 — 2026-09-19

First public release.

- Zero-dependency Node CLI and portable, single-file `axon.mjs` bundle.
- Streaming REPL, prompts, pipes, JSON events, continue/resume, and saved JSONL chats.
- Hidden-key onboarding, tiny live validation, private config, environment overrides.
- Four models, opt-in reasoning with visible/hideable thinking.
- Native Flash vision and Flash-to-text image routing for non-vision models.
- Clipboard images on Wayland, X11, and Windows; explicit path attachments everywhere.
- Permission-gated command and filesystem tools, bounded outputs, cancellation, and eight-round limit.
- Persistent memory, context trimming by complete turns, session/all-time model costs.
- Retry handling for 429/5xx and the API's temporary-unavailable response.
- Compatibility fix: tool-enabled rounds use non-streaming JSON because the live endpoint
  currently omits tool calls from its SSE output. Normal conversation remains streamed.
- Unit, protocol-fixture, real-TTY, and live API smoke verification.
