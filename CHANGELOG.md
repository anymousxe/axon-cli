# Changelog

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
