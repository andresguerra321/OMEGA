import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Capture the production preview: Studio's development panel must never enter video.
const url = process.env.OMEGA_DEMO_URL || 'http://127.0.0.1:5179';
const output = new URL('./preview/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${url}/?render`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.seek === 'function');
  await page.evaluate(async () => { await document.fonts.load('400 24px Geist'); await document.fonts.ready; });
  const config = await page.evaluate(() => window.VIDEO);
  assert.deepEqual(config, { w: 1920, h: 1080, duration: 25, fps: 60 });
  assert.equal(await page.locator('#artifact').count(), 1);
  assert.equal(await page.locator('audio,video').count(), 0);
  assert.equal(await page.evaluate(() => document.fonts.check('400 24px Geist')), true);
  for (const [time, selector, expected] of [[21, '#end-brand', 0], [24, '#end-brand', 1], [10, '#containment', 0], [17, '#containment', 1], [18, '#vault-result', 0], [20, '#vault-result', 1]]) {
    await page.evaluate(t => window.seek(t), time);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator(selector).evaluate(el => +getComputedStyle(el).opacity), expected, `${selector} timing at ${time}s`);
  }
  const shot = async t => {
    await page.evaluate(t => window.seek(t), t);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    return page.locator('#stage').screenshot({ type: 'jpeg', quality: 90 });
  };
  const a = await shot(13);
  await shot(24.5); await shot(0); await shot(6);
  const b = await shot(13);
  assert.ok(a.equals(b), 'Seeking out of order must produce the same frame');
  const framing = await page.evaluate(async () => {
    const outside = [], offCenter = [];
    for (let frame = 0; frame <= 1500; frame += 3) {
      const t = frame / 60;
      window.seek(t);
      await new Promise(requestAnimationFrame);
      const r = document.querySelector('#artifact').getBoundingClientRect();
      if (r.left < 0 || r.right > 1920 || r.top < 100 || r.bottom > 980) outside.push(t);
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (t < 21.5 && (x < 480 || x > 1440 || y < 270 || y > 810)) offCenter.push(t);
    }
    return { outside, offCenter };
  });
  assert.equal(framing.outside.length, 0, `Hero outside action-safe area: ${framing.outside}`);
  assert.equal(framing.offCenter.length, 0, `Hero outside middle half: ${framing.offCenter}`);
  const times = [1.5, 5.5, 8.5, 11.5, 14.5, 16.2, 18.8, 21, 24.5];
  for (const t of times) await writeFile(new URL(`frame-${String(t).replace('.', '-')}.jpg`, output), await shot(t));
  assert.deepEqual(errors, []);
  const report = { config, framesSampled: 501, deterministicSeek: true, fontLoaded: true, singleHero: true, silent: true, framing, errors, reviewedTimes: times };
  await writeFile(new URL('checks.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--draft')) {
    // Review copy only: 960x540, 60 fps, one sample/frame, no audio or final master.
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-i', '-', '-an', '-vf', 'scale=960:540', '-c:v', 'libx264', '-crf', '24', '-preset', 'fast', '-pix_fmt', 'yuv420p', fileURLToPath(new URL('omega-draft-muted.mp4', output))], { stdio: ['pipe', 'inherit', 'inherit'] });
    let ffError;
    ff.on('error', error => { ffError = error; });
    const done = new Promise((resolve, reject) => ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    for (let frame = 0; frame < 1500; frame++) {
      const image = await shot(frame / 60);
      if (ffError) throw ffError;
      if (!ff.stdin.write(image)) await new Promise(resolve => ff.stdin.once('drain', resolve));
      if (frame % 300 === 0) console.log(`Draft: ${frame}/1500`);
    }
    ff.stdin.end(); await done;
    console.log('Muted draft ready: preview/omega-draft-muted.mp4');
  }
} finally { await browser.close(); }
