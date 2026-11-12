#!/bin/bash
# The tools the checks need, apart from ffmpeg: faster-whisper for the voice
# check (a Python venv in ~/.cache/shipdemo, about 500MB with its model) and
# tesseract for the screen check (a system package, so this prints the
# command rather than running sudo).
set -e
V="$HOME/.cache/shipdemo/voice-check/.venv"
if [ ! -x "$V/bin/python" ]; then
  printf 'install: faster-whisper into %s\n' "$V"
  python3 -m venv "$V"
  "$V/bin/pip" install --quiet faster-whisper
fi
"$V/bin/python" -c 'import faster_whisper' && echo 'voice check: ready'
if command -v tesseract >/dev/null; then
  echo 'screen check: ready'
elif command -v brew >/dev/null; then
  echo 'screen check: run  brew install tesseract'
else
  echo 'screen check: run  sudo apt install tesseract-ocr  (or your package manager'"'"'s tesseract)'
fi
