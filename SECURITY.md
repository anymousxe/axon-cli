# Security and privacy

Axon sends prompts, retained conversation context, attached images, and saved memory to
the configured Axon API. Tool results are also sent after you approve the tool. The default
endpoint is `https://axon-chat-nu.vercel.app/api/v1`.

- Keys are entered without echo, stored in the platform config directory, and created with
  mode `0600` on Unix. The containing directory is created with mode `0700`. Windows relies
  on your user profile's ACLs. Keys are not encrypted at rest. `AXON_API_KEY` avoids storing a key.
- `AXON_BASE_URL` receives your bearer token. Only point it at a server you trust. HTTP is
  allowed for local testing; use HTTPS for remote services.
- Chats (including native image payloads), memory, tool results, and usage are local plaintext.
  Do not commit the config directory. There is no telemetry, background update request, or cloud sync.
- Tools are **off by default**. All five tools require permission, including reads. In non-TTY
  mode they fail closed. The model and piped stdin cannot approve their own requests.
- Approving `run_command` gives the shell your normal user privileges and environment. This
  is **not a sandbox**. Inspect the complete command; do not approve instructions you do not trust.
  File writes may overwrite existing files. Long write previews are explicitly marked as truncated.
- `always-for-session` approves every enabled tool for that process. `always-for-cmd` approves
  only the exact tool name and arguments (including shell, path, and content), not a prefix.
  `/tools off` clears approvals. No permission grants persist to disk.
- Model and tool output have terminal escape/control sequences removed in human-readable mode.
  NDJSON is machine-readable; consumers must sanitize strings before displaying them in a terminal.
- Shell commands time out after 30 seconds. POSIX process groups or Windows `taskkill /T` are used
  on cancellation. This is best-effort cleanup, not containment of intentionally detached processes.

Report vulnerabilities privately using GitHub's private vulnerability reporting when available,
or contact the repository owner before publishing exploit details. Never post API keys in issues.

- `/btw` sends only the side question to Lightning, not session history or persistent memory. Its usage is recorded.
- `/compact` sends active conversation text to Lightning; original transcript records remain on disk.
- `/copy` sends the last assistant answer to a local clipboard program without using a shell. Clipboard contents may be visible to other local applications.
