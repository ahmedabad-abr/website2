// Machine-readable citation metadata + human-readable "Cite this article" formats.
// Reference managers (MyBib, Zotero, Mendeley, EndNote) and Google Scholar read the
// Highwire Press `citation_*` tags first, then Dublin Core, OpenGraph and JSON-LD.

import { esc, fmtSlash, fmtISODate, isoWithOffset, fmtDate, fmtUS, fmtMLA, year, monthName, dayNum, splitName, volumeIssue } from './util.js';

const SCHEMA_TYPE = {
  Opinion: 'OpinionNewsArticle',
  Analysis: 'AnalysisNewsArticle',
  'Research Brief': 'ScholarlyArticle',
  Explainer: 'BackgroundNewsArticle'
};

const m = (name, content) => content ? `<meta name="${name}" content="${esc(content)}">` : '';
const p = (prop, content) => content ? `<meta property="${prop}" content="${esc(content)}">` : '';

export function articleUrl(site, a) { return `${site.url}/articles/${a.slug}`; }
export function pdfUrl(site, a) { return `${site.url}/articles/${a.slug}.pdf`; }

export function articleMeta(site, a) {
  const url = articleUrl(site, a);
  const authors = a.authors || [];
  const modified = a.modifiedAt || a.publishedAt;
  const keywords = [a.section, ...(a.tags || [])].filter(Boolean).join('; ');

  const vi = volumeIssue(site, a.publishedAt);
  const highwire = [
    m('citation_title', a.title),
    // Each author is followed by their institution, as Google Scholar expects.
    ...authors.flatMap((x) => x.corporate ? [m('citation_author', x.name)] : [m('citation_author', x.name), m('citation_author_institution', site.name)]),
    m('citation_journal_title', site.name),
    m('citation_journal_abbrev', site.journalAbbrev),
    vi && vi.volume ? m('citation_volume', String(vi.volume)) : '',
    vi && vi.issue ? m('citation_issue', String(vi.issue)) : '',
    site.pdf ? m('citation_pdf_url', pdfUrl(site, a)) : '',
    m('citation_publication_date', fmtSlash(a.publishedAt)),
    m('citation_online_date', fmtSlash(a.publishedAt)),
    m('citation_date', fmtSlash(a.publishedAt)),
    m('citation_publisher', site.publisher),
    m('citation_language', site.language),
    m('citation_abstract', a.standfirst),
    m('citation_keywords', keywords),
    m('citation_public_url', url),
    m('citation_abstract_html_url', url),
    m('citation_fulltext_html_url', url),
    m('citation_id', a.id),
    m('citation_issn', site.issn),
    m('citation_article_type', a.type),
    ...(a.sources || []).map((r) => m('citation_reference', r))
  ];

  const dublinCore = [
    '<link rel="schema.DC" href="http://purl.org/dc/elements/1.1/">',
    '<link rel="schema.DCTERMS" href="http://purl.org/dc/terms/">',
    m('DC.title', a.title),
    ...authors.map((x) => m('DC.creator', x.name)),
    m('DC.date', fmtISODate(a.publishedAt)),
    m('DCTERMS.issued', fmtISODate(a.publishedAt)),
    m('DCTERMS.modified', fmtISODate(modified)),
    m('DC.publisher', site.publisher),
    m('DC.description', a.standfirst),
    m('DC.subject', keywords),
    m('DC.type', 'Text'),
    m('DC.format', 'text/html'),
    m('DC.identifier', url),
    m('DC.source', site.name),
    m('DC.relation.ispartof', site.name),
    vi && vi.volume ? m('DC.citation.volume', String(vi.volume)) : '',
    vi && vi.issue ? m('DC.citation.issue', String(vi.issue)) : '',
    m('DC.language', site.language),
    m('DC.rights', `© ${year(a.publishedAt)} ${site.publisher}`)
  ];

  const social = [
    p('og:type', 'article'),
    p('og:site_name', site.name),
    p('og:title', a.title),
    p('og:description', a.standfirst),
    p('og:url', url),
    p('og:locale', site.locale),
    p('og:image', a.coverUrl || `${site.url}/brand/social/ABR-Social-Avatar-Black.png`),
    p('article:published_time', isoWithOffset(a.publishedAt)),
    p('article:modified_time', isoWithOffset(modified)),
    p('article:section', a.section),
    ...authors.map((x) => p('article:author', x.slug ? `${site.url}/authors/${x.slug}` : site.url)),
    ...(a.tags || []).map((t) => p('article:tag', t)),
    m('twitter:card', a.coverUrl ? 'summary_large_image' : 'summary'),
    m('twitter:title', a.title),
    m('twitter:description', a.standfirst),
    m('twitter:image', a.coverUrl || `${site.url}/brand/social/ABR-Social-Avatar-Black.png`),
    m('twitter:site', site.twitter)
  ];

  const ld = {
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPE[a.type] || 'NewsArticle',
    '@id': `${url}#article`,
    headline: a.title,
    description: a.standfirst || undefined,
    url,
    mainEntityOfPage: url,
    identifier: a.id,
    datePublished: isoWithOffset(a.publishedAt),
    dateModified: isoWithOffset(modified),
    inLanguage: site.language,
    articleSection: a.section || undefined,
    genre: a.type || undefined,
    keywords: (a.tags || []).join(', ') || undefined,
    wordCount: a.wordCount || undefined,
    image: a.coverUrl ? [a.coverUrl] : undefined,
    author: authors.map((x) => x.corporate
      ? { '@type': 'Organization', name: x.name, url: site.url }
      : { '@type': 'Person', name: x.name, url: `${site.url}/authors/${x.slug}`, jobTitle: x.title || undefined }),
    publisher: {
      '@type': 'Organization',
      name: site.name,
      alternateName: site.shortName,
      url: site.url,
      logo: { '@type': 'ImageObject', url: `${site.url}/brand/logo/primary/ABR-Primary-Stacked-Black.png` },
      parentOrganization: { '@type': 'Organization', name: site.publisher, url: site.publisherUrl }
    },
    isPartOf: vi && vi.volume ? {
      '@type': 'PublicationIssue', issueNumber: String(vi.issue), datePublished: String(vi.year),
      isPartOf: { '@type': 'PublicationVolume', volumeNumber: String(vi.volume),
        isPartOf: { '@type': 'Periodical', name: site.name, url: site.url, issn: site.issn || undefined, publisher: { '@type': 'Organization', name: site.publisher } } }
    } : { '@type': 'Periodical', name: site.name, url: site.url, issn: site.issn || undefined },
    associatedMedia: site.pdf ? { '@type': 'MediaObject', contentUrl: pdfUrl(site, a), encodingFormat: 'application/pdf' } : undefined,
    citation: (a.sources || []).length ? a.sources : undefined,
    copyrightHolder: { '@type': 'Organization', name: site.publisher },
    copyrightYear: year(a.publishedAt) || undefined
  };
  if (a.correction) ld.correction = { '@type': 'CorrectionComment', text: a.correction };

  if (a.partner) {
    ld.sponsor = { '@type': 'Organization', name: a.partner.name, url: a.partner.website || undefined };
  }
  // Promoted (sponsored) content is not research: it gets no Google Scholar / Highwire tags.
  const promoted = a.partner && a.partner.type === 'promoted';
  return [
    ...(promoted ? [] : highwire), ...dublinCore, ...social,
    m('author', authors.map((x) => x.name).join(', ')),
    m('keywords', keywords),
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`
  ].filter(Boolean).join('\n');
}

/* ---------- Human-readable citations ---------- */

// Organisations (e.g. "Curated by Ahmedabad Business Review") are never split into first/last names.
const nameParts = (x) => x && x.corporate ? { first: '', last: x.name, initials: '' } : splitName(x && x.name);

function apaAuthors(authors) {
  const names = authors.map((x) => { const n = nameParts(x); return n.initials ? `${n.last}, ${n.initials}` : n.last; });
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  return names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1];
}

function mlaAuthors(authors) {
  const first = nameParts(authors[0]);
  const lead = first.first ? `${first.last}, ${first.first}` : first.last;
  if (authors.length === 1) return lead;
  if (authors.length === 2) return `${lead}, and ${authors[1].name}`;
  return `${lead}, et al`;
}

function chicagoAuthors(authors) {
  const first = nameParts(authors[0]);
  const lead = first.first ? `${first.last}, ${first.first}` : first.last;
  if (authors.length === 1) return lead;
  const rest = authors.slice(1).map((x) => x.name);
  if (authors.length === 2) return `${lead}, and ${rest[0]}`;
  return `${lead}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
}

function harvardAuthors(authors) {
  const names = authors.map((x) => { const n = nameParts(x); return n.initials ? `${n.last}, ${n.initials.replace(/ /g, '')}` : n.last; });
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

const endDot = (s) => /[.?!]$/.test(s) ? s : s + '.';

export function citations(site, a) {
  const url = articleUrl(site, a);
  const authors = a.authors && a.authors.length ? a.authors : [{ name: site.name, corporate: true }];
  // When the publication itself is the author, MLA and Chicago start with the title.
  const selfAuthored = authors.length === 1 && authors[0].corporate && authors[0].name === site.name;
  const t = esc(a.title);
  const pub = `<i>${esc(site.name)}</i>`;
  const y = year(a.publishedAt);
  const vi = volumeIssue(site, a.publishedAt) || {};
  const hasVol = !!vi.volume;

  const bibKey = (selfAuthored ? 'abr' : (nameParts(authors[0]).last || 'abr')).toLowerCase().replace(/[^a-z]/g, '') + y +
    (a.title.toLowerCase().match(/[a-z]{4,}/) || ['article'])[0];
  const bibtex =
`@article{${bibKey},
  author    = {${authors.map((x) => { if (x.corporate) return `{${x.name}}`; const n = splitName(x.name); return n.first ? `${n.last}, ${n.first}` : n.last; }).join(' and ')}},
  title     = {${a.title.replace(/[{}]/g, '')}},
  journal   = {${site.name}},
  publisher = {${site.publisher}},
  year      = {${y}},${hasVol ? `
  volume    = {${vi.volume}},
  number    = {${vi.issue}},` : ''}
  month     = {${monthName(a.publishedAt).slice(0, 3).toLowerCase()}},
  url       = {${url}},
  note      = {${a.id}}
}`;

  const apaVol = hasVol ? `, <i>${vi.volume}</i>(${vi.issue})` : '';
  const mlaVol = hasVol ? `, vol. ${vi.volume}, no. ${vi.issue}` : '';
  const chiVol = hasVol ? ` ${vi.volume}, no. ${vi.issue}` : '';
  const harVol = hasVol ? `, ${vi.volume}(${vi.issue})` : '';
  return [
    { id: 'apa', label: 'APA 7', html:
      `${esc(endDot(apaAuthors(authors)))} (${y}). ${t}. ${pub}${apaVol}, Article ${esc(a.id)}. <a href="${url}">${url}</a>` },
    { id: 'mla', label: 'MLA 9', html:
      `${selfAuthored ? '' : esc(endDot(mlaAuthors(authors))) + ' '}“${t}.” ${pub}${mlaVol}, ${fmtMLA(a.publishedAt)}, ${esc(url.replace(/^https?:\/\//, ''))}.` },
    { id: 'chicago', label: 'Chicago', html:
      `${selfAuthored ? '' : esc(endDot(chicagoAuthors(authors))) + ' '}“${t}.” ${pub}${chiVol} (${hasVol ? `${esc(vi.months)} ${y}` : fmtUS(a.publishedAt)}). <a href="${url}">${url}</a>.` },
    { id: 'harvard', label: 'Harvard', html:
      `${esc(harvardAuthors(authors))} (${y}) ‘${t}’, ${pub}${harVol}, Article ${esc(a.id)}. Available at: <a href="${url}">${url}</a> (Accessed: <span data-accessed>${fmtDate(new Date().toISOString())}</span>).` },
    { id: 'bibtex', label: 'BibTeX', pre: true, html: esc(bibtex) }
  ];
}
