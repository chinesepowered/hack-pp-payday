// One small JSON document store. Files under .data/ in development, Vercel Blob when
// BLOB_READ_WRITE_TOKEN is set. PayPal stays the source of truth for money: documents hold
// PayPal ids and the last status read from PayPal.
//
// Two rules keep concurrent requests from losing each other's work:
//  1. A read returns the newest saved copy, never an older cached one, and a failed read is an
//     error. Only a document that truly does not exist reads as null.
//  2. Changes go through updateDoc(): read the document with its version (ETag), apply the change,
//     and write only if the version is still the same. If another request wrote in between, the
//     change is applied again to the newer document. Nothing is ever saved over a newer copy.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type Versioned<T> = { value: T; version: string };

/** Thrown by a backend when a conditional write finds a different version than expected. */
export class ConflictError extends Error {
  constructor(key: string) {
    super(`The document "${key}" changed while it was being updated.`);
  }
}

export interface Backend {
  /** The document and its version, or null when it does not exist. Throws when the read fails. */
  read(key: string): Promise<Versioned<string> | null>;
  /**
   * Writes the document. `expect` is the version the caller read, 'absent' when it read nothing, or
   * undefined for an unconditional overwrite. Throws ConflictError when the expectation does not hold.
   */
  write(key: string, body: string, expect?: string | 'absent'): Promise<void>;
  remove(key: string): Promise<void>;
}

// --- Files (development) ---------------------------------------------------------------------

const DIR = path.join(process.cwd(), '.data');
const filePath = (key: string) => path.join(DIR, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
const hash = (body: string) => createHash('sha1').update(body).digest('hex');
const locks = new Map<string, Promise<unknown>>();

/** Runs `work` after every earlier piece of work on the same key in this process. */
function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) ?? Promise.resolve()).then(work, work);
  locks.set(key, next.catch(() => {}));
  return next;
}

