"""Turn dev/ingredients-effort.txt (her Quick / Gourmet / storage labels) into
dev/effort.sql, the update to paste into Supabase > SQL Editor.

    python3 dev/make-effort.py

Both files are gitignored because they're her data. The update only fills
recipes whose label is still empty, and only where the name still matches,
so it never overwrites a label she changed or lands on the wrong row.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LABELS = ('quick', 'gourmet', 'storage')


def sql_text(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    rows = json.load(open(os.path.join(HERE, 'fixture.json'), encoding='utf-8'))[1:]
    sql = ["-- Quick / Gourmet / storage labels for Mom's recipes, made by dev/make-effort.py.",
           '-- PRIVATE: never commit. Only fills empty labels, only where the name still matches.',
           '', 'begin;', '']
    counts = {}
    for line in open(os.path.join(HERE, 'ingredients-effort.txt'), encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        parts = line.split()
        i, label = int(parts[0]), (parts[1] if len(parts) > 1 else '')
        if not label:
            continue
        if label not in LABELS:
            raise SystemExit(f'Recipe {i}: unknown label {label!r}')
        counts[label] = counts.get(label, 0) + 1
        sql.append(f'update public.recipes set effort = {sql_text(label)} '
                   f'where id = {i} and effort is null and name = {sql_text(rows[i - 1][0])};')
    sql += ['', 'commit;', '']
    with open(os.path.join(HERE, 'effort.sql'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(sql))
    print(counts)


if __name__ == '__main__':
    main()
