"""Turn the hand-written ingredient lists into a review page and a database update.

    python3 dev/make-ingredients.py

Reads dev/ingredients-1.txt and dev/ingredients-2.txt (one line per recipe:
"<id>[?] item, item, ..."; "?" marks a guess, nothing after the id means it isn't
a recipe) and writes, all gitignored because they're her data:

  dev/ingredients-review.md  bullet-point list to check, guesses first
  dev/ingredients.sql        the update to paste into Supabase > SQL Editor

The update only fills recipes whose ingredients are still empty, and only when
the name still matches, so it never overwrites anything or lands on the wrong row.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = ['ingredients-1.txt', 'ingredients-2.txt']


def sql_text(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    rows = json.load(open(os.path.join(HERE, 'fixture.json'), encoding='utf-8'))[1:]
    data = {}
    for name in SOURCES:
        for line in open(os.path.join(HERE, name), encoding='utf-8'):
            line = line.rstrip('\n')
            if not line.strip() or line.startswith('#'):
                continue
            m = re.match(r'^(\d+)(\??)\s*(.*)$', line)
            i = int(m.group(1))
            if i in data:
                raise SystemExit(f'Recipe {i} is listed twice')
            items = [x.strip() for x in m.group(3).split(',') if x.strip()]
            data[i] = {'guess': bool(m.group(2)), 'items': items}

    missing = [i for i in range(1, len(rows) + 1) if i not in data]
    if missing:
        raise SystemExit(f'No line for recipes: {missing}')

    filled = [i for i in sorted(data) if data[i]['items']]
    guesses = [i for i in filled if data[i]['guess']]
    empty = [i for i in sorted(data) if not data[i]['items']]

    def entry(i):
        name = rows[i - 1][0].strip() or '(no name)'
        head = f'**{i}. {name}**' + (' (check)' if data[i]['guess'] else '')
        return [head] + [f'- {x}' for x in data[i]['items']] + ['']

    md = ["# Ingredients for Mom's recipes", '',
          f'{len(filled)} recipes filled. {len(guesses)} marked **(check)** are guesses. '
          f'{len(empty)} left empty (ignore rows, blanks, how-to videos, removed videos).', '',
          '## Guesses to check first', '']
    for i in guesses:
        md += entry(i)
    md += ['## All recipes', '']
    for i in filled:
        md += entry(i)
    with open(os.path.join(HERE, 'ingredients-review.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))

    sql = ["-- Key ingredients for Mom's recipes, made by dev/make-ingredients.py.",
           '-- PRIVATE: never commit. Only fills empty ingredients, only where the name still matches.',
           '', 'begin;', '']
    for i in filled:
        arr = 'array[' + ', '.join(sql_text(x) for x in data[i]['items']) + ']::text[]'
        sql.append(f'update public.recipes set ingredients = {arr} '
                   f'where id = {i} and ingredients is null and name = {sql_text(rows[i - 1][0])};')
    sql += ['', 'commit;', '']
    with open(os.path.join(HERE, 'ingredients.sql'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(sql))

    print(f'{len(filled)} filled, {len(guesses)} guesses, {len(empty)} empty')


if __name__ == '__main__':
    main()
