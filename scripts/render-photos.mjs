// Rasterises assets/photos-src/*.svg to public/photos/*.png at 1024x768.
// Usage: node scripts/render-photos.mjs
import { createRequire } from 'node:module';
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'assets', 'photos-src');
const outDir = join(root, 'public', 'photos');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.svg')).sort()) {
  const out = join(outDir, `${basename(file, '.svg')}.png`);
  await page.goto(pathToFileURL(join(srcDir, file)).href);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1024, height: 768 } });
  console.log(`${basename(out)}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
await browser.close();
