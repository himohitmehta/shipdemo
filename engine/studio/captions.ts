import { writeFile } from 'node:fs/promises';

/**
 * Captions, cut from the narration's own marks.
 *
 * Every line a scene says already carries the moment it starts (`Mark.at`)
 * and, once spoken, how long the wav runs. That is everything a caption
 * needs, so nothing is transcribed: the cue text is the script, word for
 * word, and the timing is the mix's timing. Off unless asked for
 * (`DEMO_CAPTIONS=1` or `captions: true` in the config) — the voice is still
 * the channel, and the captions are for a muted autoplay or a viewer who
 * reads faster than they listen.
 *
 * Two outputs. Sidecar `.srt`/`.vtt`, which a player or editor can switch on
 * and which shift with the clip when it is cut into something longer; and a
 * `.captioned.mp4` with them burned in, for places that will not load a
 * sidecar at all.
 */

export type Timed = { at: number; seconds: number; text: string };
export type Cue = { from: number; to: number; text: string };

/** Two lines of this many characters is what reads in the time a cue holds. */
const LINE = 46;
const MAX_CUE = LINE * 2;

/** Breaks a long line at its sentences, then its clauses, then its middle. */
function pieces(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .flatMap(function split(piece: string): string[] {
      if (piece.length <= MAX_CUE) {
        return [piece];
      }
      const middle = piece.length / 2;
      const commas = [...piece.matchAll(/[,;:—–] /g)].map(
        (match) => match.index! + 1
      );
      const spaces = [...piece.matchAll(/ /g)].map((match) => match.index!);
      const breaks = commas.length > 0 ? commas : spaces;
      const at = breaks.reduce((best, next) =>
        Math.abs(next - middle) < Math.abs(best - middle) ? next : best
      );
      return [piece.slice(0, at).trim(), piece.slice(at).trim()].flatMap(split);
    });
}

/** Wraps a cue into at most two balanced lines. */
function wrap(text: string): string {
  if (text.length <= LINE) {
    return text;
  }
  const words = text.split(' ');
  let best = text;
  let bestScore = Infinity;
  for (let at = 1; at < words.length; at += 1) {
    const top = words.slice(0, at).join(' ');
    const bottom = words.slice(at).join(' ');
    const score = Math.max(top.length, bottom.length);
    if (score < bestScore) {
      bestScore = score;
      best = `${top}\n${bottom}`;
    }
  }
  return best;
}

/**
 * One cue per piece, the line's time shared out by length.
 *
 * A cue never runs into the next line's start: two captions on screen at once
 * read as a glitch, and the next line's mark is when its words begin.
 */
export function cues(lines: Timed[]): Cue[] {
  const sorted = [...lines].sort((left, right) => left.at - right.at);
  return sorted.flatMap((line, index) => {
    const next = sorted[index + 1]?.at ?? Infinity;
    const end = Math.min(line.at + line.seconds, next - 0.05);
    // A line written `caption || speech` shows only its caption.
    const at = line.text.indexOf(' || ');
    const parts = pieces(at < 0 ? line.text : line.text.slice(0, at));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    let from = line.at;
    return parts.map((part) => {
      const to = from + ((end - line.at) * part.length) / total;
      const cue = { from, to, text: wrap(part) };
      from = to;
      return cue;
    });
  });
}

function stamp(seconds: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const secs = Math.floor(ms / 1000) % 60;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(ms % 1000, 3)}`;
}

export function toSrt(list: Cue[]): string {
  return list
    .map(
      (cue, at) =>
        `${at + 1}\n${stamp(cue.from, ',')} --> ${stamp(cue.to, ',')}\n${cue.text}\n`
    )
    .join('\n');
}

export function toVtt(list: Cue[]): string {
  return `WEBVTT\n\n${list
    .map(
      (cue) => `${stamp(cue.from, '.')} --> ${stamp(cue.to, '.')}\n${cue.text}\n`
    )
    .join('\n')}`;
}

/** Writes `<base>.srt` and `<base>.vtt`, and answers with the srt's path. */
export async function writeCaptions(
  base: string,
  lines: Timed[]
): Promise<string> {
  const list = cues(lines);
  await writeFile(`${base}.srt`, toSrt(list));
  await writeFile(`${base}.vtt`, toVtt(list));
  // Every narrated line whole, with its timing: what a listening check
  // compares against (the captions are split, and show only the caption
  // half of a "caption || spoken" line).
  await writeFile(
    `${base}.lines.json`,
    JSON.stringify(
      lines.map(({ at, seconds, text }) => {
        const split = text.indexOf(' || ');
        return split < 0
          ? { at, seconds, caption: text, spoken: text }
          : { at, seconds, caption: text.slice(0, split), spoken: text.slice(split + 4) };
      }),
      null,
      2
    )
  );
  return `${base}.srt`;
}

/**
 * Burns the srt into a copy of the clip.
 *
 * libass lays an srt out on a 288-line canvas whatever the frame, so sizes
 * here are in those units: 13 is about 48px of a 1080p frame, at any frame
 * size. One translucent box round the whole cue (BorderStyle 4; BorderStyle 3 boxes each line and the overlaps band), its outline the box's colour so it reads as padding
 * rather than an outline keeps the words legible over a white app and a dark
 * one alike. The audio is copied; only the picture is re-encoded.
 */
/**
 * Bottom captions' lift off the frame's edge, in libass's 288-line units.
 * Raised by default so social players (Reels/Shorts caption and buttons,
 * YouTube's control bar) don't cover them: 48 (about a sixth of the height,
 * clear of a phone app's tab bar) on a portrait stage, 32 (about 120px of a
 * 1080p frame) on a landscape one. `DEMO_CAPTION_MARGIN` overrides.
 */
function captionMargin(): number {
  const n = Number(process.env.DEMO_CAPTION_MARGIN);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  const w = Number(process.env.DEMO_WIDTH ?? 1920);
  const h = Number(process.env.DEMO_HEIGHT ?? 1080);
  return h > w ? 48 : 32;
}

export function burnArgs(
  mp4: string,
  srt: string,
  out: string,
  encode: string[]
): string[] {
  const style = [
    `FontName=${process.env.DEMO_CAPTION_FONT ?? 'Noto Sans'}`,
    'Fontsize=13',
    'PrimaryColour=&H00FFFFFF',
    'BackColour=&H30141414',
    'OutlineColour=&H30141414',
    'BorderStyle=4',
    'Outline=1',
    'Shadow=0',
    // `DEMO_CAPTION_AT=top`: over the app's header rather than the bottom,
    // where a phone keeps its tab bar and a sheet its buttons. An srt's
    // force_style takes the old SSA numbers: 6 is top centre, not 8.
    ...(process.env.DEMO_CAPTION_AT === 'top'
      ? ['MarginV=6', 'Alignment=6']
      : [`MarginV=${captionMargin()}`, 'Alignment=2']),
  ].join(',');
  const escaped = srt.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    mp4,
    '-vf',
    `subtitles='${escaped}':force_style='${style}'`,
    ...encode,
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    out,
  ];
}
