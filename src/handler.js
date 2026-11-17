// Shared request handler: renders every public page on the server (so citation
// metadata is in the HTML that MyBib/Zotero/Google Scholar fetch) and proxies the
// editorial portal's API calls to Apps Script. Used by both the Worker and Pages.

import { siteConfig, slugify } from './config.js';
import { backend, BackendError } from './api.js';
import { PAGES } from './pages.js';
import { renderPaper } from './paper.js';
import { getPdf, htmlToPdf, htmlToPng } from './pdf.js';
import { aiGenerate } from './ai.js';
import { shouldCount, recordHit, analyticsSummary } from './analytics.js';
import { approvalDoc, approvalFooterTemplate, certificateDoc, letterDoc, letterFooterTemplate, issueCoverDoc, issueCompiledDoc, shareCardDoc } from './docs.js';
import { articleVI } from './util.js';
import { sanitizeHtml } from '../public/assets/sanitize.js';
import {
  homePage, listPage, articlePage, withdrawnPage, authorPage, staticPage, teamHtml,
  notFoundPage, errorPage, rssFeed, sitemap, messagePage, subscribePage, unsubscribePage, archivePage,
  partnersPage, cobrandPage, preferencesPage, issuesPage, issuePage, trackPage, verifyPage, writePage
} from './render.js';

const PER_PAGE = 18;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const res = await handle(context, url);
  if (context.env.DB && shouldCount(context.request, url, res)) context.waitUntil(recordHit(context.env, context.request, url));
  return res;
}

