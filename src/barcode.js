// Printable barcodes as pure SVG (no images, prints crisply in black and white).
//  - code128(text): Code 128 (set B) for any printable ASCII text, e.g. "ABR-V1-N06-2026"
//  - issnEan13(issn, issue): EAN-13 periodical barcode (prefix 977) for a magazine with an ISSN

const C128 = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112'
];

export function code128(text, { height = 60, module = 2, label = true } = {}) {
  const chars = String(text).replace(/[^\x20-\x7e]/g, '');
  const codes = [104];                                  // Start B
  for (const ch of chars) codes.push(ch.charCodeAt(0) - 32);
  let sum = 104;
  codes.slice(1).forEach((c, i) => { sum += c * (i + 1); });
  codes.push(sum % 103, 106);                           // checksum, Stop
  const quiet = 10 * module;
  let x = quiet;
  const bars = [];
  for (const c of codes) {
    const pattern = C128[c];
    for (let i = 0; i < pattern.length; i++) {
      const w = Number(pattern[i]) * module;
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
    }
  }
  const width = x + quiet;
  const textH = label ? 16 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + textH}" width="${width}" height="${height + textH}" role="img" aria-label="Barcode ${esc(chars)}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars.join('')}</g>` +
    (label ? `<text x="${width / 2}" y="${height + 13}" text-anchor="middle" font-family="Courier New, monospace" font-size="12" fill="#000">${esc(chars)}</text>` : '') +
    `</svg>`;
}

// ---------- EAN-13 ----------
const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

export function ean13Check(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}

// ISSN 1234-5679 → EAN-13 977 1234567 00 C (the ISSN check digit is dropped; "00" = price/variant code)
export function issnToEan13(issn, variant = '00') {
  const d = String(issn || '').replace(/[^0-9Xx]/g, '');
  if (d.length !== 8) return '';
  const base = '977' + d.slice(0, 7) + String(variant).padStart(2, '0').slice(0, 2);
  return base + ean13Check(base);
}

export function ean13(digits, { height = 70, module = 2, addOn = '' } = {}) {
  const d = String(digits);
  if (!/^\d{13}$/.test(d)) return '';
  const parity = PARITY[Number(d[0])];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[Number(d[i])];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[Number(d[i])];
  bits += '101';
  const quiet = 11 * module;
  const guards = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  const rects = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') rects.push(`<rect x="${quiet + i * module}" y="0" width="${module}" height="${guards.has(i) ? height + 8 : height}"/>`);
  }
  let width = quiet * 2 + bits.length * module;
  // Optional 2-digit add-on (issue number), placed to the right as on magazine covers.
  let addSvg = '';
  if (/^\d{2}$/.test(addOn)) {
    const v = Number(addOn) % 4;
    const par = ['LL', 'LG', 'GL', 'GG'][v];
    let ab = '1011' + (par[0] === 'L' ? L : G)[Number(addOn[0])] + '01' + (par[1] === 'L' ? L : G)[Number(addOn[1])];
    const ax = width - quiet + 9 * module;
    for (let i = 0; i < ab.length; i++) if (ab[i] === '1') addSvg += `<rect x="${ax + i * module}" y="14" width="${module}" height="${height - 6}"/>`;
    addSvg += `<text x="${ax + (ab.length * module) / 2}" y="11" text-anchor="middle" font-family="Courier New, monospace" font-size="13" fill="#000">${addOn}</text>`;
    width = ax + ab.length * module + quiet;
  }
  const t = (x, s) => `<text x="${x}" y="${height + 20}" text-anchor="middle" font-family="Courier New, monospace" font-size="15" fill="#000">${s}</text>`;
  const labels = t(quiet - 7, d[0]) + t(quiet + module * 24, d.slice(1, 7)) + t(quiet + module * 70, d.slice(7));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 24}" width="${width}" height="${height + 24}" role="img" aria-label="EAN-13 ${d}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join('')}${addSvg}</g>${labels}</svg>`;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
