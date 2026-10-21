// Capture invite-card-anim.html as deterministic frames → assemble invite-card.mp4.
// Usage: node marketing/capture-anim.mjs   (then the ffmpeg step runs automatically)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const require = createRequire('/home/asif/Documents/FX GROUP/hds-crm-dashboard/package.json');
const { chromium } = require('playwright');

const FPS = 24, SECONDS = 7, FRAMES = FPS * SECONDS;
const DIR = '/tmp/invite-frames';
const OUT = fileURLToPath(new URL('../public/invite-card.mp4', import.meta.url));

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/home/asif/.pw-browsers/chromium-1234/chrome-linux64/chrome',
});
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
await page.goto(new URL('./invite-card-anim.html', import.meta.url).href);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }));

for (let f = 0; f < FRAMES; f++) {
  const t = (f / FPS) * 1000;
  await page.evaluate(ms => document.getAnimations().forEach(a => { a.currentTime = ms; }), t);
  await page.screenshot({ path: `${DIR}/f-${String(f).padStart(4, '0')}.png` });
  if (f % 24 === 0) console.log(`frame ${f}/${FRAMES}`);
}
await browser.close();

execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', `${DIR}/f-%04d.png`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'slow',
  '-movflags', '+faststart', '-an', OUT], { stdio: 'inherit' });
console.log('wrote', OUT);
