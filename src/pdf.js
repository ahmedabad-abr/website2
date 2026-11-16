// Generates article PDFs with Cloudflare Browser Rendering (REST /pdf endpoint)
// and stores each one so it is rendered only once per article version.
//
// Required Worker secrets: CF_ACCOUNT_ID, CF_API_TOKEN (token with "Browser Rendering: Edit").
// Optional KV binding:     PDFS (permanent storage; without it the edge cache is used).

import { renderPaper, paperFooterTemplate, PAPER_VERSION } from './paper.js';

export function pdfKey(a) {
  return `pdf:${a.id}:${a.modifiedAt || a.publishedAt}:v${PAPER_VERSION}`;
}

export async function getPdf(env, site, a, waitUntil) {
  const key = pdfKey(a);
  if (env.PDFS) {
    const hit = await env.PDFS.get(key, 'arrayBuffer');
    if (hit) return hit;
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: renderPaper(site, a),
      gotoOptions: { waitUntil: 'networkidle0', timeout: 45000 },
      pdfOptions: {
        format: 'a4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: paperFooterTemplate(site, a),
        margin: { top: '12mm', bottom: '16mm', left: '12mm', right: '12mm' }
      }
    })
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('pdf')) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`PDF rendering failed (HTTP ${res.status}): ${detail}`);
  }
  const buf = await res.arrayBuffer();
  if (env.PDFS) {
    const put = env.PDFS.put(key, buf, { metadata: { id: a.id, slug: a.slug, createdAt: new Date().toISOString() } });
    if (waitUntil) waitUntil(put); else await put;
  }
  return buf;
}
