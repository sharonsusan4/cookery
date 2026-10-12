"""Turn the Naadan / One pot labels and the new recipes into SQL to run on Supabase.

    python3 dev/make-collections.py

Reads (all gitignored, they're her data):
  dev/tags.txt          "<id> naadan,onepot" per line, "#" for comments
  dev/new-recipes.json  [{name, category, effort, tags, ingredients, link, ...}]
and writes (gitignored too):
  dev/tags.sql          sets recipes.tags, only where it's still empty
  dev/new-recipes.sql   adds the new recipes, skipping any whose link she already has

Run migration 008_tags.sql first (it adds the tags column).
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
KNOWN = {'naadan', 'onepot'}


def sql_text(s):
    return "'" + str(s).replace("'", "''") + "'"


def sql_array(items):
    return 'array[' + ', '.join(sql_text(x) for x in items) + ']::text[]' if items else 'null'


def youtube_id(link):
    m = re.search(r'(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([\w-]{11})', link)
    return m and m.group(1)


def link_key(link):
    """The same key app/links.js makes, so the app sees these as the links they are."""
    yt = youtube_id(link)
    if yt:
        return 'yt:' + yt
    s = re.sub(r'^https?://(www\.|m\.)?', '', link.strip(), flags=re.I)
    return re.sub(r'/+$', '', re.sub(r'[?#].*$', '', s)).lower()


def tags_sql():
    out = ["-- Naadan / One pot labels for Mom's recipes, made by dev/make-collections.py.",
           '-- PRIVATE: never commit. Only fills tags that are still empty, on her own recipes.',
           '', 'begin;', '']
    n = 0
    for line in open(os.path.join(HERE, 'tags.txt'), encoding='utf-8'):
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        rid, _, rest = line.partition(' ')
        tags = [t for t in (x.strip() for x in rest.split(',')) if t in KNOWN]
        if not rid.isdigit() or not tags:
            continue
        out.append(f'update public.recipes set tags = {sql_array(tags)} '
                   f'where id = {int(rid)} and owner is null and (tags is null or tags = array[]::text[]);')
        n += 1
    out += ['', 'commit;', '']
    open(os.path.join(HERE, 'tags.sql'), 'w', encoding='utf-8').write('\n'.join(out))
    return n


def new_recipes_sql():
    rows = json.load(open(os.path.join(HERE, 'new-recipes.json'), encoding='utf-8'))
    out = ["-- New naadan and one-pot recipes for Mom, made by dev/make-collections.py.",
           '-- PRIVATE: never commit. Each is skipped if a recipe with the same link already exists.',
           '', 'begin;', '']
    for r in rows:
        key = link_key(r['link'])
        tags = [t for t in r.get('tags', []) if t in KNOWN]
        effort = r.get('effort') if r.get('effort') in ('quick', 'gourmet') else None
        out.append(
            'insert into public.recipes (name, category, status, link, link_key, source, notes, ingredients, effort, tags)\n'
            f"  select {sql_text(r['name'])}, {sql_text(r['category'])}, 'To Try', {sql_text(r['link'])}, {sql_text(key)}, 'YouTube', '', "
            f"{sql_array(r.get('ingredients', []))}, {sql_text(effort) if effort else 'null'}, {sql_array(tags)}\n"
            f'  where not exists (select 1 from public.recipes where link_key = {sql_text(key)});')
    out += ['', 'commit;', '']
    open(os.path.join(HERE, 'new-recipes.sql'), 'w', encoding='utf-8').write('\n'.join(out))
    return len(rows)


if __name__ == '__main__':
    print(f'{tags_sql()} recipes labelled, {new_recipes_sql()} new recipes')
