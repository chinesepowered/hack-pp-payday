// The AI core. Server-side only: W&B Inference through the OpenAI SDK, with retries, a timeout and
// a fallback model. Every call returns the model that actually answered, so the UI can tag it.

import OpenAI from 'openai';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ctx } from './context';
import { readFixture, recordFixture, recording } from './fixtures';

export const MODELS = {
  text: () => process.env.OPENAI_MODEL ?? 'Qwen/Qwen3.8-27B',
  vision: () => process.env.OPENAI_VISION_MODEL ?? 'google/gemma-4-31B-it',
  fallback: () => process.env.OPENAI_FALLBACK_MODEL ?? 'zai-org/GLM-5.3-Flash',
};

let client: OpenAI | null = null;
function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL, maxRetries: 4, timeout: 60_000 });
  return client;
}

export type AiResult = { text: string; model: string };
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * One chat completion. `key` names the call for Replay fixtures. Tries the given model, then the
 * fallback model (which always returns `reasoning`, so it gets a larger token budget and its
 * `content` may be null).
 */
export async function complete(key: string, model: string, messages: Message[], maxTokens = 500): Promise<AiResult> {
  if (ctx().mode === 'replay') {
    const hit = readFixture<AiResult>('ai', key);
    if (!hit) throw new Error(`Replay has no recording for AI call "${key}".`);
    await new Promise((r) => setTimeout(r, 500));
    return hit;
  }
  const attempts: { model: string; maxTokens: number }[] = [{ model, maxTokens }, { model: MODELS.fallback(), maxTokens: maxTokens + 1500 }];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const res = await openai().chat.completions.create({ model: attempt.model, messages, max_tokens: attempt.maxTokens, temperature: 0.2 });
      const text = res.choices[0]?.message?.content?.trim();
      if (!text) throw new Error(`${attempt.model} returned no content`);
      const out = { text, model: attempt.model };
      if (recording()) await recordFixture('ai', key, out);
      return out;
    } catch (e) {
      lastError = e;
      console.warn(`[ai] ${attempt.model} failed for ${key}:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The model did not answer.');
}

/** Pulls the first JSON object out of a model reply (models like to wrap JSON in prose or fences). */
export function parseJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export async function imageDataUrl(publicPath: string): Promise<string> {
  const file = path.join(process.cwd(), 'public', publicPath.replace(/^\//, ''));
  const data = await fs.readFile(file);
  return `data:image/png;base64,${data.toString('base64')}`;
}

export type PhotoReading = { photo: string; room: string; tidy: boolean; note: string; model: string };

const ROOMS = ['kitchen', 'bathroom', 'bedroom', 'living room', 'hallway', 'other'];

/** Asks the vision model what room a completion photo shows and whether it looks clean. */
export async function readPhoto(photo: string): Promise<PhotoReading> {
  const { text, model } = await complete(
    `vision:${photo}`,
    MODELS.vision(),
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `This is a completion photo from a home cleaning job. Reply with JSON only: ` +
              `{"room": one of ${JSON.stringify(ROOMS)}, "tidy": true or false, "note": "one short sentence on what you see"}.`,
          },
          { type: 'image_url', image_url: { url: await imageDataUrl(photo) } },
        ],
      },
    ],
    200,
  );
  const parsed = parseJson<{ room?: string; tidy?: boolean; note?: string }>(text);
  const room = ROOMS.find((r) => r === String(parsed?.room ?? '').toLowerCase().trim()) ?? 'other';
  return { photo, room, tidy: parsed?.tidy !== false, note: String(parsed?.note ?? text).slice(0, 200), model };
}

// --- Per-IP rate limit for AI routes on the hosted demo ---------------------------------------

const hits = new Map<string, number[]>();
export function rateLimit(req: Request, limit = 30, windowMs = 60_000): Response | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    return Response.json({ error: { message: 'Too many AI requests from this address. Wait a minute and try again.' } }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  hits.set(ip, [...recent, now]);
  if (hits.size > 5000) hits.clear();
  return null;
}
