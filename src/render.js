import { esc, fmtDate, readingMinutes, truncate, isoWithOffset } from './util.js';
import { articleMeta, citations, articleUrl } from './citation.js';
import { slugify } from './config.js';
import { sanitizeHtml } from '../public/assets/sanitize.js';

/* ---------------- Layout ---------------- */

export function layout(site, { title, description, canonical, head = '', body, bodyClass = '' }) {
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name} — ${site.tagline}`;
  return `<!doctype html>
<html lang="${site.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}" href="${site.url}/feed.xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;1,14..32,400&display=swap">
<link rel="stylesheet" href="/assets/style.css">
${head}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${masthead(site)}
<main id="main">
${body}
</main>
${footer(site)}
<script src="/assets/site.js" defer></script>
</body>
</html>`;
}

function masthead(site) {
  const nav = site.sections.map((s) => `<a href="/section/${slugify(s)}">${esc(s)}</a>`).join('');
  return `<header class="masthead">
  <div class="topbar wrap">
    <span class="today">${fmtDate(new Date().toISOString())}</span>
    <nav class="toplinks" aria-label="About ABR">
      <a href="/about">About</a><a href="/editorial-standards">Editorial standards</a><a href="/contact">Contact</a>
    </nav>
  </div>
  <div class="brandrow wrap">
    <a class="brand" href="/" aria-label="${esc(site.name)} — home">
      <img src="/brand/logo/horizontal/ABR-Horizontal-Black.svg" alt="${esc(site.name)}" width="380" height="41">
    </a>
  </div>
  <nav class="sections wrap" aria-label="Sections">${nav}</nav>
</header>`;
}

export function subscribeForm(source = 'site', compact = false) {
  return `<form class="sub-form${compact ? ' compact' : ''}" method="post" action="/subscribe" data-subscribe>
    <input type="hidden" name="source" value="${esc(source)}">
    <div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
    ${compact ? '' : '<label class="sr" for="sub-name-' + esc(source) + '">Name</label><input id="sub-name-' + esc(source) + '" name="name" type="text" placeholder="Your name" autocomplete="name">'}
    <label class="sr" for="sub-email-${esc(source)}">Email</label>
    <input id="sub-email-${esc(source)}" name="email" type="email" required placeholder="Your email address" autocomplete="email">
    <button class="btn" type="submit">Subscribe</button>
    <p class="sub-msg" role="status" aria-live="polite"></p>
  </form>`;
}

function footer(site) {
  const y = new Date().getFullYear();
  return `<section class="newsletter">
  <div class="wrap newsletter-in">
    <div><h2>Get ABR in your inbox</h2><p>New analysis, interviews and case studies. No spam; unsubscribe any time.</p></div>
    ${subscribeForm('footer', true)}
  </div>
</section>
<footer class="footer">
  <div class="wrap footer-grid">
    <div>
      <div class="footer-brand"><img src="/brand/logo/primary/ABR-Primary-Stacked-White.svg" alt="${esc(site.name)}" width="200" height="71"></div>
      <p class="muted">${esc(site.tagline)}</p>
      <p class="muted">Published by <a href="${esc(site.publisherUrl)}">${esc(site.publisher)}</a>, Ahmedabad, India.${site.issn ? ` ISSN ${esc(site.issn)} (Online).` : ''}</p>
    </div>
    <div>
      <h2 class="footer-h">Sections</h2>
      ${site.sections.map((s) => `<a href="/section/${slugify(s)}">${esc(s)}</a>`).join('')}
    </div>
    <div>
      <h2 class="footer-h">Standards</h2>
      <a href="/about">About ABR</a>
      <a href="/editorial-standards">Editorial standards</a>
      <a href="/corrections">Corrections policy</a>
      <a href="/how-to-cite">How to cite ABR</a>
      <a href="/brand">Brand guidelines</a>
      <a href="/contact">Contact</a>
    </div>
    <div>
      <h2 class="footer-h">Follow</h2>
      <a href="/subscribe">Newsletter</a>
      <a href="/feed.xml">RSS feed</a>
      <a href="/portal/">Editorial portal</a>
    </div>
  </div>
  <div class="wrap footer-base">© ${y} ${esc(site.publisher)}. Articles may be quoted with attribution and a link to the original.</div>
