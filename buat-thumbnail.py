#!/usr/bin/env python3
"""Buat thumbnail pratinjau tautan (1200x630 JPEG, < ~300 KB) untuk semua event berflyer.
Pakai:  sudo systemctl stop ruang
        sudo python3 buat-thumbnail.py /opt/ruang/data/data.json
        sudo systemctl start ruang
Butuh Pillow:  sudo apt-get install -y python3-pil"""
import sys, json, base64, io, os, re, shutil, datetime
from PIL import Image

DATA = sys.argv[1] if len(sys.argv) > 1 else '/opt/ruang/data/data.json'
MEDIA = os.path.join(os.path.dirname(DATA), 'media')

def tanda(src):  # sama dengan tandaGambar() di server.js
    return f"{len(src)}:{src[:40]}:{src[-40:]}" if src else ''

def buka(src):
    if src.startswith('data:image'):
        return Image.open(io.BytesIO(base64.b64decode(src.split(',', 1)[1])))
    m = re.match(r'^/media/([a-f0-9]{20}\.(png|jpg|webp|gif))$', src)
    if m:
        for d in (MEDIA, os.path.join(os.path.dirname(DATA), '..', 'media'), '/opt/ruang/media'):
            p = os.path.join(d, m.group(1))
            if os.path.exists(p): return Image.open(p)
    return None

def thumb(im):
    W, H = 1200, 630
    im = im.convert('RGBA')
    bg = Image.new('RGB', (W, H), (255, 247, 238))
    s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    bg.paste(im, ((W - im.width) // 2, (H - im.height) // 2), im)
    for q in (84, 76, 68, 60, 52):
        buf = io.BytesIO(); bg.save(buf, 'JPEG', quality=q, optimize=True)
        if buf.tell() < 245000: break
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()

store = json.load(open(DATA, encoding='utf-8'))
shutil.copy(DATA, DATA + '.sebelum-thumbnail-' + datetime.datetime.now().strftime('%Y%m%d-%H%M'))
store.setdefault('ogImg', {})
for m in store.get('meta', []):
    f = str(m.get('flyer') or '')
    if not f: continue
    if (store['ogImg'].get(m['id']) or {}).get('sig') == tanda(f):
        print('sudah ada :', m.get('title')); continue
    try:
        im = buka(f)
        if im is None: print('lewati   :', m.get('title'), '(flyer dari situs lain — unggah ulang lewat pustaka media)'); continue
        data = thumb(im)
        store['ogImg'][m['id']] = {'sig': tanda(f), 'data': data, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        print('dibuat   :', m.get('title'), f'({len(data) * 3 // 4 // 1024} KB)')
    except Exception as e:
        print('gagal    :', m.get('title'), e)
json.dump(store, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False)
print('Selesai. Jalankan: sudo systemctl start ruang')
