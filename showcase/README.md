# MDfW showcase video

A 1080p60 product video for the site, plus four soundtracks. Everything is generated from code.

| Video | Music | Length |
|---|---|---|
| `videos/mdfw-showcase-chiptune.mp4` | 120 bpm chiptune | 62 s |
| `videos/mdfw-showcase-bigbeat.mp4` | 140 bpm big beat (timeline played 7/6× faster) | 53 s |
| `videos/mdfw-showcase-dreampop.mp4` | 120 bpm dream pop | 62 s |
| `videos/mdfw-showcase-metal.mp4` | 120 bpm heavy metal | 62 s |

All tracks are original compositions.

## How it works

- `comp.html` is the composition: the real `site/index.html` runs in an iframe, driven by a camera, cursor, captions and the pixel robot. Every frame is a pure function of time (`COMP.renderAt(t)`), and the page also lists every audio cue (keystrokes, clicks, cuts) in `COMP.EVENTS`.
- `render.js` serves the repo locally, steps headless Chrome through the timeline frame by frame and pipes PNGs into ffmpeg. It also writes `events.json`.
- `synth-*.js` read `events.json` and synthesize each soundtrack (music plus sound effects on the exact frames) into a WAV.

## Rebuilding

Needs Node 18+ and Google Chrome.

```sh
cd showcase
npm install
npm run events           # refresh events.json after editing comp.html
npm run stills 20 45     # preview frames at those seconds -> stills/
npm run metal            # synthesize + render one version (~3 min); also: chiptune, bigbeat, dreampop
```

To change only the music, run its synth script and remux the audio into the existing video (no re-render). Any ffmpeg works; the one npm installed is at `$(node -p "require('ffmpeg-static')")`.

```sh
node synth-metal.js
ffmpeg -i videos/mdfw-showcase-metal.mp4 -i soundtrack-metal.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest videos/out.mp4
```