</footer>`;
}

/* ---------------- Components ---------------- */

function byline(authors, linked = true) {
  const names = (authors || []).map((x) => linked ? `<a href="/authors/${esc(x.slug)}">${esc(x.name)}</a>` : esc(x.name));
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function kicker(a) {
  return `<div class="kicker"><a href="/section/${esc(a.sectionSlug || slugify(a.section))}">${esc(a.section)}</a>${a.type ? `<span class="type">${esc(a.type)}</span>` : ''}</div>`;
}

function card(a, variant = '') {
  const img = a.coverUrl && variant !== 'compact'
    ? `<a class="card-img" href="/articles/${esc(a.slug)}" tabindex="-1" aria-hidden="true"><img src="${esc(a.coverUrl)}" alt="" loading="lazy"></a>` : '';
  return `<article class="card ${variant}">
  ${img}
  <div class="card-body">
    ${kicker(a)}
    <h3 class="card-title"><a href="/articles/${esc(a.slug)}">${esc(a.title)}</a></h3>
    ${variant === 'compact' ? '' : `<p class="card-dek">${esc(truncate(a.standfirst, 220))}</p>`}
    <div class="card-meta">${byline(a.authors, false)} · <time datetime="${esc(isoWithOffset(a.publishedAt))}">${fmtDate(a.publishedAt)}</time></div>
  </div>
</article>`;
}

/* ---------------- Pages ---------------- */

export function homePage(site, data) {
  const list = data.articles || [];
  if (!list.length) {
    return layout(site, {
      canonical: site.url + '/', description: site.tagline,
      body: `<section class="wrap empty"><h1>${esc(site.name)}</h1><p class="lede">${esc(site.tagline)}</p><p>Our first articles are on their way.</p></section>`
    });
  }
  const [lead, ...rest] = list;
  const secondary = rest.slice(0, 4);
  const more = rest.slice(4);
  const orgLd = {
    '@context': 'https://schema.org', '@type': 'NewsMediaOrganization', name: site.name, alternateName: site.shortName,
    url: site.url, logo: `${site.url}/brand/logo/primary/ABR-Primary-Stacked-Black.png`,
    parentOrganization: { '@type': 'Organization', name: site.publisher, url: site.publisherUrl },
    publishingPrinciples: `${site.url}/editorial-standards`, correctionsPolicy: `${site.url}/corrections`,
    ethicsPolicy: `${site.url}/editorial-standards`, masthead: `${site.url}/about`
  };
  return layout(site, {
    canonical: site.url + '/', description: site.tagline,
    head: `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(site.name)}"><meta property="og:title" content="${esc(site.name)}"><meta property="og:description" content="${esc(site.tagline)}"><meta property="og:url" content="${site.url}/">
<script type="application/ld+json">${JSON.stringify(orgLd)}</script>`,
    body: `<div class="wrap">
  <section class="lead-grid">
    <article class="lead${lead.coverUrl ? '' : ' noimg'}">
      ${lead.coverUrl ? `<a class="lead-img" href="/articles/${esc(lead.slug)}"><img src="${esc(lead.coverUrl)}" alt="${esc(lead.coverCaption || '')}"></a>` : ''}
      ${kicker(lead)}
      <h2 class="lead-title"><a href="/articles/${esc(lead.slug)}">${esc(lead.title)}</a></h2>
      <p class="lead-dek">${esc(lead.standfirst)}</p>
      <div class="card-meta">By ${byline(lead.authors, false)} · ${fmtDate(lead.publishedAt)} · ${readingMinutes(lead.wordCount)} min read</div>
    </article>
    <div class="secondary">${secondary.map((a) => card(a, 'compact')).join('')}</div>
  </section>
  ${more.length ? `<section class="more"><h2 class="rule-h">Latest</h2><div class="grid">${more.map((a) => card(a)).join('')}</div></section>` : ''}
