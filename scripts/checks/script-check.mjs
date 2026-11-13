#!/usr/bin/env node
/**
 * Reads each clip's narration (<clip>.lines.json) against the script rules.
 *
 *   script-check.mjs [--profile profile.json] <clip.mp4> [...]
 *
 * Flags a line over 18 words or one using a word from the profile's
 * `neverSay`; notes a line of 15 to 18 words (6 to 14 is the aim,
 * references/script.md). Reads what is spoken, and the caption when it differs.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
let profile = {};
if (argv[0] === '--profile') {
  profile = JSON.parse(await readFile(argv[1], 'utf8'));
  argv.splice(0, 2);
}
const banned = (profile.neverSay ?? []).map((w) => ({
  word: w,
  test: new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`, 'i'),
}));
let flags = 0;
for (const clip of argv) {
  const lines = JSON.parse(await readFile(clip.replace(/\.mp4$/, '.lines.json'), 'utf8'));
  const out = [];
  lines.forEach((line, i) => {
    const texts = [...new Set([line.spoken, line.caption].filter(Boolean))];
    const words = (line.caption ?? line.spoken).split(/\s+/).filter(Boolean).length;
    for (const b of banned) {
      if (texts.some((t) => b.test.test(t))) { flags++; out.push(`  FLAG line ${i + 1}: says "${b.word}": ${line.caption}`); }
    }
    if (words > 18) { flags++; out.push(`  FLAG line ${i + 1}: ${words} words (18 at most): ${line.caption}`); }
    else if (words > 14) out.push(`  note line ${i + 1}: ${words} words (6 to 14 is the aim): ${line.caption}`);
  });
  process.stdout.write(`${basename(clip)}: ${lines.length} lines\n${out.map((l) => `${l}\n`).join('')}`);
}
process.stdout.write(`script: ${flags} flagged\n`);
process.exit(flags ? 1 : 0);
