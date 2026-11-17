// Privacy-friendly page analytics stored in Cloudflare D1 (binding: DB).
// Counts page views per day, page, country and referring site. No cookies, no IP
// addresses and no personal data are stored.

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|curl|wget|python|headless|lighthouse|scholar|zotero|mybib|bingpreview/i;
let ready = false;

async function ensure(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS hits (
    day TEXT NOT NULL, path TEXT NOT NULL, country TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
    n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path, country, ref))`).run();
  ready = true;
}

export function shouldCount(request, url, res) {
  if (request.method !== 'GET' || res.status !== 200) return false;
  if (!/text\/html/.test(res.headers.get('Content-Type') || '')) return false;
  if (/^\/(portal|api|assets|brand|og|letters|track)\b/.test(url.pathname)) return false;
  const purpose = request.headers.get('Sec-Purpose') || request.headers.get('Purpose') || '';
  if (/prefetch|prerender/i.test(purpose)) return false;
  return !BOT.test(request.headers.get('User-Agent') || '');
}

export async function recordHit(env, request, url) {
  if (!env.DB) return;
  try {
    await ensure(env.DB);
    const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);   // IST day
    const path = (url.pathname.replace(/\/+$/, '') || '/').slice(0, 200);
    const country = String((request.cf && request.cf.country) || '').slice(0, 2);
    let ref = '';
    try {
      const r = new URL(request.headers.get('Referer') || '');
      ref = r.hostname === url.hostname ? '(internal)' : r.hostname.replace(/^www\./, '').slice(0, 80);
    } catch { ref = ''; }
    await env.DB.prepare(`INSERT INTO hits (day, path, country, ref, n) VALUES (?1, ?2, ?3, ?4, 1)
      ON CONFLICT(day, path, country, ref) DO UPDATE SET n = n + 1`).bind(day, path, country, ref).run();
  } catch (err) { console.error('analytics', err); }
}

export async function analyticsSummary(env, days = 30, path = '') {
  if (!env.DB) return { enabled: false };
  await ensure(env.DB);
  days = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = new Date(Date.now() + 5.5 * 3600e3 - (days - 1) * 86400e3).toISOString().slice(0, 10);
  const where = path ? 'day >= ?1 AND path = ?2' : 'day >= ?1';
  const args = path ? [since, path] : [since];
  const q = (sql) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results || []);
  const [byDay, pages, countries, refs, total] = await Promise.all([
    q(`SELECT day, SUM(n) AS views FROM hits WHERE ${where} GROUP BY day ORDER BY day`),
    q(`SELECT path, SUM(n) AS views FROM hits WHERE ${where} GROUP BY path ORDER BY views DESC LIMIT 100`),
    q(`SELECT country, SUM(n) AS views FROM hits WHERE ${where} GROUP BY country ORDER BY views DESC LIMIT 15`),
    q(`SELECT ref, SUM(n) AS views FROM hits WHERE ${where} AND ref NOT IN ('', '(internal)') GROUP BY ref ORDER BY views DESC LIMIT 15`),
    env.DB.prepare(path ? 'SELECT SUM(n) AS views FROM hits WHERE path = ?1' : 'SELECT SUM(n) AS views FROM hits').bind(...(path ? [path] : [])).first()
  ]);
  return { enabled: true, days, since, path, byDay, pages, countries, refs, allTime: (total && total.views) || 0,
           views: byDay.reduce((s, r) => s + (r.views || 0), 0) };
}