</div>`
  });
}

export function listPage(site, { title, intro, articles, canonical, page, total, perPage, basePath }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const pager = pages > 1 ? `<nav class="pager" aria-label="Pagination">
    ${page > 1 ? `<a href="${basePath}${page - 1 > 1 ? `?page=${page - 1}` : ''}">← Newer</a>` : '<span></span>'}
    <span>Page ${page} of ${pages}</span>
    ${page < pages ? `<a href="${basePath}?page=${page + 1}">Older →</a>` : '<span></span>'}
  </nav>` : '';
  return layout(site, {
    title, canonical, description: intro,
    body: `<div class="wrap">
  <header class="page-head"><h1>${esc(title)}</h1>${intro ? `<p class="lede">${esc(intro)}</p>` : ''}</header>
  ${articles.length ? `<div class="grid">${articles.map((a) => card(a)).join('')}</div>` : '<p class="muted">No articles here yet.</p>'}
  ${pager}
</div>`
  });
}

export function articlePage(site, a) {
  const url = articleUrl(site, a);
  const body = sanitizeHtml(a.body);
  const cites = citations(site, a);
  const updated = a.modifiedAt && a.modifiedAt.slice(0, 10) !== a.publishedAt.slice(0, 10);

  const sources = (a.sources || []).length ? `<section class="sources" aria-labelledby="refs">
    <h2 id="refs">Sources and references</h2>
    <ol>${a.sources.map((s) => `<li>${linkify(s)}</li>`).join('')}</ol>
  </section>` : '';

  const authorsBox = (a.authors || []).map((x) => `<div class="author-box">
    ${x.photoUrl ? `<img src="${esc(x.photoUrl)}" alt="" class="avatar">` : `<span class="avatar ph">${esc((x.name || '?')[0])}</span>`}
    <div><a class="author-name" href="/authors/${esc(x.slug)}">${esc(x.name)}</a>${x.title ? ` <span class="muted">· ${esc(x.title)}, ${esc(site.shortName)}</span>` : ''}
    ${x.bio ? `<p>${esc(x.bio)}</p>` : ''}</div>
  </div>`).join('');

  const citeTabs = cites.map((c, i) => `<button type="button" role="tab" class="cite-tab${i ? '' : ' on'}" data-cite="${c.id}" aria-selected="${i ? 'false' : 'true'}">${c.label}</button>`).join('');
  const citeBodies = cites.map((c, i) => `<div class="cite-text${i ? '' : ' on'}" data-cite-body="${c.id}" role="tabpanel">${c.pre ? `<pre>${c.html}</pre>` : `<p>${c.html}</p>`}</div>`).join('');

  return layout(site, {
    title: a.title,
    description: a.standfirst,
    canonical: url,
    head: articleMeta(site, a),
    bodyClass: 'article-view',
    body: `<article class="article">
  <header class="article-head narrow">
    ${kicker(a)}
    <h1 class="article-title">${esc(a.title)}</h1>
    ${a.standfirst ? `<p class="standfirst">${esc(a.standfirst)}</p>` : ''}
    <div class="byline">
      <div>By <span>${byline(a.authors)}</span></div>
      <div class="dates">
        Published <time datetime="${esc(isoWithOffset(a.publishedAt))}">${fmtDate(a.publishedAt)}</time>
        ${updated ? ` · Updated <time datetime="${esc(isoWithOffset(a.modifiedAt))}">${fmtDate(a.modifiedAt)}</time>` : ''}
        · ${readingMinutes(a.wordCount)} min read
      </div>
      <div class="article-id">${esc(a.id)}</div>
    </div>
    ${a.type === 'Opinion' ? `<p class="notice">Opinion: the views expressed are the author’s own and do not necessarily reflect those of ${esc(site.name)} or ${esc(site.publisherShort)}.</p>` : ''}
    ${a.correction ? `<p class="notice correction-top"><a href="#correction">This article has been corrected.</a></p>` : ''}
  </header>
  ${a.coverUrl ? `<figure class="cover"><img src="${esc(a.coverUrl)}" alt="${esc(a.coverCaption || '')}">${a.coverCaption ? `<figcaption>${esc(a.coverCaption)}</figcaption>` : ''}</figure>` : ''}
  <div class="article-body narrow">
    ${body}
  </div>
  <footer class="article-foot narrow">
    ${a.correction ? `<aside id="correction" class="box correction"><h2>Correction</h2><p>${esc(a.correction)}</p></aside>` : ''}
    ${a.disclosure ? `<aside class="box disclosure"><h2>Disclosure</h2><p>${esc(a.disclosure)}</p></aside>` : ''}
    ${sources}
    ${(a.tags || []).length ? `<p class="tags">${a.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
    <section class="authors">${authorsBox}</section>
    <section class="sub-box"><h2>Enjoyed this? Get ABR by email</h2>${subscribeForm('article', true)}</section>
    <section class="cite" aria-labelledby="cite-h">
      <div class="cite-head"><h2 id="cite-h">Cite this article</h2><button type="button" class="btn" data-copy-cite>Copy citation</button></div>
      <div class="cite-tabs" role="tablist">${citeTabs}</div>
      ${citeBodies}
      <p class="muted small">Permanent link: <a href="${url}">${url}</a> · Article ID ${esc(a.id)}</p>
    </section>
  </footer>
</article>`
  });
}

