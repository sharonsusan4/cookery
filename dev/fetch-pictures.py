"""Download a picture for recipes that don't have one, from their Instagram or
Facebook page's preview image.

    python3 -I dev/fetch-pictures.py todo.json

todo.json is the output of
    npx supabase db query --linked --project-ref <ref> \
      "select id, link from public.recipes where photo_path is null and ..." > todo.json

Each picture is saved as dev/photos/<id>/<time>.jpg (gitignored), a JPEG of at
most 1080px like the ones the app uploads, so "<id>/<time>.jpg" is the
photo_path to give it. It then writes dev/photos.sql, which sets photo_path
only where it's still empty. Upload the folder to the dish-photos bucket
before running that SQL.

Preview images on Instagram and Facebook links expire, which is why they're
saved instead of linked. Facebook "share" links usually need a login and give
nothing; those are skipped. Run on a home connection: they often block servers.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'photos')
UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
MAX_BYTES = 8 * 1024 * 1024


def get(url, limit):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en'})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.headers.get('Content-Type', ''), r.read(limit + 1)


def preview_image(link):
    _, html = get(link, 2 * 1024 * 1024)
    m = re.search(rb'property="og:image" content="([^"]+)"', html)
    return m and m.group(1).decode('utf-8', 'replace').replace('&amp;', '&')


def main():
    rows = json.load(open(sys.argv[1]))['rows']
    done, failed = [], []
    for n, row in enumerate(rows, 1):
        rid, link = int(row['id']), str(row['link'])
        folder = os.path.join(OUT, str(rid))
        if os.path.isdir(folder) and os.listdir(folder):
            done.append((rid, f'{rid}/{sorted(os.listdir(folder))[0]}'))
            continue
        try:
            src = preview_image(link)
            if not src or not src.startswith('https://'):
                raise ValueError('no preview image')
            kind, data = get(src, MAX_BYTES)
            if not kind.startswith('image/') or len(data) > MAX_BYTES or len(data) < 4000:
                raise ValueError(f'not a usable image ({kind}, {len(data)} bytes)')
            name = f'{int(time.time() * 1000)}.jpg'
            with tempfile.TemporaryDirectory() as tmp:
                raw, jpg = os.path.join(tmp, 'raw'), os.path.join(tmp, name)
                open(raw, 'wb').write(data)
                subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
                                '-Z', '1080', raw, '--out', jpg], check=True, capture_output=True)
                os.makedirs(folder, exist_ok=True)
                os.replace(jpg, os.path.join(folder, name))
            done.append((rid, f'{rid}/{name}'))
            print(f'{n}/{len(rows)} {rid} ok', flush=True)
        except Exception as e:  # one bad link shouldn't stop the rest
            failed.append(rid)
            print(f'{n}/{len(rows)} {rid} skipped: {str(e)[:80]}', flush=True)
        time.sleep(1.5)

    sql = ['-- Pictures for recipes without one, made by dev/fetch-pictures.py.',
           '-- PRIVATE: never commit. Only fills empty photo_path.', '', 'begin;', '']
    sql += [f"update public.recipes set photo_path = '{p}' where id = {rid} and photo_path is null;"
            for rid, p in done]
    sql += ['', 'commit;', '']
    open(os.path.join(HERE, 'photos.sql'), 'w').write('\n'.join(sql))
    print(f'{len(done)} pictures, {len(failed)} skipped: {failed}')


if __name__ == '__main__':
    main()
