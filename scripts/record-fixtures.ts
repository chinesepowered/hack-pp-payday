// Records the model responses Replay mode answers from (fixtures/replay.json): one reading per
// seeded photo and one explanation per anomaly kind. PayPal responses are recorded by running the
// app or scripts/smoke.ts with RECORD_FIXTURES=1.   RECORD_FIXTURES=1 pnpm tsx scripts/record-fixtures.ts
import './env';
import { readPhoto } from '../lib/ai';
import { runWith } from '../lib/context';
import { loadState, runWatchdog, saveState } from '../lib/flows';
import { PHOTO } from '../lib/seed-data';

runWith({ sid: 'fixtures', mode: 'live', feature: 'Record fixtures' }, async () => {
  const photos = [...new Set(Object.values(PHOTO).flat())];
  for (const p of photos) console.log(p, (await readPhoto(p)).room);
  const state = await loadState();
  for (const a of state.anomalies) delete a.ai;
  await saveState(state);
  for (let i = 0; i < 3; i++) {
    const anomalies = await runWatchdog();
    console.log(`explained ${anomalies.filter((a) => a.ai).length} of ${anomalies.length}`);
    if (anomalies.every((a) => a.ai)) break;
  }
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
