import { themeHead, themeRibbon, themeFx } from './festive.js';
import { marketsStrip, marketsPage as marketsPageView, stockPage as stockPageView } from './markets.js';
import { esc, fmtDate, readingMinutes, truncate, isoWithOffset, volumeIssue, articleVI } from './util.js';
import { articleMeta, citations, articleUrl, pdfUrl } from './citation.js';
import { slugify } from './config.js';
import { sanitizeHtml } from '../public/assets/sanitize.js';

/* ---------------- Layout ---------------- */

// Change this on every deploy that edits CSS/JS so browsers and Cloudflare fetch the new files.
export const ASSET_V = '20261119-3';
const av = (u) => `${u}?v=${ASSET_V}`;

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
<link rel="stylesheet" href="${av('/assets/style.css')}">
${themeHead(site.state, av('/assets/themes.css'))}
${head}
</head>
<body class="${bodyClass}"${site.state && site.state.theme ? ` data-theme="${esc(site.state.theme.key)}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
${themeRibbon(site.state, esc)}
${marketsStrip(site.state && site.state.markets, esc)}
${masthead(site)}
<main id="main">
${body}
</main>
${footer(site)}
${themeFx(site.state)}
<script src="${av('/assets/site.js')}" defer></script>
</body>
</html>`;
}

function masthead(site) {
  const nav = site.sections.map((s) => `<a href="/section/${slugify(s)}">${esc(s)}</a>`).join('');
  return `<header class="masthead">
  <div class="topbar wrap">
    <span class="today">${fmtDate(new Date().toISOString())}</span>
    <nav class="toplinks" aria-label="About ABR">
      <a href="/about">About</a><a href="/issues">Issues</a><a href="/archive">Archive</a><a href="/markets">Markets</a><a href="/write">Write for ABR</a><a href="/editorial-standards">Editorial standards</a><a href="/contact">Contact</a>
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
      <h2 class="footer-h">Policies</h2>
      <a href="/privacy">Privacy policy</a>
      <a href="/terms">Terms of use</a>
      <a href="/permissions">Rights and permissions</a>
      <a href="/preservation">DOIs and archiving</a>
      <a href="/ai-policy">Use of AI</a>
      <a href="/partner-content">Partner content</a>
    </div>
    <div>
      <h2 class="footer-h">Take part</h2>
      <a href="/markets">Markets</a>
      <a href="/write">Write for ABR</a>
      <a href="/track">Track a submission</a>
      <a href="/issues">Issues</a>
      <a href="/verify">Verify a document</a>
      <a href="/subscribe">Newsletter</a>
      <a href="/feed.xml">RSS feed</a>
      <a href="/portal/">Editorial portal</a>
    </div>
  </div>
  <div class="wrap footer-base">© ${y} ${esc(site.publisher)}. Each article states its licence and credit line. <a href="/permissions">Rights and permissions</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></div>
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

const DEFAULT_LICENCE = { code: 'cc-by-nc-nd-4.0', label: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/', nc: true, nd: true };
function licenceAllows(l) {
  const parts = ['copy and share it'];
  if (!l.nd) parts.push('adapt it');
  return `${parts.join(' and ')}${l.nd ? ' unchanged' : ''}${l.nc ? ', for non-commercial purposes' : ', for any purpose'}, with credit`;
}
// "Rights and reuse" block: licence, the authorised credit line, and a link to request a licence.
export function rightsBox(site, w) {
  const l = w.licence || DEFAULT_LICENCE;
  const year = String(w.year || new Date().getFullYear());
  const holder = w.holder ? `${w.holder}` : site.publisher;
  const credit = `${w.credit}. © ${year} ${holder}. ${w.doi ? 'https://doi.org/' + w.doi : w.url}. ${l.label}.`;
  return `<section class="rights" aria-labelledby="rights-h">
    <h2 id="rights-h">Rights and reuse</h2>
    <p>© ${esc(year)} ${esc(holder)}${w.holder ? `, published by ${esc(site.name)} under licence` : ''}. ${w.type === 'issue' ? 'The articles in this issue are' : 'This article is'} published under <a href="${esc(l.url)}" rel="license">${esc(l.label)}</a>: you may ${licenceAllows(l)}.</p>
    <div class="credit"><span>Credit line</span><code>${esc(credit)}</code><button type="button" class="btn ghost" data-copy="${esc(credit)}">Copy</button></div>
    <p>For anything else, including commercial use, course packs, translation, reprints or adaptation, ask us. Educational requests are free, and approved requests receive a numbered licence grant you can print and verify.</p>
    <p><a class="btn" href="/permissions?ref=${esc(w.ref)}">Request permission to reuse</a> <a class="rights-more" href="/permissions">How permissions work</a></p>
  </section>`;
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
    ${a.aiAssisted && site.state && site.state.aiNote ? `<p class="notice">Drafted with AI assistance and checked by ABR’s editors against the sources listed. <a href="/ai-policy">How ABR uses AI</a>.</p>` : ''}
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
    ${rightsBox(site, { type: 'article', ref: a.id, licence: a.licence, holder: a.rightsHolder, year: String(a.publishedAt || '').slice(0, 4), doi: a.doi, url,
      credit: `${(a.authors || []).map((x) => x.name).join(', ')}, “${a.title}”, ${site.name}` })}
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
    { loc: `${site.url}/write` },
    { loc: `${site.url}/permissions` },
    { loc: `${site.url}/markets` },
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
  <p class="muted small">We’ll email you a link to confirm. You start with a weekly digest of new articles, new issues and occasional newsletters, and you can change that any time: every new article, monthly, or only the sections you choose. Every email has a preferences link and an unsubscribe link, and we never share your address.</p>
</div>`
  });
}

