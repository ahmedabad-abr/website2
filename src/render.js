import { esc, fmtDate, readingMinutes, truncate, isoWithOffset, volumeIssue, articleVI } from './util.js';
import { articleMeta, citations, articleUrl, pdfUrl } from './citation.js';
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
      <a href="/about">About</a><a href="/issues">Issues</a><a href="/archive">Archive</a><a href="/submit">Write for ABR</a><a href="/editorial-standards">Editorial standards</a><a href="/contact">Contact</a>
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
      <a href="/archive">Archive (all issues)</a>
      <a href="/how-to-cite">How to cite ABR</a>
      <a href="/brand">Brand guidelines</a>
      <a href="/contact">Contact</a>
    </div>
    <div>
      <h2 class="footer-h">Take part</h2>
      <a href="/submit">Write for ABR</a>
      <a href="/track">Track a submission</a>
      <a href="/issues">Issues</a>
      <a href="/verify">Verify a certificate or letter</a>
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
  const names = (authors || []).map((x) => linked && x.slug ? `<a href="/authors/${esc(x.slug)}">${esc(x.name)}</a>` : esc(x.name));
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// "By Jane Doe" for named authors; "Curated by Ahmedabad Business Review" for desk articles.
function byPrefix(a) {
  return a.curated ? 'Curated by' : 'By';
}

function kicker(a) {
  const pl = a.partner ? `<span class="pl ${a.partner.type === 'promoted' ? 'promoted' : 'partner'}">${a.partner.type === 'promoted' ? 'Promoted' : 'Partner'}</span>` : '';
  return `<div class="kicker">${pl}<a href="/section/${esc(a.sectionSlug || slugify(a.section))}">${esc(a.section)}</a>${a.type ? `<span class="type">${esc(a.type)}</span>` : ''}</div>`;
}

