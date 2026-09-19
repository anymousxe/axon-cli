# Contributing

Requires Node 18+ and Git. There are no runtime or development dependencies to install.

```sh
git clone https://github.com/anymousxe/axon-cli.git
cd axon-cli
npm run check
```

Edit modules in `src/`, not the generated `bin/axon.mjs`. Run `npm run build` and commit the
updated bundle with source changes. The deterministic bundler only supports the import/export
forms used by this project; keep it simple or extend it with a regression test.

Tests use isolated temporary config directories and a loopback HTTP/SSE fixture. They do not
need credentials, access your real Axon config, or spend money. The live suite is opt-in:

```sh
AXON_API_KEY='your-key' npm run smoke:live
```

Live tests make billable calls, including images and one explicitly approved `echo` command.
Never commit a test key or paste it in a bug report. The inactive `.github/ci-template.yml` targets Windows and Linux on Node 18, 22, and 24.
Move it into `.github/workflows/ci.yml` with a workflow-authorized GitHub login to enable it.
For a bug report, include OS, Node version, `axon --version`, and a redacted reproduction.
