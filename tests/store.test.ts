import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadState, mutate, reservePayouts } from '../lib/flows';
import { ConflictError, getDoc, setBackendForTests, setDoc, updateDoc, type Backend } from '../lib/store';

/** An in-memory store with versions, and hooks to interleave requests exactly where it hurts. */
function memory() {
  const docs = new Map<string, { body: string; version: number }>();
  const hooks: { beforeWrite?: (key: string) => Promise<void>; failReads?: boolean } = {};
  let writes = 0;
  const backend: Backend = {
    async read(key) {
      if (hooks.failReads) throw new Error('storage unavailable');
      const d = docs.get(key);
      return d ? { value: d.body, version: String(d.version) } : null;
    },
    async write(key, body, expect) {
      const hook = hooks.beforeWrite;
      if (hook) {
        hooks.beforeWrite = undefined;
        await hook(key);
      }
      const d = docs.get(key);
      if (expect === 'absent' && d) throw new ConflictError(key);
      if (expect !== undefined && expect !== 'absent' && String(d?.version) !== expect) throw new ConflictError(key);
      docs.set(key, { body, version: (d?.version ?? 0) + 1 });
      writes++;
    },
    async remove(key) {
      docs.delete(key);
    },
  };
  return { backend, hooks, docs, writes: () => writes };
}

let store: ReturnType<typeof memory>;
beforeEach(() => {
  store = memory();
  setBackendForTests(store.backend);
});
afterEach(() => setBackendForTests(null));

describe('updateDoc: no lost updates', () => {
  it('keeps both changes when two requests update the same document at once', async () => {
    await setDoc('counter', { n: 0 });
    const bump = () => updateDoc<{ n: number }, void>('counter', (c) => ({ doc: { n: (c?.n ?? 0) + 1 }, result: undefined }));
    await Promise.all(Array.from({ length: 10 }, bump));
    expect(await getDoc('counter')).toEqual({ n: 10 });
  });

  it('re-applies a change to the newer document when another request wrote first', async () => {
    await setDoc('doc', { a: 0, b: 0 });
    // Request A has read the document and is about to save; request B saves in between.
    store.hooks.beforeWrite = async () => {
      await updateDoc<{ a: number; b: number }, void>('doc', (c) => ({ doc: { ...c!, b: 1 }, result: undefined }));
    };
    await updateDoc<{ a: number; b: number }, void>('doc', (c) => ({ doc: { ...c!, a: 1 }, result: undefined }));
    expect(await getDoc('doc')).toEqual({ a: 1, b: 1 });
  });

  it('creates a missing document once, even when two requests race to create it', async () => {
    const make = () => updateDoc<{ made: number }, number>('fresh', (c) => (c ? { doc: c, result: c.made, save: false } : { doc: { made: Math.random() }, result: -1 }));
    await Promise.all([make(), make(), make()]);
    const first = await getDoc<{ made: number }>('fresh');
    expect(await make()).toBe(first!.made);
  });

  it('treats a failed read as an error, never as "no document yet"', async () => {
    await setDoc('precious', { keep: true });
    store.hooks.failReads = true;
    const before = store.writes();
    await expect(getDoc('precious')).rejects.toThrow(/unavailable/);
    await expect(updateDoc('precious', () => ({ doc: { keep: false }, result: undefined }))).rejects.toThrow(/unavailable/);
    expect(store.writes()).toBe(before); // nothing was written over the real document
  });
});

describe('app state under concurrent requests', () => {
  it('does not create a fresh state over the real one when the read fails', async () => {
    await loadState(); // creates the seeded state
    await mutate((s) => {
      s.jobs.find((j) => j.id === 'J-4001')!.status = 'verified';
    });
    store.hooks.failReads = true;
    await expect(loadState()).rejects.toThrow(/unavailable/);
    store.hooks.failReads = false;
    expect((await loadState()).jobs.find((j) => j.id === 'J-4001')!.status).toBe('verified');
  });

  it('keeps "verified" when a slower request that loaded the older state saves afterwards', async () => {
    await loadState();
    // The status poll loaded the state while the job was still scheduled. Before it saves, the
    // submit request records the verdict. The poll's save must not erase it.
    store.hooks.beforeWrite = async () => {
      await mutate((s) => {
        s.jobs.find((j) => j.id === 'J-4001')!.status = 'verified';
      });
    };
    await mutate((s) => {
      s.messages.push({ id: 'M-poll', workerId: 'w1', at: new Date().toISOString(), text: 'written by the slower request' });
    });
    const state = await loadState();
    expect(state.jobs.find((j) => j.id === 'J-4001')!.status).toBe('verified');
    expect(state.messages.some((m) => m.id === 'M-poll')).toBe(true);
  });

  it('reserves a job for exactly one of two simultaneous pay requests', async () => {
    await mutate((s) => {
      const job = s.jobs.find((j) => j.id === 'J-4001')!;
      job.status = 'verified';
      job.completedAt = new Date().toISOString();
    });
    const pay = () => mutate((s) => reservePayouts(s, ['J-4001'], { availableBalance: 5000 }));
    const [a, b] = await Promise.all([pay(), pay()]);
    expect(a.reserved.length + b.reserved.length).toBe(1);
    expect([...a.blocked, ...b.blocked][0].blocks.join(' ')).toMatch(/not verified|duplicate/);
    const state = await loadState();
    expect(state.payouts.filter((p) => p.jobId === 'J-4001')).toHaveLength(1);
    expect(state.jobs.find((j) => j.id === 'J-4001')!.status).toBe('paid');
  });
});
