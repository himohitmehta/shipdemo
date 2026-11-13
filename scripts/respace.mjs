#!/usr/bin/env node
/**
 * Stops a clip's narration lines talking over each other, without letting
 * the voice drift from the picture.
 *
 *   respace.mjs <clip.mp4> [--gap 0.25] [--dry]
 *
 * Lines are timed while filming from an estimate of how long each takes to
 * say; the voice is made afterwards, and a line that runs long talks over
 * the next. Where that happens, the picture holds its frame just before the
 * next line's moment until the long line has finished (plus `gap` seconds),
 * then carries on: the next line and the highlight it belongs to still start
 * together, as filmed, and everything after moves later by the same amount.
 * The only visible change is a short pause in the picture. If the last line
 * runs past the end, the last frame is held too.
 *
 * Run it with the voice settings the clip was filmed with (DEMO_CONFIG at the
 * workspace's demo.config.ts, and any DEMO_VOICE_* the film used), so each
 * line's audio comes from the voice cache rather than being said again.
 * Rewrites <clip>.mp4, .lines.json, .srt, .vtt and .captioned.mp4; the
 * originals go to <dir>/.pre-respace/, and a second run starts from them.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  if (at < 0) return fallback;
  const v = argv[at + 1];
  argv.splice(at, 2);
  return v;
};
const dry = argv.includes('--dry') && argv.splice(argv.indexOf('--dry'), 1);
const GAP = Number(flag('--gap', '0.25'));
const clip = argv[0] ? resolve(argv[0]) : null;
if (!clip || !clip.endsWith('.mp4') || !existsSync(clip)) {
  process.stderr.write('respace: name the plain clip (<name>.mp4, with <name>.lines.json beside it)\n');
  process.exit(1);
}
if (!process.env.DEMO_CONFIG) {
  process.stderr.write('respace: set DEMO_CONFIG to the workspace demo.config.ts the clip was filmed with\n');
  process.exit(1);
}
const base = clip.slice(0, -4);
const keep = join(dirname(clip), '.pre-respace');
const kept = (ext) => join(keep, `${basename(base)}.${ext}`);
// A second run works from the originals, never from its own output.
const source = (ext) => (existsSync(kept(ext)) ? kept(ext) : `${base}.${ext}`);

const { speak } = await import('../engine/studio/voice.ts');
const { writeCaptions, burnArgs } = await import('../engine/studio/captions.ts');

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-400)}`);
};
const probe = (file, entries) =>
  spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim();

/** Where the speech in a line's wav ends, before its trailing silence. */
function voicedEnd(wav, length) {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', wav, '-af', 'silencedetect=n=-40dB:d=0.08', '-f', 'null', '-'], { encoding: 'utf8' });
  const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const last = starts.at(-1);
  return last !== undefined && starts.length > ends.length ? last : length;
}

const lines = JSON.parse(await readFile(source('lines.json'), 'utf8'));
const marks = lines.map((l) => ({
  at: l.at,
  text: l.spoken && l.spoken !== l.caption ? `${l.caption} || ${l.spoken}` : l.caption,
}));
const spoken = await speak(marks);
if (spoken.length !== marks.length) throw new Error('respace: the voice cache did not answer every line');

// Where the picture pauses (at the original time `at`, for `hold` seconds),
// and where each line lands on the new timeline.
const holds = [];
let shift = 0;
let lastEnd = -Infinity;
const placed = spoken.map((line, i) => {
  const wanted = marks[i].at + shift;
  const hold = Math.max(0, lastEnd + GAP - wanted);
  if (hold > 0.02) {
    holds.push({ at: marks[i].at, hold });
    shift += hold;
  }
  const at = marks[i].at + shift;
  lastEnd = at + voicedEnd(line.path, line.seconds);
  return { ...line, text: marks[i].text, at };
});
for (const h of holds) process.stdout.write(`  picture holds ${h.hold.toFixed(2)} s at ${h.at.toFixed(2)} s\n`);
process.stdout.write(`${basename(clip)}: ${holds.length} pause${holds.length === 1 ? '' : 's'}, ${shift.toFixed(2)} s longer\n`);
if (dry || holds.length === 0) process.exit(0);

await mkdir(keep, { recursive: true });
for (const ext of ['mp4', 'lines.json', 'srt', 'vtt', 'captioned.mp4']) {
  if (existsSync(`${base}.${ext}`) && !existsSync(kept(ext))) await copyFile(`${base}.${ext}`, kept(ext));
}
const original = kept('mp4');
const fps = probe(original, 'stream=r_frame_rate');
const frame = 1 / (Number(fps.split('/')[0]) / Number(fps.split('/')[1] || 1));
const video = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', original], { encoding: 'utf8' }).stdout);

// The picture: cut at each pause, hold the cut's last frame, join.
const cuts = [0, ...holds.map((h) => Math.max(frame, h.at - frame / 2)), video];
const tail = Math.max(0, Math.max(...placed.map((p) => p.at + p.seconds)) + 0.3 - (video + shift));
const parts = cuts.slice(0, -1).map((from, k) => {
  const pad = k < holds.length ? holds[k].hold : tail;
  return `[0:v]trim=start=${from.toFixed(4)}:end=${cuts[k + 1].toFixed(4)},setpts=PTS-STARTPTS${
    pad > 0 ? `,tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}` : ''
  }[p${k}]`;
});
const picture = `${parts.join(';')};${parts.map((_, k) => `[p${k}]`).join('')}concat=n=${parts.length}:v=1:a=0[v]`;
const delays = placed.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}:all=1[d${i}]`).join(';');
const voice = `${placed.map((_, i) => `[d${i}]`).join('')}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,apad[a]`;
const total = video + shift + tail;
run(['-i', original, ...placed.flatMap((p) => ['-i', p.path]), '-filter_complex', `${picture};${delays};${voice}`,
  '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-r', fps, '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(3), '-movflags', '+faststart', clip]);
await writeCaptions(base, placed.map((p) => ({ at: p.at, seconds: p.seconds, text: p.text })));
if (existsSync(kept('captioned.mp4'))) {
  run(burnArgs(clip, `${base}.srt`, `${base}.captioned.mp4`, ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p']).slice(4));
}
process.stdout.write(`  rewrote ${basename(clip)}, .lines.json, .srt, .vtt; originals in .pre-respace/\n`);
