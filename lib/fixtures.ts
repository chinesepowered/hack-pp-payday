// Replay fixtures: real sandbox and model responses recorded from a live run (RECORD_FIXTURES=1),
// kept in fixtures/replay.json. Replay mode answers from these when the sandbox or the model is down.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import recorded from '@/fixtures/replay.json';

type Fixtures = { paypal: Record<string, unknown>; ai: Record<string, unknown> };
const FILE = path.join(process.cwd(), 'fixtures', 'replay.json');
const fixtures = recorded as unknown as Fixtures;
export const recording = () => process.env.RECORD_FIXTURES === '1';

export function readFixture<T>(kind: keyof Fixtures, key: string): T | undefined {
  return fixtures[kind]?.[key] as T | undefined;
}

let queue: Promise<void> = Promise.resolve();
export function recordFixture(kind: keyof Fixtures, key: string, value: unknown) {
  if (!recording()) return;
  queue = queue.then(async () => {
    const current = JSON.parse(await fs.readFile(FILE, 'utf8')) as Fixtures;
    current[kind][key] = value;
    await fs.writeFile(FILE, JSON.stringify(current, null, 1));
  });
  return queue;
}
