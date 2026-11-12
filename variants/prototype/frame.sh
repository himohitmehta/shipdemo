#!/bin/bash
# frame-phone.sh <plain.mp4> <srt> <hook line1> <hook line2> <out> [extra ffmpeg input/output args...]
set -e
IN=$1; SRT=$2; H1=$3; H2=$4; OUT=$5; shift 5
D=$(mktemp -d)
CW=${CW:-1080}; CH=${CH:-1920}; W=${W:-700}; H=${H:-1244}; X=${X:-190}; Y=${Y:-232}; R=${R:-42}; MV=${MV:-44}; FS=${FS:-8.6}; HY=${HY:-64}; HX=${HX:-0}; HW=${HW:-$CW}; HS=${HS:-58}; ML=${ML:-10}
# background: soft warm vertical gradient
ffmpeg -loglevel error -y -f lavfi -i color=c=black:s=${CW}x${CH}:d=1 -frames:v 1 \
  -vf "format=rgb24,geq=r='247-10*Y/H':g='243-12*Y/H':b='236-16*Y/H'" $D/bg.png
# rounded mask for the video
ffmpeg -loglevel error -y -f lavfi -i color=c=black:s=${W}x${H}:d=1 -frames:v 1 \
  -vf "format=gray,geq=lum='if(lte(pow(max(max($R-X,X-($W-1-$R)),0),2)+pow(max(max($R-Y,Y-($H-1-$R)),0),2),$R*$R),255,0)'" $D/mask.png
# soft shadow: the mask, padded and blurred, as black at low alpha
ffmpeg -loglevel error -y -i $D/mask.png -frames:v 1 \
  -vf "pad=w=iw+120:h=ih+120:x=60:y=60:color=black,boxblur=28:2,lut=y='val*0.30'" $D/shadow.png
printf '%s' "$H1" > $D/h1.txt; printf '%s' "$H2" > $D/h2.txt
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
esc=$(printf '%s' "$SRT" | sed "s/\\\\/\\\\\\\\/g; s/:/\\\\:/g; s/'/\\\\'/g")
ffmpeg -hide_banner -loglevel error -y -loop 1 -i $D/bg.png -i "$IN" -loop 1 -i $D/mask.png -loop 1 -i $D/shadow.png -filter_complex "
[1:v]scale=$W:$H:flags=lanczos,format=rgba[v];[2:v]format=gray[m];[v][m]alphamerge[vr];
[3:v]format=gray[sm];color=c=black:s=$((W+120))x$((H+120))[sc];[sc][sm]alphamerge[sh];
[0:v][sh]overlay=$((X-60)):$((Y-60+18))[b1];[b1][vr]overlay=$X:$Y:shortest=1[b2];
[b2]drawtext=fontfile=/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf:textfile=$D/h1.txt:fontsize=$HS:fontcolor=0x1A1A1A:x=$HX+($HW-text_w)/2:y=$HY,drawtext=fontfile=/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf:textfile=$D/h2.txt:fontsize=$HS:fontcolor=0x1A1A1A:x=$HX+($HW-text_w)/2:y=$((HY+HS*135/100))[b3];
[b3]subtitles='$esc':force_style='FontName=Noto Sans,Fontsize=$FS,Bold=1,PrimaryColour=&H001A1A1A,BorderStyle=1,Outline=0,Shadow=0,MarginV=$MV,MarginL=$ML,MarginR=10,Alignment=2',format=yuv420p[out]" \
  -map "[out]" -map 1:a? -c:v libx264 -preset medium -crf 18 -r 60 -c:a copy -movflags +faststart -t "$DUR" "$@" "$OUT"
rm -rf $D