// "In partnership with X" / "Promoted · Supported by X" strip shown under the headline.
function partnerStrip(a) {
  const x = a.partner;
  if (!x) return '';
  const promoted = x.type === 'promoted';
  const name = x.website ? `<a href="${esc(x.website)}" rel="${promoted ? 'sponsored ' : ''}noopener" target="_blank">${esc(x.name)}</a>` : esc(x.name);
  return `<div class="partner-strip ${promoted ? 'promoted' : ''}">
    ${x.logoUrl ? `<img src="${esc(x.logoUrl)}" alt="${esc(x.name)} logo" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <span>${promoted ? `<b>Promoted</b> · Supported by ${name}` : `In partnership with ${name}`}</span>
    <a class="why" href="/partner-content">What this means</a>
  </div>`;
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
      <div class="card-meta">${byPrefix(lead)} ${byline(lead.authors, false)} · ${fmtDate(lead.publishedAt)} · ${readingMinutes(lead.wordCount)} min read</div>
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
  let body = sanitizeHtml(a.body);
  // Links in promoted articles are paid placements: mark them rel="sponsored" for search engines.
  if (a.partner && a.partner.type === 'promoted') {
    body = body.replace(/<a\b([^>]*)>/gi, (m0, attrs) => `<a${attrs.replace(/\srel="[^"]*"/i, '')} rel="sponsored noopener">`);
  }
  const cites = citations(site, a);
  const updated = a.modifiedAt && a.modifiedAt.slice(0, 10) !== a.publishedAt.slice(0, 10);

  const sources = (a.sources || []).length ? `<section class="sources" aria-labelledby="refs">
    <h2 id="refs">References</h2>
    <ol>${a.sources.map((s) => `<li>${linkify(s)}</li>`).join('')}</ol>
  </section>` : '';

  const authorsBox = (a.authors || []).map((x) => x.corporate ? `<div class="author-box">
    <img src="/brand/logo/emblem/ABR-Emblem-Black.svg" alt="" class="avatar org">
    <div><span class="author-name">Curated by ${esc(x.name)}</span> <span class="muted">· ${esc(x.title || 'Editorial Desk')}</span>
    <p>${esc(x.bio || '')} <a href="/editorial-standards">How we work</a>.</p></div>
  </div>` : `<div class="author-box">
    ${x.photoUrl ? `<img src="${esc(x.photoUrl)}" alt="" class="avatar">` : `<span class="avatar ph">${esc((x.name || '?')[0])}</span>`}
    <div>${x.slug ? `<a class="author-name" href="/authors/${esc(x.slug)}">${esc(x.name)}</a>` : `<span class="author-name">${esc(x.name)}</span>`}${x.external ? ` <span class="muted">· Contributor${x.affiliation ? ', ' + esc(x.affiliation) : ''}</span>` : x.title ? ` <span class="muted">· ${esc(x.title)}, ${esc(site.shortName)}</span>` : ''}
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
    ${partnerStrip(a)}
    <div class="byline">
      <div>${byPrefix(a)} <span>${byline(a.authors)}</span></div>
      <div class="dates">
        Published <time datetime="${esc(isoWithOffset(a.publishedAt))}">${fmtDate(a.publishedAt)}</time>
        ${updated ? ` · Updated <time datetime="${esc(isoWithOffset(a.modifiedAt))}">${fmtDate(a.modifiedAt)}</time>` : ''}
        · ${readingMinutes(a.wordCount)} min read
      </div>
      <div class="article-id">${esc(a.id)}${(() => { const vi = articleVI(site, a); return vi ? ` · <a href="${a.issue ? `/issues/${esc(a.issue.key)}` : `/archive#${vi.volume ? `v${vi.volume}-n${vi.issue}` : `y${vi.year}`}`}">${esc(vi.label)}</a>` : ''; })()}${a.doi ? ` · DOI <a href="https://doi.org/${esc(a.doi)}">${esc(a.doi)}</a>` : ''}</div>
    </div>
    <div class="article-actions">
      <a class="btn" href="${site.pdf ? esc(pdfUrl(site, a)) : `/articles/${esc(a.slug)}/paper`}"${site.pdf ? ' download' : ''}>Download PDF</a>
      <a class="btn ghost" href="#cite-h">Cite</a>
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
    { loc: `${site.url}/archive` },
    { loc: `${site.url}/issues` },
    { loc: `${site.url}/submit` },
    ...(data.issues || []).map((i) => ({ loc: `${site.url}/issues/${i.key}`, lastmod: (i.compiledAt || '').slice(0, 10) })),
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

export function archivePage(site, articles) {
  const groups = new Map();
  for (const a of articles) {
    const vi = articleVI(site, a);
    if (!vi) continue;
    const key = vi.volume ? `v${vi.volume}-n${vi.issue}` : `y${vi.year}`;
    if (!groups.has(key)) groups.set(key, { vi, items: [] });
    groups.get(key).items.push(a);
  }
  const sorted = [...groups.entries()].sort((x, y) => (y[1].items[0].publishedAt || '').localeCompare(x[1].items[0].publishedAt || ''));
  const body = sorted.map(([key, g]) => `<section class="issue" id="${key}">
    <h2 class="issue-h">${esc(g.vi.label)} <span class="muted">· ${g.items.length} article${g.items.length === 1 ? '' : 's'}</span></h2>
    <ol class="toc">${g.items.sort((a, b) => (a.publishedAt || '').localeCompare(b.publishedAt || '')).map((a) => `<li>
      <a class="toc-title" href="/articles/${esc(a.slug)}">${esc(a.title)}</a>
      <div class="toc-meta">${esc((a.authors || []).map((x) => x.name).join(', '))} · ${esc(a.section || '')}${a.type ? ` · ${esc(a.type)}` : ''} · ${fmtDate(a.publishedAt)} · ${esc(a.id)}
        · <a href="${site.pdf ? esc(pdfUrl(site, a)) : `/articles/${esc(a.slug)}/paper`}">PDF</a></div>
    </li>`).join('')}</ol>
  </section>`).join('');
  return layout(site, {
    title: 'Archive', canonical: `${site.url}/archive`,
    description: `Every article published in ${site.name}, by volume and issue.`,
    body: `<div class="narrow page-pad">
  <h1 class="archive-h">Archive</h1>
  <p class="lede">Every article published in ${esc(site.name)}, by volume and issue.${site.issn ? ` ISSN ${esc(site.issn)} (Online).` : ''}</p>
  ${body || '<p class="muted">No articles yet.</p>'}
</div>`
  });
}

export function partnersPage(site, partners) {
  const grid = partners.length ? `<div class="partners-grid">${partners.map((x) => `<div class="p">
    ${x.logoUrl ? `<img src="${esc(x.logoUrl)}" alt="${esc(x.name)} logo" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ''}
    <b>${x.website ? `<a href="${esc(x.website)}" rel="noopener" target="_blank">${esc(x.name)}</a>` : esc(x.name)}</b>
  </div>`).join('')}</div>` : '<p class="muted">Our partner list will appear here.</p>';
  return layout(site, {
    title: 'Partners',
    description: `Organisations that work with ${site.name}.`,
    canonical: `${site.url}/partners`,
    body: `<section class="page narrow">
  <h1>Partners</h1>
  <p class="lede">Organisations we work with on articles, research and events. Read <a href="/partner-content">how we label partner and promoted content</a>.</p>
  ${grid}
  <p class="muted small">Are you a partner? Make your co-branded logo kit with the <a href="/cobrand">co-brand kit tool</a>.</p>
</section>`
  });
}

export function cobrandPage(site) {
  return layout(site, {
    title: 'Co-brand kit',
    description: `Make a co-branded ${site.name} logo kit for partners.`,
    canonical: `${site.url}/cobrand`,
    head: '<meta name="robots" content="noindex">',
    bodyClass: 'cobrand-view',
    body: `<section class="page narrow cobrand">
  <h1>Partner co-brand kit</h1>
  <p class="lede">Upload your logo and we’ll build ABR co-brand lockups to our <a href="/brand">brand standards</a>: trimmed, scaled and spaced automatically, in light and dark versions.</p>
  <div class="cb-step" id="cbCodeStep">
    <h2>1. Enter your partner code</h2>
    <p class="muted">ABR sends this code to each partner. It looks like <code>ABCDE-FGH23</code>.</p>
    <form id="cbCodeForm" class="cb-row"><input id="cbCode" autocomplete="off" placeholder="Partner code" required><button class="btn">Continue</button></form>
    <p class="cb-msg" id="cbCodeMsg"></p>
  </div>
  <div class="cb-step" id="cbLogoStep" hidden>
    <h2>2. Upload your logo</h2>
    <p class="muted">Partner: <b id="cbName"></b>. Use a PNG with a transparent background if you have one (SVG and JPG also work). At least 600&nbsp;px wide is best.</p>
    <input type="file" id="cbFile" accept="image/png,image/svg+xml,image/jpeg,image/webp">
    <p class="cb-msg" id="cbLogoMsg"></p>
  </div>
  <div class="cb-step" id="cbPreviewStep" hidden>
    <h2>3. Check and download</h2>
    <div class="cb-previews" id="cbPreviews"></div>
    <label class="cb-check"><input type="checkbox" id="cbAgree"> I will use these files only as set out in ABR’s brand guidelines and the README in the kit.</label>
    <div class="cb-row"><button class="btn" id="cbDownload" disabled>Download co-brand kit (.zip)</button></div>
    <p class="cb-msg" id="cbDlMsg"></p>
  </div>
</section>
<script src="/assets/cobrand.js" defer></script>`
  });
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

const COVER_BG = { ink: '#111', saffron: '#e8902a', indigo: '#1f2a5c', forest: '#1e4d3a', terracotta: '#a8442a', slate: '#e7e4dc' };

export function issuesPage(site, issues) {
  const grid = issues.length ? `<div class="issue-grid">${issues.map((i) => `<a class="issue-card" href="/issues/${esc(i.key)}">
    <span class="ic-cover" style="background:${COVER_BG[i.coverStyle] || '#111'}">${site.pdf ? `<img src="/issues/${esc(i.key)}/cover.png?v=${esc((i.compiledAt || '').slice(0, 19))}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <span class="ic-label ${i.coverStyle === 'slate' || i.coverStyle === 'saffron' ? 'dark' : ''}">Vol. ${i.volume} · No. ${i.number}<b>${esc(i.title || i.months + ' ' + i.year)}</b></span></span>
    <span class="ic-meta"><b>${esc(i.label)}</b><br>${i.articles.length} article${i.articles.length === 1 ? '' : 's'}</span></a>`).join('')}</div>`
    : '<p class="muted">The first compiled issue will appear here.</p>';
  return layout(site, {
    title: 'Issues', description: `Compiled issues of ${site.name}, with the Chair’s foreword and every article, as downloadable PDFs.`,
    canonical: `${site.url}/issues`,
    body: `<section class="page wrap"><h1>Issues</h1>
    <p class="lede narrow-l">${esc(site.name)} publishes articles online as soon as they are approved. Every two months they are gathered into an issue with a foreword, a cover and a downloadable PDF, so the publication keeps the feel of a magazine. See the <a href="/archive">archive</a> for every article by date.</p>
    ${grid}</section>`
  });
}

export function issuePage(site, i) {
  const statements = [i.chairStatement ? { h: 'From the Chair', name: i.chair && i.chair.name, title: i.chair && i.chair.title, text: i.chairStatement } : null,
    ...(i.statements || []).map((s) => ({ h: s.role === 'eic' ? 'From the Editor-in-Chief' : s.role === 'coo' ? 'From the COO' : `From ${s.name}`, name: s.name, title: s.title, text: s.text }))].filter(Boolean);
  const para = (t) => String(t || '').split(/\n\s*\n/).map((b) => `<p>${esc(b.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  return layout(site, {
    title: `${i.label}${i.title ? ': ' + i.title : ''}`,
    description: i.theme || `${site.name}, ${i.label}.`,
    canonical: `${site.url}/issues/${i.key}`,
    head: site.pdf ? `<meta property="og:image" content="${site.url}/issues/${esc(i.key)}/cover.png">` : '',
    body: `<section class="page wrap issue-view">
  <div class="issue-head">
    <div class="ih-cover" style="background:${COVER_BG[i.coverStyle] || '#111'}">${site.pdf ? `<img src="/issues/${esc(i.key)}/cover.png?v=${esc((i.compiledAt || '').slice(0, 19))}" alt="Cover of ${esc(i.label)}" onerror="this.remove()">` : ''}
      <span class="ic-label ${i.coverStyle === 'slate' || i.coverStyle === 'saffron' ? 'dark' : ''}"><img src="/brand/logo/primary/ABR-Primary-Stacked-${i.coverStyle === 'slate' || i.coverStyle === 'saffron' ? 'Black' : 'White'}.svg" alt="" class="ic-logo">Vol. ${i.volume} · No. ${i.number}<b>${esc(i.title || i.months + ' ' + i.year)}</b></span></div>
    <div>
      <div class="kicker"><span class="type">Vol. ${i.volume} · No. ${i.number} · ${esc(i.months)} ${i.year}</span></div>
      <h1>${esc(i.title || i.label)}</h1>
      ${i.theme ? `<p class="lede">${esc(i.theme)}</p>` : ''}
      <div class="article-actions">
        <a class="btn" href="${site.pdf ? `/issues/${esc(i.key)}.pdf` : `/issues/${esc(i.key)}/print`}">Download the issue (PDF)</a>
        <a class="btn ghost" href="/issues/${esc(i.key)}/print">Read as print edition</a>
      </div>
      <p class="muted small">${i.articles.length} article${i.articles.length === 1 ? '' : 's'} · Published ${fmtDate(i.publishedAt)}</p>
    </div>
  </div>
  ${statements.map((s) => `<article class="statement narrow"><h2>${esc(s.h)}</h2>${para(s.text)}<p class="sig"><b>${esc(s.name || '')}</b><br><span class="muted">${esc(s.title || '')}</span></p></article>`).join('')}
  <h2 class="section-h">In this issue</h2>
  <div class="list">${i.articles.map((a) => card(a)).join("")}</div>
</section>`
  });
}

/* ------------------------------------------------------------------ */
/* Write for ABR, tracking and verification                            */
/* ------------------------------------------------------------------ */

export function submitPage(site, cfg) {
  return layout(site, {
    title: 'Write for ABR', description: `Pitch or submit an article to ${site.name}.`, canonical: `${site.url}/submit`,
    bodyClass: 'submit-view',
    body: `<section class="page narrow submit">
  <h1>Write for ABR</h1>
  <p class="lede">We publish evidence-based analysis, case studies and explainers on business, entrepreneurship, innovation, leadership and policy, with a focus on Ahmedabad, Gujarat and India. Students, researchers and practitioners are all welcome.</p>
  <div class="box"><h2>Before you submit</h2><ul>
    <li>Original work, not published elsewhere (including blogs and LinkedIn), 800–2,500 words is ideal.</li>
    <li>Every figure and claim must be sourced. Analyses, case studies, explainers and research briefs need at least ${cfg.minRefs || 2} references.</li>
    <li>Read our <a href="/editorial-standards">editorial standards</a>. Tell us if you used AI tools, and about any conflict of interest.</li>
    <li>Editors may edit for length, clarity and style. You will see the final version before it goes live if changes are substantial.</li>
    <li>Published contributors receive a certificate of publication with a verifiable ID.</li>
  </ul></div>
  <form id="subForm" class="sub-form" novalidate>
    <fieldset><legend>About you</legend>
      <label>Full name<input name="name" required maxlength="120" autocomplete="name"></label>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Affiliation <span class="muted">(college, company or "Independent")</span><input name="affiliation" maxlength="160"></label>
      <label>Short bio <span class="muted">(2–3 sentences, shown with your article)</span><textarea name="bio" rows="3" maxlength="500"></textarea></label>
      <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    </fieldset>
    <fieldset><legend>Your article</legend>
      <label>Title<input name="title" required maxlength="250"></label>
      <label>Standfirst <span class="muted">(one or two sentences summarising the argument)</span><textarea name="standfirst" rows="2" maxlength="600"></textarea></label>
      <div class="two"><label>Section<select name="section"><option value="">Choose…</option>${(cfg.sections || site.sections).map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label>Type<select name="type"><option value="">Choose…</option>${(cfg.types || []).filter((t) => t !== 'Interview').map((s) => `<option>${esc(s)}</option>`).join('')}</select></label></div>
      <label>Article <span class="muted">(paste from Word or Google Docs; headings and bold are kept)</span></label>
      <div id="subBody" class="sub-editor" contenteditable="true" data-placeholder="Paste or write your article here…"></div>
      <div class="muted small" id="subCount">0 words</div>
      <label>References <span class="muted">(one per line, with links)</span><textarea name="sources" rows="6"></textarea></label>
      <label>Disclosures <span class="muted">(AI use, funding, affiliations, conflicts of interest)</span><textarea name="disclosure" rows="2" maxlength="1000"></textarea></label>
    </fieldset>
    <fieldset><legend>Declarations</legend>
      <label class="chk"><input type="checkbox" name="original"> This is my original work and does not infringe anyone’s rights.</label>
      <label class="chk"><input type="checkbox" name="exclusive"> It has not been published elsewhere and is not under review elsewhere.</label>
      <label class="chk"><input type="checkbox" name="edit"> I agree that ABR may edit it and publish it online, in issues and in PDF form, with my name.</label>
      <label class="chk"><input type="checkbox" name="guidelines"> I have read the editorial standards, and my disclosures above are complete.</label>
    </fieldset>
    <button class="btn" id="subBtn">Submit article</button>
    <p class="sub-msg" id="subMsg" role="status"></p>
  </form>
  <div id="subDone" hidden class="box"><h2>Thank you</h2><p>Your submission <b id="subId"></b> has been received. We have emailed you a private tracking link.</p><p><a class="btn" id="subTrack" href="/track">Track your submission</a></p></div>
</section>
<script src="/assets/submit.js" type="module"></script>`
  });
}

export function trackPage(site, t, q, error) {
  const steps = t ? t.steps.map((s) => `<li><time>${fmtDate(s.at)}</time><b>${esc(s.label)}</b>${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</li>`).join('') : '';
  const statusText = t ? ({ submitted: 'Under review', changes_requested: 'Changes requested', rejected: 'Not accepted', published: 'Published', withdrawn: 'Withdrawn', draft: 'Draft' })[t.status] || t.status : '';
  return layout(site, {
    title: 'Track a submission', canonical: `${site.url}/track`, head: '<meta name="robots" content="noindex">',
    body: `<section class="page narrow track">
  <h1>Track a submission</h1>
  ${t ? `<div class="track-card">
    <div class="muted small">${esc(t.id)} · submitted ${fmtDate(t.submittedAt)}</div>
    <h2>${esc(t.title)}</h2>
    <p class="status st-${esc(t.status)}">${esc(statusText)}</p>
    ${t.url ? `<p><a class="btn" href="${esc(t.url)}">Read the published article</a> ${t.certificate ? `<a class="btn ghost" href="/certificates/${esc(t.certificate)}">Your certificate</a>` : ''}</p>` : ''}
    <ol class="timeline">${steps}</ol>
  </div>
  ${t.canRevise ? `<form id="revForm" class="sub-form" data-id="${esc(t.id)}" data-key="${esc(q.key)}">
    <h2>Send your revised version</h2>
    ${t.note ? `<div class="box"><b>Editors’ note:</b><p>${esc(t.note).replace(/\n/g, '<br>')}</p></div>` : ''}
    <label>Article</label><div id="subBody" class="sub-editor" contenteditable="true" data-placeholder="Paste your revised article here…"></div>
    <div class="muted small" id="subCount">0 words</div>
    <label>References <span class="muted">(one per line)</span><textarea name="sources" rows="5"></textarea></label>
    <label>Note to the editors <span class="muted">(what you changed)</span><textarea name="message" rows="3" maxlength="500"></textarea></label>
    <button class="btn" id="subBtn">Send revision</button><p class="sub-msg" id="subMsg" role="status"></p>
  </form>
  <script src="/assets/submit.js" type="module"></script>` : ''}`
  : `<p class="lede">Enter the tracking ID and key from your confirmation email.</p>
  ${error ? `<p class="notice">${esc(error)}</p>` : ''}
  <form class="track-form" method="get" action="/track">
    <label>Tracking ID<input name="id" value="${esc(q.id || '')}" placeholder="ABR-2026-0012" required></label>
    <label>Key<input name="key" value="${esc(q.key || '')}" placeholder="8 characters" required></label>
    <button class="btn">Track</button>
  </form>`}
</section>`
  });
}

export function verifyPage(site, ref, r) {
  let result = '';
  if (ref && r) {
    if (r.kind === 'certificate') {
      const c = r.record, ok = c.status === 'valid';
      result = `<div class="verify ${ok ? 'ok' : 'bad'}"><h2>${ok ? '✓ Genuine certificate' : '✗ This certificate has been revoked'}</h2>
        <dl><dt>Reference</dt><dd>${esc(c.id)}</dd><dt>Issued to</dt><dd>${esc(c.name)}</dd><dt>Certificate</dt><dd>${esc(c.typeLabel)}</dd>
        <dt>Issued</dt><dd>${fmtDate(c.issuedAt)}</dd>${!ok && c.note ? `<dt>Reason</dt><dd>${esc(c.note)}</dd>` : ''}</dl>
        ${ok ? `<p><a class="btn" href="/certificates/${esc(c.id)}">View certificate</a></p>` : ''}</div>`;
    } else if (r.kind === 'letter') {
      const l = r.record, ok = l.status === 'issued';
      result = `<div class="verify ${ok ? 'ok' : 'bad'}"><h2>${ok ? '✓ Genuine letter' : '✗ This letter has been revoked'}</h2>
        <dl><dt>Reference</dt><dd>${esc(l.id)}</dd><dt>Dated</dt><dd>${fmtDate(l.date + 'T12:00:00+05:30')}</dd><dt>Addressed to</dt><dd>${esc(l.to || '—')}</dd>
        <dt>Subject</dt><dd>${esc(l.subject)}</dd><dt>Signed by</dt><dd>${esc(l.signName)}, ${esc(l.signTitle)}</dd></dl>
        <p class="muted small">For privacy, the contents of letters are not shown here. Compare these details with the letter you hold.</p></div>`;
    } else if (r.kind === 'article') {
      result = `<div class="verify ok"><h2>✓ Published article</h2><dl><dt>Article</dt><dd>${esc(r.record.id)}</dd><dt>Title</dt><dd><a href="/articles/${esc(r.record.slug)}">${esc(r.record.title)}</a></dd><dt>Published</dt><dd>${fmtDate(r.record.publishedAt)}</dd></dl></div>`;
    } else {
      result = `<div class="verify bad"><h2>✗ No record found</h2><p>We have no certificate, letter or article with the reference <b>${esc(ref)}</b>. Check it for typos. If you believe a document claiming to be from ${esc(site.name)} is not genuine, please <a href="/contact">contact us</a>.</p></div>`;
    }
  }
  return layout(site, {
    title: 'Verify a document', canonical: `${site.url}/verify`, head: ref ? '<meta name="robots" content="noindex">' : '',
    description: `Check that a certificate, letter or article reference from ${site.name} is genuine.`,
    body: `<section class="page narrow">
  <h1>Verify a document</h1>
  <p class="lede">Every certificate (ABRC-…), letter (ABRL-…) and article (ABR-…) issued by ${esc(site.name)} carries a reference number. Enter it to check that it is genuine.</p>
  <form class="track-form" method="get" action="/verify"><label>Reference number<input name="ref" value="${esc(ref || '')}" placeholder="ABRC-2026-0001" required></label><button class="btn">Verify</button></form>
  ${result}
</section>`
  });
}