async function handle(context, url) {
  const { request, env } = context;
  const site = siteConfig(env);

  if (url.pathname === '/api') {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
    return proxy(request, env);
  }
  if (url.pathname === '/subscribe' && request.method === 'POST') return subscribePost(request, env, site);
  if (url.pathname === '/unsubscribe' && request.method === 'POST') return unsubscribePost(request, env, site);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const live = await liveRoute(url, env, site, context.waitUntil);
  if (live) return live;

  // Edge cache for public pages.
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let res;
  try {
    res = await route(url, env, site, context.waitUntil);
  } catch (err) {
    console.error(err);
    return html(errorPage(site), 503, 'no-store');
  }
  if ((res.status === 200 || res.status === 404) && /s-maxage/.test(res.headers.get('Cache-Control') || '')) {
    context.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return res;
}

async function route(url, env, site, waitUntil) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const ttl = site.cacheSeconds;

  if (path === '/') {
    const data = await backend(env, 'public.list', { limit: 25 });
    return html(homePage(site, data), 200, cacheHeader(ttl));
  }

  // Research-paper PDF of an article: /articles/<slug>.pdf
  if (parts[0] === 'articles' && parts.length === 2 && parts[1].endsWith('.pdf')) {
    const a = await backend(env, 'public.article', { slug: parts[1].slice(0, -4) });
    if (!a || a.withdrawn) return html(notFoundPage(site), 404, cacheHeader(60));
    if (!site.pdf) return Response.redirect(`${site.url}/articles/${a.slug}/paper`, 302);
    try {
      const buf = await getPdf(env, site, a, waitUntil);
      return new Response(buf, { headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${a.id}-${a.slug.slice(0, 60)}.pdf"`,
        'Cache-Control': cacheHeader(3600),
        'X-Robots-Tag': 'index, follow'
      } });
    } catch (err) {
      console.error(err);
      return Response.redirect(`${site.url}/articles/${a.slug}/paper`, 302);
    }
  }

  // Printable research-paper view (also the fallback when PDF rendering is unavailable).
  if (parts[0] === 'articles' && parts.length === 3 && parts[2] === 'paper') {
    const a = await backend(env, 'public.article', { slug: parts[1] });
    if (!a || a.withdrawn) return html(notFoundPage(site), 404, cacheHeader(60));
    return html(renderPaper(site, a, { forPrint: true }), 200, cacheHeader(ttl));
  }

  if (path === '/submit') {
    return new Response(null, { status: 301, headers: { Location: '/write', 'Cache-Control': cacheHeader(86400) } });
  }
  if (path === '/write') {
    let cfg = {};
    try { cfg = await backend(env, 'contrib.config'); } catch { cfg = {}; }
    return html(writePage(site, cfg || {}), 200, cacheHeader(3600));
  }

  // Share card image for an article: /og/<slug>.png
  if (parts[0] === 'og' && parts.length === 2 && parts[1].endsWith('.png')) {
    const a = await backend(env, 'public.article', { slug: parts[1].slice(0, -4) });
    if (!a || a.withdrawn || !site.pdf) return Response.redirect(`${site.url}/brand/social/ABR-Social-Avatar-Black.png`, 302);
    try {
      const png = await htmlToPng(env, `og:${a.id}:${a.modifiedAt || a.publishedAt}:${a.doi || ''}:${a.issue ? a.issue.key : ''}:v1`,
        shareCardDoc(site, a, articleVI(site, a)), 1200, 630, waitUntil);
      return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } });
    } catch (err) {
      console.error(err);
      return Response.redirect(a.coverUrl || `${site.url}/brand/social/ABR-Social-Avatar-Black.png`, 302);
    }
  }

  if (path === '/issues') {
    const list = await backend(env, 'public.issues');
    return html(issuesPage(site, list || []), 200, cacheHeader(ttl));
  }

  if (parts[0] === 'issues' && parts.length >= 2) {
    const key = parts[1].replace(/\.pdf$/, '');
    const pdf = parts.length === 2 && parts[1].endsWith('.pdf');
    const sub = parts[2] || '';
    const full = pdf || sub === 'print';
    const issue = await backend(env, 'public.issue', { key, full });
    if (!issue) return html(notFoundPage(site), 404, cacheHeader(60));
    if (sub === 'cover.png') {
      if (!site.pdf) return new Response('Not found', { status: 404 });
      const png = await htmlToPng(env, `cover:${issue.key}:${issue.compiledAt}:v1`, issueCoverDoc(site, issue), 794, 1123, waitUntil);
      return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } });
    }
    if (sub === 'print') return html(issueCompiledDoc(site, issue), 200, cacheHeader(ttl));
    if (pdf) {
      if (!site.pdf) return Response.redirect(`${site.url}/issues/${issue.key}/print`, 302);
      try {
        const buf = await htmlToPdf(env, `issue:${issue.key}:${issue.compiledAt}:v2`, issueCompiledDoc(site, issue, { forPrint: true }), {}, waitUntil);
        return new Response(buf, { headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="ABR-Vol${issue.volume}-No${issue.number}.pdf"`,
          'Cache-Control': cacheHeader(3600)
        } });
      } catch (err) {
        console.error(err);
        return Response.redirect(`${site.url}/issues/${issue.key}/print`, 302);
      }
    }
    if (parts.length === 2) return html(issuePage(site, issue), 200, cacheHeader(ttl));
  }

  if (path === '/partners') {
    let list = [];
    try { list = await backend(env, 'public.partners'); } catch { list = []; }
    return html(partnersPage(site, list || []), 200, cacheHeader(ttl));
  }

  if (path === '/archive') {
    const data = await backend(env, 'public.archive');
    return html(archivePage(site, data.articles || []), 200, cacheHeader(ttl));
  }

  if (parts[0] === 'articles' && parts.length === 2) {
    const a = await backend(env, 'public.article', { slug: parts[1] });
    if (!a) return html(notFoundPage(site), 404, cacheHeader(60));
    if (a.withdrawn) return html(withdrawnPage(site, a), 200, cacheHeader(ttl));
    return html(articlePage(site, a), 200, cacheHeader(ttl));
  }

  if (parts[0] === 'section' && parts.length === 2) {
    const name = site.sections.find((s) => slugify(s) === parts[1]);
    if (!name) return html(notFoundPage(site), 404, cacheHeader(60));
    const data = await backend(env, 'public.list', { section: parts[1], limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
    return html(listPage(site, {
      title: name, articles: data.articles, total: data.total, page, perPage: PER_PAGE,
      basePath: `/section/${parts[1]}`, canonical: `${site.url}/section/${parts[1]}${page > 1 ? `?page=${page}` : ''}`
    }), 200, cacheHeader(ttl));
  }

  if (parts[0] === 'authors' && parts.length === 2) {
    const data = await backend(env, 'public.author', { slug: parts[1] });
    if (!data) return html(notFoundPage(site), 404, cacheHeader(60));
    return html(authorPage(site, data), 200, cacheHeader(ttl));
  }

  if (parts.length === 1 && PAGES[parts[0]]) {
    let extra = '';
    if (parts[0] === 'about') {
      try { extra = teamHtml(await backend(env, 'public.team')); } catch { extra = ''; }
    }
    return html(staticPage(site, PAGES[parts[0]], extra), 200, cacheHeader(3600));
  }

  if (path === '/feed.xml' || path === '/rss.xml' || path === '/feed') {
    const data = await backend(env, 'public.list', { limit: 50 });
    return new Response(rssFeed(site, data.articles), {
      headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': cacheHeader(ttl) }
    });
  }

  if (path === '/sitemap.xml') {
    const data = await backend(env, 'public.sitemap');
    return new Response(sitemap(site, data, Object.keys(PAGES)), {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': cacheHeader(ttl) }
    });
  }

  if (path === '/robots.txt') {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /portal/\nDisallow: /api\nDisallow: /letters/\nDisallow: /approvals/\nDisallow: /track\n\nSitemap: ${site.url}/sitemap.xml\n`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': cacheHeader(86400) }
    });
  }

  return html(notFoundPage(site), 404, cacheHeader(60));
}

