"""Copy the rows out of the recipe spreadsheet into dev/fixture.json for local testing.

    python3 dev/make-fixture.py                  (uses "Recepies 2.0.xlsx")
    python3 dev/make-fixture.py other-file.xlsx

The dev server works on a copy of this, so the real spreadsheet is never touched.
Uses only the standard library (no openpyxl needed).
"""
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(HERE, '..', '..', 'Recepies 2.0.xlsx')
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


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


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else XLSX
    z = zipfile.ZipFile(path)
    tab, sheet_xml = first_sheet_path(z)
    strings = [''.join(t.text or '' for t in si.iter(NS + 't'))
               for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(NS + 'si')]
    root = ET.fromstring(z.read(sheet_xml))
    rows = []
    for r in root.iter(NS + 'row'):
        cells = {}
        for c in r.findall(NS + 'c'):
            v = c.find(NS + 'v')
            if v is None:
                continue
            cells[col_index(c.get('r'))] = strings[int(v.text)] if c.get('t') == 's' else v.text
        if cells:
            width = max(cells) + 1
            rows.append([cells.get(i, '') for i in range(width)])
    width = len(rows[0])
    rows = [(row + [''] * width)[:width] for row in rows]
    out = os.path.join(HERE, 'fixture.json')
    with open(out, 'w') as f:
        json.dump(rows, f, ensure_ascii=False, indent=0)
    print(f'Wrote {len(rows) - 1} rows from "{os.path.basename(path)}" (tab "{tab}") to {out}')


if __name__ == '__main__':
    main()
