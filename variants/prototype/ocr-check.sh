#!/bin/bash
# ocr-check.sh <video> <workdir>
# Reads a frame every 0.5 s and flags banned words; a second pass keeps
# only red pixels and reads those, to catch error text in any wording.
V=$1; W=$2; rm -rf $W; mkdir -p $W/f $W/r
M="gt(r(X,Y),150)*lt(g(X,Y),110)*lt(b(X,Y),110)*gt(r(X,Y)-g(X,Y),70)"
ffmpeg -hide_banner -loglevel error -i "$V" -vf fps=2 -q:v 3 $W/f/%05d.jpg </dev/null
ffmpeg -hide_banner -loglevel error -i "$V" -vf "fps=2,format=rgb24,geq=r='if($M,0,255)':g='if($M,0,255)':b='if($M,0,255)',format=gray" $W/r/%05d.pgm </dev/null
ls $W/f/*.jpg | xargs -P 8 -I{} sh -c 'tesseract {} - --psm 11 2>/dev/null | tr "\n" " " > {}.txt'
python3 - $W <<'PY' > $W/redlist
import sys,glob
for f in sorted(glob.glob(sys.argv[1]+'/r/*.pgm')):
    d=open(f,'rb').read(); body=d[d.index(b'255\n')+4:]
    if sum(1 for b in body if b<128)>200: print(f)
PY
xargs -r -P 8 -I{} sh -c 'tesseract {} - --psm 11 2>/dev/null | tr "\n" " " > {}.txt' < $W/redlist
BAN='already a plan|localhost|went wrong|couldn.t|failed to|invalid|is required|try again|validation'
echo "frames: $(ls $W/f/*.txt | wc -l)"
echo "BANNED:"; grep -liE "$BAN" $W/f/*.txt | while read t; do i=$(basename $t .jpg.txt); echo "  t=$(( (10#$i-1)/2 ))s: $(grep -oiE ".{0,30}($BAN).{0,30}" $t | head -1)"; done
echo "RED frames: $(wc -l < $W/redlist)"
while read f; do s=$(tr -s ' ' < $f.txt | sed 's/^ *//;s/ *$//'); [ -n "$s" ] && echo "$s"; done < $W/redlist | sort | uniq -c | sort -rn | head -30
