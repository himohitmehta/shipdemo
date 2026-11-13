#!/usr/bin/env node
/**
 * Checks recorded clips before anyone posts them.
 *
 *   check.mjs <corpus dir | clip.mp4> [--profile profile.json] [--only script,voice,screen,frames]
 *
 * script  no line over 18 words or using a profile `neverSay` word
 * voice   every narrated line sounds like its script (faster-whisper)
 * screen  no error text on screen: banned words, then anything in red (tesseract)
 * frames  no clip stutters: slow frame gaps against fast ones (needs a run
 *         filmed with DEMO_TRACE_FRAMES=1)
 *
 * A check whose tool is missing says so and how to install it
 * (scripts/install-checks.sh) rather than failing the others.
 * Exits non-zero when any check flags something.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const take = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const only = (take('--only') ?? 'script,voice,screen,frames').split(',');
let profile = take('--profile');
const target = argv[0] ? resolve(argv[0]) : null;
if (!target || !existsSync(target)) {
  process.stderr.write('check: name a corpus folder or a clip\n');
  process.exit(1);
}
const root = statSync(target).isDirectory() ? target : dirname(target);
profile ??= [join(root, 'profile.json'), join(root, '..', 'profile.json')].find(existsSync) ?? null;

function clips(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'variants') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) clips(path, found);
    else if (entry.endsWith('.lines.json')) {
      const mp4 = path.replace(/\.lines\.json$/, '.mp4');
      if (existsSync(mp4)) found.push(mp4);
    }
  }
  return found;
}
const list = statSync(target).isDirectory() ? clips(target) : [target];
if (list.length === 0) {
  process.stderr.write('check: no clip with a .lines.json beside it (film with DEMO_CAPTIONS=1)\n');
  process.exit(1);
}

const results = [];
const step = (name, cmd, args) => {
  process.stdout.write(`\n== ${name}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  results.push([name, r.status === 0 ? 'ok' : r.status === 2 ? 'skipped' : 'flagged']);
};
const withProfile = profile ? ['--profile', profile] : [];

if (only.includes('script')) step('script', process.execPath, [join(SKILL, 'scripts/checks/script-check.mjs'), ...withProfile, ...list]);
if (only.includes('voice')) {
  const python = [join(homedir(), '.cache/shipdemo/voice-check/.venv/bin/python'), join(homedir(), '.cache/demo-voice-check/.venv/bin/python')].find(existsSync);
  if (python) step('voice', python, [join(SKILL, 'scripts/checks/voice-check.py'), ...withProfile, ...list]);
  else { process.stdout.write('\n== voice\nskipped: faster-whisper is not installed (scripts/install-checks.sh)\n'); results.push(['voice', 'skipped']); }
}
if (only.includes('screen')) step('screen', process.execPath, [join(SKILL, 'scripts/checks/screen-check.mjs'), ...withProfile, ...list]);
if (only.includes('frames')) {
  const manifest = [join(root, 'manifest.json')].find(existsSync);
  if (manifest) step('frames', process.execPath, [join(SKILL, 'scripts/gaps.mjs'), manifest]);
  else { process.stdout.write('\n== frames\nskipped: no manifest.json here\n'); results.push(['frames', 'skipped']); }
}

process.stdout.write(`\n${results.map(([n, s]) => `${n}: ${s}`).join(' · ')}  (${list.length} clip${list.length === 1 ? '' : 's'}${profile ? `, profile ${basename(profile)}` : ''})\n`);
process.exit(results.some(([, s]) => s === 'flagged') ? 1 : 0);
