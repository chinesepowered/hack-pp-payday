// Text to speech with ElevenLabs, for Rio's pre-rendered in-product lines (public/audio) and the
// demo video narration (demo/raw). The hosted demo never calls ElevenLabs: it plays the files.
// Every call is counted in demo/elevenlabs-usage.json to stay inside this build's character budget.
//
//   pnpm tsx scripts/voice.ts rio          Rio's product lines
//   pnpm tsx scripts/voice.ts narration    the video narration, from demo/narration.json
import './env';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const NARRATOR = 'cgSgspJ2msm6clMCkdW9'; // Jessica
const RIO = 'bIHbv24MWmeRgasZH58o'; // Will: a clearly different, relaxed male voice for the mascot
const USAGE = 'demo/elevenlabs-usage.json';
const BUDGET = 15_000;

type Usage = { total: number; calls: { file: string; characters: number; voice: string }[] };

async function speak(text: string, voice: string, file: string, force = false) {
  const usage: Usage = JSON.parse(await fs.readFile(USAGE, 'utf8').catch(() => '{"total":0,"calls":[]}'));
  const done = usage.calls.find((c) => c.file === file);
  if (!force && done && (await fs.stat(file).catch(() => null))) return console.log(`  kept ${file}`);
  if (usage.total + text.length > BUDGET) throw new Error(`ElevenLabs budget of ${BUDGET} characters would be exceeded.`);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  usage.total += text.length;
  usage.calls.push({ file, characters: text.length, voice: voice === RIO ? 'Rio (Will)' : 'Narrator (Jessica)' });
  await fs.mkdir('demo', { recursive: true });
  await fs.writeFile(USAGE, JSON.stringify(usage, null, 1));
  console.log(`  made ${file} (${text.length} characters, ${usage.total} used of ${BUDGET})`);
}

const RIO_LINES: Record<string, string> = {
  'rio-paid': "You got paid! The money is in your PayPal. Nice work today.",
  'rio-review': 'Hmm, one photo is missing. The team will take a look, and I will let you know.',
};

async function main() {
  const what = process.argv[2];
  if (what === 'rio') {
    for (const [name, text] of Object.entries(RIO_LINES)) await speak(text, RIO, `public/audio/${name}.mp3`);
  } else if (what === 'narration') {
    const scenes = JSON.parse(await fs.readFile('demo/narration.json', 'utf8')) as { id: string; voice?: 'rio'; text: string }[];
    const only = process.argv[3];
    for (const s of scenes) if (!only || s.id === only) await speak(s.text, s.voice === 'rio' ? RIO : NARRATOR, `demo/raw/voice/${s.id}.mp3`, Boolean(only));
  } else {
    console.error('Usage: tsx scripts/voice.ts rio | narration [scene-id]');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
