"""zoom.py <in.mp4> <out.mp4> [max_zoom]
Finds the dim-band highlight in each frame (the only full-brightness area
while the rest is dimmed) and pushes in on it, easing in and out."""
import subprocess, sys, math
IN, OUT = sys.argv[1], sys.argv[2]
ZMAX = float(sys.argv[3]) if len(sys.argv) > 3 else 1.6
AW, AH, AFPS = 480, 270, 10          # analysis size and rate
probe = subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0","-show_entries",
    "stream=width,height:format=duration","-of","default=nw=1:nk=1",IN]).decode().split()
W, H, DUR = int(probe[0]), int(probe[1]), float(probe[2])
raw = subprocess.check_output(["ffmpeg","-v","error","-i",IN,"-vf",f"fps={AFPS},scale={AW}:{AH},format=gray",
    "-f","rawvideo","-"])
T = bytes(1 if i >= 235 else 0 for i in range(256))
n = len(raw)//(AW*AH)
targets = []   # (z, cx, cy) per analysis frame, in source pixels
for k in range(n):
    f = raw[k*AW*AH:(k+1)*AW*AH].translate(T)
    rows = [y for y in range(AH) if f[y*AW:(y+1)*AW].count(1) >= 8]
    lit = sum(f[y*AW:(y+1)*AW].count(1) for y in rows)
    if not rows or lit > 0.6*AW*AH:
        targets.append((1.0, W/2, H/2)); continue
    x0 = min(f[y*AW:(y+1)*AW].find(1) for y in rows)
    x1 = max(f[y*AW:(y+1)*AW].rfind(1) for y in rows)
    y0, y1 = rows[0], rows[-1]
    sx, sy = W/AW, H/AH
    bw, bh = (x1-x0+1)*sx, (y1-y0+1)*sy
    pad = 0.10
    w = max(bw*(1+2*pad), bh*(1+2*pad)*W/H)
    z = max(1.0, min(ZMAX, W/w))
    targets.append((z, (x0+x1+1)/2*sx, (y0+y1+1)/2*sy))
# debounce: a new target must hold 0.3 s
held, out, cand, since = targets[0], [], None, 0
for t in targets:
    same = lambda a, b: abs(a[0]-b[0]) < 0.08 and abs(a[1]-b[1]) < 60 and abs(a[2]-b[2]) < 60
    if same(t, held): cand = None
    elif cand is not None and same(t, cand):
        since += 1
        if since >= 3: held, cand = t, None
    else: cand, since = t, 1
    out.append(held)
# ease to target per output frame (60 fps), critically damped
FPS = 60; tau = 0.22
z, cx, cy = 1.0, W/2, H/2
cmds = []
for i in range(int(DUR*FPS)+1):
    t = i/FPS; tz, tx, ty = out[min(int(t*AFPS), len(out)-1)]
    a = 1 - math.exp(-1/(FPS*tau))
    z += (tz-z)*a; cx += (tx-cx)*a; cy += (ty-cy)*a
    cw, ch = round(W/z/2)*2, round(H/z/2)*2
    x = min(max(cx-cw/2, 0), W-cw); y = min(max(cy-ch/2, 0), H-ch)
    cmds.append(f"{t:.4f} crop w {cw}, crop h {ch}, crop x {int(x)}, crop y {int(y)};")
cf = OUT + ".cmd"
open(cf, "w").write("\n".join(cmds) + "\n")
subprocess.run(["ffmpeg","-v","error","-y","-i",IN,"-vf",
    f"sendcmd=f='{cf}',crop=w={W}:h={H}:x=0:y=0,scale={W}:{H}:flags=lanczos,setsar=1",
    "-c:v","libx264","-preset","medium","-crf","16","-pix_fmt","yuv420p","-c:a","copy",OUT], check=True)
zs = [o[0] for o in out]
print(f"frames {n}, zoomed {sum(1 for v in zs if v>1.01)/AFPS:.1f}s of {DUR:.1f}s, max {max(zs):.2f}x")
