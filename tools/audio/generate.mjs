#!/usr/bin/env node
// Generates the game's music, sound effects and character babble with ElevenLabs, from the
// prompts in content/assets.yaml, into public/audio/. Build-time only: the API key is read
// from .env.local by Node and never reaches the game.
//
//   node --env-file=.env.local tools/audio/generate.mjs            # everything missing
//   node --env-file=.env.local tools/audio/generate.mjs sfx         # one group: music | sfx | babble
//   node --env-file=.env.local tools/audio/generate.mjs music mesh  # one item (regenerates it)
//
// Existing files are skipped unless named explicitly, so a failed run can just be re-run.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

const assets = parse(readFileSync('content/assets.yaml', 'utf8'));
const client = new ElevenLabsClient(); // reads ELEVENLABS_API_KEY
const [onlyGroup, onlyItem] = process.argv.slice(2);
const MUSIC_MS = 120_000;

async function save(stream, raw) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  writeFileSync(raw, Buffer.concat(chunks));
}

/** Loudness-normalise and re-encode for the web. Music gets a small bitrate; effects stay crisp. */
function finish(raw, out, { bitrate, loudness }) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', `loudnorm=I=${loudness}:TP=-1.5:LRA=11`, '-ar', '44100', '-b:a', bitrate, out]);
  rmSync(raw);
}

const jobs = [];
for (const [id, prompt] of Object.entries(assets.music))
  jobs.push({ group: 'music', id, run: () => client.music.compose({ prompt, musicLengthMs: MUSIC_MS, modelId: 'music_v2_5', forceInstrumental: true }), post: { bitrate: '96k', loudness: -18 } });
for (const [id, { prompt, seconds }] of Object.entries(assets.sfx))
  jobs.push({ group: 'sfx', id, run: () => client.textToSoundEffects.convert({ text: prompt, modelId: 'eleven_text_to_sound_v3', durationSeconds: seconds, promptInfluence: 0.7 }), post: { bitrate: '128k', loudness: -16 } });
for (const [id, prompt] of Object.entries(assets.babble))
  jobs.push({ group: 'babble', id, run: () => client.textToSoundEffects.convert({ text: prompt, modelId: 'eleven_text_to_sound_v3', durationSeconds: 0.5, promptInfluence: 0.8 }), post: { bitrate: '128k', loudness: -18 } });

let failed = 0;
for (const job of jobs) {
  if (onlyGroup && job.group !== onlyGroup) continue;
  if (onlyItem && job.id !== onlyItem) continue;
  const dir = `public/audio/${job.group}`;
  const out = `${dir}/${job.id}.mp3`;
  if (existsSync(out) && !onlyItem) continue;
  mkdirSync(dir, { recursive: true });
  const raw = `${out}.raw.mp3`;
  try {
    const t = Date.now();
    await save(await job.run(), raw);
    finish(raw, `${out}.tmp.mp3`, job.post);
    renameSync(`${out}.tmp.mp3`, out);
    console.log(`ok   ${out} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    rmSync(raw, { force: true });
    const body = e?.body ? JSON.stringify(e.body).slice(0, 300) : '';
    console.log(`FAIL ${out}: ${e?.statusCode ?? ''} ${e?.message ?? e} ${body}`);
  }
}
console.log(failed ? `done with ${failed} failure(s)` : 'done');
process.exit(failed ? 1 : 0);