export function withdrawnPage(site, a) {
  return layout(site, {
    title: `Withdrawn: ${a.title}`,
    canonical: `${site.url}/articles/${a.slug}`,
    head: '<meta name="robots" content="noindex">',
    body: `<div class="narrow page-pad">
  <p class="kicker">Withdrawn article</p>
  <h1 class="article-title">${esc(a.title)}</h1>
  <aside class="box correction">
    <p>This article (${esc(a.id)}), first published on ${fmtDate(a.publishedAt)}, was withdrawn by ${esc(site.name)} on ${fmtDate(a.withdrawnAt)}.</p>
    ${a.reason ? `<p><b>Reason:</b> ${esc(a.reason)}</p>` : ''}
    <p>See our <a href="/corrections">corrections policy</a>.</p>
  </aside>
</div>`
  });
}

export function authorPage(site, data) {
  const x = data.author;
  const ld = { '@context': 'https://schema.org', '@type': 'ProfilePage',
    mainEntity: { '@type': 'Person', name: x.name, jobTitle: x.title, description: x.bio || undefined, image: x.photoUrl || undefined,
      worksFor: { '@type': 'Organization', name: site.name }, url: `${site.url}/authors/${x.slug}` } };
  return layout(site, {
    title: x.name, description: x.bio ? truncate(x.bio, 160) : `${x.name}, ${x.title}, ${site.name}`,
    canonical: `${site.url}/authors/${x.slug}`,
    head: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
    body: `<div class="wrap">
  <header class="profile">
    ${x.photoUrl ? `<img src="${esc(x.photoUrl)}" alt="" class="avatar lg">` : `<span class="avatar lg ph">${esc((x.name || '?')[0])}</span>`}
    <div><h1>${esc(x.name)}</h1><p class="muted">${esc(x.title)}, ${esc(site.name)}</p>${x.bio ? `<p class="bio">${esc(x.bio)}</p>` : ''}</div>
  </header>
  <h2 class="rule-h">Articles</h2>
  ${data.articles.length ? `<div class="grid">${data.articles.map((a) => card(a)).join('')}</div>` : '<p class="muted">No published articles yet.</p>'}
</div>`
  });
}

export function staticPage(site, page, extraHtml = '') {
  return layout(site, {
    title: page.title, description: page.description, canonical: `${site.url}/${page.slug}`,
    body: `<div class="${page.wide ? 'wrap' : 'narrow'} page-pad prose">
  <h1>${esc(page.title)}</h1>
  ${page.html(site)}
  ${extraHtml}
</div>`
  });
}

export function teamHtml(team) {
  if (!team || !team.length) return '';
  return `<h2>Editorial leadership</h2><div class="team">${team.map((x) => `<a class="team-card" href="/authors/${esc(x.slug)}">
    ${x.photoUrl ? `<img src="${esc(x.photoUrl)}" alt="" class="avatar">` : `<span class="avatar ph">${esc((x.name || '?')[0])}</span>`}
    <span><b>${esc(x.name)}</b><br><span class="muted">${esc(x.title)}</span></span></a>`).join('')}</div>`;
}

