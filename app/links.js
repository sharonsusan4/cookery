// Link helpers. youTubeId and linkKey are also ported to Python in
// dev/make-import.py, which fills in link_key for her imported recipes. Keep
// them in sync: if linkKey gives a different answer here than in the database,
// repeats aren't spotted.

function sourceFor(link) {
  var l = String(link).toLowerCase();
  if (/youtube\.com|youtu\.be/.test(l)) return 'YouTube';
  if (/instagram\.com/.test(l)) return 'Instagram';
  if (/facebook\.com|fb\.watch/.test(l)) return 'Facebook';
  return 'Other';
}

function youTubeId(link) {
  var m = String(link).match(/(?:youtu\.be\/|youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/))([\w-]{11})/i);
  return m ? m[1] : '';
}

function linkKey(link) {
  var s = String(link).trim();
  var yt = youTubeId(s);
  if (yt) return 'yt:' + yt;
  var ig = s.match(/instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([\w-]+)/i);
  if (ig) return 'ig:' + ig[1];
  return s.replace(/^https?:\/\/(www\.|m\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}

/** Pull the first link out of whatever an app shared (YouTube puts it in the text). */
function findLink(...parts) {
  for (const p of parts) {
    const m = String(p || '').match(/https?:\/\/[^\s]+/i);
    if (m) return m[0];
  }
  return '';
}

/**
 * Turn a video title into a recipe name, keeping only the English words.
 * "Kappa Biriyani ആഹാ അന്തസ്... #food" -> "Kappa Biriyani". All-Malayalam titles give "".
 */
function nameFromTitle(title) {
  const parts = String(title).replace(/#[\p{L}\p{N}_]+/gu, '').split(/[|｜]/);
  for (const part of parts) {
    const words = part
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\.{2,}|…/g, ' ')
      .split(/\s+/)
      .filter(w => w && !/\p{L}/u.test(w.replace(/[A-Za-z]/g, '')));
    const name = words.join(' ').replace(/^[\s\-–—:,.!]+|[\s\-–—:,.!]+$/g, '').trim();
    if (/[A-Za-z]{3}/.test(name)) return name;
  }
  return '';
}
