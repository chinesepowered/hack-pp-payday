// Composes demo/video.mp4 (1920x1080 H.264) from the Playwright recordings in demo/raw, title and
// caption cards rendered from HTML, and the ElevenLabs narration. Also writes demo/thumb.png and
// demo/narration.txt.   node demo/compose.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { promises as fs, readFileSync } from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const RAW = 'demo/raw';
const OUT = `${RAW}/scenes`;
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const probe = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
const marks = (name) => JSON.parse(readFileSync(`${RAW}/${name}.json`, 'utf8'));
const rio = readFileSync('public/rio.svg', 'utf8').replace(/<\?xml[^>]*>/, '');

const CSS = `*{box-sizing:border-box;margin:0}body{width:1920px;height:1080px;font-family:Inter,ui-sans-serif,system-ui,'Segoe UI',Roboto,Arial,sans-serif;color:#0b2a33;overflow:hidden}
.card{width:1920px;height:1080px;background:#f6f2ec;display:flex;align-items:center;gap:80px;padding:0 150px}
.dark{background:#0b2a33;color:#fff}.k{font-size:30px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0f766e}.dark .k{color:#7fd6c9}
h1{font-size:84px;line-height:1.08;font-weight:800;letter-spacing:-.02em;margin-top:18px}p{font-size:40px;line-height:1.35;margin-top:28px;color:#4d5f66}.dark p{color:#d7f0ea}
.rio svg{width:420px;height:420px}.side{position:absolute;left:820px;top:0;width:1100px;height:1080px;padding:120px 110px 0 40px}
.side h2{font-size:64px;line-height:1.1;font-weight:800;margin-top:14px}.side ul{list-style:none;margin-top:40px}
.side li{font:600 30px ui-monospace,Menlo,Consolas,monospace;background:#fff;border:2px solid #ddd5c8;border-radius:14px;padding:16px 22px;margin-top:16px}
.side li b{background:#0b2a33;color:#fff;border-radius:8px;padding:2px 10px;margin-right:12px;font-size:24px}.side li i{font:500 24px Inter,system-ui,sans-serif;color:#4d5f66;display:block;margin-top:6px}
.phone{position:absolute;left:150px;top:22px;width:596px;height:1036px;border-radius:44px;background:#0b2a33;box-shadow:0 30px 80px rgba(11,42,51,.35)}
.lower{position:absolute;left:60px;bottom:54px;max-width:1500px;background:rgba(11,42,51,.94);color:#fff;border-radius:18px;padding:18px 28px;font-size:30px;font-weight:700;border-left:10px solid #f59e0b}
.lower span{display:block;font:500 24px ui-monospace,Menlo,Consolas,monospace;color:#bfe9e1;margin-top:6px}`;

const card = (kicker, title, text, dark = false) =>
  `<div class="card ${dark ? 'dark' : ''}"><div style="flex:1"><div class="k">${kicker}</div><h1>${title}</h1><p>${text}</p></div><div class="rio">${rio}</div></div>`;
const side = (kicker, title, calls) =>
  `<div class="card"></div><div class="phone"></div><div class="side"><div class="k">${kicker}</div><h2>${title}</h2><ul>${calls.map(([m, p, n]) => `<li><b>${m}</b>${p}<i>${n}</i></li>`).join('')}</ul></div>`;
const lower = (title, sub) => `<div class="lower">${title}<span>${sub}</span></div>`;

