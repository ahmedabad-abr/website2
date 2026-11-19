// Printable documents: certificates, letters on letterhead, issue covers, compiled
// issues and article share cards. Each returns a complete HTML document that works
// both in the browser (with a small toolbar) and as input for PDF/PNG rendering.

import { esc, fmtDate, truncate, issueVI } from './util.js';
import { renderPaper } from './paper.js';
import { code128, ean13, issnToEan13 } from './barcode.js';
import { ORNAMENTS } from './festive.js';

const FONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@400;500;600;700;800&family=Tinos:ital,wght@0,400;0,700;1,400&display=swap">';

const fmtDay = (d) => d ? fmtDate(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00+05:30' : d) : '';

function toolbar(items) {
  return `<div class="tb no-print">${items.filter(Boolean).join('')}</div>`;
}
const TOOLBAR_CSS = `
.tb { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; padding: 12px; background: #111; font: 500 14px Inter, Arial, sans-serif; }
.tb a, .tb button { color: #fff; background: transparent; border: 1px solid #555; padding: 8px 14px; text-decoration: none; cursor: pointer; font: inherit; border-radius: 3px; }
.tb a.primary, .tb button.primary { background: #fff; color: #000; border-color: #fff; }
@media print { .no-print { display: none !important; } }`;

/* ------------------------------------------------------------------ */
/* Certificates                                                        */
/* ------------------------------------------------------------------ */

export function certificateWording(site, c) {
  const d = c.detail || {};
  const art = (t) => `“${esc(t)}”`;
  switch (c.type) {
    case 'contributor':
      return `for authoring the article ${art(d.title)}, published in <i>${esc(site.name)}</i> on ${esc(fmtDay(d.publishedAt))} as Article ${esc(d.articleId)}.`;
    case 'term':
      return `for serving as <b>${esc(d.office)}</b> of <i>${esc(site.name)}</i> from ${esc(fmtDay(d.start))} to ${esc(fmtDay(d.end))}, with dedication to its editorial mission.`;
    case 'issue': {
      const list = (d.articles || []).map(art);
      const arts = list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '';
      return `for contributing ${list.length > 1 ? 'the articles' : 'the article'} ${arts} to <i>${esc(site.name)}</i>, ${esc(d.issueLabel || '')}.`;
    }
    case 'service':
      return `for editorial service as <b>${esc(d.office || 'Editor')}</b> of <i>${esc(site.name)}</i> from ${esc(fmtDay(d.from))} to ${esc(fmtDay(d.to))}.`;
    default:
      return esc(d.text || '');
  }
}

export function certificateDoc(site, c, { forPrint = false } = {}) {
  const url = `${site.url}/certificates/${c.id}`;
  const heading = c.type === 'custom' ? (c.detail && c.detail.heading) || 'Certificate of Recognition' : c.typeLabel;
  const issued = new Date(c.issuedAt);
  const li = `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(heading)}&organizationName=${encodeURIComponent(site.name)}&issueYear=${issued.getFullYear()}&issueMonth=${issued.getMonth() + 1}&certUrl=${encodeURIComponent(url)}&certId=${encodeURIComponent(c.id)}`;
  const revoked = c.status === 'revoked';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}: ${esc(c.name)} | ${esc(site.name)}</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="${esc(heading)}: ${esc(c.name)}">
<meta property="og:description" content="Issued by ${esc(site.name)} · ${esc(c.id)}">
${FONTS}
<style>
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #e9e6df; font-family: 'EB Garamond', Tinos, Georgia, serif; color: #111; }
.page { width: 297mm; height: 210mm; margin: 24px auto; background: #fbfaf6; position: relative; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.15); }
@media print { body { background: #fff; } .page { margin: 0; box-shadow: none; } }
.frame { position: absolute; inset: 9mm; border: 0.6pt solid #111; }
.frame::after { content: ''; position: absolute; inset: 2.2mm; border: 1.6pt solid #111; }
.band { position: absolute; left: 9mm; right: 9mm; bottom: 9mm; height: 7mm; background: repeating-linear-gradient(90deg, #111 0 6mm, transparent 6mm 7mm); opacity: .08; }
.inner { position: absolute; inset: 20mm 26mm 18mm; display: flex; flex-direction: column; align-items: center; text-align: center; }
.logo { height: 15mm; margin-bottom: 7mm; }
.kick { font: 600 9pt Inter, Arial, sans-serif; letter-spacing: .32em; text-transform: uppercase; color: #555; }
h1 { font-weight: 500; font-size: 34pt; margin: 2mm 0 6mm; letter-spacing: .01em; }
.certify { font-size: 13pt; font-style: italic; color: #333; }
.name { font-size: 36pt; font-weight: 500; font-style: italic; margin: 3mm 0 1mm; padding: 0 10mm 2mm; border-bottom: 0.6pt solid #111; }
.role { font: 500 9.5pt Inter, Arial, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #555; margin-top: 2mm; }
.text { font-size: 14.5pt; line-height: 1.5; max-width: 205mm; margin: 6mm auto 0; }
.foot { margin-top: auto; width: 100%; display: flex; justify-content: space-between; align-items: flex-end; font-family: Inter, Arial, sans-serif; }
.sig { text-align: left; min-width: 70mm; }
.sig .line { border-top: 0.6pt solid #111; padding-top: 2mm; font: 600 10pt Inter, Arial, sans-serif; }
.sig .t { font-size: 8.5pt; color: #555; }
.sigimg { display: block; height: 15mm; max-width: 60mm; object-fit: contain; margin: 0 0 -1mm; }
.seal { width: 26mm; height: 26mm; border-radius: 50%; border: 1pt solid #111; display: flex; align-items: center; justify-content: center; }
.seal img { width: 13mm; }
.meta { text-align: right; font-size: 8pt; color: #444; line-height: 1.5; min-width: 70mm; }
.meta b { font-size: 9pt; color: #111; letter-spacing: .04em; }
.revoked { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.revoked span { transform: rotate(-18deg); font: 800 64pt Inter, Arial, sans-serif; color: rgba(170,0,0,.22); border: 6pt solid rgba(170,0,0,.22); padding: 4mm 12mm; }
${TOOLBAR_CSS}
</style></head><body>
${forPrint ? '' : toolbar([
    `<a class="primary" href="/certificates/${esc(c.id)}.pdf">Download PDF</a>`,
    '<button onclick="window.print()">Print</button>',
    revoked ? '' : `<a href="${esc(li)}" target="_blank" rel="noopener">Add to LinkedIn</a>`,
    `<a href="/verify?ref=${esc(c.id)}">Verify</a>`
  ])}
<div class="page">
  <div class="frame"></div><div class="band"></div>
  <div class="inner">
    <img class="logo" src="${site.url}/brand/logo/horizontal/ABR-Horizontal-Black.png" alt="${esc(site.name)}">
    <div class="kick">${esc(site.name)}</div>
    <h1>${esc(heading)}</h1>
    <div class="certify">This is to certify that</div>
    <div class="name">${esc(c.name)}</div>
    ${c.role ? `<div class="role">${esc(c.role)}</div>` : ''}
    <div class="text">${c.type === 'custom' ? certificateWording(site, c) : `is recognised ${certificateWording(site, c)}`}</div>
    <div class="foot">
      <div class="sig">${c.signature ? `<img class="sigimg" src="${c.signature}" alt="Signature">` : ''}<div class="line">${esc((c.signatory && c.signatory.name) || '')}</div>
        <div class="t">${esc((c.signatory && c.signatory.title) || 'Chairperson')}, ${esc(site.name)}</div></div>
      <div class="seal"><img src="${site.url}/brand/logo/emblem/ABR-Emblem-Black.png" alt=""></div>
      <div class="meta"><b>${esc(c.id)}</b><br>Issued ${esc(fmtDate(c.issuedAt))}<br>Verify at ${esc(site.url.replace(/^https?:\/\//, ''))}/verify<br>Published by ${esc(site.publisher)}</div>
    </div>
  </div>
  ${revoked ? '<div class="revoked"><span>REVOKED</span></div>' : ''}
</div>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Letters on letterhead                                               */
/* ------------------------------------------------------------------ */

// Plain-text letter body → HTML. A blank line starts a new paragraph, a single line
// break stays a line break, "- " or "• " lines become bullets, "1. " lines a numbered
// list, **bold** and _italic_ are supported.
export function letterBodyHtml(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_(.+?)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  return String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) return '';
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

export function letterFooterTemplate(site, l) {
  return `<div style="width:100%;padding:0 18mm;font-family:Arial,sans-serif;font-size:7pt;color:#555;display:flex;justify-content:space-between;">
    <span>${esc(site.name)} · An initiative of ${esc(site.publisher)} · ${esc(site.url.replace(/^https?:\/\//, ''))}</span>
    <span>Ref. ${esc(l.id)} · Verify at ${esc(site.url.replace(/^https?:\/\//, ''))}/verify · Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

export function letterDoc(site, l, { forPrint = false, pdfHref = '' } = {}) {
  const revoked = l.status === 'revoked';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(l.subject)} | ${esc(site.name)}</title>
<meta name="robots" content="noindex, nofollow">
${FONTS}
<style>
@page { size: A4; margin: 16mm 18mm 20mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #e9e6df; font-family: Tinos, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.5; color: #111; }
.page { width: 210mm; min-height: 297mm; margin: 24px auto; background: #fff; padding: 16mm 18mm 20mm; box-shadow: 0 10px 40px rgba(0,0,0,.15); position: relative; }
@media print { body { background: #fff; } .page { margin: 0; padding: 0; width: auto; min-height: 0; box-shadow: none; } }
.lh { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 4mm; border-bottom: 1.4pt solid #111; }
.lh img { height: 13mm; }
.lh .c { text-align: right; font: 8pt/1.5 Inter, Arial, sans-serif; color: #333; }
.lh2 { border-top: 0.4pt solid #111; margin-top: 0.8mm; }
.refrow { display: flex; justify-content: space-between; margin: 8mm 0 6mm; font: 9.5pt Inter, Arial, sans-serif; }
.to { white-space: pre-line; margin-bottom: 6mm; }
.subj { font-weight: 700; margin: 0 0 5mm; }
.body p { margin: 0 0 3.5mm; text-align: justify; }
.body ul, .body ol { margin: 0 0 3.5mm; padding-left: 7mm; }
.close { margin-top: 8mm; }
.sign { margin-top: 16mm; }
.sign .sigimg { display: block; height: 15mm; max-width: 60mm; object-fit: contain; margin: -10mm 0 1mm; }
.sign b { display: block; }
.cc { margin-top: 8mm; font-size: 9.5pt; white-space: pre-line; }
.revoked { position: absolute; top: 40%; left: 0; right: 0; text-align: center; transform: rotate(-18deg); font: 800 60pt Inter, Arial, sans-serif; color: rgba(170,0,0,.2); pointer-events: none; }
.webfoot { margin-top: 14mm; padding-top: 3mm; border-top: 0.4pt solid #999; font: 7.5pt Inter, Arial, sans-serif; color: #555; display: flex; justify-content: space-between; }
@media print { .webfoot { display: none; } }
${TOOLBAR_CSS}
</style></head><body>
${forPrint ? '' : toolbar([pdfHref ? `<a class="primary" href="${esc(pdfHref)}">Download PDF</a>` : '', '<button onclick="window.print()">Print</button>', `<a href="/verify?ref=${esc(l.id)}">Verify</a>`])}
<div class="page">
  <div class="lh">
    <img src="${site.url}/brand/logo/horizontal/ABR-Horizontal-Black.png" alt="${esc(site.name)}">
    <div class="c">An initiative of ${esc(site.publisher)}<br>Ahmedabad, Gujarat, India<br>${esc(site.url.replace(/^https?:\/\//, ''))} · ${esc(site.contactEmail)}</div>
  </div>
  <div class="lh2"></div>
  <div class="refrow"><span>Ref. <b>${esc(l.id)}</b></span><span>${esc(fmtDay(l.date))}</span></div>
  ${l.toBlock ? `<div class="to">${esc(l.toBlock)}</div>` : ''}
  <div class="subj">Subject: ${esc(l.subject)}</div>
  <div class="body">${letterBodyHtml(l.body)}</div>
  <div class="close">${esc(l.closing || 'Yours sincerely,')}</div>
  <div class="sign">${l.signature ? `<img class="sigimg" src="${l.signature}" alt="Signature">` : ''}<b>${esc(l.signName)}</b>${esc(l.signTitle)}<br>${esc(site.name)}</div>
  ${l.cc ? `<div class="cc"><b>Copy to:</b>\n${esc(l.cc)}</div>` : ''}
  ${forPrint ? '' : `<div class="webfoot"><span>${esc(site.name)} · An initiative of ${esc(site.publisher)}</span><span>Ref. ${esc(l.id)} · Verify at ${esc(site.url.replace(/^https?:\/\//, ''))}/verify</span></div>`}
  ${revoked ? '<div class="revoked">REVOKED</div>' : ''}
</div>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Issue cover and compiled issue                                      */
/* ------------------------------------------------------------------ */

export const COVER_PALETTE = {
  ink:        { bg: '#111111', fg: '#ffffff', accent: '#d9c9a3' },
  saffron:    { bg: '#e8902a', fg: '#111111', accent: '#ffffff' },
  indigo:     { bg: '#1f2a5c', fg: '#ffffff', accent: '#f2b84b' },
  forest:     { bg: '#1e4d3a', fg: '#ffffff', accent: '#e9d8a6' },
  terracotta: { bg: '#a8442a', fg: '#ffffff', accent: '#f5e6c8' },
  slate:      { bg: '#e7e4dc', fg: '#111111', accent: '#a8442a' }
};

// Stepwell (vav) motif: nested descending steps, echoing the ABR emblem.
function stepwellSvg(color) {
  const steps = [];
  for (let i = 0; i < 9; i++) {
    const w = 360 - i * 36, x = (360 - w) / 2;
    steps.push(`<rect x="${x}" y="${i * 22}" width="${w}" height="22" fill="none" stroke="${color}" stroke-width="1.2"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200" preserveAspectRatio="xMidYMax meet">${steps.join('')}</svg>`;
}

function coverInner(site, issue) {
  const pal = COVER_PALETTE[issue.coverStyle] || COVER_PALETTE.ink;
  const white = pal.fg === '#ffffff';
  const logo = `${site.url}/brand/logo/primary/ABR-Primary-Stacked-${white ? 'White' : 'Black'}.png`;
  const lead = (issue.articles || []).slice(0, 5);
  return `<div class="cover" style="background:${pal.bg};color:${pal.fg}">
    <div class="cv-top"><img src="${logo}" alt="${esc(site.name)}">
      <div class="cv-meta"><div>Vol. ${issue.volume} · No. ${issue.number}</div><div>${esc(issue.months)} ${issue.year}</div>${site.issn ? `<div>ISSN ${esc(site.issn)}</div>` : ''}</div></div>
    <div class="cv-rule" style="background:${pal.fg}"></div>
    <div class="cv-title">${esc(issue.title || 'The ' + issue.months + ' Issue')}</div>
    ${issue.theme ? `<div class="cv-theme" style="color:${pal.accent}">${esc(issue.theme)}</div>` : ''}
    <div class="cv-list">${lead.map((a) => `<div class="cv-item"><span class="cv-sec" style="color:${pal.accent}">${esc(a.section || '')}</span>${esc(a.title)}<span class="cv-by">${esc(a.curated ? 'ABR Editorial Desk' : (a.authors || []).map((x) => x.name).join(', '))}</span></div>`).join('')}</div>
    <div class="cv-art">${stepwellSvg(pal.fg)}</div>
    <div class="cv-foot"><span>${esc(site.tagline)}</span><span>${esc(site.url.replace(/^https?:\/\//, ''))}</span></div>
  </div>`;
}

const COVER_CSS = `
.cover { width: 210mm; height: 297mm; position: relative; overflow: hidden; padding: 16mm 16mm 14mm; font-family: Inter, Arial, sans-serif; display: flex; flex-direction: column; }
.cv-top { display: flex; justify-content: space-between; align-items: flex-start; }
.cv-top img { height: 30mm; }
.cv-meta { text-align: right; font-size: 10pt; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; line-height: 1.6; }
.cv-rule { height: 1.5pt; margin: 9mm 0 12mm; opacity: .9; }
.cv-title { font-family: 'EB Garamond', Tinos, serif; font-size: 50pt; line-height: 1.02; font-weight: 500; max-width: 165mm; }
.cv-theme { font-family: 'EB Garamond', Tinos, serif; font-style: italic; font-size: 17pt; line-height: 1.35; margin-top: 6mm; max-width: 150mm; }
.cv-list { margin-top: 14mm; max-width: 120mm; position: relative; z-index: 2; }
.cv-item { font-size: 12.5pt; font-weight: 700; line-height: 1.3; padding: 3.2mm 0; border-top: 0.5pt solid currentColor; }
.cv-sec { display: block; font-size: 7.5pt; letter-spacing: .16em; text-transform: uppercase; font-weight: 700; margin-bottom: 1mm; }
.cv-by { display: block; font-weight: 400; font-size: 9pt; opacity: .8; margin-top: 1mm; }
.cv-art { position: absolute; right: -10mm; bottom: 18mm; width: 120mm; opacity: .35; }
.cv-art svg { width: 100%; height: auto; display: block; }
.cv-foot { margin-top: auto; display: flex; justify-content: space-between; font-size: 8.5pt; opacity: .85; position: relative; z-index: 2; }`;

// Issue reference printed under the barcode, e.g. ABR-V1-N06-2026
export function issueRef(issue) {
  return `ABR-V${issue.volume}-N${String(issue.number).padStart(2, '0')}-${issue.year}`;
}

function issueBarcode(site, issue) {
  const ean = site.issn ? issnToEan13(site.issn) : '';
  if (ean) return ean13(ean, { addOn: String(issue.number).padStart(2, '0') });
  return code128(issueRef(issue), { height: 64, module: 2 });
}

function backCoverInner(site, issue) {
  const pal = COVER_PALETTE[issue.coverStyle] || COVER_PALETTE.ink;
  const white = pal.fg === '#ffffff';
  const emblem = `${site.url}/brand/logo/emblem/ABR-Emblem-${white ? 'White' : 'Black'}.png`;
  const host = site.url.replace(/^https?:\/\//, '');
  return `<div class="cover back" style="background:${pal.bg};color:${pal.fg}">
    <div class="bk-top"><img src="${emblem}" alt=""><div class="bk-tag">${esc(site.tagline || '')}</div></div>
    <div class="bk-about">
      <div class="bk-h" style="color:${pal.accent}">About ${esc(site.shortName)}</div>
      <p>${esc(site.name)} publishes evidence-based analysis, case studies and explainers on business, entrepreneurship, innovation, leadership and policy, from Ahmedabad for India and the world.</p>
      <p>Every article is reviewed and approved before publication, carries its references, and can be cited. Corrections are made in public.</p>
      <div class="bk-h" style="color:${pal.accent}">Read, cite, write</div>
      <p>Read every article free at <b>${esc(host)}</b> · Cite it with the article ID and link · Write for us at <b>${esc(host)}/write</b> · Subscribe at <b>${esc(host)}/subscribe</b></p>
    </div>
    <div class="bk-foot">
      <div class="bk-pub">Published by ${esc(site.publisher)}, Ahmedabad, Gujarat, India.<br>
        ${esc(issue.label)}${site.issn ? ` · ISSN ${esc(site.issn)}` : ''}<br>
        © ${issue.year} ${esc(site.publisher)}. Verify any ABR certificate, letter or record at ${esc(host)}/verify.</div>
      <div class="bk-code"><div class="bk-code-in">${issueBarcode(site, issue)}</div><div class="bk-code-l">${site.issn ? 'ISSN periodical code' : 'Issue reference'}</div></div>
    </div>
  </div>`;
}

const BACK_CSS = `
.back { justify-content: space-between; }
.bk-top { display: flex; align-items: center; gap: 8mm; }
.bk-top img { height: 26mm; }
.bk-tag { font-family: 'EB Garamond', Tinos, serif; font-style: italic; font-size: 16pt; max-width: 120mm; line-height: 1.3; }
.bk-about { max-width: 140mm; font-family: Tinos, 'Times New Roman', serif; font-size: 12pt; line-height: 1.55; }
.bk-about p { margin: 0 0 5mm; }
.bk-h { font: 700 8pt Inter, Arial, sans-serif; letter-spacing: .2em; text-transform: uppercase; margin: 6mm 0 2mm; }
.bk-foot { display: flex; width: 100%; justify-content: space-between; align-items: flex-end; gap: 10mm; }
.bk-pub { flex: 1 1 110mm; width: 110mm; min-width: 90mm; font-size: 8.5pt; line-height: 1.6; opacity: .9; }
.bk-code { flex: none; background: #fff; color: #000; padding: 3mm 4mm 2mm; text-align: center; }
.bk-code-in svg { display: block; height: 24mm; width: auto; }
.bk-code-l { font: 600 6.5pt Inter, Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; margin-top: 1mm; }`;

export function issueBackCoverDoc(site, issue) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
@page { size: A4; margin: 0; } * { box-sizing: border-box; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; } ${COVER_CSS} ${BACK_CSS}</style></head><body>${backCoverInner(site, issue)}</body></html>`;
}

export function issueCoverDoc(site, issue) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
@page { size: A4; margin: 0; } * { box-sizing: border-box; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; } ${COVER_CSS}</style></head><body>${coverInner(site, issue)}</body></html>`;
}

function paperParts(html) {
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const body = (html.match(/<body>([\s\S]*?)<\/body>/) || [])[1] || '';
  return { style, body };
}

export function issueCompiledDoc(site, issue, { forPrint = false } = {}) {
  const arts = issue.articles || [];
  const paper = arts.length ? paperParts(renderPaper(site, arts[0])) : { style: '' };
  const statements = [
    issue.chairStatement ? { heading: 'From the Chair', name: issue.chair ? issue.chair.name : '', title: issue.chair ? issue.chair.title : 'Chairperson', text: issue.chairStatement } : null,
    ...(issue.statements || []).map((s) => ({ heading: s.role === 'eic' ? 'From the Editor-in-Chief' : s.role === 'coo' ? 'From the Chief Operating Officer' : `From the editors: ${s.name}`, name: s.name, title: s.title, text: s.text }))
  ].filter(Boolean);
  const team = issue.team || [];
  const statementHtml = (s) => `<section class="stmt pg">
    <div class="st-kick">${esc(issue.label)}</div><h2>${esc(s.heading)}</h2>
    <div class="st-body">${letterBodyHtml(s.text)}</div>
    <div class="st-sign"><b>${esc(s.name)}</b><br>${esc(s.title)}, ${esc(site.name)}</div></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.name)}, ${esc(issue.label)}</title>
<meta name="robots" content="noindex">
${FONTS}
<style>
${paper.style}
@page cover { size: A4; margin: 0; }
.cover-page { page: cover; break-after: page; }
.back-page { page: cover; break-before: page; }
${COVER_CSS}
${BACK_CSS}
.pg { break-before: page; }
.front { font-family: Tinos, 'Times New Roman', serif; min-height: 268mm; }
.masthead-pg h2, .toc h2, .stmt h2 { font-family: 'EB Garamond', Tinos, serif; font-weight: 500; font-size: 26pt; margin: 0 0 6mm; }
.st-kick { font: 600 8pt Inter, Arial, sans-serif; letter-spacing: .2em; text-transform: uppercase; color: #555; margin-bottom: 3mm; }
.st-body p { margin: 0 0 4mm; line-height: 1.6; text-align: justify; font-size: 12pt; }
.st-sign { margin-top: 10mm; font-size: 11.5pt; }
.masthead-pg { font-size: 10.5pt; line-height: 1.6; }
.masthead-pg .role { font: 600 8pt Inter, Arial, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #555; margin-top: 4mm; }
.masthead-pg .small { font-size: 9pt; color: #333; margin-top: 10mm; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { padding: 3.5mm 0; border-top: 0.5pt solid #999; }
.toc .sec { font: 600 7.5pt Inter, Arial, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #555; }
.toc .t { font-size: 13pt; font-weight: 700; display: block; margin: 1mm 0; }
.toc .by { font-size: 10pt; color: #333; }
.art { break-before: page; }
${forPrint ? '' : TOOLBAR_CSS + ' body { background: #e9e6df; } .wrapdoc { width: 210mm; margin: 24px auto; background: #fff; } @media print { .wrapdoc { width: auto; margin: 0; } }'}
</style></head><body>
${forPrint ? '' : toolbar([site.pdf ? `<a class="primary" href="/issues/${esc(issue.key)}.pdf">Download PDF</a>` : '', '<button onclick="window.print()">Print / Save as PDF</button>', `<a href="/issues/${esc(issue.key)}">Back to issue</a>`])}
<div class="wrapdoc">
<div class="cover-page">${coverInner(site, issue)}</div>

<div class="sheet front masthead-pg">
  <h2>${esc(site.name)}</h2>
  <div>${esc(issue.label)}</div>
  ${team.map((x) => `<div class="role">${esc(x.title)}</div><div>${esc(x.name)}</div>`).join('')}
  <div class="small">Published by ${esc(site.publisher)}, Ahmedabad, India.<br>
  ${site.issn ? `ISSN ${esc(site.issn)} (Online)<br>` : ''}
  Every article in this issue is also published online at ${esc(site.url.replace(/^https?:\/\//, ''))}, where its permanent link, citation and any corrections can be found.<br>
  © ${issue.year} ${esc(site.publisher)} and the authors. Each article states its licence and credit line. For other uses, request permission at ${esc(site.url.replace(/^https?:\/\//, ''))}/permissions.</div>
</div>

${statements.map((s) => `<div class="sheet front">${statementHtml(s)}</div>`).join('')}

<div class="sheet front toc pg">
  <h2>Contents</h2>
  <ol>${arts.map((a) => `<li><span class="sec">${esc(a.section || '')}${a.type ? ' · ' + esc(a.type) : ''}</span><span class="t">${esc(a.title)}</span>
  <span class="by">${esc(a.curated ? 'Curated by ' + site.name : (a.authors || []).map((x) => x.name).join(', '))} · ${esc(a.id)}</span></li>`).join('')}</ol>
</div>

${arts.map((a) => `<div class="art">${paperParts(renderPaper(site, a)).body}</div>`).join('\n')}
<div class="back-page">${backCoverInner(site, issue)}</div>
</div>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Article share card (1200 × 630)                                     */
/* ------------------------------------------------------------------ */

export function shareCardDoc(site, a, vi) {
  const t = a.title || '';
  const size = t.length > 110 ? 50 : t.length > 80 ? 58 : t.length > 50 ? 66 : 76;
  const by = a.curated ? `Curated by ${site.name}` : (a.authors || []).map((x) => x.name).join(', ');
  const label = a.partner && a.partner.type === 'promoted' ? 'Promoted' : a.partner ? 'Partner' : '';
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
* { box-sizing: border-box; } html, body { margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #fbfaf6; font-family: Inter, Arial, sans-serif; color: #111; display: flex; }
.l { flex: 1; padding: 54px 60px 46px; display: flex; flex-direction: column; position: relative; }
.top { display: flex; align-items: center; justify-content: space-between; }
.top img { height: 40px; }
.kick { margin-top: 44px; font-size: 20px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #a8442a; }
.kick .pl { color: #111; border: 2px solid #111; padding: 2px 10px; margin-right: 14px; font-size: 16px; }
h1 { font-family: 'EB Garamond', Tinos, serif; font-weight: 600; font-size: ${size}px; line-height: 1.05; margin: 14px 0 0; letter-spacing: -.01em; }
.by { margin-top: auto; font-size: 22px; font-weight: 600; }
.meta { margin-top: 6px; font-size: 17px; color: #555; }
.r { width: ${a.coverUrl ? 380 : 0}px; background: #111 center/cover no-repeat ${a.coverUrl ? `url('${esc(a.coverUrl)}')` : ''}; }
.strip { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: #111; }
</style></head><body>
<div class="l">
  <div class="top"><img src="${site.url}/brand/logo/horizontal/ABR-Horizontal-Black.png" alt=""></div>
  <div class="kick">${label ? `<span class="pl">${label}</span>` : ''}${esc(a.section || '')}${a.type ? ' · ' + esc(a.type) : ''}</div>
  <h1>${esc(truncate(t, 150))}</h1>
  <div class="by">${esc(by)}</div>
  <div class="meta">${esc(a.id)}${vi ? ' · ' + esc(vi.label) : ''}${a.doi ? ' · DOI ' + esc(a.doi) : ''} · ${esc(site.url.replace(/^https?:\/\//, ''))}</div>
  <div class="strip"></div>
</div>
${a.coverUrl ? '<div class="r"></div>' : ''}
</body></html>`;
}

export { issueVI };

/* ------------------------------------------------------------------ */
/* Approval records (black and white only)                             */
/* ------------------------------------------------------------------ */

export function approvalFooterTemplate(site, r) {
  const host = site.url.replace(/^https?:\/\//, '');
  return `<div style="width:100%;padding:0 18mm;font-family:Arial,sans-serif;font-size:7pt;color:#000;display:flex;justify-content:space-between;">
    <span>${esc(site.name)} · An initiative of ${esc(site.publisher)} · Approval record ${esc(r.id)}</span>
    <span>Verify at ${esc(host)}/verify · Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

export function approvalDoc(site, r, { forPrint = false, autoPrint = false, pdfHref = '' } = {}) {
  const host = site.url.replace(/^https?:\/\//, '');
  const major = r.level === 'major';
  const when = fmtDate(r.decidedAt);
  const details = (r.details || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('');
  const head = (title, page) => `
    <div class="lh">
      <img src="${site.url}/brand/logo/horizontal/ABR-Horizontal-Black.png" alt="${esc(site.name)}">
      <div class="c">An initiative of ${esc(site.publisher)}<br>Ahmedabad, Gujarat, India<br>${esc(host)} · ${esc(site.contactEmail)}</div>
    </div>
    <div class="rule2"></div>
    <div class="ttl"><span>${esc(title)}</span><span>${page}</span></div>
    <table class="meta"><tr>
      <td><small>Reference</small><b>${esc(r.id)}</b></td>
      <td><small>Category</small>${esc(r.kindLabel)}</td>
      <td><small>Date of decision</small>${esc(when)}</td>
      <td><small>Signatures</small>${major ? 'Countersignature and Chairperson' : 'Chairperson'}</td>
    </tr></table>
    <div class="subj">${esc(r.subject)}</div>`;
  const sig = (role, name) => `
    <div class="sig">
      <div class="sigline"></div>
      <table class="sigt"><tr><th>Signature</th><td></td></tr>
        <tr><th>Name</th><td>${esc(name || '')}</td></tr>
        <tr><th>Designation</th><td>${esc(role)}</td></tr>
        <tr><th>Date</th><td></td></tr></table>
    </div>`;
  const filing = `
    <table class="filing"><tr><th colspan="4">For office use</th></tr>
      <tr><td><small>File number</small>${esc(r.fileRef || '')}</td><td><small>Filed by</small></td><td><small>Date filed</small>${r.filedAt ? esc(fmtDate(r.filedAt)) : ''}</td><td><small>Seal</small></td></tr></table>`;

  const countersignPage = major ? `
  <section class="pg">
    ${head('Countersignature', 'Page 1 of 2')}
    <p>The matter below has been placed before the countersigning authority of ${esc(site.publisher)} for countersignature before it is signed by the Chairperson of ${esc(site.name)} (page 2).</p>
    <table class="det">${details}</table>
    <div class="keep"><div class="box">
      <div class="boxh">Decision of the countersigning authority (tick one)</div>
      <div class="ticks"><span><i></i> Countersigned</span><span><i></i> Countersigned with remarks</span><span><i></i> Returned for reconsideration</span></div>
      <div class="boxh">Remarks</div>
      <div class="lines"><div></div><div></div><div></div></div>
    </div>
    ${sig(r.countersignRole || 'Countersigning authority', r.countersignName)}</div>
  </section>` : '';

  const chairPage = `
  <section class="pg">
    ${head('Approval record', major ? 'Page 2 of 2' : 'Page 1 of 1')}
    <table class="det">${details}</table>
    <div class="stmt">
      This matter was approved in the ${esc(site.name)} editorial system on <b>${esc(when)}</b>, recorded by ${esc(r.decidedByName || 'the Chairperson')}.
      ${major ? `It requires the countersignature of the <b>${esc(r.countersignRole)}</b> on page 1 before this page is signed.` : ''}
      By signing below, the Chairperson confirms the approval for the record. The signed original is to be filed under the reference above.
    </div>
    ${r.note ? `<div class="stmt"><b>Note:</b> ${esc(r.note)}</div>` : ''}
    <div class="keep">${sig(`${(r.chair && r.chair.title) || 'Chairperson'}, ${site.name}`, r.chair && r.chair.name)}
    ${filing}</div>
    ${forPrint ? '' : `<div class="webfoot"><span>${esc(site.name)} · Approval record ${esc(r.id)}</span><span>Verify at ${esc(host)}/verify</span></div>`}
  </section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.id)}: ${esc(r.subject)}</title>
<meta name="robots" content="noindex, nofollow">
${FONTS}
<style>
@page { size: A4; margin: 16mm 18mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #000; font-family: Tinos, 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.4; }
.pg { width: 210mm; min-height: 297mm; margin: 24px auto; padding: 16mm 18mm 18mm; border: 1px solid #000; background: #fff; }
.pg + .pg { break-before: page; }
.keep { break-inside: avoid; page-break-inside: avoid; }
@media print { .pg { width: auto; min-height: 0; margin: 0; padding: 0; border: 0; } }
.lh { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 3mm; border-bottom: 1.4pt solid #000; }
.lh img { height: 12mm; }
.lh .c { text-align: right; font: 8pt/1.5 Inter, Arial, sans-serif; }
.rule2 { border-top: 0.4pt solid #000; margin-top: 0.8mm; }
.ttl { display: flex; justify-content: space-between; align-items: baseline; margin: 5mm 0 2.5mm; }
.ttl span:first-child { font: 800 15pt Inter, Arial, sans-serif; letter-spacing: .14em; text-transform: uppercase; }
.ttl span:last-child { font: 9pt Inter, Arial, sans-serif; }
table { border-collapse: collapse; width: 100%; }
.meta td { border: 0.6pt solid #000; padding: 2mm 3mm; font-size: 10pt; vertical-align: top; width: 25%; }
.meta small, .filing small { display: block; font: 600 6.5pt Inter, Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; margin-bottom: .6mm; }
.subj { font-size: 13pt; font-weight: 700; margin: 4mm 0 3mm; }
.det th, .det td { border: 0.6pt solid #000; padding: 1.5mm 2.5mm; text-align: left; vertical-align: top; font-size: 10pt; }
.det th { width: 32%; font-weight: 700; }
.stmt { margin: 5mm 0 0; text-align: justify; }
.box { border: 0.8pt solid #000; padding: 2.5mm 4mm; margin-top: 4mm; }
.boxh { font: 700 7.5pt Inter, Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; margin: 1mm 0 2mm; }
.ticks { display: flex; gap: 8mm; flex-wrap: wrap; margin-bottom: 3mm; }
.ticks i { display: inline-block; width: 4mm; height: 4mm; border: 0.8pt solid #000; vertical-align: -0.6mm; margin-right: 1.5mm; }
.lines div { border-bottom: 0.5pt solid #000; height: 7mm; }
.sig { margin-top: 6mm; width: 95mm; margin-left: auto; break-inside: avoid; page-break-inside: avoid; }
.sigline { height: 12mm; }
.sigt th, .sigt td { border-bottom: 0.5pt solid #000; padding: 1.6mm 1mm; text-align: left; font-size: 10pt; }
.sigt th { width: 28mm; font: 600 7.5pt Inter, Arial, sans-serif; letter-spacing: .1em; text-transform: uppercase; }
.filing { margin-top: 6mm; break-inside: avoid; page-break-inside: avoid; }
.filing th { border: 0.6pt solid #000; padding: 1.5mm 3mm; text-align: left; font: 700 7.5pt Inter, Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.filing td { border: 0.6pt solid #000; padding: 1.5mm 3mm 7mm; width: 25%; vertical-align: top; }
.void { border: 2pt solid #000; text-align: center; font: 800 14pt Inter, Arial, sans-serif; letter-spacing: .3em; padding: 2mm; margin: 4mm 0; }
.webfoot { margin-top: 10mm; padding-top: 2mm; border-top: 0.4pt solid #000; font: 7.5pt Inter, Arial, sans-serif; display: flex; justify-content: space-between; }
@media print { .webfoot { display: none; } }
${TOOLBAR_CSS}
.tb { background: #000; }
</style></head><body>
${forPrint ? '' : toolbar(['<button class="primary" onclick="window.print()">Print now</button>', pdfHref ? `<a href="${esc(pdfHref)}">Download PDF</a>` : '', '<button onclick="window.close()">Print later</button>'])}
${r.status === 'void' ? `<div class="pg" style="min-height:0"><div class="void">CANCELLED: ${esc(r.note || '')}</div></div>` : ''}
${countersignPage}
${chairPage}
${autoPrint && !forPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),400))</script>' : ''}
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Licence grants (permissions to reuse ABR material)                  */
/* ------------------------------------------------------------------ */

export function licenceFooterTemplate(site, x) {
  const host = site.url.replace(/^https?:\/\//, '');
  return `<div style="width:100%;padding:0 18mm;font-family:Arial,sans-serif;font-size:7pt;color:#000;display:flex;justify-content:space-between;">
    <span>${esc(site.name)} · An initiative of ${esc(site.publisher)} · Licence ${esc(x.id)}</span>
    <span>Verify at ${esc(host)}/verify · Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

export function licenceDoc(site, x, { forPrint = false, pdfHref = '' } = {}) {
  const host = site.url.replace(/^https?:\/\//, '');
  const d = (s) => fmtDate(String(s).length === 10 ? s + 'T12:00:00+05:30' : s);
  const w = x.work || {};
  const rows = [
    ['Material', `${esc(w.title || x.refTitle)}<br><small>${w.type === 'issue' ? 'Issue' : 'Article'} ${esc(w.id || x.refId)}${w.authors ? ' · ' + esc(w.authors) : ''} · ${esc(w.doi ? 'https://doi.org/' + w.doi : w.url || '')}</small>`],
    ['Permitted use', esc(x.useLabel) + (x.commercial ? ' (commercial)' : '')],
    ['Portion and form', `${esc(x.portionLabel)} · ${esc(x.adaptationLabel)}`],
    ['Medium and audience', `${esc(x.mediumLabel)}${x.audience ? ' · ' + esc(x.audience) : ''}`],
    ['Territory and period', `${esc(x.territory)} · ${esc(d(x.startDate))} to ${esc(d(x.endDate))}`],
    ['Fee', esc(x.fee || 'None')],
    ['Use as described by the licensee', esc(x.purpose).replace(/\n/g, '<br>')]
  ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  const conditions = String(x.conditions || '').split(/\n+/).map((c) => c.trim()).filter(Boolean);
  const holderNote = w.holder
    ? `The copyright in this article belongs to its author, ${esc(w.holder)}, who has licensed ${esc(site.publisher)} to publish it and to grant permissions for its reuse.`
    : `${esc(site.publisher)} holds the copyright in this material.`;
  const banner = x.status === 'revoked' ? `REVOKED: ${esc(x.note || '')}` : x.expired ? `EXPIRED ON ${esc(d(x.endDate)).toUpperCase()}` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Licence ${esc(x.id)}: ${esc(w.title || x.refTitle)}</title>
<meta name="robots" content="noindex, nofollow">
${FONTS}
<style>
@page { size: A4; margin: 16mm 18mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #000; font-family: Tinos, 'Times New Roman', serif; font-size: 10pt; line-height: 1.38; }
.pg { width: 210mm; min-height: 297mm; margin: 24px auto; padding: 16mm 18mm 18mm; border: 1px solid #000; background: #fff; }
@media print { .pg { width: auto; min-height: 0; margin: 0; padding: 0; border: 0; } }
.lh { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 3mm; border-bottom: 1.4pt solid #000; }
.lh img { height: 12mm; }
.lh .c { text-align: right; font: 8pt/1.5 Inter, Arial, sans-serif; }
.rule2 { border-top: 0.4pt solid #000; margin-top: 0.8mm; }
.ttl { display: flex; justify-content: space-between; align-items: baseline; margin: 4mm 0 2mm; }
.ttl span:first-child { font: 800 16pt Inter, Arial, sans-serif; letter-spacing: .16em; text-transform: uppercase; }
.ttl span:last-child { font: 9pt Inter, Arial, sans-serif; }
table { border-collapse: collapse; width: 100%; }
.meta td { border: 0.6pt solid #000; padding: 1.6mm 3mm; font-size: 10pt; vertical-align: top; width: 25%; }
.meta small, .lbl { display: block; font: 600 6.5pt Inter, Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; margin-bottom: .6mm; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin: 3.5mm 0 3mm; }
.parties div { border-top: 0.8pt solid #000; padding-top: 2mm; }
p { margin: 0 0 2mm; text-align: justify; }
.det { margin: 1mm 0 3mm; }
.det th, .det td { border: 0.6pt solid #000; padding: 1.1mm 2.5mm; text-align: left; vertical-align: top; font-size: 10pt; }
.det th { width: 30%; font-weight: 700; }
.det small { font-size: 8.5pt; }
.credit { border: 1.2pt solid #000; padding: 2mm 3.5mm; margin: 1mm 0 3mm; break-inside: avoid; }
.credit .q { font-size: 10.5pt; font-style: italic; }
ol { margin: 0.5mm 0 3mm; padding-left: 6mm; font-size: 9.5pt; }
ol li { margin-bottom: 0.6mm; }
.sig { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; margin-top: 4mm; break-inside: avoid; }
.sig .who { width: 85mm; border-top: 0.6pt solid #000; padding-top: 2mm; }
.sig .ver { font: 8pt/1.5 Inter, Arial, sans-serif; max-width: 80mm; }
.banner { border: 2pt solid #000; text-align: center; font: 800 13pt Inter, Arial, sans-serif; letter-spacing: .2em; padding: 2mm; margin: 4mm 0; }
.webfoot { margin-top: 10mm; padding-top: 2mm; border-top: 0.4pt solid #000; font: 7.5pt Inter, Arial, sans-serif; display: flex; justify-content: space-between; }
@media print { .webfoot { display: none; } }
${TOOLBAR_CSS}
.tb { background: #000; }
</style></head><body>
${forPrint ? '' : toolbar(['<button class="primary" onclick="window.print()">Print</button>', pdfHref ? `<a href="${esc(pdfHref)}">Download PDF</a>` : ''])}
<section class="pg">
  <div class="lh">
    <img src="${site.url}/brand/logo/horizontal/ABR-Horizontal-Black.png" alt="${esc(site.name)}">
    <div class="c">An initiative of ${esc(site.publisher)}<br>Ahmedabad, Gujarat, India<br>${esc(host)} · ${esc(site.contactEmail)}</div>
  </div>
  <div class="rule2"></div>
  <div class="ttl"><span>Licence grant</span><span>Permission to reuse</span></div>
  <table class="meta"><tr>
    <td><small>Licence reference</small><b>${esc(x.id)}</b></td>
    <td><small>Date of grant</small>${esc(fmtDate(x.decidedAt))}</td>
    <td><small>Valid until</small>${esc(d(x.endDate))}</td>
    <td><small>Status</small>${x.status === 'revoked' ? 'Revoked' : x.expired ? 'Expired' : 'In force'}</td>
  </tr></table>
  ${banner ? `<div class="banner">${banner}</div>` : ''}
  <div class="parties">
    <div><span class="lbl">Licensor</span><b>${esc(site.publisher)}</b><br>publisher of ${esc(site.name)}</div>
    <div><span class="lbl">Licensee</span><b>${esc(x.name)}</b>${x.designation ? `<br>${esc(x.designation)}` : ''}${x.organisation ? `<br>${esc(x.organisation)}` : ''}</div>
  </div>
  <p>${esc(site.publisher)} grants the licensee a non-exclusive, non-transferable licence to use the material below, only for the use, period and territory stated, and on the conditions that follow. ${holderNote}</p>
  <table class="det">${rows}</table>
  <span class="lbl">Required credit line</span>
  <div class="credit"><div class="q">${esc(x.creditLine)}</div></div>
  <span class="lbl">Conditions</span>
  <ol>${conditions.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>
  ${x.note ? `<p><b>Note from the editors:</b> ${esc(x.note)}</p>` : ''}
  <div class="sig">
    <div class="ver">Issued electronically by ${esc(site.name)}. ${x.decidedBy === 'auto' ? 'Approved automatically under ABR’s educational-use policy.' : `Approved by ${esc(x.decidedByName)}.`} This grant is valid without a signature. Confirm it at <b>${esc(host)}/verify</b> with the reference <b>${esc(x.id)}</b>.</div>
    <div class="who">${x.signature ? `<img src="${x.signature}" alt="Signature" style="display:block;height:13mm;max-width:55mm;object-fit:contain;margin:-14mm 0 1mm">` : ''}<b>${esc((x.chair && x.chair.name) || '')}</b><br>${esc((x.chair && x.chair.title) || 'Chairperson')}, ${esc(site.name)}<br>for ${esc(site.publisher)}</div>
  </div>
  ${forPrint ? '' : `<div class="webfoot"><span>${esc(site.name)} · Licence ${esc(x.id)}</span><span>Verify at ${esc(host)}/verify</span></div>`}
</section>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Festival greetings from the Chair                                   */
/* ------------------------------------------------------------------ */

const GREET_PALETTE = {
  christmas:    { bg: '#fffaf2', ink: '#173b26', a: '#1f6b3a', b: '#c0262d', c: '#d9a93a', title: 'Season’s Greetings' },
  newyear:      { bg: '#0f1b3d', ink: '#f7f1e1', a: '#e8c25b', b: '#ffffff', c: '#e8c25b', title: 'Happy New Year' },
  uttarayan:    { bg: '#eef7ff', ink: '#0d2c4d', a: '#1e88e5', b: '#e53935', c: '#fdd835', title: 'Happy Uttarayan' },
  republic:     { bg: '#f7f8ff', ink: '#0b0a4a', a: '#06038d', b: '#ff9933', c: '#138808', title: 'Happy Republic Day' },
  holi:         { bg: '#fffdf8', ink: '#3a1030', a: '#e91e63', b: '#00bcd4', c: '#ffc107', title: 'Happy Holi' },
  independence: { bg: '#ffffff', ink: '#1b1b3a', a: '#ff9933', b: '#138808', c: '#06038d', title: 'Happy Independence Day' },
  navratri:     { bg: '#fff7ee', ink: '#4a0f22', a: '#7b1e3a', b: '#f5a623', c: '#c2185b', title: 'Happy Navratri' },
  diwali:       { bg: '#2a0833', ink: '#fff4dc', a: '#f6b93b', b: '#e8590c', c: '#ffd98a', title: 'Happy Diwali' }
};

export function greetingDoc(site, g, { forPrint = false, pdfHref = '' } = {}) {
  const p = GREET_PALETTE[g.theme] || GREET_PALETTE.diwali;
  const dark = ['newyear', 'diwali'].includes(g.theme);
  const host = site.url.replace(/^https?:\/\//, '');
  const orn = (ORNAMENTS[g.theme] || []).map((s) => `<span class="o">${s}</span>`).join('');
  const tri = ['independence', 'republic'].includes(g.theme);
  const logo = `${site.url}/brand/logo/horizontal/ABR-Horizontal-${dark ? 'White' : 'Black'}.png`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} from ${esc(site.name)}</title>
<meta name="robots" content="noindex, nofollow">
${FONTS}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;1,9..144,400&display=swap">
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: ${forPrint ? p.bg : '#d9d6cf'}; font-family: Inter, Arial, sans-serif; color: ${p.ink}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.card { width: 210mm; height: 297mm; margin: ${forPrint ? '0' : '24px auto'}; background: ${p.bg}; position: relative; overflow: hidden; padding: 22mm 22mm 18mm; display: flex; flex-direction: column; box-shadow: ${forPrint ? 'none' : '0 10px 40px rgba(0,0,0,.25)'}; }
@media print { body { background: ${p.bg}; } .card { margin: 0; box-shadow: none; } }
.frame { position: absolute; inset: 8mm; border: 1.2mm solid ${p.a}; pointer-events: none; }
.frame::after { content: ''; position: absolute; inset: 2.2mm; border: 0.4mm solid ${p.c}; }
${tri ? `.tri { position: absolute; left: 0; right: 0; top: 0; height: 6mm; background: linear-gradient(90deg, #ff9933 0 33.3%, #ffffff 33.3% 66.6%, #138808 66.6%); }
.tri.b { top: auto; bottom: 0; }` : ''}
.top { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 1; }
.top img { height: 11mm; }
.top .ref { font-size: 7.5pt; letter-spacing: .14em; text-transform: uppercase; opacity: .75; }
.orns { display: flex; justify-content: center; gap: 8mm; margin: 20mm 0 7mm; }
.orns .o svg { width: 20mm; height: 20mm; }
${g.theme === 'diwali' ? '.orns .o svg { width: 24mm; height: 20mm; }' : ''}
h1 { font-family: Fraunces, Georgia, serif; font-weight: 600; font-size: 40pt; line-height: 1.02; text-align: center; margin: 0 0 3mm; color: ${p.a}; letter-spacing: -0.01em; }
.sub { text-align: center; font-size: 9pt; letter-spacing: .3em; text-transform: uppercase; color: ${p.ink}; opacity: .8; margin-bottom: 14mm; }
.rule { width: 40mm; height: 0.6mm; background: ${p.c}; margin: 0 auto 12mm; }
.body { font-family: Fraunces, Georgia, serif; font-size: 13.5pt; line-height: 1.65; max-width: 140mm; margin: 0 auto 10mm; flex: 1; display: flex; flex-direction: column; justify-content: center; width: 100%; }
.body .dear { font-style: italic; margin-bottom: 5mm; }
.body p { margin: 0 0 4mm; }
.sign { margin-top: 8mm; }
.sign img { height: 18mm; max-width: 60mm; object-fit: contain; display: block; margin-bottom: 1mm; ${dark ? 'filter: invert(1) brightness(1.6);' : ''} }
.sign .gap { height: 14mm; }
.sign b { display: block; font-family: Inter, Arial, sans-serif; font-size: 11pt; }
.sign span { font-family: Inter, Arial, sans-serif; font-size: 9pt; opacity: .85; }
.foot { position: relative; z-index: 1; display: flex; justify-content: space-between; font-size: 7.5pt; opacity: .75; border-top: 0.3mm solid ${p.c}; padding-top: 3mm; }
.wash { position: absolute; width: 140mm; height: 140mm; border-radius: 50%; filter: blur(30px); opacity: ${g.theme === 'holi' ? '.35' : '.12'}; }
${TOOLBAR_CSS}
</style></head><body>
${forPrint ? '' : toolbar(['<button class="primary" onclick="window.print()">Print</button>', pdfHref ? `<a href="${esc(pdfHref)}">Download PDF</a>` : ''])}
<section class="card">
  <span class="wash" style="background:${p.a};top:-50mm;left:-50mm"></span><span class="wash" style="background:${p.b};bottom:-60mm;right:-50mm"></span>
  ${g.theme === 'holi' ? `<span class="wash" style="background:${p.c};top:90mm;right:-70mm"></span>` : ''}
  ${tri ? '<div class="tri"></div><div class="tri b"></div>' : ''}
  <div class="frame"></div>
  <div class="top"><img src="${logo}" alt="${esc(site.name)}"><span class="ref">${esc(g.themeName)} ${esc(String(g.date || '').slice(0, 4))}</span></div>
  <div class="orns">${orn}</div>
  <h1>${esc(p.title)}</h1>
  <div class="sub">From the Chair of ${esc(site.name)}</div>
  <div class="rule"></div>
  <div class="body">
    <div class="dear">Dear ${esc(g.name)}${g.organisation ? `, ${esc(g.organisation)}` : ''},</div>
    ${String(g.message || '').split(/\n\s*\n/).map((x) => `<p>${esc(x.trim())}</p>`).join('')}
    <p>With warm wishes,</p>
    <div class="sign">${g.signature ? `<img src="${g.signature}" alt="Signature">` : '<div class="gap"></div>'}
      <b>${esc((g.chair && g.chair.name) || '')}</b><span>${esc((g.chair && g.chair.title) || 'Chairperson')}, ${esc(site.name)}</span></div>
  </div>
  <div class="foot"><span>${esc(site.name)} · An initiative of ${esc(site.publisher)} · ${esc(host)}</span><span>${esc(g.id)} · ${esc(fmtDate(g.date))}</span></div>
</section>
</body></html>`;
}
