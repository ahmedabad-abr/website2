// /markets: closing levels entered by editors (until a licensed live feed is connected),
// currency reference rates from the European Central Bank (via frankfurter.dev, free, no key),
// a rupee converter, a 90-day USD/INR chart, and ABR's markets coverage.

const FX_API = 'https://api.frankfurter.dev/v1';
export const FX_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'SGD', 'CNY', 'CHF', 'AUD'];
const FX_NAMES = { USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', JPY: 'Japanese yen (100)', SGD: 'Singapore dollar', CNY: 'Chinese yuan', CHF: 'Swiss franc', AUD: 'Australian dollar' };

async function cachedJson(url, ttl, waitUntil) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(url);
  if (cache) { const hit = await cache.match(key); if (hit) { try { return await hit.json(); } catch {} } }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('FX ' + res.status);
  const j = await res.json();
  if (cache) {
    const p = cache.put(key, new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } }));
    if (waitUntil) waitUntil(p); else await p;
  }
  return j;
}

// Rupees per unit of each currency (per 100 for yen), with the change from the previous ECB fixing.
export async function fxRates(waitUntil) {
  try {
    const start = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10);
    const series = await cachedJson(`${FX_API}/${start}..?base=INR&symbols=${FX_CODES.join(',')}`, 6 * 3600, waitUntil);
    const days = Object.keys(series.rates || {}).sort();
    if (!days.length) return null;
    const inr = (d, c) => { const r = series.rates[d] && series.rates[d][c]; return r ? (c === 'JPY' ? 100 : 1) / r : null; };
    const last = days[days.length - 1], prev = days[days.length - 2];
    const rows = FX_CODES.map((c) => {
      const v = inr(last, c), p = prev ? inr(prev, c) : null;
      return { code: c, name: FX_NAMES[c], value: v, change: v && p ? v - p : null, pct: v && p ? (v - p) / p * 100 : null };
    });
    const usd = days.map((d) => ({ d, v: inr(d, 'USD') })).filter((x) => x.v);
    return { date: last, rows, usd };
  } catch (e) {
    console.error('fx fetch failed', e && e.message);
    return null;
  }
}

const n2 = (v, d = 2) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

function sparkline(points, w = 640, h = 180) {
  if (!points || points.length < 2) return '';
  const vs = points.map((p) => p.v), min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * (w - 8) + 4, y = (v) => h - 22 - ((v - min) / span) * (h - 44);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const lastP = points[points.length - 1];
  const fmt = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `<svg class="mk-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="US dollar in rupees over the last ${points.length} ECB fixings, from ${n2(points[0].v)} to ${n2(lastP.v)}">
    <path d="${d} L${x(points.length - 1)} ${h - 22} L4 ${h - 22}Z" fill="currentColor" opacity=".08"/>
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="${x(points.length - 1)}" cy="${y(lastP.v)}" r="4.5" fill="currentColor"/>
    <text x="4" y="${h - 4}" font-size="12" fill="#6b6b6b">${fmt(points[0].d)}</text>
    <text x="${w - 4}" y="${h - 4}" font-size="12" fill="#6b6b6b" text-anchor="end">${fmt(lastP.d)}</text>
    <text x="${w - 4}" y="14" font-size="12" fill="#6b6b6b" text-anchor="end">High ₹${n2(max)} · Low ₹${n2(min)}</text>
  </svg>`;
}

