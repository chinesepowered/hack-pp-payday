// One small JSON document store. Files under .data/ in development, Vercel Blob when
// BLOB_READ_WRITE_TOKEN is set. PayPal stays the source of truth for money: documents hold
// PayPal ids and the last status read from PayPal.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), '.data');
const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const blobPath = (key: string) => `payday/${key}.json`;
const filePath = (key: string) => path.join(DIR, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

export async function getDoc<T>(key: string): Promise<T | null> {
  if (blobEnabled()) {
    const { list } = await import('@vercel/blob');
    const found = await list({ prefix: blobPath(key), limit: 1 });
    const blob = found.blobs.find((b) => b.pathname === blobPath(key));
    if (!blob) return null;
    const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  }
  try {
    return JSON.parse(await fs.readFile(filePath(key), 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function setDoc<T>(key: string, value: T): Promise<void> {
  if (blobEnabled()) {
    const { put } = await import('@vercel/blob');
    await put(blobPath(key), JSON.stringify(value), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    });
    return;
  }
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${filePath(key)}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, filePath(key));
}

export async function deleteDoc(key: string): Promise<void> {
  if (blobEnabled()) {
    const { del } = await import('@vercel/blob');
    await del(blobPath(key)).catch(() => {});
    return;
  }
  await fs.rm(filePath(key), { force: true });
}
