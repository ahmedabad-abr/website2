// Allow-list HTML sanitizer shared by the public site (Cloudflare) and the portal (browser).
// Anything not on the list is removed; text is always escaped.

const ALLOWED = new Set([
  'p', 'br', 'h2', 'h3', 'h4', 'strong', 'em', 'u', 's', 'blockquote', 'ul', 'ol', 'li',
  'a', 'img', 'figure', 'figcaption', 'hr', 'sup', 'sub', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'
]);
const RENAME = { b: 'strong', i: 'em', div: 'p', h1: 'h2', strike: 's', del: 's' };
const VOID = new Set(['br', 'img', 'hr']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript',
  'template', 'svg', 'math', 'form', 'textarea', 'select', 'button', 'head', 'title']);
const ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
  ol: ['start']
};

const esc = (s) => String(s).replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&colon;/gi, ':').replace(/&tab;/gi, '\t').replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&');
}

function safeUrl(url, forImage) {
  const raw = decodeEntities(url).replace(/[\u0000- \u007f-\u009f]/g, '');
  if (forImage) return /^https:\/\//i.test(raw) ? url.trim() : null;
  if (/^(https?:|mailto:)/i.test(raw) || /^[/#]/.test(raw)) return url.trim();
  return null;
}

function parseAttrs(str) {
  const out = [];
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(str))) out.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']);
  return out;
}

export function sanitizeHtml(html) {
  const input = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
  let out = '';
  let last = 0;
  let dropDepth = 0;
  let dropTag = null;
  const stack = [];
  let m;

  while ((m = tagRe.exec(input))) {
    const text = input.slice(last, m.index);
    last = tagRe.lastIndex;
    if (!dropDepth) out += esc(text);

    const closing = m[1] === '/';
    let name = m[2].toLowerCase();

    if (dropDepth) {
      if (name === dropTag) dropDepth += closing ? -1 : 1;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing) { dropDepth = 1; dropTag = name; }
      continue;
    }
    name = RENAME[name] || name;
    if (!ALLOWED.has(name)) continue;

    if (closing) {
      if (VOID.has(name)) continue;
      const idx = stack.lastIndexOf(name);
      if (idx === -1) continue;
      while (stack.length > idx) out += `</${stack.pop()}>`;
      continue;
    }

    let attrs = '';
    const allowed = ATTRS[name] || [];
    for (const [k, v] of parseAttrs(m[3] || '')) {
      if (!allowed.includes(k)) continue;
      if (k === 'href' || k === 'src') {
        const u = safeUrl(v, k === 'src');
        if (!u) continue;
        attrs += ` ${k}="${escAttr(u)}"`;
      } else if (['width', 'height', 'colspan', 'rowspan', 'start'].includes(k)) {
        if (/^\d{1,4}$/.test(v)) attrs += ` ${k}="${v}"`;
      } else {
        attrs += ` ${k}="${escAttr(v)}"`;
      }
    }
    if (name === 'img' && !/\ssrc=/.test(attrs)) continue;
    if (name === 'a' && /href="(https?:)?\/\//i.test(attrs)) attrs += ' rel="noopener nofollow" target="_blank"';
    if (name === 'img') attrs += ' loading="lazy"';

    out += `<${name}${attrs}>`;
    if (!VOID.has(name)) stack.push(name);
  }
  if (!dropDepth) out += esc(input.slice(last));
  while (stack.length) out += `</${stack.pop()}>`;

  // Remove empty paragraphs left over from editors.
  return out.replace(/<p>(\s|&nbsp;|<br>)*<\/p>/g, '');
}

export function textFromHtml(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