const fileBackend: Backend = {
  async read(key) {
    try {
      const body = await fs.readFile(filePath(key), 'utf8');
      return { value: body, version: hash(body) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  write(key, body, expect) {
    return serial(key, async () => {
      if (expect !== undefined) {
        const current = await fileBackend.read(key);
        if ((expect === 'absent' && current) || (expect !== 'absent' && current?.version !== expect)) throw new ConflictError(key);
      }
      await fs.mkdir(DIR, { recursive: true });
      const tmp = `${filePath(key)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, filePath(key));
    });
  },
  async remove(key) {
    await fs.rm(filePath(key), { force: true });
  },
};

// --- Vercel Blob (deployed) ------------------------------------------------------------------
//
// Measured on this project's store: after a blob is overwritten, reading it back can return the
// previous content for two to three seconds, even with `useCache: false`, and a path that was read
// before it existed can keep answering "not found" for a while. Blob's API calls (list, put) are
// consistent at once. So a document is never overwritten. Each save creates a new immutable file,
//   payday/<key>/v00000042.json
// and the current document is the highest version that `list` reports. That gives:
//  - exact reads: the newest version is found through the API, and its content never changes;
//  - an atomic compare-and-swap: saving version n+1 is "create this file only if it does not
//    exist", which Blob enforces. Two requests that both read version n cannot both save n+1.
// Documents written by the first deployment (payday/<key>.json) are still read once, as version 0.

const versionPrefix = (key: string) => `payday/${key}/v`;
const versionPath = (key: string, seq: number) => `${versionPrefix(key)}${String(seq).padStart(8, '0')}.json`;
const legacyPath = (key: string) => `payday/${key}.json`;
const KEEP_VERSIONS = 4;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function versions(key: string): Promise<{ seq: number; pathname: string; url: string }[]> {
  const { list } = await import('@vercel/blob');
  const out: { seq: number; pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: versionPrefix(key), cursor, limit: 1000 });
    for (const b of page.blobs) {
      const match = /\/v(\d{8})\.json$/.exec(b.pathname);
      if (match) out.push({ seq: Number(match[1]), pathname: b.pathname, url: b.url });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => a.seq - b.seq);
}

/** The content of a file that `list` says exists. It is immutable, so any copy of it is the right one. */
async function content(pathname: string): Promise<string> {
  const { get } = await import('@vercel/blob');
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await get(pathname, { access: 'public', useCache: false });
    if (res?.statusCode === 200) return new Response(res.stream).text();
    await pause(150 * (attempt + 1)); // a brand new file can take a moment to be readable
  }
  throw new Error(`Blob "${pathname}" exists but could not be read.`);
}

const blobBackend: Backend = {
  async read(key) {
    const all = await versions(key);
    const latest = all.at(-1);
    if (latest) return { value: await content(latest.pathname), version: String(latest.seq) };
    // No versions yet: adopt the document the first deployment wrote, if there is one.
    const { get } = await import('@vercel/blob');
    const legacy = await get(legacyPath(key), { access: 'public', useCache: false });
    if (!legacy) return null; // the document truly does not exist
    if (legacy.statusCode !== 200) throw new Error(`Blob read of "${key}" answered ${legacy.statusCode}.`);
    return { value: await new Response(legacy.stream).text(), version: '0' };
  },
  async write(key, body, expect) {
    const { put, del } = await import('@vercel/blob');
    const create = (seq: number) => put(versionPath(key, seq), body, { access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
    const exists = (e: unknown) => e instanceof Error && /already exists/i.test(e.message);
    let saved = 0;
    if (expect === undefined) {
      // Unconditional: take the next free version, whatever it is.
      for (let attempt = 0; ; attempt++) {
        const next = ((await versions(key)).at(-1)?.seq ?? 0) + 1;
        try {
          await create(next);
          saved = next;
          break;
        } catch (e) {
          if (!exists(e) || attempt > 8) throw e;
        }
      }
    } else {
      const next = (expect === 'absent' ? 0 : Number(expect)) + 1;
      try {
        await create(next);
        saved = next;
      } catch (e) {
        if (exists(e)) throw new ConflictError(key); // someone else saved this version first
        throw e;
      }
    }
    // Old versions are removed every few saves. Failing to clean up is harmless.
    if (saved % KEEP_VERSIONS === 0) {
      const stale = (await versions(key).catch(() => [])).filter((v) => v.seq <= saved - KEEP_VERSIONS).map((v) => v.url);
      if (stale.length) await del(stale).catch(() => {});
    }
  },
  async remove(key) {
    const { del } = await import('@vercel/blob');
    const urls = (await versions(key)).map((v) => v.url);
    if (urls.length) await del(urls).catch(() => {});
    await del(legacyPath(key)).catch(() => {});
  },
};

// --- Public API ------------------------------------------------------------------------------

let override: Backend | null = null;
/** Tests swap in an in-memory backend, so the lost-update case runs without the network. */
export function setBackendForTests(backend: Backend | null) {
  override = backend;
}
const backend = (): Backend => override ?? (process.env.BLOB_READ_WRITE_TOKEN ? blobBackend : fileBackend);

/** The document, or null when it does not exist. A failed read throws: it is never "no document". */
export async function getDoc<T>(key: string): Promise<T | null> {
  const doc = await backend().read(key);
  return doc ? (JSON.parse(doc.value) as T) : null;
}

/** Unconditional overwrite. Only for documents with a single writer, or a deliberate reset. */
export async function setDoc<T>(key: string, value: T): Promise<void> {
  await backend().write(key, JSON.stringify(value));
}

export async function deleteDoc(key: string): Promise<void> {
  await backend().remove(key);
}

const MAX_ATTEMPTS = 12;

/**
 * Read, change, write, without losing a concurrent writer's work. `change` receives the current
 * document (null when it does not exist) and returns the document to save plus a result. It runs
 * again on the newer document whenever another request wrote first, so it must not have side
 * effects outside the document. Returning `save: false` skips the write.
 */
export async function updateDoc<T, R>(key: string, change: (current: T | null) => Promise<{ doc: T; result: R; save?: boolean }> | { doc: T; result: R; save?: boolean }): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    const found = await backend().read(key);
    const { doc, result, save } = await change(found ? (JSON.parse(found.value) as T) : null);
    if (save === false) return result;
    try {
      await backend().write(key, JSON.stringify(doc), found ? found.version : 'absent');
      return result;
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt >= MAX_ATTEMPTS - 1) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
    }
  }
}