export function marketsPage(site, { layout, esc, fmtDate, card }, m, fx, coverage) {
  const items = (m && m.items) || [];
  const asOf = m && m.asOf ? new Date(m.asOf.length === 10 ? m.asOf + 'T15:30:00+05:30' : m.asOf + ':00+05:30') : null;
  const asOfText = asOf ? asOf.toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: m.asOf.length > 10 ? 'numeric' : undefined, minute: m.asOf.length > 10 ? '2-digit' : undefined, timeZone: 'Asia/Kolkata' }) : '';
  const tile = (x) => {
    const up = Number(x.change) > 0, down = Number(x.change) < 0;
    return `<div class="mk-tile ${up ? 'up' : down ? 'down' : ''}">
      <div class="mk-name">${esc(x.name)}</div>
      <div class="mk-val">${x.value === '' ? '—' : n2(x.value)}</div>
      <div class="mk-chg">${x.change === '' ? '&nbsp;' : `${up ? '▲' : down ? '▼' : ''} ${n2(Math.abs(x.change))}${x.pct !== '' ? ` (${up ? '+' : down ? '−' : ''}${n2(Math.abs(x.pct))}%)` : ''}`}</div>
      ${x.unit ? `<div class="mk-unit">${esc(x.unit)}</div>` : ''}
    </div>`;
  };
  const fxTable = fx ? `<table class="mk-fx"><thead><tr><th>Currency</th><th>₹</th><th>Change</th></tr></thead><tbody>
    ${fx.rows.map((r) => `<tr><td><b>${r.code}</b> <span>${esc(r.name)}</span></td><td>${r.value ? n2(r.value, r.code === 'JPY' ? 2 : 2) : '—'}</td>
      <td class="${r.change > 0.0005 ? 'up' : r.change < -0.0005 ? 'down' : ''}">${r.change === null ? '' : Math.abs(r.change) < 0.0005 ? 'unchanged' : `${r.change > 0 ? '▲' : '▼'} ${n2(Math.abs(r.change), 3)}`}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted">Currency rates are unavailable right now. Please try again later.</p>';
  const fxJson = fx ? JSON.stringify(Object.fromEntries(fx.rows.filter((r) => r.value).map((r) => [r.code, r.code === 'JPY' ? r.value / 100 : r.value]))) : '{}';
  return layout(site, {
    title: 'Markets', canonical: `${site.url}/markets`, bodyClass: 'mk-page',
    description: `Closing levels of Indian markets, rupee reference rates, a currency converter and ${site.name}'s markets coverage.`,
    body: `${m && m.live !== false ? tickerTape(m.exchange, true) : ''}<section class="mk-hero"><div class="mk-wrap">
      <div class="w-kicker">Markets</div>
      <h1>Markets today</h1>
      ${asOfText ? `<p class="mk-asof">ABR closing summary: levels on <b>${esc(asOfText)}</b> · Source: ${esc(m.source)}</p>` : '<p class="mk-asof">Market levels will appear here after the next close.</p>'}
      ${items.length ? `<div class="mk-tiles">${items.map(tile).join('')}</div>` : ''}
      ${m && m.note ? `<p class="mk-note">${esc(m.note)}</p>` : ''}
    </div></section>
    ${m && m.live !== false ? liveSection(m, esc) : ''}
    <div class="mk-wrap mk-grid">
      <section class="mk-card">
        <h2>The rupee</h2>
        <p class="mk-sub">Reference rates${fx ? ` for ${esc(fmtDate(fx.date + 'T12:00:00Z'))}` : ''}, rupees per unit. Source: European Central Bank, via Frankfurter.</p>
        ${fxTable}
      </section>
      <section class="mk-card">
        <h2>US dollar in rupees</h2>
        <p class="mk-sub">Daily ECB reference rate, last three months.</p>
        <div class="mk-chart">${fx ? sparkline(fx.usd) : ''}</div>
        <h3 class="mk-h3">Currency converter</h3>
        <form class="mk-conv" id="mkConv" onsubmit="return false">
          <input id="mkAmt" type="number" min="0" step="any" value="1000" aria-label="Amount">
          <select id="mkFrom" aria-label="From">${['INR', ...FX_CODES].map((c) => `<option ${c === 'USD' ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <span>to</span>
          <select id="mkTo" aria-label="To">${['INR', ...FX_CODES].map((c) => `<option ${c === 'INR' ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <output id="mkOut" class="mk-out"></output>
        </form>
        <p class="mk-fine">Reference rates, not dealing rates. Banks and money changers add margins.</p>
      </section>
    </div>
    ${coverage && coverage.length ? `<div class="mk-wrap"><h2 class="section-h">Markets and economy coverage</h2><div class="list">${coverage.map((a) => card(a)).join('')}</div></div>` : ''}
    <div class="mk-wrap"><p class="mk-disc">The closing levels at the top are end-of-day figures entered by ABR’s editors from the named public sources. Live prices and charts are provided by TradingView. Nothing here is investment advice. Index names are trademarks of their owners.</p></div>
    <script>
    (function () {
      var r = ${fxJson}; r.INR = 1;
      var a = document.getElementById('mkAmt'), f = document.getElementById('mkFrom'), t = document.getElementById('mkTo'), o = document.getElementById('mkOut');
      function go() {
        if (!r[f.value] || !r[t.value]) { o.textContent = ''; return; }
        var v = (Number(a.value) || 0) * r[f.value] / r[t.value];
        o.textContent = '= ' + v.toLocaleString('en-IN', { maximumFractionDigits: v < 10 ? 4 : 2 }) + ' ' + t.value;
      }
      [a, f, t].forEach(function (el) { el.addEventListener('input', go); });
      go();
    })();
    </script>`
  });
}

// One-line strip under the ribbon, if editors switch it on.
export function marketsStrip(ms, esc) {
  if (!ms || !ms.items || !ms.items.length) return '';
  return `<a class="mk-strip" href="/markets" aria-label="Markets">${ms.items.slice(0, 5).map((x) => {
    const up = Number(x.change) > 0, down = Number(x.change) < 0;
    return `<span><b>${esc(x.name)}</b> ${n2(x.value)} <i class="${up ? 'up' : down ? 'down' : ''}">${x.pct !== '' ? `${up ? '▲' : down ? '▼' : ''}${n2(Math.abs(x.pct))}%` : ''}</i></span>`;
  }).join('')}<em>Close, ${esc(ms.date)}</em></a>`;
}

/* ---------------- Live prices via TradingView widgets ---------------- */
// TradingView licenses the exchange data shown in its widgets; ABR only embeds them, with their credit.
// Some Indian symbols may be delayed (TradingView marks them "D").

export const POPULAR = [
  ['RELIANCE', 'Reliance Industries'], ['HDFCBANK', 'HDFC Bank'], ['ICICIBANK', 'ICICI Bank'], ['INFY', 'Infosys'], ['TCS', 'Tata Consultancy Services'],
  ['BHARTIARTL', 'Bharti Airtel'], ['SBIN', 'State Bank of India'], ['ITC', 'ITC'], ['LT', 'Larsen & Toubro'], ['KOTAKBANK', 'Kotak Mahindra Bank'],
  ['AXISBANK', 'Axis Bank'], ['HINDUNILVR', 'Hindustan Unilever'], ['BAJFINANCE', 'Bajaj Finance'], ['MARUTI', 'Maruti Suzuki'], ['SUNPHARMA', 'Sun Pharma'],
  ['HCLTECH', 'HCLTech'], ['NTPC', 'NTPC'], ['TITAN', 'Titan'], ['ULTRACEMCO', 'UltraTech Cement'], ['ADANIENT', 'Adani Enterprises'],
  ['ADANIPORTS', 'Adani Ports and SEZ'], ['ADANIGREEN', 'Adani Green Energy'], ['TORNTPHARM', 'Torrent Pharmaceuticals'], ['ZYDUSLIFE', 'Zydus Lifesciences'],
  ['ASTRAL', 'Astral'], ['GUJGASLTD', 'Gujarat Gas'], ['ARVIND', 'Arvind'], ['TATASTEEL', 'Tata Steel'], ['ASIANPAINT', 'Asian Paints'], ['WIPRO', 'Wipro'],
  ['ONGC', 'ONGC'], ['COALINDIA', 'Coal India'], ['M&M', 'Mahindra & Mahindra'], ['TECHM', 'Tech Mahindra'], ['CIPLA', 'Cipla'], ['DRREDDY', 'Dr Reddy’s'],
  ['TRENT', 'Trent'], ['BEL', 'Bharat Electronics'], ['JIOFIN', 'Jio Financial Services'], ['NESTLEIND', 'Nestlé India']
];

export function cleanSymbol(raw, exchange) {
  let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = /^(?:(NSE|BSE):)?([A-Z0-9&_.\-]{1,24})$/.exec(s);
  if (!m) return null;
  return { exchange: m[1] || exchange || 'BSE', code: m[2], full: `${m[1] || exchange || 'BSE'}:${m[2]}` };
}

function tvWidget(name, config, height) {
  const json = JSON.stringify({ colorTheme: 'light', isTransparent: true, locale: 'in', ...config }).replace(/</g, '\\u003c');
  return `<div class="tv-box"${height ? ` style="height:${height}px"` : ''}><div class="tradingview-widget-container">
    <div class="tradingview-widget-container__widget"></div>
    <div class="tradingview-widget-copyright"><a href="https://in.tradingview.com/" rel="noopener nofollow" target="_blank">Market data by TradingView</a></div>
    <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-${name}.js" async>${json}</script>
  </div></div>`;
}

export function tickerTape(exchange, dark) {
  const x = exchange || 'BSE';
  return `<div class="tv-tape">${tvWidget('ticker-tape', {
    symbols: [
      { proName: 'BSE:SENSEX', title: 'Sensex' }, { proName: 'NSE:NIFTY', title: 'NIFTY 50' }, { proName: 'BSE:BANKEX', title: 'Bankex' },
      { proName: 'FX_IDC:USDINR', title: 'USD/INR' }, { proName: 'TVC:GOLD', title: 'Gold' }, { proName: 'TVC:UKOIL', title: 'Brent' },
      { proName: `${x}:RELIANCE`, title: 'Reliance' }, { proName: `${x}:HDFCBANK`, title: 'HDFC Bank' }, { proName: `${x}:INFY`, title: 'Infosys' },
      { proName: `${x}:ADANIPORTS`, title: 'Adani Ports' }, { proName: `${x}:TORNTPHARM`, title: 'Torrent Pharma' }
    ], showSymbolLogo: false, displayMode: 'adaptive', colorTheme: dark ? 'dark' : 'light'
  })}</div>`;
}

export function searchForm(esc, value = '') {
  return `<form class="mk-search" action="/markets/stock" method="get" role="search">
    <label for="mkQ" class="sr">Search a company or stock symbol</label>
    <input id="mkQ" name="s" list="mkList" value="${esc(value)}" placeholder="Search a company or symbol, e.g. Reliance or NSE:TCS" autocomplete="off" spellcheck="false" required>
    <datalist id="mkList">${POPULAR.map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join('')}</datalist>
    <button type="submit">Search</button>
  </form>`;
}

export function liveSection(m, esc) {
  const x = (m && m.exchange) || 'BSE';
  return `<section class="mk-live"><div class="mk-wrap">
    <div class="mk-live-h"><h2>Live markets</h2>${searchForm(esc)}</div>
    <div class="mk-live-grid">
      <div class="mk-card">${tvWidget('market-overview', {
        dateRange: '1D', showChart: true, width: '100%', height: '100%', showSymbolLogo: false, showFloatingTooltip: true,
        tabs: [
          { title: 'Indices', symbols: [{ s: 'BSE:SENSEX', d: 'Sensex' }, { s: 'NSE:NIFTY', d: 'NIFTY 50' }, { s: 'NSE:BANKNIFTY', d: 'Nifty Bank' }, { s: 'BSE:BANKEX', d: 'Bankex' }, { s: 'NSE:CNXIT', d: 'Nifty IT' }] },
          { title: 'Gujarat', symbols: [['ADANIENT', 'Adani Enterprises'], ['ADANIPORTS', 'Adani Ports'], ['TORNTPHARM', 'Torrent Pharma'], ['ZYDUSLIFE', 'Zydus Lifesciences'], ['ASTRAL', 'Astral'], ['GUJGASLTD', 'Gujarat Gas']].map(([s, d]) => ({ s: `${x}:${s}`, d })) },
          { title: 'Currencies', symbols: [{ s: 'FX_IDC:USDINR', d: 'USD/INR' }, { s: 'FX_IDC:EURINR', d: 'EUR/INR' }, { s: 'FX_IDC:GBPINR', d: 'GBP/INR' }, { s: 'FX_IDC:JPYINR', d: 'JPY/INR' }] },
          { title: 'Commodities', symbols: [{ s: 'TVC:GOLD', d: 'Gold (US$/oz)' }, { s: 'TVC:SILVER', d: 'Silver (US$/oz)' }, { s: 'TVC:UKOIL', d: 'Brent crude' }] }
        ]
      }, 520)}</div>
      <div class="mk-card">${tvWidget('hotlists', { exchange: 'BSE', dateRange: '1D', showChart: true, width: '100%', height: '100%', showSymbolLogo: false }, 520)}</div>
    </div>
    <div class="mk-card mk-screener"><h3 class="mk-h3">Stock screener</h3>${tvWidget('screener', { width: '100%', height: '100%', defaultColumn: 'overview', defaultScreen: 'general', market: 'india', showToolbar: true }, 560)}</div>
    <p class="mk-fine">Live data is provided by TradingView under its own exchange licences; some Indian symbols may be delayed by up to 15 minutes (marked “D”). It is shown for information only and is not investment advice.</p>
  </div></section>`;
}

export function stockPage(site, { layout, esc, card }, sym, m, coverage) {
  const name = (POPULAR.find(([c]) => c === sym.code) || [])[1] || sym.code;
  const other = sym.exchange === 'NSE' ? 'BSE' : 'NSE';
  return layout(site, {
    title: `${name} share price, chart and financials`, canonical: `${site.url}/markets/stock/${encodeURIComponent(sym.full)}`, bodyClass: 'mk-page',
    description: `${name} (${sym.full}) share price, chart, key financials and company profile, with data by TradingView, and ${site.name}'s coverage.`,
    body: `${tickerTape(sym.exchange)}
    <div class="mk-wrap mk-stock">
      <nav class="mk-crumbs"><a href="/markets">Markets</a> › ${esc(name)}</nav>
      ${searchForm(esc, sym.code)}
      <div class="mk-stock-h"><span>${esc(sym.full)}</span> <a href="/markets/stock/${encodeURIComponent(other + ':' + sym.code)}">View on ${other}</a></div>
      ${tvWidget('symbol-info', { symbol: sym.full, width: '100%' })}
      <div class="mk-card mk-chartbox">${tvWidget('advanced-chart', { symbol: sym.full, autosize: true, interval: 'D', timezone: 'Asia/Kolkata', style: '1', allow_symbol_change: true, hide_side_toolbar: true, calendar: false, support_host: 'https://www.tradingview.com' }, 560)}</div>
      <div class="mk-grid">
        <div class="mk-card"><h3 class="mk-h3">Key financials</h3>${tvWidget('financials', { symbol: sym.full, width: '100%', height: '100%', displayMode: 'regular' }, 520)}</div>
        <div class="mk-card"><h3 class="mk-h3">Company profile</h3>${tvWidget('symbol-profile', { symbol: sym.full, width: '100%', height: '100%' }, 300)}
          <h3 class="mk-h3">Technical summary</h3>${tvWidget('technical-analysis', { symbol: sym.full, interval: '1D', width: '100%', height: '100%', showIntervalTabs: true, displayMode: 'single' }, 420)}</div>
      </div>
      ${coverage && coverage.length ? `<h2 class="section-h">ABR on ${esc(name)}</h2><div class="list">${coverage.map((a) => card(a)).join('')}</div>` : ''}
      <p class="mk-disc">Prices, charts and financials are provided by TradingView under its own exchange licences and may be delayed. The technical summary is generated automatically by TradingView from price indicators; it is not ABR’s view and not investment advice.</p>
    </div>`
  });
}
