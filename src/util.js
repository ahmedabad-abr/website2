export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TZ = 'Asia/Kolkata';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

// Calendar parts of an ISO timestamp in India Standard Time.
export function dateParts(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(iso) {            // 16 November 2026
  const p = dateParts(iso);
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : '';
}
export function fmtUS(iso) {              // November 16, 2026
  const p = dateParts(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : '';
}
export function fmtMLA(iso) {             // 16 Nov. 2026
  const p = dateParts(iso);
  return p ? `${p.d} ${MLA_MONTHS[p.m - 1]} ${p.y}` : '';
}
export function fmtSlash(iso) {           // 2026/11/16  (Highwire citation_* format)
  const p = dateParts(iso);
  return p ? `${p.y}/${pad(p.m)}/${pad(p.d)}` : '';
}
export function fmtISODate(iso) {         // 2026-11-16
  const p = dateParts(iso);
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : '';
}
export function isoWithOffset(iso) {      // 2026-11-16T12:03:00+05:30
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().replace(/\.\d{3}Z$/, '+05:30');
}
export function year(iso) { const p = dateParts(iso); return p ? p.y : ''; }
export function monthName(iso) { const p = dateParts(iso); return p ? MONTHS[p.m - 1] : ''; }
export function dayNum(iso) { const p = dateParts(iso); return p ? p.d : ''; }

// "Fenil Pritesh Shah" → { first: 'Fenil Pritesh', last: 'Shah', initials: 'F. P.' }
export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: '', last: parts[0] || '', initials: '' };
  const last = parts.pop();
  return { first: parts.join(' '), last, initials: parts.map((p) => p[0].toUpperCase() + '.').join(' ') };
}

export function readingMinutes(words) {
  return Math.max(1, Math.round((Number(words) || 0) / 220));
}

export function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
}
