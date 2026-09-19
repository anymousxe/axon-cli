# Axon 1.8 Flash — From spark to possibility

A 24-second independent concept advertisement: a real-time, ray-marched copper core, four editorial chapters, and an original procedural ambient score. No stock footage, external fonts, tracking, API keys or third-party runtime dependencies.

## Deliverables

- `index.html`, `style.css`, `ad.js`, `icon.svg`: responsive interactive web edition.
- [Video, poster, audio and verification downloads](https://github.com/anymousxe/axon-cli/releases/tag/axon-flash-ad-v1): 1920×1080 H.264/AAC MP4, 24 fps, 24 seconds; stereo WAV; poster; checksums.
- `../../scripts/test-ad.mjs`: automated Chromium/browser QA with screenshots.
- `../../scripts/render-ad.mjs`: deterministic video renderer and full-decode verifier.

This is a concept film for the Axon CLI, not a claim of an official model-provider campaign. Pricing reflects the CLI's model table at production time, not a live wallet quote.

## Watch locally

From the repository root:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
# Open http://127.0.0.1:8080/docs/ad/
```

Play/pause, replay, seek, select chapters, enable sound, or drag the core to change the view. Space toggles playback when not focused on a control. Sound is opt-in. Reduced-motion users start paused; WebGL failure/context loss reveals a CSS fallback; without JavaScript, a static introduction and useful link remain.

Preview links support `?t=12&paused=1`. `?capture=1` selects the clean 16:9 export layout and disables autoplay and transition animations. `window.axonFilm.seek(seconds)` renders an exact frame; `.state` exposes read-only playback metadata. No network requests are made beyond local assets until a user follows a link.

## Storyboard

| Time | Chapter | Message |
| --- | --- | --- |
| 00–06 | Spark | Big ideas. Meet Flash. |
| 06–12 | See | Paste a screenshot. Native vision. |
| 12–18 | Think | Fast by default. Extra reasoning by choice. |
| 18–24 | Create | Less friction. More creation. Open the CLI. |

The linked copper rings and warm central glow rotate continuously; the geometry evolves over the film. Charcoal, warm white, and copper-orange type keep the composition readable. The export uses editorial cuts between chapters. The final chapter holds the call to action for six seconds.

## Reproduce QA and video

Requires Node 18+, Python only for manual serving, Chromium, FFmpeg/FFprobe (with libx264 and AAC), and Playwright **as a development tool only**. Install browser tooling outside the CLI project to keep its zero-dependency package unchanged:

```sh
npm install --prefix /tmp/axon-ad-tools playwright
export AXON_PLAYWRIGHT=/tmp/axon-ad-tools/node_modules/playwright/index.mjs
export AXON_CHROMIUM=/usr/bin/chromium # override for your installation
node scripts/test-ad.mjs /tmp/axon-ad-qa
node scripts/render-ad.mjs /tmp/axon-ad-export
cd /tmp/axon-ad-export && sha256sum -c SHA256SUMS
```

The scripts start isolated loopback servers on automatically allocated ports; no existing server is reused. Chromium uses SwiftShader to make headless WebGL reproducible. Export is 576 individually rendered frames, not real-time screen recording, so a slow machine does not drop frames. `AD_WIDTH`/`AD_HEIGHT` may override 1920×1080 for drafts. Rendering can take several minutes on software graphics.

The offline stereo soundtrack is generated from sine-wave chord beds, decaying arpeggios, a bass pulse and chapter accents, with fade-in/out. The web edition uses a quieter, opt-in ambient chord bed rather than downloading the video score.

## Verification

Browser QA checks shader compilation, all four chapters, play/pause/replay/end state, timeline seeking, chapter selection, sound controls, all chapter headlines at 320/390/768/1024/1440/1920px, reduced-motion behavior, WebGL context-loss fallback, no-JavaScript content, export layout, and absence of browser exceptions/HTTP errors. Screenshots are saved for visual inspection.

Export verification checks dimensions, 576 frames, duration, both video/audio streams, and a complete FFmpeg decode. SHA-256 checksums cover the exported assets. Actual Safari/Firefox and physical mobile GPU behavior are not covered by the Chromium checks.