export function preferencesPage(site, d, token) {
  if (!d) return messagePage(site, 'Link not valid', 'This preferences link has expired or is not valid. Use the “Choose what you receive” link in your latest ABR email, or <a href="/subscribe">subscribe again</a>.');
  const p = d.prefs;
  const freq = [
    ['instant', 'Every new article', 'An email each time we publish (usually a few a week).'],
    ['weekly', 'Weekly digest', 'One email every Monday with the week’s articles.'],
    ['monthly', 'Monthly digest', 'One email at the start of each month.'],
    ['off', 'No article emails', 'Only the options you tick below.']
  ];
  return layout(site, {
    title: 'Your email preferences', head: '<meta name="robots" content="noindex">',
    body: `<div class="narrow page-pad prose prefs">
  <h1>Choose what you receive</h1>
  <p class="lede">Preferences for <b>${esc(d.email)}</b>.${d.status === 'unsubscribed' ? ' You are currently unsubscribed; saving preferences below will subscribe you again.' : ''}</p>
  <form id="prefForm" data-t="${esc(token)}">
    <fieldset><legend>How often should we email you about new articles?</legend>
      ${freq.map(([v, l, h]) => `<label class="opt"><input type="radio" name="freq" value="${v}" ${p.freq === v ? 'checked' : ''}><span><b>${l}</b><br><span class="muted small">${h}</span></span></label>`).join('')}
    </fieldset>
    <fieldset><legend>Which sections?</legend>
      <p class="muted small">Leave all unticked to get every section.</p>
      ${d.sections.map((x) => `<label class="opt inline"><input type="checkbox" name="sections" value="${esc(x)}" ${p.sections.includes(x) ? 'checked' : ''}> ${esc(x)}</label>`).join('')}
    </fieldset>
    <fieldset><legend>Also send me</legend>
      <label class="opt"><input type="checkbox" name="issues" ${p.issues ? 'checked' : ''}><span><b>New issues</b><br><span class="muted small">When a new compiled issue (with its PDF) is published, every two months.</span></span></label>
      <label class="opt"><input type="checkbox" name="news" ${p.news ? 'checked' : ''}><span><b>Newsletters and announcements</b><br><span class="muted small">Occasional editions, events and news from ABR.</span></span></label>
    </fieldset>
    <label>Your name <span class="muted small">(optional, used to greet you)</span><input name="name" value="${esc(d.name || '')}" maxlength="100"></label>
    <p><button class="btn" type="submit">Save preferences</button> <span id="prefMsg" role="status"></span></p>
  </form>
  <p class="muted small">Want nothing at all? <a href="/unsubscribe?t=${esc(token)}">Unsubscribe from everything</a>.</p>
</div>
<script>
document.getElementById('prefForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, msg = document.getElementById('prefMsg');
  msg.textContent = 'Saving…';
  const payload = { token: f.dataset.t, freq: (f.querySelector('input[name=freq]:checked') || {}).value,
    sections: [...f.querySelectorAll('input[name=sections]:checked')].map((x) => x.value),
    issues: f.issues.checked, news: f.news.checked, name: f.name.value };
  try {
    const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'public.subPrefs.save', payload }) }).then((x) => x.json());
    msg.textContent = r.ok ? '✓ Saved. Your next emails will follow these choices.' : (r.error || 'Could not save.');
  } catch { msg.textContent = 'Could not reach the server. Please try again.'; }
});
</script>`
  });
}