export function notFoundPage(site) {
  return layout(site, {
    title: 'Page not found',
    head: '<meta name="robots" content="noindex">',
    body: `<div class="narrow page-pad"><h1>Page not found</h1><p>The page you were looking for doesn’t exist or has moved. <a href="/">Go to the homepage</a>.</p></div>`
  });
}

export function errorPage(site) {
  return layout(site, {
    title: 'Temporarily unavailable',
    head: '<meta name="robots" content="noindex">',
    body: `<div class="narrow page-pad"><h1>We’ll be right back</h1><p>This page couldn’t be loaded just now. Please refresh in a moment.</p></div>`
  });
}

function linkify(text) {
  const parts = String(text).split(/(https?:\/\/[^\s<>"]+)/g);
  return parts.map((p, i) => i % 2
    ? `<a href="${esc(p.replace(/[.,;)]+$/, ''))}" rel="noopener nofollow" target="_blank">${esc(p)}</a>`
    : esc(p)).join('');
}

/* ---------------- Feeds ---------------- */

export function rssFeed(site, articles) {
  const x = (s) => esc(s);
  const items = articles.map((a) => `<item>
  <title>${x(a.title)}</title>
  <link>${site.url}/articles/${x(a.slug)}</link>
  <guid isPermaLink="true">${site.url}/articles/${x(a.slug)}</guid>
  <pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>
  ${(a.authors || []).map((au) => `<dc:creator>${x(au.name)}</dc:creator>`).join('')}
  <category>${x(a.section)}</category>
  <description>${x(a.standfirst)}</description>
</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${x(site.name)}</title>
<link>${site.url}/</link>
<atom:link href="${site.url}/feed.xml" rel="self" type="application/rss+xml"/>
<description>${x(site.tagline)}</description>
<language>en-in</language>
<copyright>© ${new Date().getFullYear()} ${x(site.publisher)}</copyright>
${items}
</channel>
</rss>`;
}

export function sitemap(site, data, staticSlugs) {
  const urls = [
    { loc: `${site.url}/`, lastmod: '' },
    ...staticSlugs.map((s) => ({ loc: `${site.url}/${s}` })),
    ...data.sections.map((s) => ({ loc: `${site.url}/section/${slugify(s)}` })),
    ...data.authors.map((a) => ({ loc: `${site.url}/authors/${a.slug}` })),
    ...data.articles.map((a) => ({ loc: `${site.url}/articles/${a.slug}`, lastmod: (a.modifiedAt || a.publishedAt || '').slice(0, 10) }))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;
}

export function messagePage(site, title, html) {
  return layout(site, {
    title, head: '<meta name="robots" content="noindex">',
    body: `<div class="narrow page-pad prose"><h1>${esc(title)}</h1><p>${html}</p><p><a href="/">Go to the homepage</a></p></div>`
  });
}

export function subscribePage(site) {
  return layout(site, {
    title: 'Subscribe', canonical: `${site.url}/subscribe`,
    description: `Subscribe to ${site.name} by email.`,
    body: `<div class="narrow page-pad prose">
  <h1>Subscribe to ABR</h1>
  <p class="lede">Get new analysis, interviews and case studies from ${esc(site.name)} by email.</p>
  ${subscribeForm('subscribe-page')}
  <p class="muted small">We’ll email you a link to confirm. Every email has an unsubscribe link, and we never share your address.</p>
</div>`
  });
}

export function unsubscribePage(site, token) {
  return layout(site, {
    title: 'Unsubscribe', head: '<meta name="robots" content="noindex">',
    body: `<div class="narrow page-pad prose">
  <h1>Unsubscribe</h1>
  <p>Click below to stop receiving emails from ${esc(site.name)}.</p>
  <form method="post" action="/unsubscribe"><input type="hidden" name="t" value="${esc(token)}"><button class="btn" type="submit">Unsubscribe me</button></form>
</div>`
  });
}
