// Research-paper layout used for the downloadable PDF of every article
// (and for the printable /articles/<slug>/paper view).
// A4 · Times New Roman 12 pt · double-spaced body · hairline page frame on every page.

import { esc, fmtDate, volumeIssue, isoWithOffset } from './util.js';
import { citations, articleUrl } from './citation.js';
import { sanitizeHtml } from '../public/assets/sanitize.js';

export const PAPER_VERSION = '1';   // bump to regenerate every stored PDF after a design change

function linkify(text) {
  return String(text).split(/(https?:\/\/[^\s<>"]+)/g)
    .map((p, i) => i % 2 ? `<a href="${esc(p.replace(/[.,;)]+$/, ''))}">${esc(p)}</a>` : esc(p)).join('');
}

export function paperFooterTemplate(site, a) {
  const vi = volumeIssue(site, a.publishedAt);
  const left = [site.name, vi && vi.volume ? `Vol. ${vi.volume}, No. ${vi.issue}` : vi && vi.label, a.id].filter(Boolean).join(' · ');
  return `<div style="width:100%;font-family:'Times New Roman',Tinos,'Liberation Serif',Times,serif;font-size:8pt;color:#333;padding:0 13mm;display:flex;justify-content:space-between;">
    <span>${esc(left)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

export function renderPaper(site, a, { forPrint = false } = {}) {
  const url = articleUrl(site, a);
  const vi = volumeIssue(site, a.publishedAt);
  const authors = a.authors || [];
  const apa = citations(site, a).find((c) => c.id === 'apa');
  const updated = a.modifiedAt && a.modifiedAt.slice(0, 10) !== a.publishedAt.slice(0, 10);
  const body = sanitizeHtml(a.body)
    .replace(/<img /g, '<img referrerpolicy="no-referrer" ');

  const authorLine = authors.map((x, i) =>
    `<span class="au">${esc(x.name)}<sup>${i + 1}</sup></span>`).join(', ');
  const affiliations = authors.map((x, i) =>
    `<div><sup>${i + 1}</sup> ${esc(x.title || 'Contributor')}, ${esc(site.name)}, Ahmedabad, India</div>`).join('');

  const notes = [
    a.correction ? `<p><b>Correction.</b> ${esc(a.correction)}</p>` : '',
    a.disclosure ? `<p><b>Disclosure.</b> ${esc(a.disclosure)}</p>` : '',
    a.type === 'Opinion' ? `<p><b>Note.</b> The views expressed are the author’s own and do not necessarily reflect those of ${esc(site.name)} or ${esc(site.publisherShort)}.</p>` : ''
  ].join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(a.title)} | ${esc(site.name)}</title>
<meta name="author" content="${esc(authors.map((x) => x.name).join(', '))}">
<meta name="description" content="${esc(a.standfirst || '')}">
${forPrint ? '<meta name="robots" content="noindex">' : ''}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap">
<style>
  @page { size: A4; margin: 12mm 12mm 16mm 12mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #000; background: #fff;
    font-family: 'Times New Roman', Tinos, 'Liberation Serif', Times, serif; font-size: 12pt; }
  /* Hairline frame on every page: the sheet's border and padding are repeated on each page fragment. */
  .sheet { border: 0.4pt solid #000; padding: 12mm 10mm 12mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  a { color: #000; text-decoration: none; }
  .mast { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 3mm; border-bottom: 0.4pt solid #000; }
  .mast img { width: 58mm; height: auto; display: block; }
  .mast .meta { text-align: right; font-size: 8.5pt; line-height: 1.35; }
  .kicker { margin: 7mm 0 0; text-align: center; font-size: 8.5pt; letter-spacing: 0.18em; text-transform: uppercase; }
  h1.title { margin: 4mm 6mm 0; text-align: center; font-size: 19pt; line-height: 1.22; font-weight: 700; }
  .authors { margin-top: 5mm; text-align: center; font-size: 12pt; }
  .authors sup, .affil sup { font-size: 7pt; }
  .affil { margin-top: 2mm; text-align: center; font-size: 9.5pt; font-style: italic; line-height: 1.4; }
  .dates { margin-top: 3mm; text-align: center; font-size: 9pt; color: #222; }
  .abstract { margin: 6mm 0 0; border: 0.4pt solid #000; padding: 4mm 5mm; font-size: 11pt; line-height: 1.5; text-align: justify; hyphens: auto; }
  .abstract h2 { margin: 0 0 1.5mm; font-size: 10pt; letter-spacing: 0.14em; text-transform: uppercase; text-align: center; font-weight: 700; }
  .abstract .kw { margin-top: 2mm; font-size: 10pt; }
  .cite { margin-top: 3mm; font-size: 9pt; line-height: 1.4; padding: 2.5mm 0; border-top: 0.4pt solid #000; border-bottom: 0.4pt solid #000; overflow-wrap: anywhere; }
  .cite b { letter-spacing: 0.08em; text-transform: uppercase; font-size: 8pt; }
  main { margin-top: 8mm; line-height: 2; text-align: justify; hyphens: auto; }
  main p { margin: 0; text-indent: 0.5in; orphans: 3; widows: 3; }
  main h2 + p, main h3 + p, main h4 + p, main > p:first-child, main blockquote + p, main ul + p, main ol + p, main figure + p { text-indent: 0; }
  main h2 { font-size: 12pt; font-weight: 700; text-align: center; margin: 0; page-break-after: avoid; break-after: avoid; }
  main h3 { font-size: 12pt; font-weight: 700; margin: 0; page-break-after: avoid; break-after: avoid; }
  main h4 { font-size: 12pt; font-weight: 700; font-style: italic; margin: 0; }
  main ul, main ol { margin: 0; padding-left: 0.5in; }
  main blockquote { margin: 0 0 0 0.5in; }
  main blockquote p { text-indent: 0; }
  main figure { margin: 4mm 0; text-align: center; break-inside: avoid; }
  main img { max-width: 100%; max-height: 120mm; }
  main figcaption { font-size: 10pt; line-height: 1.4; font-style: italic; margin-top: 2mm; }
  main table { width: 100%; border-collapse: collapse; font-size: 10pt; line-height: 1.4; margin: 3mm 0; border-top: 0.8pt solid #000; border-bottom: 0.8pt solid #000; }
  main th { border-bottom: 0.4pt solid #000; text-align: left; padding: 1.5mm; }
  main td { padding: 1.5mm; vertical-align: top; }
  .section-h { font-size: 12pt; font-weight: 700; text-align: center; margin: 8mm 0 0; line-height: 2; page-break-after: avoid; break-after: avoid; }
  .notes p { margin: 0; line-height: 2; text-align: justify; }
  .refs { line-height: 2; }
  .refs p { margin: 0; padding-left: 0.5in; text-indent: -0.5in; overflow-wrap: anywhere; text-align: left; }
  .bios { font-size: 11pt; line-height: 1.5; text-align: justify; }
  .bios p { margin: 0 0 2mm; }
  .colophon { margin-top: 10mm; padding-top: 3mm; border-top: 0.4pt solid #000; font-size: 8.5pt; line-height: 1.45; color: #222; }
  ${forPrint ? `@media screen { body { background: #e8e6e1; } .sheet { background: #fff; max-width: 186mm; margin: 10mm auto; box-shadow: 0 1px 6px rgba(0,0,0,.2); position: relative; }
    .printbar { text-align: center; font: 14px/1.4 Arial, sans-serif; padding: 12px; } .printbar button { font: 600 14px Arial; padding: 8px 16px; background: #000; color: #fff; border: 0; cursor: pointer; } }
    @media print { .printbar { display: none; } }` : ''}
</style></head>
<body>
${forPrint ? `<div class="printbar">Research-paper view of this article. <button onclick="window.print()">Print / Save as PDF</button> &nbsp; <a href="${esc(url)}" style="text-decoration:underline">Back to article</a></div>` : ''}
<div class="sheet">
<header class="mast">
  <img src="${site.url}/brand/logo/horizontal/ABR-Horizontal-Black.png" alt="${esc(site.name)}">
  <div class="meta">
    <div><b>${esc(site.name)}</b></div>
    ${vi ? `<div>${esc(vi.label)}</div>` : ''}
    <div>Article ${esc(a.id)}</div>
    ${site.issn ? `<div>ISSN ${esc(site.issn)} (Online)</div>` : ''}
    <div>${esc(site.url.replace(/^https?:\/\//, ''))}</div>
  </div>
</header>

<div class="kicker">${esc(a.section || '')}${a.type ? ` &nbsp;·&nbsp; ${esc(a.type)}` : ''}</div>
<h1 class="title">${esc(a.title)}</h1>
<div class="authors">${authorLine}</div>
<div class="affil">${affiliations}</div>
<div class="dates">Published ${fmtDate(a.publishedAt)}${updated ? ` · Updated ${fmtDate(a.modifiedAt)}` : ''} · Open access</div>

${a.standfirst ? `<section class="abstract"><h2>Abstract</h2><div>${esc(a.standfirst)}</div>
${(a.tags || []).length ? `<div class="kw"><i>Keywords:</i> ${esc(a.tags.join(', '))}</div>` : ''}</section>` : ''}

<div class="cite"><b>How to cite:</b> ${apa ? apa.html : ''}</div>

<main>
${body}
</main>

${notes ? `<h2 class="section-h">Notes</h2><div class="notes">${notes}</div>` : ''}

${(a.sources || []).length ? `<h2 class="section-h">References</h2><div class="refs">${a.sources.map((s) => `<p>${linkify(s)}</p>`).join('')}</div>` : ''}

${authors.some((x) => x.bio) ? `<h2 class="section-h">About the author${authors.length > 1 ? 's' : ''}</h2><div class="bios">${authors.filter((x) => x.bio).map((x) => {
  const bio = String(x.bio).trim();
  return bio.toLowerCase().startsWith(String(x.name).toLowerCase()) ? `<p><b>${esc(x.name)}</b>${esc(bio.slice(x.name.length))}</p>` : `<p><b>${esc(x.name)}.</b> ${esc(bio)}</p>`;
}).join('')}</div>` : ''}

<div class="colophon">
  © ${esc(String(new Date(a.publishedAt).getUTCFullYear()))} ${esc(site.publisher)}. Published by ${esc(site.name)}, Ahmedabad, India.
  This article was reviewed and approved under ABR’s editorial standards (${esc(site.url.replace(/^https?:\/\//, ''))}/editorial-standards).
  It may be quoted with attribution and a link to the original.<br>
  Permanent link: <a href="${esc(url)}">${esc(url)}</a> · Published online ${esc(isoWithOffset(a.publishedAt).slice(0, 10))}.
</div>
</div>
</body></html>`;
}