const STILLS = {
  s01: card('Friday, 9:40 pm', 'Four homes cleaned.<br>Still waiting to be paid.', 'Small marketplaces often pay by hand, in batches, days later.'),
  s02: card('Payday', 'Same-day pay for gig workers.', 'For small service marketplaces with 20 to 500 workers. Shown here: TidyNest, a home cleaning marketplace, on the PayPal sandbox.', true),
  s03: side('1. Job complete', 'AI checks the evidence', [['AI', 'google/gemma-4-31B-it', 'Vision: which room is in each photo, and is it clean?'], ['RULE', 'checklist, check-in, location', 'Code compares the photos and the job record with the booking.']]),
  s04: side('2. Pay now', 'PayPal Payouts, at once', [['GET', '/v1/reporting/balances', 'Balance check before the batch.'], ['POST', '/v1/payments/payouts', 'One item to the worker\'s PayPal email.'], ['GET', '/v1/payments/payouts/{batch_id}', 'Polled until PENDING becomes SUCCESS.']]),
  s05: side('Under the hood', 'Every PayPal call, with its debug ID', [['POST', '/v2/checkout/orders', 'Money in: the customer pays TidyNest (Server SDK).'], ['POST', '/v1/payments/payouts', 'Money out: the worker is paid.'], ['GET', '/v1/payments/payouts/{batch_id}', 'Status polls. Webhooks are verified too.']]),
  s06: side('Needs review', 'A missing room stops the payout', [['AI', 'No photo shows the bathroom', 'The model reports what it sees.'], ['RULE', 'Not verified, not paid', 'The job waits for a person on the payouts desk.']]),
  s12: card('Payday', 'Paid the day<br>the job is done.', 'PayPal Payouts, an AI auditor, and a live AG Studio dashboard. Built for the PayPal AI Hackathon. Sandbox only.', true),
};
const LOWERS = {
  s07: lower('The operator\'s live dashboard, built in AG Studio', 'custom widgets: anomaly feed, time to pay, worker earnings  |  brand theme  |  layout presets'),
  s08: lower('Payout auditor: a custom agent in the AG Studio Agent Framework', 'tools: payout_totals_by_day, find_duplicate_payouts, show_evidence  |  model: Qwen3.8-27B'),
  s09: lower('Operator approves the cancel. PayPal answers. Payday reports it as it is.', 'POST /v1/payments/payouts-item/{payout_item_id}/cancel  |  sandbox returned HTTP 500 on the day of recording'),
  s10: lower('Money rules live in code. A person approves every fix.', 'duplicate guard  |  rate and cap check  |  email-change hold  |  balance check'),
  s11: lower('Honest limits: sandbox cancel refused today; Transaction Search lags up to 3 hours', 'GET /v1/reporting/transactions  |  the two weeks of history are seeded and labelled'),
};

async function renderStills() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [id, html] of Object.entries(STILLS)) {
    await page.setContent(`<style>${CSS}</style>${html}`);
    await page.screenshot({ path: `${OUT}/${id}.png` });
  }
  for (const [id, html] of Object.entries(LOWERS)) {
    await page.setContent(`<style>${CSS}body{background:transparent}</style>${html}`);
    await page.screenshot({ path: `${OUT}/${id}-lower.png`, omitBackground: true });
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.setContent(`<style>${CSS}body{width:1200px;height:800px}.card{width:1200px;height:800px;padding:0 70px;gap:30px}h1{font-size:64px}p{font-size:30px}.rio svg{width:300px;height:300px}</style>${card('Payday', 'Paid the day<br>the job is done.', 'Same-day pay for gig workers through PayPal Payouts, with an AI payout auditor.', true)}`);
  await page.screenshot({ path: 'demo/thumb.png' });
  await browser.close();
}

const PAD = 0.9;
const narration = JSON.parse(readFileSync('demo/narration.json', 'utf8'));
const voice = (id) => `${RAW}/voice/${id}.mp3`;

/** One scene: video for `dur` seconds plus the narration, as an mp4 segment. */
function scene(id, videoArgs, filter, dur, extraAudio) {
  const audioInputs = ['-i', voice(id), ...(extraAudio ? ['-i', extraAudio.file] : [])];
  const nVideo = videoArgs.filter((a) => a === '-i').length;
  const a0 = `[${nVideo}:a]adelay=350:all=1,apad[a0]`;
  const mix = extraAudio ? `${a0};[${nVideo + 1}:a]adelay=${Math.round(extraAudio.at * 1000)}:all=1,volume=0.9,apad[a1];[a0][a1]amix=inputs=2:normalize=0[a]` : `${a0};[a0]anull[a]`;
  ff([...videoArgs, ...audioInputs, '-filter_complex', `${filter};${mix}`, '-map', '[v]', '-map', '[a]', '-t', dur.toFixed(2), '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', `${OUT}/${id}.mp4`]);
  console.log(`  ${id}: ${dur.toFixed(1)}s`);
  return `${OUT}/${id}.mp4`;
}

