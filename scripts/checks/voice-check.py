"""
Listens to each narrated line and flags the ones that don't sound like
their script.

    voice-check.py [--profile profile.json] <clip.mp4> [...]

Reads <clip>.lines.json beside each clip (written by a captioned run), cuts
each line's audio out of the clip, transcribes it with faster-whisper (small,
English) and compares the words with what the line was meant to say. A line
under 0.8 is flagged. The profile's `names` help the model spell product and
people's names; `heardAs` maps what it hears for them back to the script.
"""
import difflib, json, os, re, subprocess, sys, tempfile

from faster_whisper import WhisperModel

args = sys.argv[1:]
profile = {}
if args[:1] == ["--profile"]:
    profile = json.load(open(args[1]))
    args = args[2:]
if not args:
    sys.exit("voice-check: name at least one clip")

model = WhisperModel("small", compute_type="int8")
PROMPT = ", ".join(profile.get("names", [])) or None
SAME = {k.lower(): v.lower() for k, v in profile.get("heardAs", {}).items()}
NUMBERS = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
           "7": "seven", "8": "eight", "9": "nine", "10": "ten", "12": "twelve", "20": "twenty"}


def words(text):
    t = text.lower().replace("-", " ")
    t = re.sub(r"([a-z0-9])\.([a-z]{2,})\b", r"\1 dot \2", t)
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    return [SAME.get(w, NUMBERS.get(w, w)) for w in t.split()]


flagged = 0
for clip in args:
    lines = json.load(open(re.sub(r"\.mp4$", ".lines.json", clip)))
    worst = []
    with tempfile.TemporaryDirectory() as d:
        for i, line in enumerate(lines):
            wav = os.path.join(d, f"{i}.wav")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(0, line['at'] - 0.1):.2f}",
                            "-t", f"{line['seconds'] + 0.3:.2f}", "-i", clip, "-ac", "1", "-ar", "16000", wav],
                           check=True)
            segs, _ = model.transcribe(wav, language="en", initial_prompt=PROMPT, beam_size=5)
            heard = " ".join(s.text for s in segs).strip()
            meant = line.get("spoken") or line["caption"]
            score = difflib.SequenceMatcher(None, words(meant), words(heard)).ratio()
            if score < 0.8:
                worst.append(f"  FLAG line {i + 1} ({score:.2f})\n     meant: {meant}\n     heard: {heard}")
    flagged += len(worst)
    print(f"{os.path.basename(clip)}: {len(lines)} lines, {len(worst)} flagged")
    for w in worst:
        print(w)
print(f"voice: {flagged} flagged")
sys.exit(1 if flagged else 0)
