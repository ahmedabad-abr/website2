// Seasonal designs and festival greetings (Worker side).
// The active design comes from Apps Script (public.site) and is cached here for two minutes,
// so switching a design in the portal shows on the site within a couple of minutes.

import { backend } from './api.js';

const STATE_URL = 'https://abr.internal/site-state';
const OFF = { aiNote: false, theme: null, greetingsOpen: false, v: 'off' };

export async function siteState(env, waitUntil) {
  if (!env.APPS_SCRIPT_URL) return OFF;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(STATE_URL);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) { try { return await hit.json(); } catch {} }
  }
  let s = OFF;
  try { s = (await backend(env, 'public.site')) || OFF; } catch { return OFF; }
  if (cache) {
    const res = new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' } });
    const p = cache.put(key, res);
    if (waitUntil) waitUntil(p); else await p;
  }
  return s;
}

// Small inline SVG ornaments per design (no external images).
const KITE = (c1, c2) => `<svg viewBox="0 0 40 52" aria-hidden="true"><path d="M20 2 38 20 20 40 2 20Z" fill="${c1}"/><path d="M20 2v38M2 20h36" stroke="${c2}" stroke-width="1.4"/><path d="M20 40c-3 5 3 6 0 11" fill="none" stroke="${c2}" stroke-width="1"/></svg>`;
const DIYA = `<svg viewBox="0 0 48 40" aria-hidden="true"><path class="fl" d="M24 4c4 6 4 10 0 13-4-3-4-7 0-13Z" fill="#ffcc4d"/><path d="M4 22h40c-2 10-10 15-20 15S6 32 4 22Z" fill="#c8541c"/><path d="M8 22h32" stroke="#ffd98a" stroke-width="2"/></svg>`;
const STAR = (c) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1l2.9 7.3L23 9l-6 5.2L18.8 22 12 18l-6.8 4L7 14.2 1 9l8.1-.7z" fill="${c}"/></svg>`;
const HOLLY = `<svg viewBox="0 0 60 40" aria-hidden="true"><path d="M30 20C20 6 6 10 2 4c2 10 4 16 16 18-6 4-4 10-10 14 12 0 16-6 22-16Z" fill="#1f6b3a"/><path d="M30 20C40 6 54 10 58 4c-2 10-4 16-16 18 6 4 4 10 10 14-12 0-16-6-22-16Z" fill="#1f6b3a"/><circle cx="26" cy="22" r="4" fill="#c0262d"/><circle cx="34" cy="22" r="4" fill="#c0262d"/><circle cx="30" cy="16" r="4" fill="#c0262d"/></svg>`;
const DANDIYA = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 40 36 6" stroke="#c2185b" stroke-width="4" stroke-linecap="round"/><path d="M40 40 12 6" stroke="#f5a623" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="23" r="3" fill="#fff"/></svg>`;
const CHAKRA = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="#06038d" stroke-width="2.5"/><circle cx="24" cy="24" r="3" fill="#06038d"/>${Array.from({ length: 24 }, (_, i) => { const a = (i * 15) * Math.PI / 180; return `<line x1="24" y1="24" x2="${(24 + 19 * Math.cos(a)).toFixed(2)}" y2="${(24 + 19 * Math.sin(a)).toFixed(2)}" stroke="#06038d" stroke-width="1"/>`; }).join('')}</svg>`;
const SPLASH = (c) => `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4c5 0 6 6 11 6s6 7 3 11 2 9-3 12-8-1-11 2-9 0-11-4-7-5-5-11-1-9 4-11 7-5 12-5Z" fill="${c}"/></svg>`;

export const ORNAMENTS = {
  christmas: [HOLLY, STAR('#d9a93a'), HOLLY],
  newyear: [STAR('#e8c25b'), STAR('#ffffff'), STAR('#e8c25b')],
  uttarayan: [KITE('#e53935', '#5a1a1a'), KITE('#fdd835', '#5a4a00'), KITE('#1e88e5', '#0d2c4d')],
  holi: [SPLASH('#e91e63'), SPLASH('#ffc107'), SPLASH('#00bcd4'), SPLASH('#8bc34a')],
  navratri: [DANDIYA, DANDIYA],
  diwali: [DIYA, DIYA, DIYA],
  independence: [CHAKRA],
  republic: [CHAKRA]
};

// Particles that drift across the page (CSS animates them; disabled for reduced motion).
const FX = { christmas: 'snow', newyear: 'spark', uttarayan: 'kite', holi: 'colour', diwali: 'spark', navratri: 'petal' };

export function themeHead(state, assetUrl) {
  if (!state || !state.theme) return '';
  return `<link rel="stylesheet" href="${assetUrl}">`;
}

export function themeRibbon(state, esc) {
  const t = state && state.theme;
  if (!t) return '';
  if (t.mourning) {
    return `<div class="fest-ribbon fest-mourning" role="note"><span class="fest-band" aria-hidden="true"></span>
      <p>${t.mourningName ? `Ahmedabad Business Review mourns the passing of <b>${esc(t.mourningName)}</b>.` : ''} ${esc(t.mourningNote || '')}</p></div>`;
  }
  const orn = (ORNAMENTS[t.key] || []).map((s) => `<span class="fest-orn">${s}</span>`).join('');
  return `<div class="fest-ribbon" role="note">
    <span class="fest-orns" aria-hidden="true">${orn}</span>
    <p><b>${esc(t.greeting)}</b> from all of us at Ahmedabad Business Review.</p>
    ${state.greetingsOpen ? `<a class="fest-cta" href="/greetings">Get a greeting from our Chair →</a>` : ''}
  </div>`;
}

export function themeFx(state) {
  const t = state && state.theme;
  const kind = t && FX[t.key];
  if (!kind) return '';
  const n = kind === 'kite' ? 7 : 18;
  return `<div class="fest-fx fx-${kind}" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
    `<i style="--x:${(i * 53) % 100}%;--d:${(9 + (i * 7) % 11)}s;--delay:-${(i * 13) % 17}s;--s:${0.6 + ((i * 29) % 10) / 10}">${kind === 'kite' ? KITE(['#e53935', '#fdd835', '#1e88e5', '#43a047', '#8e24aa'][i % 5], '#333') : ''}</i>`).join('')}</div>`;
}

// Create the greeting, render it as a PDF and have Apps Script email it.
export async function requestGreeting(env, payload, meta, renderDoc, htmlToPdf, site) {
  const g = await backend(env, 'public.greeting.create', payload, '', meta);
  let pdf = '';
  if (site.pdf) {
    try {
      const buf = await htmlToPdf(env, `greeting:${g.id}`, renderDoc(site, g, { forPrint: true }), { preferCSSPageSize: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      pdf = btoa(bin);
    } catch (e) { console.error('greeting pdf failed', e && e.message); }
  }
  await backend(env, 'public.greeting.send', { id: g.id, key: g.key, pdf }, '', meta);
  return { id: g.id, url: `/greetings/${g.id}?k=${g.key}`, theme: g.themeName };
}