const still = (id, extra = 0) => {
  const dur = probe(voice(id)) + PAD + extra;
  return scene(id, ['-loop', '1', '-i', `${OUT}/${id}.png`], '[0:v]scale=1920:1080,format=yuv420p[v]', dur);
};

/** A cut of a recording from `from` to `to` seconds, retimed to fill the scene. */
const cut = (from, to, dur) => `trim=start=${from.toFixed(2)}:end=${to.toFixed(2)},setpts=(PTS-STARTPTS)*${(dur / (to - from)).toFixed(4)}`;

function phoneScene(id, from, to, extra = 0, extraAudio) {
  const dur = probe(voice(id)) + PAD + extra;
  const filter = `[1:v]${cut(from, to, dur)},crop=400:720:0:0,scale=560:1008:flags=lanczos[p];[0:v][p]overlay=168:36:shortest=0,format=yuv420p[v]`;
  return scene(id, ['-loop', '1', '-i', `${OUT}/${id}.png`, '-i', `${RAW}/worker.webm`], filter, dur, extraAudio);
}

function wideScene(id, clip, from, to, extra = 0) {
  const dur = probe(voice(id)) + PAD + extra;
  const filter = `[0:v]${cut(from, to, dur)},scale=1920:1080[b];[b][1:v]overlay=0:0,format=yuv420p[v]`;
  return scene(id, ['-i', `${RAW}/${clip}.webm`, '-loop', '1', '-i', `${OUT}/${id}-lower.png`], filter, dur);
}

await fs.mkdir(OUT, { recursive: true });
await renderStills();
const w = marks('worker');
const d = marks('dashboard');
const o = marks('ops');
const rioLine = 'public/audio/rio-paid.mp3';
const s04voice = probe(voice('s04'));

const parts = [
  still('s01'),
  still('s02'),
  phoneScene('s03', w.start - 0.5, w.verified + 0.6),
  // The wait for PayPal is compressed; Rio speaks once the narrator has finished.
  phoneScene('s04', w.verified + 0.6, w.hoodOpen, probe(rioLine) + 0.2, { file: rioLine, at: s04voice + 0.6 }),
  phoneScene('s05', w.hoodOpen, w.hoodClose),
  phoneScene('s06', w.hoodClose + 0.4, w.end, 1.2),
  wideScene('s07', 'dashboard', d.start - 1, d.auditorOpen + 0.4, 0.6),
  wideScene('s08', 'dashboard', d.auditorOpen + 0.4, d.ask2 - 0.3, 3.5),
  wideScene('s09', 'dashboard', d.ask2 - 0.3, d.end, 3.5),
  wideScene('s10', 'ops', o.start - 1, o.reconcile, 1),
  wideScene('s11', 'ops', o.reconcile, o.end, 0.5),
  still('s12', 2.2),
];

await fs.writeFile(`${OUT}/list.txt`, parts.map((p) => `file '${p.replace(`${OUT}/`, '')}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', `${OUT}/list.txt`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'demo/video.mp4']);
await fs.writeFile(
  'demo/narration.txt',
  narration.map((s) => `[${s.id}] ${s.text}`).join('\n\n') + `\n\n[Rio, in the product, after scene s04] You got paid! The money is in your PayPal. Nice work today.\n`,
);
const total = probe('demo/video.mp4');
const size = (await fs.stat('demo/video.mp4')).size / 1e6;
console.log(`demo/video.mp4: ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}, ${size.toFixed(1)} MB`);
