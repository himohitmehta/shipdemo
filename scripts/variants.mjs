#!/usr/bin/env node
/**
 * Exports recorded clips in the shapes each platform wants.
 *
 *   variants.mjs <corpus dir> [--only reel,wide-laptop | all] [--clip home,team]
 *                [--hooks hooks.json] [--out <dir>] [--list]
 *
 * A clip is any `<name>.mp4` with a `<name>.srt` beside it (what a captioned
 * run writes). Each preset in variants/presets.json says which recordings it
 * takes (portrait = phone, landscape = laptop), the canvas, where the app
 * sits, where the hook and captions go, and whether to zoom on highlights.
 * Output: <out>/<preset>/<name>.mp4 plus a poster, beside the originals,
 * which are never touched.
 *
 * Hooks are one line per clip, read from --hooks or <corpus>/hooks.json:
 * { "13-home": "Your whole gym day on one screen" }. A clip with no hook gets
 * the frame without one.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = JSON.parse(await readFile(join(SKILL, 'variants/presets.json'), 'utf8'));

function fail(message) {
  process.stderr.write(`variants: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  if (at < 0) return null;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value ?? fail(`${name} needs a value`);
};
if (argv.includes('--list')) {
  for (const p of CONFIG.presets) process.stdout.write(`${p.name.padEnd(18)} ${p.about}\n`);
  process.exit(0);
}
const only = (flag('--only') ?? 'all').split(',').map((s) => s.trim()).filter(Boolean);
const clipFilter = flag('--clip')?.split(',').map((s) => s.trim());
const hooksPath = flag('--hooks');
const outFlag = flag('--out');
const corpus = argv[0] ? resolve(argv[0]) : fail('name the folder with the recorded clips');
if (!existsSync(corpus)) fail(`${corpus} does not exist`);
const out = outFlag ? resolve(outFlag) : join(corpus, 'variants');

const names = CONFIG.presets.map((p) => p.name);
const chosen = only.includes('all') ? CONFIG.presets : only.map((n) => CONFIG.presets.find((p) => p.name === n) ?? fail(`no preset "${n}" (have: ${names.join(', ')})`));

const hooksFile = hooksPath ? resolve(hooksPath) : join(corpus, 'hooks.json');
const hooks = existsSync(hooksFile) ? JSON.parse(await readFile(hooksFile, 'utf8')) : {};

// ---------------------------------------------------------------- clips
function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'variants' || entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.srt')) {
      const base = path.slice(0, -4);
      if (existsSync(`${base}.mp4`)) found.push(base);
    }
  }
  return found;
}

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height:format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  const [w, h, d] = r.stdout.trim().split(/\s+/).map(Number);
  if (!w || !h || !d) fail(`could not read ${file}`);
  return { w, h, duration: d };
}

const clips = walk(corpus)
  .map((base) => ({ base, name: basename(base), ...probe(`${base}.mp4`) }))
  .filter((c) => !clipFilter || clipFilter.includes(c.name))
  .sort((a, b) => a.name.localeCompare(b.name));
if (clips.length === 0) fail(`no clip with an .srt beside it under ${corpus}`);

// ---------------------------------------------------------------- helpers
function run(cmd, args, input) {
  return new Promise((ok, no) => {
    const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => (err += c));
    child.on('close', (code) => (code === 0 ? ok(Buffer.concat(chunks)) : no(new Error(`${cmd} failed: ${err.slice(-600)}`))));
  });
}

const fontFile = (() => {
  const r = spawnSync('fc-match', ['-f', '%{file}', `${CONFIG.text.font}:bold`], { encoding: 'utf8' });
  return r.stdout.trim() || fail('no font found (install fontconfig and Noto Sans)');
})();

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const assColour = (c) => { const [r, g, b] = hex(c); return `&H00${[b, g, r].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`; };
const escapeFilterPath = (p) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");

/** Splits a hook into `lines` lines of about equal length. */
function lines(text, count) {
  if (count <= 1) return [text];
  const words = text.split(/\s+/);
  let best = [text], score = Infinity;
  for (let at = 1; at < words.length; at++) {
    const a = words.slice(0, at).join(' '), b = words.slice(at).join(' ');
    const s = Math.max(a.length, b.length);
    if (s < score) { score = s; best = [a, b]; }
  }
  return best;
}

