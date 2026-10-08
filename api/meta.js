// GET /api/meta?id=<YouTube video id>  ->  { title, thumbnail }
//
// The Add screen uses the video's title to suggest a recipe name. Browsers
// can't ask YouTube for it directly (no CORS), so this small Vercel function
// asks on the app's behalf. It only ever calls YouTube's oEmbed address with a
// checked 11-character video id, so it can't be used to fetch anything else.
// Instagram and Facebook don't share titles without a login.
//
// Written against plain Node's request/response so dev/server.js can use the
// same handler locally.

const ID = /^[\w-]{11}$/;

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function meta(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Use GET' });
  const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
  if (!ID.test(id)) return send(res, 400, { error: 'Expected a YouTube video id' });

  const thumbnail = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  let title = '';
  try {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, {
      signal: AbortSignal.timeout(6000),
    });
    // 401/404 mean private, removed or not embeddable: no title, which is fine.
    if (r.ok) title = String((await r.json()).title || '');
  } catch (e) {
    // Slow or unreachable: she can type the name herself.
  }
  // Titles hardly ever change, so let Vercel's CDN remember them for a day.
  send(res, 200, { title, thumbnail }, title ? 'public, max-age=3600, s-maxage=86400' : 'no-store');
};
