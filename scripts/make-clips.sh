#!/usr/bin/env bash
# Feed clips: 25 s excerpts of the trailers, H.264/AAC, 1280x720 or 720x1280 (cover crop), ~2 MB each.
# Input:  media/trailers/src/{id}.(mp4|mov|webm|mkv)   id = film id (HO…) or promo-{tiktokId}
# Output: media/trailers/{id}.mp4 + `clip`/`vertical` fields in data/films.json and data/promos.json
# Usage:  scripts/make-clips.sh            (needs ffmpeg + ffprobe: brew install ffmpeg)
set -euo pipefail
cd "$(dirname "$0")/.."
# ffmpeg/ffprobe from the project venv (.venv/bin, pip package static-ffmpeg) or PATH
export PATH="$PWD/.venv/bin:$PATH"
# first run: link the static binaries as ffmpeg/ffprobe so yt-dlp and this script find them on PATH
[ -x .venv/bin/ffmpeg ] || .venv/bin/python -c "from static_ffmpeg import run; f,p=run.get_or_fetch_platform_executables_else_raise(); import os; os.symlink(f,'.venv/bin/ffmpeg'); os.symlink(p,'.venv/bin/ffprobe')" 2>/dev/null || true
FFMPEG=$(command -v ffmpeg || command -v static_ffmpeg || true); FFPROBE=$(command -v ffprobe || command -v static_ffprobe || true)
[ -n "$FFMPEG" ] && [ -n "$FFPROBE" ] || { echo "ffmpeg missing: python3 -m pip install static-ffmpeg"; exit 1; }
export FFPROBE
mkdir -p media/trailers
shopt -s nullglob
n=0
for f in media/trailers/src/*.{mp4,mov,webm,mkv,MP4,MOV}; do
  id=$(basename "${f%.*}"); out="media/trailers/$id.mp4"
  [ -s "$out" ] && { echo "skip $id (exists)"; continue; }
  read -r w h dur < <("$FFPROBE" -v error -select_streams v:0 -show_entries stream=width,height:format=duration -of csv=p=0 "$f" | tr ',\n' '  ') || true # read hits EOF (no newline) → non-zero under set -e
  dur=${dur%.*}; [ -z "$dur" ] && dur=25
  if [ "$h" -gt "$w" ]; then vf="scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280"; else vf="scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720"; fi
  # ponytail: YouTube trailers open with studio logos; skip 8 s when there is room, TikTok/Shorts start at 0
  ss=0; case "$id" in promo-*) ss=0;; *) [ "$dur" -gt 40 ] && [ "$h" -le "$w" ] && ss=8;; esac
  echo "clip $id ${w}x${h} ${dur}s from ${ss}s"
  "$FFMPEG" -v error -y -ss "$ss" -t 25 -i "$f" -vf "$vf" -r 30 -g 60 -pix_fmt yuv420p \
    -c:v libx264 -profile:v main -level 4.0 -preset slow -crf 27 \
    -af "loudnorm=I=-18:TP=-1.5,afade=t=in:d=0.4,afade=t=out:st=24.6:d=0.4" -c:a aac -b:a 96k -ac 2 \
    -movflags +faststart "$out"
  n=$((n+1))
done
echo "$n clips written; total $(du -sh media/trailers | cut -f1)"
# Data: clip + vertical per film / promo
python3 - <<'EOF'
import json, subprocess, glob, os
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')
def vertical(p):
    w, h = subprocess.run([FFPROBE,'-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',p],capture_output=True,text=True).stdout.strip().split(',')
    return int(h) > int(w)
clips = {os.path.basename(p)[:-4]: p for p in glob.glob('media/trailers/*.mp4')}
for path, key, pid in (('data/films.json','films',lambda o: o['id']), ('data/promos.json',None,lambda o: 'promo-' + str(o.get('id') or o.get('tiktok') or ''))):
    raw = open(path).read(); d = json.loads(raw); items = d[key] if key else d
    n = 0
    for o in items:
        p = clips.get(pid(o))
        if not p: continue
        o['clip'] = p; n += 1
        if vertical(p): o['vertical'] = True
        else: o.pop('vertical', None)
    open(path,'w').write(json.dumps(d, ensure_ascii=False, indent=1) + ('\n' if raw.endswith('\n') else ''))
    print(path, n, 'items with clip')
EOF