export function unsubscribePage(site, token) {
  return layout(site, {
    title: 'Unsubscribe', head: '<meta name="robots" content="noindex">',
    body: `<div class="narrow page-pad prose">
  <h1>Unsubscribe</h1>
  <p>Click below to stop receiving all emails from ${esc(site.name)}.</p>
  <p class="muted">Getting too many? You can <a href="/subscribe/preferences?t=${esc(token)}">switch to a weekly or monthly digest, or choose sections</a> instead.</p>
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
<script src="${av('/assets/cobrand.js')}" defer></script>`
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
  <div class="narrow">${rightsBox(site, { type: 'issue', ref: i.key, licence: i.licence, year: i.year, url: `${site.url}/issues/${i.key}`,
    credit: `${site.name}, Vol. ${i.volume}, No. ${i.number} (${i.months} ${i.year})${i.title ? ', ' + i.title : ''}` })}</div>
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
<script src="${av('/assets/submit.js')}" type="module"></script>`
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
  <script src="${av('/assets/submit.js')}" type="module"></script>` : ''}`
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
  const row = (k, v) => `<div class="vf-row"><dt>${k}</dt><dd>${v}</dd></div>`;
  let result = '';
  if (ref && r) {
    let ok = true, kind = '', rows = '', action = '', note = '';
    if (r.kind === 'certificate') {
      const c = r.record; ok = c.status === 'valid'; kind = 'Certificate';
      rows = row('Reference', `<code>${esc(c.id)}</code>`) + row('Issued to', esc(c.name)) + row('Certificate', esc(c.typeLabel)) +
        row('Date of issue', fmtDate(c.issuedAt)) + (!ok ? row('Status', 'Revoked') : '') + (!ok && c.note ? row('Reason revoked', esc(c.note)) : '');
      if (ok) action = `<a class="vf-link" href="/certificates/${esc(c.id)}">View the certificate →</a>`;
    } else if (r.kind === 'letter') {
      const l = r.record; ok = l.status === 'issued'; kind = 'Letter';
      rows = row('Reference', `<code>${esc(l.id)}</code>`) + row('Dated', fmtDate(l.date + 'T12:00:00+05:30')) + row('Addressed to', esc(l.to || '—')) +
        row('Subject', esc(l.subject)) + row('Signed by', `${esc(l.signName)}, ${esc(l.signTitle)}`) + (!ok ? row('Status', 'Revoked') + (l.note ? row('Reason', esc(l.note)) : '') : '');
      note = 'For privacy, the contents of letters are not shown. Compare these details with the letter you hold.';
    } else if (r.kind === 'approval') {
      const x = r.record; ok = x.status !== 'void'; kind = 'Approval record';
      rows = row('Reference', `<code>${esc(x.id)}</code>`) + row('Category', esc(x.category)) + row('Date of decision', fmtDate(x.decidedAt)) +
        row('Signatures', x.level === 'major' ? 'Countersignature and Chairperson' : 'Chairperson') +
        row('Status', x.status === 'filed' ? 'Signed and filed' + (x.filedAt ? ', ' + fmtDate(x.filedAt) : '') : x.status === 'void' ? 'Cancelled' : 'Awaiting signature and filing');
      note = 'For privacy, the subject and details of internal approvals are not shown.';
    } else if (r.kind === 'licence') {
      const x = r.record; ok = x.status === 'approved' && !x.expired; kind = 'Licence grant';
      rows = row('Reference', `<code>${esc(x.id)}</code>`) + row('Licensee', esc(x.licensee)) + row('Material', `${esc(x.work)} <span class="muted">(${esc(x.workId)})</span>`) +
        row('Permitted use', esc(x.use)) + row('Valid', `${fmtDate(x.startDate + 'T12:00:00+05:30')} to ${fmtDate(x.endDate + 'T12:00:00+05:30')}`) +
        row('Status', x.status === 'revoked' ? 'Revoked' : x.expired ? 'Expired' : 'In force') + (x.note ? row('Reason', esc(x.note)) : '');
      note = 'The licence covers only the use, period and conditions printed on the grant.';
    } else if (r.kind === 'article') {
      kind = 'Published article';
      rows = row('Reference', `<code>${esc(r.record.id)}</code>`) + row('Title', esc(r.record.title)) + row('Published', fmtDate(r.record.publishedAt));
      action = `<a class="vf-link" href="/articles/${esc(r.record.slug)}">Read the article →</a>`;
    } else {
      ok = false;
    }
    const found = r.kind && r.kind !== 'none';
    result = `<section class="vf-result ${ok ? 'is-ok' : 'is-bad'}" aria-live="polite">
      <div class="vf-stamp"><span class="vf-icon">${ok ? '✓' : '✕'}</span>
        <div><div class="vf-kicker">${found ? esc(kind) : 'Reference not found'}</div>
        <div class="vf-verdict">${!found ? 'No record matches this reference' : ok ? 'Genuine. Issued by ' + esc(site.name) : 'This ' + esc(kind.toLowerCase()) + ' is no longer valid'}</div></div></div>
      ${found ? `<dl class="vf-rows">${rows}</dl>` : `<p class="vf-note">We have no certificate, letter, approval record or article with the reference <code>${esc(ref)}</code>. Check it character by character. If someone has shown you a document claiming to be from ${esc(site.name)} and it does not verify, please <a href="/contact">tell us</a>.</p>`}
      ${note ? `<p class="vf-note">${note}</p>` : ''}${action}
      <p class="vf-checked">Checked ${fmtDate(new Date().toISOString())} at ${esc(site.url.replace(/^https?:\/\//, ''))}/verify</p>
    </section>`;
  }
  const kinds = [['ABRC', 'Certificate', 'publication, contribution and service certificates'], ['ABRL', 'Letter', 'letters issued on ABR letterhead'],
    ['ABRP', 'Licence', 'permissions to reuse ABR material'], ['ABRA', 'Approval record', 'signed and filed approvals'], ['ABR', 'Article', 'every published article']];
  return layout(site, {
    title: 'Verify a document', canonical: `${site.url}/verify`, head: ref ? '<meta name="robots" content="noindex">' : '',
    description: `Check that a certificate, letter, approval record or article reference from ${site.name} is genuine.`,
    bodyClass: 'vf-page',
    body: `<section class="vf-hero"><div class="vf-wrap">
    <div class="w-kicker">Verification</div>
    <h1>Is this document genuine?</h1>
    <p class="vf-lede">Every certificate, letter, licence, approval record and article from ${esc(site.name)} carries a unique reference. Type it exactly as printed.</p>
    <form class="vf-form" method="get" action="/verify" role="search">
      <label for="vfRef" class="sr">Reference number</label>
      <input id="vfRef" name="ref" value="${esc(ref || '')}" placeholder="ABRC-2026-0001" autocomplete="off" spellcheck="false" required>
      <button type="submit">Verify</button>
    </form>
  </div></section>
  <div class="vf-wrap vf-body">
    ${result}
    <div class="vf-kinds">${kinds.map(([p, n, d]) => `<div><code>${p}-…</code><b>${n}</b><span>${d}</span></div>`).join('')}</div>
  </div>`
  });
}

export function writePage(site, cfg) {
  const steps = [
    ['Create an account', 'Sign up with your email. It takes a minute and keeps all your submissions in one place.'],
    ['Submit your article', 'Paste from Word or Google Docs, add your references and disclosures, and send it to the editors.'],
    ['Editorial review', 'An editor reads every submission. You may be asked for changes, and you can revise from your account.'],
    ['Published and credited', 'Your article goes live with your name and a permanent, citable link, and you receive a verifiable certificate.']
  ];
  const types = [
    ['Analysis', 'An argument about a business, market or policy, built on evidence.'],
    ['Case study', 'How one company, cluster or institution solved a problem, and what others can learn.'],
    ['Explainer', 'A clear account of a complex topic for intelligent non-specialists.'],
    ['Research brief', 'Findings from your own research or data, written for a general audience.'],
    ['Opinion', 'A reasoned view on a live question, clearly labelled as opinion.']
  ];
  return layout(site, {
    title: 'Write for ABR', canonical: `${site.url}/write`, bodyClass: 'w-page',
    description: `Become a contributor to ${site.name}: submit evidence-based analysis, case studies and explainers on business, entrepreneurship, innovation, leadership and policy.`,
    body: `<div id="wApp" data-cfg='${esc(JSON.stringify(cfg || {}))}'>
<section class="w-hero w-marketing"><div class="w-wrap w-hero-in">
  <div>
    <div class="w-kicker">Write for ABR</div>
    <h1>Your research,<br>read and cited.</h1>
    <p class="w-lede">${esc(site.name)} publishes evidence-based writing on business, entrepreneurship, innovation, leadership and policy. Students, researchers and practitioners are welcome.</p>
    <div class="w-cta"><a class="w-btn w-btn-light" href="#join" data-go="signup">Create a contributor account</a><a class="w-btn w-btn-outline" href="#join" data-go="login">Sign in</a></div>
  </div>
  <ul class="w-gets">
    <li><b>A permanent, citable link</b><span>with citation data that MyBib, Zotero and Google Scholar can read</span></li>
    <li><b>Professional editing</b><span>from ABR’s editors before publication</span></li>
    <li><b>A verifiable certificate</b><span>with its own reference number</span></li>
    <li><b>A DOI</b><span>for research articles, where registered</span></li>
  </ul>
</div></section>

<section class="w-marketing w-wrap w-section">
  <div class="w-sec-h"><span>01</span><h2>How it works</h2></div>
  <ol class="w-steps">${steps.map(([h, t], i) => `<li><span class="w-num">${String(i + 1).padStart(2, '0')}</span><h3>${h}</h3><p>${t}</p></li>`).join('')}</ol>
</section>

<section class="w-marketing w-wrap w-section w-two">
  <div>
    <div class="w-sec-h"><span>02</span><h2>What we publish</h2></div>
    <dl class="w-types">${types.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>
  </div>
  <div>
    <div class="w-sec-h"><span>03</span><h2>Our standards</h2></div>
    <ul class="w-rules">
      <li>Original work, not published elsewhere, including blogs and LinkedIn. 800–2,500 words is ideal.</li>
      <li>Every figure and claim is sourced. Analyses, case studies, explainers and research briefs need at least ${(cfg && cfg.minRefs) || 2} references.</li>
      <li>Disclose any AI use, funding or conflict of interest.</li>
      <li>Editors may edit for length, clarity and style, and will consult you on substantial changes.</li>
      <li>You keep your copyright. You license ABR to publish, archive and register a DOI for your article, and to grant reuse permissions on your behalf.</li>
    </ul>
    <p class="w-small">Read the full <a href="/editorial-standards">editorial standards</a>.</p>
  </div>
</section>

<section id="join" class="w-join"><div class="w-wrap"><div id="wMount" class="w-mount"><noscript>Please enable JavaScript to sign in.</noscript></div></div></section>
</div>
<script src="${av('/assets/write.js')}" type="module"></script>`
  });
}

/* ------------------------------------------------------------------ */
/* Rights and permissions                                              */
/* ------------------------------------------------------------------ */

export function permissionsPage(site, cfg, ref) {
  const l = cfg.licence || DEFAULT_LICENCE;
  const w = cfg.work;
  const opts = (list, sel) => (list || []).map((o) => `<option value="${esc(o.value)}"${o.value === sel ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const form = `<form class="w-form pm-form" id="pmForm" novalidate>
    ${w ? `<div class="pm-work"><small>${w.type === 'issue' ? 'Issue' : 'Article ' + esc(w.id)}</small><b>${esc(w.title)}</b>${w.authors ? `<div class="muted small">${esc(w.authors)}</div>` : ''}<input type="hidden" name="ref" value="${esc(w.id)}"></div>`
      : `${cfg.workError && ref ? `<p class="w-msg bad">${esc(cfg.workError)}</p>` : ''}
      <label class="w-field"><span>Article ID or issue <em>e.g. ABR-2026-0007, or v1n6 for Vol. 1 No. 6</em></span><input name="ref" value="${esc(ref || '')}" required></label>`}
    <div class="w-grid2">
      <label class="w-field"><span>Full name</span><input name="name" autocomplete="name" required></label>
      <label class="w-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="w-field"><span>Organisation <em>school, university, company</em></span><input name="organisation" autocomplete="organization"></label>
      <label class="w-field"><span>Your role <em>optional</em></span><input name="designation" placeholder="e.g. Assistant Professor"></label>
    </div>
    <label class="w-field"><span>How will you use it?</span><select name="useType" required><option value="">Choose…</option>${opts(cfg.useTypes)}</select></label>
    <div class="w-grid2">
      <label class="w-field"><span>How much?</span><select name="portion">${opts((cfg.portions || []).filter((o) => w && w.type === 'issue' ? o.value !== 'full' : o.value !== 'issue'), w && w.type === 'issue' ? 'issue' : 'full')}</select></label>
      <label class="w-field"><span>In what form?</span><select name="adaptation">${opts(cfg.adaptations, 'none')}</select></label>
      <label class="w-field"><span>Where will it appear?</span><select name="medium" required><option value="">Choose…</option>${opts(cfg.media)}</select></label>
      <label class="w-field"><span>Audience or copies <em>e.g. 60 students</em></span><input name="audience"></label>
      <label class="w-field"><span>From</span><input name="startDate" type="date" value="${today}"></label>
      <label class="w-field"><span>Until <em>up to 3 years</em></span><input name="endDate" type="date"></label>
    </div>
    <label class="w-field"><span>Territory</span><input name="territory" value="India"></label>
    <label class="w-field"><span>Tell us about the use</span><textarea name="purpose" rows="4" required placeholder="Course name, publication, event or product; who will see it; whether anyone pays for it."></textarea></label>
    <input name="website" class="w-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="w-btn" type="submit">Send request</button>
    <p class="w-msg" role="status"></p>
    <p class="w-fine">We use these details only to decide your request and issue your licence. See our <a href="/privacy">privacy policy</a>.</p>
  </form>
  <div class="pm-done" id="pmDone" hidden></div>`;
  return layout(site, {
    title: 'Rights and permissions', canonical: `${site.url}/permissions`, bodyClass: 'w-page',
    description: `How you may reuse articles and issues from ${site.name}, and how to request a licence for teaching, research, reprints, translation or commercial use.`,
    head: ref ? '<meta name="robots" content="noindex">' : '',
    body: `<section class="vf-hero"><div class="vf-wrap">
    <div class="w-kicker">Rights and permissions</div>
    <h1>Use our work.<br>Ask for a licence.</h1>
    <p class="vf-lede">Every ${esc(site.shortName)} article is published under ${esc(l.label)}. For anything that licence does not cover, request permission here. Approved requests receive a numbered licence grant you can print and anyone can verify.</p>
  </div></section>
  <div class="vf-wrap w-section pm-grid">
    <div>
      <div class="w-sec-h"><span>01</span><h2>Without asking</h2></div>
      <ul class="pm-allow">
        <li class="y">Read, link to and cite any article.</li>
        <li class="y">Quote short passages for criticism, review, teaching or research, with full credit.</li>
        <li class="y">Under ${esc(l.label)}: ${licenceAllows(l)}, using the credit line shown at the end of the article.</li>
      </ul>
      <div class="w-sec-h"><span>02</span><h2>Ask us first</h2></div>
      <ul class="pm-allow">
        ${l.nc ? '<li class="n">Any commercial use: corporate training, marketing, paid products or paid publications.</li>' : ''}
        ${l.nd ? '<li class="n">Translating, abridging, editing or adapting an article.</li>' : ''}
        <li class="n">Course packs and printed readers sold to students.</li>
        <li class="n">Reprinting in a newspaper, magazine, book or website.</li>
        <li class="n">Using a whole issue, or using ABR material to train AI systems.</li>
        <li class="n">Anything you are unsure about.</li>
      </ul>
      <div class="w-sec-h"><span>03</span><h2>How it works</h2></div>
      <ul class="w-rules">
        <li>Send the form. You get a reference (ABRP-…) and a private link to follow your request.</li>
        <li>The Chair, Editor-in-Chief or COO decides, usually within five working days.${cfg.autoEducation ? ' Educational, non-commercial requests to use material unchanged are approved straight away.' : ''}</li>
        <li>On approval you receive a licence grant on ${esc(site.shortName)} letterhead with the exact credit line to use, its period and conditions. Print it or save it as a PDF.</li>
        <li>Anyone can confirm the licence at <a href="/verify">/verify</a>. Educational and non-profit uses are free. Commercial uses may carry a fee, which we agree with you first.</li>
      </ul>
      <p class="w-small">Authors who wrote for ABR keep their copyright and have licensed ${esc(site.publisherShort)} to grant these permissions. Material credited to others, such as photographs, is not covered. To report a misuse of ABR material, write to <a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>.</p>
    </div>
    <div id="request"><div class="w-sec-h"><span>04</span><h2>Request a licence</h2></div>${form}</div>
  </div>
  <script>
  (function () {
    var f = document.getElementById('pmForm'); if (!f) return;
    var m = f.querySelector('.w-msg');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = {}; new FormData(f).forEach(function (v, k) { d[k] = v; });
      var b = f.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Sending…'; m.textContent = ''; m.className = 'w-msg';
      fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'public.permission.request', payload: d }) })
        .then(function (r) { return r.json(); }).then(function (j) {
          if (!j.ok) throw new Error(j.error || 'Something went wrong.');
          var done = document.getElementById('pmDone'); f.hidden = true; done.hidden = false;
          var path = String(j.data.url || '').replace(/^https?:\\/\\/[^/]+/, '');
          done.innerHTML = j.data.status === 'approved'
            ? '<div class="w-kicker">Approved</div><h3>Your licence ' + j.data.id + ' is ready</h3><p>Your request qualified for automatic approval. We have also emailed you the link.</p><p><a class="w-btn" href="' + path + '">Open your licence</a></p>'
            : '<div class="w-kicker">Request received</div><h3>Reference ' + j.data.id + '</h3><p>We have emailed you a private link to follow your request. We usually reply within five working days.</p><p><a class="w-btn w-btn-ghost" href="' + path + '">View your request</a></p>';
          done.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }).catch(function (err) { m.textContent = err.message; m.className = 'w-msg bad'; b.disabled = false; b.textContent = 'Send request'; });
    });
  })();
  </script>`
  });
}

// Requester's private page while a request is pending, declined or revoked.
export function permissionStatusPage(site, x) {
  const label = { pending: 'Under review', declined: 'Not granted', revoked: 'Revoked' }[x.status] || x.status;
  return layout(site, {
    title: `Permission request ${x.id}`, head: '<meta name="robots" content="noindex, nofollow">', bodyClass: 'vf-page',
    body: `<section class="vf-hero"><div class="vf-wrap"><div class="w-kicker">Permission request</div><h1>${esc(x.id)}</h1>
      <p class="vf-lede">${esc(x.work.title)}</p></div></section>
    <div class="vf-wrap vf-body"><section class="vf-result ${x.status === 'pending' ? 'is-ok' : 'is-bad'}">
      <div class="vf-stamp"><span class="vf-icon">${x.status === 'pending' ? '…' : '✕'}</span><div><div class="vf-kicker">Status</div><div class="vf-verdict">${esc(label)}</div></div></div>
      <dl class="vf-rows">
        <div class="vf-row"><dt>Requested by</dt><dd>${esc(x.name)}${x.organisation ? ', ' + esc(x.organisation) : ''}</dd></div>
        <div class="vf-row"><dt>Use</dt><dd>${esc(x.useLabel)} · ${esc(x.portionLabel)} · ${esc(x.adaptationLabel)}</dd></div>
        <div class="vf-row"><dt>Where</dt><dd>${esc(x.mediumLabel)}${x.audience ? ' · ' + esc(x.audience) : ''} · ${esc(x.territory)}</dd></div>
        <div class="vf-row"><dt>Period requested</dt><dd>${fmtDate(x.startDate + 'T12:00:00+05:30')} to ${fmtDate(x.endDate + 'T12:00:00+05:30')}</dd></div>
        <div class="vf-row"><dt>Received</dt><dd>${fmtDate(x.createdAt)}</dd></div>
        ${x.note ? `<div class="vf-row"><dt>${x.status === 'pending' ? 'Note' : 'Reason'}</dt><dd>${esc(x.note)}</dd></div>` : ''}
      </dl>
      <p class="vf-note">${x.status === 'pending' ? 'We will email you when there is a decision. Keep this link; it is private to you.' : 'Questions? Write to <a href="mailto:' + esc(site.contactEmail) + '">' + esc(site.contactEmail) + '</a>.'}</p>
    </section></div>`
  });
}

export function greetingsPage(site) {
  const st = site.state || {};
  const t = st.theme;
  const open = st.greetingsOpen && t && !t.mourning;
  return layout(site, {
    title: open ? `${t.greeting} from our Chair` : 'Festival greetings', canonical: `${site.url}/greetings`, bodyClass: 'w-page',
    description: `Ask for a personal festival greeting from the Chair of ${site.name}.`,
    body: `<section class="vf-hero fest-hero"><div class="vf-wrap">
      <div class="w-kicker">${open ? esc(t.name) + ' greetings' : 'Festival greetings'}</div>
      <h1>${open ? esc(t.greeting) + ',<br>from our Chair.' : 'Greetings open during festivals.'}</h1>
      <p class="vf-lede">${open ? `Tell us your name and we will email you a personal ${esc(t.name)} greeting from the Chair of ${esc(site.name)}, on our letterhead, as a PDF you can keep, print or share.`
        : `During Diwali, Navratri, Uttarayan, Holi, Christmas, the New Year, Independence Day and Republic Day you can ask for a personal greeting from the Chair of ${esc(site.name)}. Please come back then.`}</p>
    </div></section>
    ${open ? `<div class="vf-wrap w-section"><form class="w-form w-narrow" id="grForm" novalidate>
      <label class="w-field"><span>Your name <em>as it should appear on the greeting</em></span><input name="name" autocomplete="name" maxlength="80" required></label>
      <label class="w-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <div class="w-grid2"><label class="w-field"><span>Organisation <em>optional</em></span><input name="organisation" maxlength="120"></label>
        <label class="w-field"><span>City <em>optional</em></span><input name="city" maxlength="60"></label></div>
      <input name="website" class="w-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="w-btn" type="submit">Send me a greeting</button>
      <p class="w-msg" role="status"></p>
      <p class="w-fine">One greeting per email address for each festival. We use your details only to send it; see our <a href="/privacy">privacy policy</a>.</p>
    </form><div class="pm-done w-narrow" id="grDone" hidden></div></div>
    <script>
    (function () {
      var f = document.getElementById('grForm'), m = f.querySelector('.w-msg');
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var d = {}; new FormData(f).forEach(function (v, k) { d[k] = v; });
        var b = f.querySelector('button'); b.disabled = true; b.textContent = 'Preparing your greeting…'; m.textContent = ''; m.className = 'w-msg';
        fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'greeting.request', payload: d }) })
          .then(function (r) { return r.json(); }).then(function (j) {
            if (!j.ok) throw new Error(j.error || 'Something went wrong.');
            f.hidden = true; var done = document.getElementById('grDone'); done.hidden = false;
            done.innerHTML = '<div class="w-kicker">Sent</div><h3>Your greeting is on its way</h3><p>We have emailed it to you as a PDF. You can also open it now.</p><p><a class="w-btn" href="' + j.data.url + '">Open your greeting</a></p>';
          }).catch(function (err) { m.textContent = err.message; m.className = 'w-msg bad'; b.disabled = false; b.textContent = 'Send me a greeting'; });
      });
    })();
    </script>` : ''}`
  });
}

export function marketsPage(site, m, fx, coverage) {
  return marketsPageView(site, { layout, esc, fmtDate, card }, m, fx, coverage);
}

export function stockPage(site, sym, m, coverage) {
  return stockPageView(site, { layout, esc, card }, sym, m, coverage);
}
