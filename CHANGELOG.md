# Changelog

## 1.0.0 — 2026-09-19

First public release.

- Zero-dependency Node CLI and portable, single-file `axon.mjs` bundle.
- Streaming REPL, prompts, pipes, JSON events, continue/resume, and saved JSONL chats.
- Hidden-key onboarding, tiny live validation, private config, environment overrides.
- Four models, four variants, opt-in reasoning with visible/hideable thinking.
- Native Flash vision and Flash-to-text image routing for non-vision models.
- Clipboard images on Wayland, X11, and Windows; explicit path attachments everywhere.
- Permission-gated command and filesystem tools, bounded outputs, cancellation, and eight-round limit.
- Persistent memory, context trimming by complete turns, session/all-time model costs.
- Retry handling for 429/5xx and the API's temporary-unavailable response.
- Compatibility fix: tool-enabled rounds use non-streaming JSON because the live endpoint
  currently omits tool calls from its SSE output. Normal conversation remains streamed.
- Unit, protocol-fixture, real-TTY, and live API smoke verification.