// ---------------------------------------------------------------- highlight zoom
/**
 * Finds the highlight in each frame: while the band is up, everything around
 * it is dimmed, so the part at full brightness is the subject. Answers a
 * sendcmd script that eases a crop onto it and back out.
 */
async function zoomScript(clip, max) {
  const AW = 480, AH = 270, AFPS = 10, FPS = 60, TAU = 0.22;
  const raw = await run('ffmpeg', ['-v', 'error', '-i', `${clip.base}.mp4`, '-vf',
    `fps=${AFPS},scale=${AW}:${AH},format=gray`, '-f', 'rawvideo', '-']);
  const size = AW * AH, n = Math.floor(raw.length / size);
  const { w: W, h: H } = clip;
  const targets = [];
  for (let k = 0; k < n; k++) {
    const f = raw.subarray(k * size, (k + 1) * size);
    let y0 = -1, y1 = -1, x0 = AW, x1 = -1, lit = 0;
    for (let y = 0; y < AH; y++) {
      let count = 0, first = -1, last = -1;
      for (let x = 0; x < AW; x++) {
        if (f[y * AW + x] >= 235) { count++; if (first < 0) first = x; last = x; }
      }
      if (count >= 8) {
        if (y0 < 0) y0 = y;
        y1 = y; lit += count;
        if (first < x0) x0 = first;
        if (last > x1) x1 = last;
      }
    }
    if (y0 < 0 || lit > 0.6 * size) { targets.push([1, W / 2, H / 2]); continue; }
    const sx = W / AW, sy = H / AH, pad = 0.1;
    const width = Math.max((x1 - x0 + 1) * sx * (1 + 2 * pad), (y1 - y0 + 1) * sy * (1 + 2 * pad) * W / H);
    targets.push([Math.max(1, Math.min(max, W / width)), ((x0 + x1 + 1) / 2) * sx, ((y0 + y1 + 1) / 2) * sy]);
  }
  // A new target has to hold 0.3 s, so a flicker never moves the camera.
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.08 && Math.abs(a[1] - b[1]) < 60 && Math.abs(a[2] - b[2]) < 60;
  let held = targets[0], cand = null, since = 0;
  const steady = targets.map((t) => {
    if (same(t, held)) cand = null;
    else if (cand && same(t, cand)) { if (++since >= 3) { held = t; cand = null; } }
    else { cand = t; since = 1; }
    return held;
  });
  let z = 1, cx = W / 2, cy = H / 2;
  const a = 1 - Math.exp(-1 / (FPS * TAU));
  const cmds = [];
  for (let i = 0; i <= Math.floor(clip.duration * FPS); i++) {
    const t = i / FPS;
    const [tz, tx, ty] = steady[Math.min(Math.floor(t * AFPS), steady.length - 1)];
    z += (tz - z) * a; cx += (tx - cx) * a; cy += (ty - cy) * a;
    const cw = Math.round(W / z / 2) * 2, ch = Math.round(H / z / 2) * 2;
    const x = Math.round(Math.min(Math.max(cx - cw / 2, 0), W - cw));
    const y = Math.round(Math.min(Math.max(cy - ch / 2, 0), H - ch));
    cmds.push(`${t.toFixed(4)} crop w ${cw}, crop h ${ch}, crop x ${x}, crop y ${y};`);
  }
  const zoomed = steady.filter((s) => s[0] > 1.01).length / AFPS;
  return { script: `${cmds.join('\n')}\n`, zoomed };
}