// Pages that must never be cached.
async function liveRoute(url, env, site, waitUntil) {
  const path = url.pathname.replace(/\/+$/, '');
  const q = Object.fromEntries(url.searchParams);
  if (path === '/track') {
    if (!q.id || !q.key) return html(trackPage(site, null, q), 200);
    try {
      return html(trackPage(site, await backend(env, 'public.track', { id: q.id, key: q.key }), q), 200);
    } catch (err) {
      if (err instanceof BackendError) return html(trackPage(site, null, q, err.message), 200);
      return html(errorPage(site), 503);
    }
  }
  if (path === '/verify') {
    let r = null;
    if (q.ref) { try { r = await backend(env, 'public.verify', { ref: q.ref }); } catch { return html(errorPage(site), 503); } }
    return html(verifyPage(site, q.ref || '', r), 200);
  }
  let m = /^\/certificates\/(ABRC-\d{4}-\d{4})(\.pdf)?$/i.exec(path);
  if (m) {
    const c = await backend(env, 'public.certificate', { id: m[1].toUpperCase() });
    if (!c) return html(notFoundPage(site), 404);
    if (!m[2]) return html(certificateDoc(site, c), 200);
    if (!site.pdf) return Response.redirect(`${site.url}/certificates/${c.id}`, 302);
    const buf = await htmlToPdf(env, `cert:${c.id}:${c.status}:v1`, certificateDoc(site, c, { forPrint: true }),
      { landscape: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } }, waitUntil);
    return new Response(buf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${c.id}.pdf"`, 'Cache-Control': 'private, no-store' } });
  }
  m = /^\/approvals\/(ABRA-\d{4}-\d{4})(\.pdf)?$/i.exec(path);
  if (m) {
    const r = await backend(env, 'public.approval', { id: m[1].toUpperCase(), key: q.k || '' });
    if (!r) return html(notFoundPage(site), 404);
    const pdfHref = site.pdf ? `/approvals/${r.id}.pdf?k=${encodeURIComponent(q.k)}` : '';
    if (!m[2]) return html(approvalDoc(site, r, { autoPrint: q.print === '1', pdfHref }), 200);
    if (!site.pdf) return Response.redirect(`${site.url}/approvals/${r.id}?k=${encodeURIComponent(q.k)}&print=1`, 302);
    const buf = await htmlToPdf(env, `approval:${r.id}:${r.status}:${r.fileRef || ''}:v1`, approvalDoc(site, r, { forPrint: true }), {
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: approvalFooterTemplate(site, r),
      margin: { top: '16mm', bottom: '18mm', left: '18mm', right: '18mm' }, preferCSSPageSize: false }, waitUntil);
    return new Response(buf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.id}.pdf"`, 'Cache-Control': 'private, no-store' } });
  }
  m = /^\/letters\/(ABRL-\d{4}-\d{4})(\.pdf)?$/i.exec(path);
  if (m) {
    const l = await backend(env, 'public.letter', { id: m[1].toUpperCase(), key: q.k || '' });
    if (!l) return html(notFoundPage(site), 404);
    if (!m[2]) return html(letterDoc(site, l, { pdfHref: site.pdf ? `/letters/${l.id}.pdf?k=${encodeURIComponent(q.k)}` : '' }), 200);
    if (!site.pdf) return Response.redirect(`${site.url}/letters/${l.id}?k=${encodeURIComponent(q.k)}`, 302);
    const buf = await htmlToPdf(env, `letter:${l.id}:${l.status}:v1`, letterDoc(site, l, { forPrint: true }), {
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: letterFooterTemplate(site, l),
      margin: { top: '16mm', bottom: '20mm', left: '18mm', right: '18mm' }, preferCSSPageSize: false }, waitUntil);
    return new Response(buf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${l.id}.pdf"`, 'Cache-Control': 'private, no-store' } });
  }
  if (path === '/subscribe') return html(subscribePage(site), 200, cacheHeader(3600));
  if (path === '/cobrand') return html(cobrandPage(site), 200, 'no-store');
  if (path === '/subscribe/confirm') {
    const t = url.searchParams.get('t') || '';
    let r = null;
    try { r = t ? await backend(env, 'public.confirmSubscribe', { token: t }) : null; } catch { return html(errorPage(site), 503); }
    if (!r) return html(messagePage(site, 'Link not valid', 'This confirmation link has expired or was already replaced. Please <a href="/subscribe">subscribe again</a>.'), 400);
    return html(messagePage(site, 'You’re subscribed', `Thank you${r.name ? ', ' + escapeHtml(r.name.split(' ')[0]) : ''}. You’ll get a weekly digest of new ABR articles, every new issue and occasional newsletters. A welcome email is on its way.<br><br><a class="btn" href="/subscribe/preferences?t=${encodeURIComponent(r.token || t)}">Choose what you receive</a>`), 200);
  }
  if (path === '/subscribe/preferences') {
    const t = url.searchParams.get('t') || '';
    let d = null;
    try { d = t ? await backend(env, 'public.subPrefs.get', { token: t }) : null; } catch { return html(errorPage(site), 503); }
    return html(preferencesPage(site, d, t), d ? 200 : 400);
  }
  if (path === '/unsubscribe') {
    return html(unsubscribePage(site, url.searchParams.get('t') || ''), 200);
  }
  return null;
}

async function formBody(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await request.json().catch(() => ({}));
  const f = await request.formData().catch(() => null);
  return f ? Object.fromEntries(f) : {};
}

function meta(request) {
  return { ip: request.headers.get('CF-Connecting-IP') || '', ua: (request.headers.get('User-Agent') || '').slice(0, 300) };
}

async function subscribePost(request, env, site) {
  const b = await formBody(request);
  const wantsJson = (request.headers.get('accept') || '').includes('application/json');
  try {
    await backend(env, 'public.subscribe', { email: b.email, name: b.name, website: b.website, source: b.source }, '', meta(request));
    if (wantsJson) return json({ ok: true });
    return html(messagePage(site, 'Check your inbox', 'We’ve sent you an email with a link to confirm your subscription. If it doesn’t arrive in a few minutes, check your spam folder.'), 200);
  } catch (err) {
    const msg = err instanceof BackendError ? err.message : 'Something went wrong. Please try again.';
    if (wantsJson) return json({ ok: false, error: msg });
    return html(messagePage(site, 'Subscription not completed', escapeHtml(msg) + ' <a href="/subscribe">Try again</a>.'), 400);
  }
}

async function unsubscribePost(request, env, site) {
  const b = await formBody(request);
  const url = new URL(request.url);
  const token = b.t || url.searchParams.get('t') || '';
  let r = null;
  try { r = token ? await backend(env, 'public.unsubscribe', { token }) : null; } catch { return html(errorPage(site), 503); }
  if (!r) return html(messagePage(site, 'Link not valid', 'We couldn’t find that subscription. It may already have been removed.'), 400);
  return html(messagePage(site, 'You’ve been unsubscribed', `${escapeHtml(r.email)} will no longer receive ABR emails. You can <a href="/subscribe">subscribe again</a> at any time.`), 200);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function proxy(request, env) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 10 * 1024 * 1024) return json({ ok: false, error: 'Request too large.' }, 413);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }
  if (!body || typeof body.action !== 'string') return json({ ok: false, error: 'Bad request.' }, 400);
  const payload = body.payload || {};
  // Outside submissions are cleaned with the same allow-list sanitizer the site uses for display.
  if (['public.submit', 'public.revise', 'contrib.submit', 'contrib.revise'].includes(body.action) && typeof payload.body === 'string') {
    payload.body = sanitizeHtml(payload.body);
  }
  try {
    let data;
    if (body.action === 'ai.generate') {
      data = await aiGenerate(env, payload, body.token || '', meta(request));
    } else if (body.action === 'analytics.summary') {
      await backend(env, 'analytics.authorize', {}, body.token || '', meta(request));
      data = await analyticsSummary(env, payload.days, payload.path || '');
    } else {
      data = await backend(env, body.action, payload, body.token || '', meta(request));
    }
    return json({ ok: true, data });
  } catch (err) {
    const msg = err instanceof BackendError ? err.message : 'Could not reach the editorial server. Try again.';
    return json({ ok: false, error: msg }, 200);
  }
}

function cacheHeader(seconds) {
  return `public, max-age=60, s-maxage=${seconds}`;
}

function html(body, status = 200, cacheControl = 'no-store') {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl }
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
