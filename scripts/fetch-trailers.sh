#!/usr/bin/env bash
# Downloads the feed's trailer sources into media/trailers/src/{id}.mp4 with yt-dlp, then runs make-clips.sh.
# Films: verticalTrailer (TikTok) wins over youtubeKey; promos: TikTok id. Skips files that already exist.
# Usage: scripts/fetch-trailers.sh [max]      (brew install yt-dlp ffmpeg)
set -uo pipefail
cd "$(dirname "$0")/.."
# tools from the project venv (.venv/bin: python3 -m venv .venv && .venv/bin/pip install yt-dlp static-ffmpeg), else PATH
export PATH="$PWD/.venv/bin:$PATH"
[ -x .venv/bin/ffmpeg ] || .venv/bin/python -c "from static_ffmpeg import run; f,p=run.get_or_fetch_platform_executables_else_raise(); import os; os.symlink(f,'.venv/bin/ffmpeg'); os.symlink(p,'.venv/bin/ffprobe')" 2>/dev/null || true
command -v ffmpeg >/dev/null || echo "warning: no ffmpeg on PATH, yt-dlp cannot merge video+audio"
if command -v yt-dlp >/dev/null; then YTDLP=yt-dlp; elif python3 -c "import yt_dlp" 2>/dev/null; then YTDLP="python3 -m yt_dlp"; else echo "yt-dlp missing: python3 -m venv .venv && .venv/bin/pip install yt-dlp static-ffmpeg"; exit 1; fi
export YTDLP
mkdir -p media/trailers/src
max=${1:-999}
python3 - "$max" <<'EOF' > /tmp/cineco-trailers.txt
import json, sys
films = json.load(open('data/films.json'))['films']
listed = [f for f in films if not f.get('hidden')]
rows = []
for f in listed:
    tk = f.get('verticalTrailer'); key = f.get('youtubeKey')
    if tk: rows.append((f['id'], 'https://www.tiktok.com/@cine_colombia/video/' + str(tk.get('id') if isinstance(tk, dict) else tk)))
    elif key: rows.append((f['id'], 'https://www.youtube.com/watch?v=' + key))
for p in json.load(open('data/promos.json')):
    rows.append(('promo-' + str(p['id']), p.get('url') or 'https://www.tiktok.com/@cine_colombia/video/' + str(p['id'])))
# featured / feedOrder first so the demo cards land early
order = {f['id']: (0 if f.get('featured') else 1, f.get('feedOrder') or 999) for f in listed}
rows.sort(key=lambda r: order.get(r[0], (0, 0)) if not r[0].startswith('promo-') else (0, 2))
for i, (fid, url) in enumerate(rows[:int(sys.argv[1])]): print(fid, url)
EOF
total=$(wc -l < /tmp/cineco-trailers.txt | tr -d ' ')
echo "$total sources; downloading up to 3 at a time into media/trailers/src/"
# ponytail: one yt-dlp per line, 3 in parallel; failures are listed at the end and those cards keep their hero image
xargs -P 3 -L 1 sh -c '
  id=$0; url=$1; out="media/trailers/src/$id.mp4"
  [ -s "$out" ] && { echo "skip $id"; exit 0; }
  dl() { $YTDLP -q --no-warnings --no-playlist --socket-timeout 30 -f "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/b" --merge-output-format mp4 -o "$out" "$@" "$url"; }
  # ponytail: YouTube sometimes 403s the web client; the iOS client usually gets through
  dl 2>/dev/null || dl --extractor-args "youtube:player_client=ios" 2>/dev/null || dl --extractor-args "youtube:player_client=android" 2>/dev/null \
    && echo "ok   $id" || echo "FAIL $id $url"
' < /tmp/cineco-trailers.txt | tee /tmp/cineco-trailers.log
echo "--- $(grep -c '^ok' /tmp/cineco-trailers.log) downloaded, $(grep -c '^FAIL' /tmp/cineco-trailers.log) failed (see /tmp/cineco-trailers.log)"
scripts/make-clips.sh
