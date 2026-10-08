"""Turn Mom's spreadsheet into SQL that loads her recipes into Supabase.

    python3 recipe-app/dev/make-import.py                  (uses "Recepies 2.0.xlsx")
    python3 recipe-app/dev/make-import.py other-file.xlsx

Writes dev/import.sql. Paste it into Supabase > SQL Editor and click Run, after
supabase/schema.sql. The file holds her recipes, so it's in .gitignore and must
never be committed (the GitHub repo is public).

Every row goes in exactly as she typed it: "To try", "Main course ", blank
statuses and trailing spaces are all kept, because the app already reads them
forgivingly. The spreadsheet itself is only read, never changed.

Uses only the standard library (no openpyxl needed).
"""
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(HERE, '..', '..', 'Recepies 2.0.xlsx')
OUT = os.path.join(HERE, 'import.sql')
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

# Database column -> header in her sheet. Found by name, so column order doesn't matter.
HEADERS = {
    'name': 'Recipe Name',
    'category': 'Category',
    'status': 'Status',
    'link': 'Recipe Link',
    'source': 'Source',
    'notes': 'Notes',  # not in her sheet today; picked up if it's ever added
}


# ---------- reading the .xlsx ----------

def first_sheet_path(z):
    """The file inside the .xlsx that holds the first tab, whatever it's called."""
    sheet = ET.fromstring(z.read('xl/workbook.xml')).find(NS + 'sheets')[0]
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = next(r.get('Target') for r in rels if r.get('Id') == sheet.get(REL))
    return sheet.get('name'), 'xl/' + target.lstrip('/').removeprefix('xl/')


def col_index(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def cell_text(si):
    """Text of a shared string: plain <t>, or rich-text runs <r><t>. Phonetic hints are skipped."""
    t = si.find(NS + 't')
    if t is not None:
        return t.text or ''
    return ''.join(r.findtext(NS + 't') or '' for r in si.findall(NS + 'r'))


def read_rows(path):
    """All non-empty rows of the first tab, in order, as lists of strings."""
    z = zipfile.ZipFile(path)
    tab, sheet_xml = first_sheet_path(z)
    strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        strings = [cell_text(si) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(NS + 'si')]
    rows = []
    for r in ET.fromstring(z.read(sheet_xml)).iter(NS + 'row'):
        cells = {}
        for c in r.findall(NS + 'c'):
            kind = c.get('t')
            if kind == 'inlineStr':
                is_ = c.find(NS + 'is')
                value = cell_text(is_) if is_ is not None else ''
            else:
                v = c.find(NS + 'v')
                if v is None:
                    continue
                value = strings[int(v.text)] if kind == 's' else (v.text or '')
            cells[col_index(c.get('r'))] = value
        if any(v != '' for v in cells.values()):
            rows.append([cells.get(i, '') for i in range(max(cells) + 1)])
    return tab, rows


# ---------- linkKey, ported from app/links.js ----------
# Must give exactly the same answer as the JavaScript, because the app compares
# its own linkKey() with the link_key stored here. If you change one, change
# both. Details that matter: JS \w and \s are ASCII-only / JS's own set, JS "."
# doesn't match line breaks, and JS "$" (without the m flag) means the very end.

JS_SPACE = '\t\n\v\f\r                  　﻿'
DOT = r'[^\n\r  ]'
YT = re.compile(r'(?:youtu\.be/|youtube\.com/(?:shorts/|watch\?(?:' + DOT + r'*&)?v=|embed/|live/))([\w-]{11})', re.I | re.A)
IG = re.compile(r'instagram\.com/(?:[\w.]+/)?(?:reel|reels|p|tv)/([\w-]+)', re.I | re.A)


def js_trim(s):
    return s.strip(JS_SPACE)


def youtube_id(link):
    m = YT.search(str(link))
    return m.group(1) if m else ''


def link_key(link):
    s = js_trim(str(link))
    yt = youtube_id(s)
    if yt:
        return 'yt:' + yt
    ig = IG.search(s)
    if ig:
        return 'ig:' + ig.group(1)
    s = re.sub(r'^https?://(www\.|m\.)?', '', s, count=1, flags=re.I)
    s = re.sub(r'[?#]' + DOT + r'*\Z', '', s, count=1)
    s = re.sub(r'/+\Z', '', s, count=1)
    return s.lower()


# ---------- writing SQL ----------

def sql_text(s):
    """A SQL string literal. Supabase uses standard strings, so only ' needs doubling."""
    if '\x00' in s:
        raise ValueError('A cell contains a NUL character, which Postgres can’t store: %r' % s)
    return "'" + s.replace("'", "''") + "'"


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else XLSX
    tab, rows = read_rows(path)
    header = [h.strip().lower() for h in rows[0]]
    cols = {f: header.index(h.lower()) for f, h in HEADERS.items() if h.lower() in header}
    if 'link' not in cols:
        sys.exit('Could not find the "%s" column in the first row.' % HEADERS['link'])

    fields = [f for f in HEADERS if f in cols]
    values = []
    for n, row in enumerate(rows[1:], start=1):
        rec = {f: row[cols[f]] if cols[f] < len(row) else '' for f in fields}
        # id = position in the sheet, so the app's "newest first" keeps her order.
        values.append('(%d, %s, %s)' % (
            n,
            ', '.join(sql_text(rec[f]) for f in fields),
            sql_text(link_key(rec['link'])),
        ))

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('-- Mom\'s recipes from "%s" (tab "%s"), made by dev/make-import.py on %s.\n'
                % (os.path.basename(path), tab, date.today().isoformat()))
        f.write('-- PRIVATE: never commit this file. Run it once in Supabase > SQL Editor, after supabase/schema.sql.\n\n')
        f.write('begin;\n\n')
        # Running it twice (or after the app has saved something) would mix up
        # the ids, so stop with a clear message instead.
        f.write("do $$\nbegin\n  if exists (select 1 from public.recipes) then\n"
                "    raise exception 'The recipes table already has recipes in it, so nothing was imported.';\n"
                "  end if;\nend;\n$$;\n\n")
        f.write('insert into public.recipes (id, %s, link_key) values\n' % ', '.join(fields))
        f.write(',\n'.join(values))
        f.write(';\n\n')
        # New recipes from the app carry on numbering after the last imported one.
        f.write("select setval(pg_get_serial_sequence('public.recipes', 'id'), (select max(id) from public.recipes));\n\n")
        f.write('commit;\n\n')
        f.write('select count(*) as recipes_imported from public.recipes;\n')

    print('Wrote %d recipes from "%s" (tab "%s") to %s' % (len(values), os.path.basename(path), tab, OUT))


if __name__ == '__main__':
    main()
