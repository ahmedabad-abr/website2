/**
 * Company profiles behind the downloadable "ABR Company Brief" PDF on each stock page.
 *
 * Everything in a brief is ABR's own work: a description written by an editor, key facts and a
 * financial summary taken from the company's annual reports or exchange filings (with sources),
 * and links to ABR's coverage. Live prices and TradingView data are never copied into it.
 * No AI is used anywhere in the markets section.
 */

var COMPANY_COLS = ['code', 'name', 'status', 'sector', 'industry', 'hq', 'founded', 'website', 'leaders',
                    'description', 'facts', 'financials', 'currency', 'sources', 'tags', 'aiDrafted',
                    'version', 'createdAt', 'updatedAt', 'updatedBy', 'reviewedBy'];

var COMPANY_ROUTES = {
  'companies.list':  companiesList_,
  'companies.get':   function (p, req) { marketsEditor_(req); return companyView_(findCompany_(p.code), true); },
  'companies.save':  companiesSave_,
  'public.company':  function (p) { var c = findCompany_(p.code); return c && c.status === 'published' ? companyView_(c, false) : null; }
};

var FIN_FIELDS = [['revenue', 'Revenue from operations'], ['ebitda', 'EBITDA'], ['netProfit', 'Net profit'], ['eps', 'Earnings per share (₹)'],
                  ['totalAssets', 'Total assets'], ['netWorth', 'Net worth'], ['debt', 'Total borrowings'], ['employees', 'Employees']];

function readCompanies_() { return sheetRows_('Companies', COMPANY_COLS); }
function findCompany_(code) {
  code = String(code || '').trim().toUpperCase().replace(/^(NSE|BSE):/, '');
  return readCompanies_().filter(function (c) { return c.code === code; })[0] || null;
}

function companyView_(c, full) {
  if (!c) return null;
  var v = {
    code: c.code, name: c.name, status: c.status, sector: c.sector, industry: c.industry, hq: c.hq, founded: c.founded,
    website: c.website, leaders: c.leaders, description: c.description,
    facts: safeParse_(c.facts) || [], financials: safeParse_(c.financials) || [], currency: c.currency || '₹ crore',
    sources: c.sources, tags: c.tags, aiDrafted: truthy_(c.aiDrafted), version: Number(c.version) || 1,
    updatedAt: c.updatedAt, reviewedBy: c.reviewedBy, finFields: FIN_FIELDS
  };
  if (full) { v.updatedBy = c.updatedBy; v.createdAt = c.createdAt; }
  return v;
}

function companiesList_(p, req) {
  marketsEditor_(req);
  return readCompanies_().sort(function (a, b) { return a.name < b.name ? -1 : 1; }).map(function (c) {
    return { code: c.code, name: c.name, status: c.status, sector: c.sector, updatedAt: c.updatedAt, updatedBy: c.updatedBy, aiDrafted: truthy_(c.aiDrafted) };
  });
}

function companiesSave_(p, req) {
  var u = marketsEditor_(req);
  var code = String(p.code || '').trim().toUpperCase().replace(/^(NSE|BSE):/, '');
  if (!/^[A-Z0-9&_.\-]{1,24}$/.test(code)) throw new Error('Enter the stock symbol, for example RELIANCE.');
  var name = String(p.name || '').trim();
  if (name.length < 2) throw new Error('Enter the company name.');
  var publish = p.status === 'published';
  var c = findCompany_(code) || { code: code, createdAt: now_(), version: 0 };
  var desc = String(p.description || '').trim();
  var sources = String(p.sources || '').trim();
  if (publish) {
    if (desc.length < 200) throw new Error('Write a description of at least a few sentences before publishing.');
    if (sources.split(/\n/).filter(function (s) { return /https?:\/\//.test(s); }).length < 1) throw new Error('List at least one source with a link (for example the annual report) before publishing.');
    if (truthy_(p.aiDrafted) && !p.checked) throw new Error('This profile was drafted by AI. Tick “I have checked every fact and figure against the sources” before publishing.');
  }
  var facts = (p.facts || []).slice(0, 12).map(function (f) { return { label: String(f.label || '').trim().slice(0, 60), value: String(f.value || '').trim().slice(0, 160) }; })
    .filter(function (f) { return f.label && f.value; });
  var fin = (p.financials || []).slice(0, 6).map(function (r) {
    var o = { year: String(r.year || '').trim().slice(0, 12) };
    FIN_FIELDS.forEach(function (f) { var v = String(r[f[0]] === undefined ? '' : r[f[0]]).replace(/[,₹\s]/g, ''); o[f[0]] = v === '' || !isFinite(Number(v)) ? '' : Number(v); });
    return o;
  }).filter(function (r) { return r.year; });
  c.name = name.slice(0, 120); c.sector = String(p.sector || '').slice(0, 60); c.industry = String(p.industry || '').slice(0, 80);
  c.hq = String(p.hq || '').slice(0, 80); c.founded = String(p.founded || '').slice(0, 20); c.website = /^https?:\/\//.test(p.website || '') ? String(p.website).slice(0, 200) : '';
  c.leaders = String(p.leaders || '').slice(0, 300); c.description = desc.slice(0, 6000);
  c.facts = JSON.stringify(facts); c.financials = JSON.stringify(fin); c.currency = String(p.currency || '₹ crore').slice(0, 20);
  c.sources = sources.slice(0, 4000); c.tags = String(p.tags || '').slice(0, 200);
  c.aiDrafted = truthy_(p.aiDrafted) ? 'TRUE' : 'FALSE';
  if (publish && c.status !== 'published') c.version = (Number(c.version) || 0) + 1;
  else if (publish) c.version = (Number(c.version) || 1) + (p.newVersion ? 1 : 0);
  c.status = publish ? 'published' : 'draft';
  c.updatedAt = now_(); c.updatedBy = u.name;
  if (publish) c.reviewedBy = u.name;
  writeRow_('Companies', COMPANY_COLS, c);
  log_(u.email, 'company.' + c.status, '', code);
  return companyView_(c, true);
}