// ---------------------------------------------------------------- framed render
async function framed(clip, preset, target) {
  const tmp = await mkdtemp(join(tmpdir(), 'shipdemo-'));
  try {
    const [CW, CH] = preset.canvas;
    const { x: X, y: Y, w: W, h: H, radius: R } = preset.app;
    const [tr, tg, tb] = hex(CONFIG.background.top), [br, bg, bb] = hex(CONFIG.background.bottom);
    const ff = (args) => run('ffmpeg', ['-v', 'error', '-y', ...args]);
    await ff(['-f', 'lavfi', '-i', `color=c=black:s=${CW}x${CH}:d=1`, '-frames:v', '1', '-vf',
      `format=rgb24,geq=r='${tr}+(${br - tr})*Y/H':g='${tg}+(${bg - tg})*Y/H':b='${tb}+(${bb - tb})*Y/H'`, join(tmp, 'bg.png')]);
    await ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1`, '-frames:v', '1', '-vf',
      `format=gray,geq=lum='if(lte(pow(max(max(${R}-X,X-(${W - 1 - R})),0),2)+pow(max(max(${R}-Y,Y-(${H - 1 - R})),0),2),${R * R}),255,0)'`, join(tmp, 'mask.png')]);
    await ff(['-i', join(tmp, 'mask.png'), '-frames:v', '1', '-vf',
      "pad=w=iw+120:h=ih+120:x=60:y=60:color=black,boxblur=28:2,lut=y='val*0.30'", join(tmp, 'shadow.png')]);

    let source = '[1:v]';
    let pre = '';
    let zoomed = 0;
    if (preset.zoom) {
      const z = await zoomScript(clip, preset.zoom.max ?? 1.6);
      zoomed = z.zoomed;
      await writeFile(join(tmp, 'zoom.cmd'), z.script);
      pre = `[1:v]sendcmd=f='${escapeFilterPath(join(tmp, 'zoom.cmd'))}',crop=w=${clip.w}:h=${clip.h}:x=0:y=0,setsar=1[src];`;
      source = '[src]';
    }

    const text = CONFIG.text.colour.replace('#', '0x');
    const hook = hooks[clip.name];
    let draw = '';
    if (hook && preset.hook) {
      const { x, w, y, size, lines: count } = preset.hook;
      const parts = lines(hook, count ?? 1);
      draw = parts.map((line, i) => {
        const file = join(tmp, `hook${i}.txt`);
        return { file, line, y: Math.round(y + i * size * 1.35) };
      });
      for (const d of draw) await writeFile(d.file, d.line);
      draw = draw.map((d) => `drawtext=fontfile='${escapeFilterPath(fontFile)}':textfile='${escapeFilterPath(d.file)}':fontsize=${size}:fontcolor=${text}:x=${x}+(${w}-text_w)/2:y=${d.y}`).join(',');
    }

    const c = preset.captions;
    const uy = 288 / CH, ux = 384 / CW;
    const style = [`FontName=${CONFIG.text.font}`, `Fontsize=${(c.size * uy).toFixed(1)}`, 'Bold=1',
      `PrimaryColour=${assColour(CONFIG.text.colour)}`, 'BorderStyle=1', 'Outline=0', 'Shadow=0',
      `MarginV=${Math.round(c.bottom * uy)}`, `MarginL=${Math.round(c.left * ux)}`, `MarginR=${Math.round(c.right * ux)}`, 'Alignment=2'].join(',');

    const graph = `${pre}${source}scale=${W}:${H}:flags=lanczos,format=rgba[v];[2:v]format=gray[m];[v][m]alphamerge[vr];` +
      `[3:v]format=gray[sm];color=c=black:s=${W + 120}x${H + 120}[sc];[sc][sm]alphamerge[sh];` +
      `[0:v][sh]overlay=${X - 60}:${Y - 42}[b1];[b1][vr]overlay=${X}:${Y}[b2];` +
      `[b2]${draw ? `${draw},` : ''}subtitles='${escapeFilterPath(`${clip.base}.srt`)}':force_style='${style}',scale=out_range=tv,format=yuv420p[out]`;
    await writeFile(join(tmp, 'graph.txt'), graph);
    await ff(['-loop', '1', '-i', join(tmp, 'bg.png'), '-i', `${clip.base}.mp4`, '-loop', '1', '-i', join(tmp, 'mask.png'),
      '-loop', '1', '-i', join(tmp, 'shadow.png'), '-filter_complex_script', join(tmp, 'graph.txt'),
      // Plain yuv420p, limited range: the PNG frame would otherwise make it
      // yuvj420p (full range), which phones, browsers and social players
      // show as a blank or black screen.
      // 30 fps, level 4.0: what Reels, Shorts and LinkedIn ask for, and what
      // every phone and player decodes (1080x1920 at 60 needs level 4.2,
      // which some players show as a black screen with sound).
      '-map', '[out]', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', '30', '-g', '60',
      '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-profile:v', 'high', '-level:v', '4.0',
      '-c:a', 'copy', '-movflags', '+faststart', '-t', clip.duration.toFixed(3), target]);
    await ff(['-ss', (clip.duration * 0.4).toFixed(2), '-i', target, '-frames:v', '1', '-q:v', '3', target.replace(/\.mp4$/, '.poster.jpg')]);
    return zoomed;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- web
async function web(clip, dir) {
  // Phone and laptop takes of one scene share a name, so web says which.
  const name = `${clip.name}.${clip.h > clip.w ? 'phone' : 'laptop'}`;
  await copyFile(`${clip.base}.mp4`, join(dir, `${name}.mp4`));
  for (const ext of ['vtt', 'srt']) if (existsSync(`${clip.base}.${ext}`)) await copyFile(`${clip.base}.${ext}`, join(dir, `${name}.${ext}`));
  const poster = [`${clip.base}.poster.jpg`, join(dirname(clip.base), `${clip.name}.poster.jpg`)].find(existsSync);
  if (poster) await copyFile(poster, join(dir, `${name}.poster.jpg`));
  const portrait = clip.h > clip.w;
  await writeFile(join(dir, `${name}.embed.html`), `<!-- ${name}: drop into a page. The frame is CSS, the captions are a track the viewer can switch off. -->
<figure style="margin:0;padding:${portrait ? '24px' : '3%'};background:linear-gradient(${CONFIG.background.top},${CONFIG.background.bottom});border-radius:24px;display:flex;justify-content:center">
  <video controls playsinline preload="metadata" poster="${name}.poster.jpg"
    style="width:100%;max-width:${portrait ? '420px' : '1440px'};aspect-ratio:${clip.w}/${clip.h};border-radius:${portrait ? 28 : 16}px;box-shadow:0 18px 50px rgb(0 0 0 / .25)">
    <source src="${name}.mp4" type="video/mp4">
    <track kind="captions" src="${name}.vtt" srclang="en" label="English" default>
  </video>
</figure>
`);  return join(dir, `${name}.mp4`);
}

// ---------------------------------------------------------------- run
let made = 0;
for (const preset of chosen) {
  const takes = clips.filter((c) => preset.source === 'any' || (preset.source === 'portrait') === (c.h > c.w));
  if (takes.length === 0) {
    process.stdout.write(`${preset.name}: no ${preset.source} clips here, skipped\n`);
    continue;
  }
  const dir = join(out, preset.name);
  await mkdir(dir, { recursive: true });
  for (const clip of takes) {
    const started = Date.now();
    let note = hooks[clip.name] || preset.kind === 'web' ? '' : ' (no hook)';
    let file = join(dir, `${clip.name}.mp4`);
    if (preset.kind === 'web') file = await web(clip, dir);
    else {
      const zoomed = await framed(clip, preset, file);
      if (preset.zoom) note += `, zoomed ${zoomed.toFixed(1)} of ${clip.duration.toFixed(1)} s`;
    }
    made++;
    process.stdout.write(`${preset.name}: ${clip.name}${note} → ${file} (${((Date.now() - started) / 1000).toFixed(0)} s)\n`);
  }
}
process.stdout.write(`variants: ${made} written under ${out}\n`);
