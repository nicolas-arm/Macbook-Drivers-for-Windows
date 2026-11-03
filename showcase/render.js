// Render comp.html frame by frame into an MP4.
//   node render.js stills 3 19.5 27.4     -> stills/t-<sec>.png
//   node render.js video [out.mp4] [fps]  -> frames piped into ffmpeg, muxed with soundtrack-chiptune.wav
//   SPEED=7/6 AUDIO=soundtrack-bigbeat.wav node render.js video out.mp4  -> play the timeline faster (e.g. 120 -> 140 bpm grid)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright-core");
const FFMPEG = require("ffmpeg-static");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript" };

function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

async function open(server) {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.error("pageerror:", e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/showcase/comp.html`);
  await page.evaluate(() => window.COMP.ready);
  await page.waitForTimeout(300);
  return { browser, page };
}

(async () => {
  const [mode = "stills", ...rest] = process.argv.slice(2);
  const server = await serve();
  const { browser, page } = await open(server);
  const meta = await page.evaluate(() => ({ FPS: COMP.FPS, DURATION: COMP.DURATION, EVENTS: COMP.EVENTS }));
  fs.writeFileSync(path.join(__dirname, "events.json"), JSON.stringify(meta, null, 0));

  if (mode === "stills") {
    fs.mkdirSync(path.join(__dirname, "stills"), { recursive: true });
    // play up to each still so stateful bits (typed input) are reached in order
    for (const s of rest.map(Number).sort((a, b) => a - b)) {
      await page.evaluate(t => COMP.renderAt(t), s);
      await page.screenshot({ path: path.join(__dirname, "stills", `t-${s.toFixed(2)}.png`) });
      console.log("still", s);
    }
  } else if (mode === "events") {
    console.log("wrote events.json,", meta.EVENTS.length, "cues");
  } else {
    const out = path.resolve(rest[0] || path.join(__dirname, "videos", "mdfw-showcase-chiptune.mp4"));
    const fps = +(rest[1] || meta.FPS);
    const speed = (process.env.SPEED || "1").split("/").map(Number).reduce((a, b) => a / b);
    const n = Math.round(meta.DURATION / speed * fps);
    const audio = path.resolve(process.env.AUDIO || path.join(__dirname, "soundtrack-chiptune.wav"));
    const args = ["-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-"];
    if (fs.existsSync(audio)) args.push("-i", audio);
    args.push("-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation", "-pix_fmt", "yuv420p",
      "-profile:v", "high", "-movflags", "+faststart", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709");
    if (fs.existsSync(audio)) args.push("-c:a", "aac", "-b:a", "256k", "-shortest");
    args.push(out);
    const ff = spawn(FFMPEG, args, { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = ""; ff.stderr.on("data", d => { ffErr = (ffErr + d).slice(-4000); });
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      await page.evaluate(t => COMP.renderAt(t), i / fps * speed);
      const buf = await page.screenshot({ type: "png" });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
      if (i % (fps * 2) === 0) process.stdout.write(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
    ff.stdin.end();
    const code = await new Promise(r => ff.on("close", r));
    if (code) { console.error(ffErr); process.exit(1); }
    console.log("wrote", out);
  }
  await browser.close();
  server.close();
})();
