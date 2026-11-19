/**
 * Markets desk: the closing levels shown on /markets and in the optional masthead strip.
 *
 * Index, commodity and stock prices belong to the exchanges, and showing them on a public
 * website needs a display licence (for example through an authorised vendor such as TrueData).
 * Until ABR has one, editors enter the day's closing levels here from a public source, with the
 * source named, and the site shows them as "Closing levels on <date>". Currency reference rates
 * come automatically from the European Central Bank (via the Worker).
 */

var MARKET_DEFAULTS = [
  { key: 'nifty50',   name: 'NIFTY 50',      unit: '' },
  { key: 'sensex',    name: 'Sensex',        unit: '' },
  { key: 'banknifty', name: 'Nifty Bank',    unit: '' },
  { key: 'gold',      name: 'Gold (MCX)',    unit: '₹ per 10 g' },
  { key: 'crude',     name: 'Crude oil (MCX)', unit: '₹ per barrel' },
  { key: 'usdinr',    name: 'USD/INR (RBI reference)', unit: '₹' }
];
var MARKET_EDITORS = ['chair', 'eic', 'coo', 'editor'];

var MARKET_ROUTES = {
  'public.markets': function () { return marketsPublic_(); },
  'markets.get':    function (p, req) { marketsEditor_(req); return marketsRaw_(); },
  'markets.save':   marketsSave_,
  'markets.live':   marketsLive_
};

function marketsEditor_(req) {
  var u = requireUser_(req);
  if (MARKET_EDITORS.indexOf(u.role) === -1) throw new Error('Only editors can update market data.');
  return u;
}

function marketsRaw_() {
  var m = safeParse_(prop_('MARKETS')) || {};
  var items = (m.items && m.items.length ? m.items : MARKET_DEFAULTS.map(function (d) { return { key: d.key, name: d.name, unit: d.unit, value: '', change: '' }; }));
  return { asOf: m.asOf || '', source: m.source || '', note: m.note || '', items: items, strip: !!m.strip,
           live: m.live !== false, exchange: m.exchange === 'NSE' ? 'NSE' : 'BSE',
           updatedBy: m.updatedBy || '', updatedAt: m.updatedAt || '', history: m.history || [] };
}

function num_(v) {
  var s = String(v === undefined || v === null ? '' : v).replace(/[,₹\s]/g, '');
  if (s === '') return '';
  var n = Number(s);
  if (!isFinite(n)) throw new Error('“' + v + '” is not a number.');
  return n;
}

function marketsSave_(p, req) {
  var u = marketsEditor_(req);
  var asOf = String(p.asOf || '');
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(asOf)) throw new Error('Enter the date (and time) these levels are for.');
  var source = String(p.source || '').trim();
  if (source.length < 3) throw new Error('Name the source of these figures (for example, NSE and BSE websites).');
  var items = (p.items || []).slice(0, 12).map(function (x) {
    var name = String(x.name || '').trim().slice(0, 40);
    if (!name) return null;
    var value = num_(x.value), change = num_(x.change);
    var prev = value !== '' && change !== '' ? value - change : '';
    return { key: String(x.key || slugify_(name)).slice(0, 30), name: name, unit: String(x.unit || '').slice(0, 30),
             value: value, change: change, pct: prev ? Math.round(change / prev * 10000) / 100 : '' };
  }).filter(Boolean);
  if (!items.some(function (x) { return x.value !== ''; })) throw new Error('Enter at least one level.');
  var cur = marketsRaw_();
  var history = (cur.history || []).filter(function (h) { return h.asOf.slice(0, 10) !== asOf.slice(0, 10); });
  history.unshift({ asOf: asOf, items: items.map(function (x) { return { key: x.key, value: x.value }; }) });
  var m = { asOf: asOf, source: source.slice(0, 160), note: String(p.note || '').trim().slice(0, 300), items: items, strip: !!p.strip,
            live: p.live !== false, exchange: p.exchange === 'NSE' ? 'NSE' : 'BSE',
            updatedBy: u.name, updatedAt: now_(), history: history.slice(0, 30) };
  var json = JSON.stringify(m);
  if (json.length > 8500) { m.history = m.history.slice(0, 15); json = JSON.stringify(m); }
  PropertiesService.getScriptProperties().setProperty('MARKETS', json);
  log_(u.email, 'markets.save', '', asOf);
  return marketsRaw_();
}

function marketsPublic_() {
  var m = marketsRaw_();
  if (!m.asOf) return { asOf: '', items: [], strip: false, live: m.live, exchange: m.exchange };
  return { asOf: m.asOf, source: m.source, note: m.note, strip: m.strip, live: m.live, exchange: m.exchange,
           items: m.items.filter(function (x) { return x.value !== ''; }),
           history: m.history.slice(0, 20).reverse() };
}

// Switch the live TradingView widgets on or off without re-entering levels.
function marketsLive_(p, req) {
  var u = marketsEditor_(req);
  var m = safeParse_(prop_('MARKETS')) || {};
  m.live = p.live !== false; m.exchange = p.exchange === 'NSE' ? 'NSE' : 'BSE';
  PropertiesService.getScriptProperties().setProperty('MARKETS', JSON.stringify(m));
  log_(u.email, 'markets.live', '', (m.live ? 'on ' : 'off ') + m.exchange);
  return marketsRaw_();
}
