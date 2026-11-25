import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const output = new URL('./final/', import.meta.url);
const cache = new URL('.render-cache/', output);
await mkdir(cache, { recursive: true });
const run = args => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', args, { stdio: 'inherit' });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`)));
});
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const workers = 4, fps = 60, subframes = 4, frames = 1500;
let rendered = 0;
try {
  await Promise.all(Array.from({ length: workers }, async (_, worker) => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => { throw error; });
    await page.goto('http://127.0.0.1:5179/?render', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.seek === 'function');
    await page.evaluate(async () => { await document.fonts.load('400 24px Geist'); await document.fonts.ready; });
    assert.equal(await page.evaluate(() => window.VIDEO.duration), 25);
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps * subframes), '-i', '-', '-an', '-vf', 'tmix=frames=4,select=eq(mod(n\\,4)\\,3),setpts=N/(60*TB)', '-r', '60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium', '-threads', '2', fileURLToPath(new URL(`part-${worker}.mp4`, cache))], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => { ff.on('error', reject); ff.on('close', code => code === 0 ? resolve() : reject(new Error(`Worker ${worker}: FFmpeg ${code}`))); });
    const first = worker * frames / workers, last = (worker + 1) * frames / workers;
    for (let frame = first; frame < last; frame++) {
      for (let sub = 0; sub < subframes; sub++) {
        await page.evaluate(t => window.seek(t), (frame + .5 * sub / subframes) / fps);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const image = await page.locator('#stage').screenshot({ type: 'jpeg', quality: 98 });
        if (!ff.stdin.write(image)) await new Promise(resolve => ff.stdin.once('drain', resolve));
      }
      rendered++;
      if (rendered % 150 === 0) console.log(`Master: ${rendered}/${frames} frames (4 subframes/frame)`);
    }
    ff.stdin.end(); await done; await page.close();
  }));
  const list = Array.from({ length: workers }, (_, worker) => `file 'part-${worker}.mp4'`).join('\n');
  const listFile = new URL('parts.txt', cache);
  await writeFile(listFile, list + '\n');
  await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', fileURLToPath(listFile), '-c', 'copy', '-movflags', '+faststart', fileURLToPath(new URL('omega-master-silent.mp4', output))]);
  console.log('Master ready: final/omega-master-silent.mp4');
} finally { await browser.close(); }
