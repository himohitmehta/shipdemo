#!/usr/bin/env node
/**
 * Reads what is on screen, every half second, and flags error text.
 *
 *   screen-check.mjs [--profile profile.json] <clip.mp4> [...]
 *
 * Two passes. The first reads every frame (tesseract) and looks for the
 * profile's `neverOnScreen` words: "localhost", "went wrong" and the like.
 * The second keeps only strong red pixels, since an app draws its errors in
 * red, and reads the frames that have enough of them, which catches an error
 * in wording nobody thought to list. Red that is meant to be there (an
 * overdue badge, a Delete button) shows up in the second list too: read it,
 * don't just count it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const argv = process.argv.slice(2);
let profile = {};
if (argv[0] === '--profile') {
  profile = JSON.parse(await readFile(argv[1], 'utf8'));
  argv.splice(0, 2);
}
if (argv.length === 0) {
  process.stderr.write('screen-check: name at least one clip\n');
  process.exit(1);
}
if (spawnSync('tesseract', ['--version']).status !== 0) {
  process.stderr.write('screen-check: tesseract is not installed (apt install tesseract-ocr, brew install tesseract)\n');
  process.exit(2);
}

const banned = profile.neverOnScreen ?? ['localhost', 'went wrong', "couldn't", 'failed to', 'invalid', 'is required', 'try again', 'validation', 'undefined', 'NaN'];
const pattern = new RegExp(banned.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, ".")).join('|'), 'i');
const FPS = 2;

const run = (cmd, args) => new Promise((ok, no) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  child.on('close', (code) => (code === 0 ? ok(out) : no(new Error(`${cmd}: ${err.slice(-300)}`))));
});

async function pool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; results[i] = await work(items[i], i); }
  }));
  return results;
}

const read = (image) => run('tesseract', [image, '-', '--psm', '11']).then((t) => t.replace(/\s+/g, ' ').trim()).catch(() => '');

/** Streams the clip as raw RGB and writes a black-on-white mask of each frame's strong red. */
async function redFrames(clip, dir) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', clip], { encoding: 'utf8' });
  const [w, h] = probe.stdout.trim().split(',').map(Number);
  const size = w * h * 3;
  const child = spawn('ffmpeg', ['-v', 'error', '-i', clip, '-vf', `fps=${FPS}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const found = [];
  let buffer = Buffer.alloc(0), index = 0;
  const writes = [];
  for await (const chunk of child.stdout) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= size) {
      const frame = buffer.subarray(0, size);
      const mask = Buffer.alloc(w * h, 255);
      let red = 0;
      for (let p = 0, q = 0; p < size; p += 3, q++) {
        const r = frame[p], g = frame[p + 1], b = frame[p + 2];
        if (r > 150 && g < 110 && b < 110 && r - g > 70) { mask[q] = 0; red++; }
      }
      if (red > 200) {
        const file = join(dir, `red-${String(index).padStart(5, '0')}.pgm`);
        writes.push(writeFile(file, Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), mask])));
        found.push({ file, at: index / FPS });
      }
      buffer = buffer.subarray(size);
      index++;
    }
  }
  await Promise.all(writes);
  return found;
}

let problems = 0;
const workers = Math.max(2, Math.floor(availableParallelism() / 2));
for (const clip of argv) {
  const dir = await mkdtemp(join(tmpdir(), 'shipdemo-screen-'));
  try {
    await run('ffmpeg', ['-v', 'error', '-i', clip, '-vf', `fps=${FPS}`, '-q:v', '3', join(dir, 'f-%05d.jpg')]);
    const frames = (await run('sh', ['-c', `ls ${JSON.stringify(dir)}/f-*.jpg`])).trim().split('\n');
    const texts = await pool(frames, workers, read);
    const hits = [];
    texts.forEach((t, i) => {
      const m = t.match(pattern);
      if (m) hits.push(`  ${(i / FPS).toFixed(1)} s: …${t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}…`);
    });
    const reds = await redFrames(clip, dir);
    const redTexts = await pool(reds, workers, (r) => read(r.file));
    const redWords = new Map();
    redTexts.forEach((t, i) => {
      if (/[a-z]{3,}/i.test(t)) {
        const key = t.slice(0, 80);
        if (!redWords.has(key)) redWords.set(key, reds[i].at);
      }
    });
    problems += hits.length;
    process.stdout.write(`${basename(clip)}: ${frames.length} frames, ${hits.length} with banned words, ${reds.length} with red\n`);
    // Consecutive frames repeat one another; show each moment once.
    let last = '';
    for (const h of hits) { const k = h.replace(/^\s+[\d.]+ s: /, ''); if (k !== last) process.stdout.write(`${h}\n`); last = k; }
    for (const [text, at] of redWords) process.stdout.write(`  red at ${at.toFixed(1)} s: ${text}\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
process.stdout.write(`screen: ${problems} frames with banned words\n`);
process.exit(problems ? 1 : 0);
